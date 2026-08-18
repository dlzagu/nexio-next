import { NextResponse } from "next/server";
import {
  currentUser,
  listPersonas,
  loadUser,
  USER_COOKIE,
} from "@/lib/session";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });
  }
  return NextResponse.json({ user, personas: await listPersonas() });
}

/** 데모 역할 전환 — 시드 데이터의 가상 인물로 전환한다 (ADR-0004) */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    userId?: string;
  } | null;
  const userId = body?.userId?.trim();
  if (!userId) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }
  const user = await loadUser(userId);
  if (!user) {
    return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
  }
  const res = NextResponse.json({ user });
  res.cookies.set(USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
