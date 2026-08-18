import { NextResponse } from "next/server";
import {
  AttachmentError,
  decodeUploads,
  validateUploads,
  type IncomingFile,
} from "@/lib/data/attachments";
import { applyAction, UnsupportedActionError } from "@/lib/data/mutations";
import { getTicket } from "@/lib/data/tickets";
import { MODULE } from "@/lib/codes";
import { select } from "@/lib/db";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { actionLabel, canDo } from "@/lib/permissions";
import { isBlankHtml } from "@/lib/sanitize";
import { actionSchema } from "@/lib/schemas";
import { currentUser, loadCustomerConfig } from "@/lib/session";

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
      { code: "BAD_REQUEST", detail: parsed.error.issues },
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
    if (e instanceof AttachmentError) {
      return NextResponse.json(
        { code: "INVALID_ATTACHMENT", message: e.message },
        { status: 400 },
      );
    }
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
      const limit = new Date(new Date().getFullYear() + 2, 11, 31);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v) > limit) {
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
      comment: comment?.body?.trim() ? { ...comment, files } : undefined,
      triage,
      reason,
    });
    return NextResponse.json({
      code: "OK",
      message:
        action === "save"
          ? "처리내역을 저장했습니다."
          : action === "comment"
            ? "댓글을 등록했습니다."
            : `${actionLabel(action)} 처리했습니다.`,
      echoNum: parsed.data.echoNum,
      progress: result.progress,
    });
  } catch (e) {
    if (e instanceof UnsupportedActionError) {
      // reapply 처럼 상태 전이가 아닌 액션이 여기로 오면 막는다. 재신청은 신청 폼으로 간다.
      return NextResponse.json(
        { code: "UNSUPPORTED_ACTION", message: e.message },
        { status: 400 },
      );
    }
    throw e;
  }
}
