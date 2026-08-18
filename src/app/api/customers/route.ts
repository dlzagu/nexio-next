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
    return NextResponse.json(
      { code: "BAD_REQUEST", detail: parsed.error.issues },
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
    return NextResponse.json({ code: "CREATED", ...created }, { status: 201 });
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
