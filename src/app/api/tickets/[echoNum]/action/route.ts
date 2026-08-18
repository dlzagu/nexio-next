import { NextResponse } from "next/server";
import { applyAction, UnsupportedActionError } from "@/lib/data/mutations";
import { getTicket } from "@/lib/data/tickets";
import { devWritesAllowed } from "@/lib/db";
import { actionLabel, canDo } from "@/lib/permissions";
import { isBlankHtml } from "@/lib/sanitize";
import { actionSchema } from "@/lib/schemas";
import { currentUser, loadCustomerConfig } from "@/lib/session";

/**
 * 액션 라우트. 클라이언트가 보낸 티켓 상태를 믿지 않고 **서버에서 다시 읽어** 판정한다.
 * canDo() 는 UI 표시용이기도 하지만 여기서도 같은 함수로 한 번 더 거른다 (fail-closed).
 *
 * ⚠️ 데모 DB 쓰기는 기본 차단이다(ALLOW_DEV_WRITES). 꺼져 있으면 권한 판정까지만 하고
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

  // 처리내역 저장 권한은 액션 권한과 **별개 축**이다.
  // 액션에 딸려 온 처리내역은 save 권한이 있을 때만 반영한다 (없으면 조용히 버리지 않고 무시).
  const canSave = canDo("save", ticket, user, config);
  const solution =
    parsed.data.solution && canSave ? parsed.data.solution : undefined;

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message:
          "권한 판정은 통과했지만 데모 DB 쓰기가 비활성 상태입니다. 환경변수 ALLOW_DEV_WRITES=true 로 켜세요.",
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
      comment: comment?.body?.trim() ? comment : undefined,
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
