import { NextResponse } from "next/server";
import { CustomerError, setCustomerActive } from "@/lib/data/customers";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { canDeactivateCustomer, customerAdminHint } from "@/lib/permissions";
import { currentUser } from "@/lib/session";

/**
 * 활성/비활성 전환. 🔒 운영팀 **관리자**만 — 계정 체계가 없는 데모라 기본 페르소나는
 * 전부 거부된다(403 과 함께 왜 막혔는지 문장을 돌려준다).
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  if (!canDeactivateCustomer(user)) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: customerAdminHint(user) },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    active?: boolean;
  } | null;
  if (typeof body?.active !== "boolean") {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message: `권한 판정은 통과했습니다. ${writeDisabledReason()}`,
      },
      { status: 202 },
    );
  }

  try {
    await setCustomerActive(decodeURIComponent(code), body.active, user);
    return NextResponse.json({
      code: "OK",
      message: body.active ? "다시 활성화했습니다." : "비활성 처리했습니다.",
    });
  } catch (e) {
    if (e instanceof CustomerError) {
      return NextResponse.json(
        { code: "INVALID_CUSTOMER", message: e.message },
        { status: 400 },
      );
    }
    throw e;
  }
}
