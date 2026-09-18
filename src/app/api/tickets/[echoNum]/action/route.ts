import { NextResponse } from "next/server";
import {
  AttachmentError,
  decodeUploads,
  validateUploads,
  type IncomingFile,
} from "@/lib/data/attachments";
import {
  applyAction,
  assertActionInput,
  InternalAttachmentError,
  ReasonRequiredError,
  SolutionRequiredError,
  supportsAction,
  UnsupportedActionError,
} from "@/lib/data/mutations";
import { getTicket } from "@/lib/data/tickets";
import { MODULE } from "@/lib/codes";
import { select } from "@/lib/db";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { seoulWallDate } from "@/lib/format";
import { actionLabel, canDo } from "@/lib/permissions";
import { isBlankHtml } from "@/lib/sanitize";
import { actionSchema } from "@/lib/schemas";
import { currentUser, loadCustomerConfig } from "@/lib/session";
import type { TicketAction } from "@/lib/types";

/**
 * 데이터 계층이 던지는 **입력 오류**를 400 문장으로 바꾼다. 모르는 오류는 null — 삼키지 않고
 * 호출자가 다시 던진다(500). 쓰기 게이트 앞의 판정과 실행 중의 판정이 같은 표를 쓴다.
 */
function inputErrorResponse(e: unknown): NextResponse | null {
  const code =
    e instanceof AttachmentError
      ? "INVALID_ATTACHMENT"
      : e instanceof InternalAttachmentError
        ? "INTERNAL_ATTACHMENT"
        : e instanceof SolutionRequiredError
          ? "SOLUTION_REQUIRED"
          : e instanceof ReasonRequiredError
            ? "REASON_REQUIRED"
            : e instanceof UnsupportedActionError
              ? "UNSUPPORTED_ACTION"
              : null;
  if (!code) return null;
  return NextResponse.json(
    { code, message: (e as Error).message },
    { status: 400 },
  );
}

/** 처리 결과 안내. '완료 처리' + '처리했습니다' 가 '완료 처리 처리했습니다' 가 되지 않게 */
function doneMessage(action: TicketAction): string {
  if (action === "save") return "처리내역을 저장했습니다.";
  if (action === "comment") return "댓글을 등록했습니다.";
  const label = actionLabel(action);
  return label.endsWith("처리")
    ? `${label}했습니다.`
    : `${label} 처리했습니다.`;
}

/**
 * 액션 라우트. 클라이언트가 보낸 티켓 상태를 믿지 않고 **서버에서 다시 읽어** 판정한다.
 * canDo() 는 UI 표시용이기도 하지만 여기서도 같은 함수로 한 번 더 거른다 (fail-closed).
 *
 * ⚠️ 데모 DB 쓰기는 ALLOW_DEV_WRITES=false 로 잠글 수 있다. 잠겨 있으면 권한 판정까지만 하고
 *    202 로 돌려준다 — 판정이 통과했다는 사실은 알려주되 데이터는 건드리지 않는다.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ echoNum: string }> },
) {
  const { echoNum } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse({
    ...raw,
    echoNum: decodeURIComponent(echoNum),
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "BAD_REQUEST",
        // 화면은 message 를 그대로 띄운다 — 길이 초과처럼 사용자가 고칠 수 있는 이유를 문장으로
        message: parsed.error.issues[0]?.message,
        detail: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const ticket = await getTicket(parsed.data.echoNum, user);
  if (!ticket) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const config = await loadCustomerConfig(ticket.custCode);
  const { action, comment, reason } = parsed.data;
  if (!canDo(action, ticket, user, config)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }

  // 'reapply' 처럼 상태 전이가 아닌 액션 — 쓰기가 잠겨 있어도 202('통과')로 알리지 않는다.
  // 재신청은 신청 폼(/api/requests)으로 간다.
  if (!supportsAction(action)) {
    return inputErrorResponse(new UnsupportedActionError(action))!;
  }

  if (action === "comment" && isBlankHtml(comment?.body)) {
    return NextResponse.json(
      { code: "EMPTY_COMMENT", message: "댓글 내용을 입력해 주세요." },
      { status: 400 },
    );
  }

  // 첨부는 댓글에만 딸려 온다. 형식·크기 판정은 쓰기 게이트 **앞**에서 한다 —
  // 쓰기가 꺼져 있어도 "이 파일은 못 올린다"는 사실은 알려줘야 한다.
  let files: IncomingFile[] = [];
  try {
    files = validateUploads(decodeUploads(comment?.attachments ?? []));
  } catch (e) {
    const res = inputErrorResponse(e);
    if (res) return res;
    throw e;
  }

  /**
   * 접수하며 확정한 분류. 🔒 클라이언트가 보낸 값을 믿지 않는다 —
   * 운영시스템이 **그 티켓 고객사의 것인지** 서버가 다시 조회하고, 모듈은 코드표에
   * 있는 값만 통과시킨다. 접수 외의 액션에 실려 오면 조용히 버린다(전이표 밖의 부수효과 금지).
   */
  let triage:
    | {
        systemId?: string;
        systemName?: string;
        moduleCode?: string;
        expeTime?: number;
        scheDate?: string;
      }
    | undefined;

  if (action === "receive" && parsed.data.triage) {
    const t = parsed.data.triage;
    triage = {};

    if (t.systemId.trim()) {
      const sys = await select<{ SYSTEM_NAME: string | null }>(
        `SELECT SYSTEM_NAME FROM COMPANY_OPER_SYSTEM
          WHERE OPER_SYS_ID = @id AND COMPANY_CODE = @cc
            AND COALESCE(USE_YN,'Y') = 'Y' AND COALESCE(DEL_YN,'N') <> 'Y'`,
        [
          { name: "id", value: Number(t.systemId) },
          { name: "cc", value: ticket.custCode },
        ],
      );
      if (sys.length === 0) {
        return NextResponse.json(
          {
            code: "INVALID_SYSTEM",
            message: "선택한 운영시스템이 이 고객사의 것이 아닙니다.",
          },
          { status: 400 },
        );
      }
      triage.systemId = t.systemId.trim();
      triage.systemName = (sys[0].SYSTEM_NAME ?? "").trim() || undefined;
    }

    if (t.moduleCode.trim()) {
      if (!(t.moduleCode.trim() in MODULE)) {
        return NextResponse.json(
          { code: "INVALID_MODULE", message: "모듈 코드가 올바르지 않습니다." },
          { status: 400 },
        );
      }
      triage.moduleCode = t.moduleCode.trim();
    }

    if (t.expeTime.trim()) {
      const n = Number(t.expeTime);
      if (!Number.isFinite(n) || n < 0 || n > 999) {
        return NextResponse.json(
          {
            code: "INVALID_EXPETIME",
            message: "예상 시간은 0~999 사이의 숫자로 입력해 주세요.",
          },
          { status: 400 },
        );
      }
      triage.expeTime = n;
    }

    if (t.scheDate.trim()) {
      const v = t.scheDate.trim();
      const limit = new Date(seoulWallDate().getFullYear() + 2, 11, 31);
      const d = new Date(v);
      // ⚠️ 모양만 봐서는 안 된다 — '2026-13-40' 은 정규식을 통과하고, 뒤따르는 범위 비교는
      //    Invalid Date 라 **거짓**이 되어 그대로 저장된다 (NaN 비교는 언제나 거짓이다).
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        Number.isNaN(d.getTime()) ||
        d > limit
      ) {
        return NextResponse.json(
          {
            code: "INVALID_SCHEDATE",
            message: "예상 처리일이 올바르지 않습니다 (2년 이내).",
          },
          { status: 400 },
        );
      }
      triage.scheDate = v;
    }
  }

  // 처리내역 저장 권한은 액션 권한과 **별개 축**이다.
  // 액션에 딸려 온 처리내역은 save 권한이 있을 때만 반영한다 (없으면 조용히 버리지 않고 무시).
  const canSave = canDo("save", ticket, user, config);
  const solution =
    parsed.data.solution && canSave ? parsed.data.solution : undefined;

  /**
   * 🔴 저장할 것 없는 '저장'은 성공이 아니다. 예전엔 처리내역 없이 온 save 가 아무것도 안
   *    바꾸고 200 "저장했습니다"를 돌려줬고, 화면은 그 200 을 믿고 쓰던 초안을 버렸다
   *    (액션바의 저장 버튼이 초안을 안 실어 보내던 경로 — 실측으로 답변이 사라졌다).
   */
  if (action === "save" && !solution) {
    return NextResponse.json(
      {
        code: "NOTHING_TO_SAVE",
        message: "저장할 처리내역이 없습니다.",
      },
      { status: 400 },
    );
  }

  /**
   * 빈 해결안·빠진 사유·내부 전용 글의 첨부. **쓰기 게이트 앞**에서 본다 —
   * 쓰기가 꺼져 있어도 무엇을 고쳐야 하는지는 알려줘야 한다(첨부 검증과 같은 축).
   * 판정 자체는 데이터 계층(assertActionInput)에 있고, applyAction 이 한 번 더 본다.
   */
  const commentInput = comment?.body?.trim()
    ? { ...comment, files }
    : undefined;
  try {
    assertActionInput({
      ticket,
      action,
      solution,
      reason,
      // 본문 없이 온 첨부도 내부 전용 판정에서 빠지지 않게 원래 요청을 넘긴다
      comment: comment ? { adminOnly: comment.adminOnly, files } : undefined,
    });
  } catch (e) {
    const res = inputErrorResponse(e);
    if (res) return res;
    throw e;
  }

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message: `권한 판정은 통과했습니다. ${writeDisabledReason()}`,
        action,
        echoNum: parsed.data.echoNum,
      },
      { status: 202 },
    );
  }

  try {
    const result = await applyAction({
      ticket,
      user,
      action,
      solution,
      comment: commentInput,
      triage,
      reason,
    });
    return NextResponse.json({
      code: "OK",
      message: doneMessage(action),
      echoNum: parsed.data.echoNum,
      progress: result.progress,
    });
  } catch (e) {
    // 마지막 방어선이 던진 입력 오류 — 무엇을 고쳐야 하는지 문장으로 돌려준다
    const res = inputErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
