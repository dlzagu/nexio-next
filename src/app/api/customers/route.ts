import { NextResponse } from "next/server";
import { createCustomer, CustomerError } from "@/lib/data/customers";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { canManageCustomers } from "@/lib/permissions";
import { newCustomerSchema } from "@/lib/schemas";
import { currentUser } from "@/lib/session";

/** 고객사 등록 — 운영팀만 (ADR-0010) */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });
  if (!canManageCustomers(user)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = newCustomerSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    // 코드만 주면 화면에 'BAD_REQUEST' 가 그대로 뜬다 — 첫 문장을 message 로 싣는다
    return NextResponse.json(
      {
        code: "BAD_REQUEST",
        message: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.",
        detail: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  /**
   * 🔒 운영시스템은 필수다 (fail-closed). 없으면 신청 화면에서 고를 게 없는 고객사가 영구히 남는다.
   *    쓰기 잠금(202)보다 **먼저** 거른다 — 잠겨 있을 때 "검증은 통과했습니다"가 거짓이 되지 않게.
   *    (createCustomer 도 같은 조건으로 한 번 더 막는다)
   */
  if (!parsed.data.systemName.trim()) {
    return NextResponse.json(
      {
        code: "SYSTEM_REQUIRED",
        message:
          "운영시스템 이름을 입력해 주세요 — 시스템이 없는 고객사는 신청 화면에서 고를 게 없습니다.",
      },
      { status: 400 },
    );
  }

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message: `검증은 통과했습니다. ${writeDisabledReason()}`,
      },
      { status: 202 },
    );
  }

  try {
    const created = await createCustomer(parsed.data, user);
    return NextResponse.json(
      {
        code: "CREATED",
        message: `고객사를 등록했습니다 (${created.custCode}).`,
        ...created,
      },
      { status: 201 },
    );
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
