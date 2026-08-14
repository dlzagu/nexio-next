import { NextResponse } from "next/server";
import { getTicket } from "@/lib/data/tickets";
import { devWritesAllowed } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { actionSchema } from "@/lib/schemas";
import { currentUser, loadCustomerConfig } from "@/lib/session";

/**
 * 액션 라우트. 클라이언트가 보낸 티켓 상태를 믿지 않고 **서버에서 다시 읽어** 판정한다.
 * canDo() 는 UI 표시용이기도 하지만 여기서도 같은 함수로 한 번 더 거른다 (fail-closed).
 *
 * ⚠️ 데모 DB 쓰기는 기본 차단이다(ALLOW_DEV_WRITES). 켜기 전까지는 판정까지만 하고
 *    실제 UPDATE 를 수행하지 않는다 — 쓰기 경로는 P6.s4 에서 구현한다.
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
  if (!canDo(parsed.data.action, ticket, user, config)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message:
          "권한 판정은 통과했지만 데모 DB 쓰기가 비활성 상태입니다. 환경변수 ALLOW_DEV_WRITES=true 로 켜세요.",
        action: parsed.data.action,
        echoNum: parsed.data.echoNum,
      },
      { status: 202 },
    );
  }

  // 쓰기 경로는 아직 구현하지 않았다. 자체 SQLite 이므로 UPDATE + 이력 로그
  // (NX_OPTREPORTR 의 IS_LOG_YN='Y' 행) 기록까지 묶어서 P6.s4 에서 구현한다.
  return NextResponse.json(
    {
      code: "NOT_IMPLEMENTED",
      message: "쓰기 경로 미구현 (P6.s4 예정).",
    },
    { status: 501 },
  );
}
