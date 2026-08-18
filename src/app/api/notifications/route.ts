import { NextResponse } from "next/server";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/data/notifications";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { currentUser } from "@/lib/session";

/** 알림 목록 — 내 건에 달린, 내가 아직 안 본 글 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });
  return NextResponse.json(await listNotifications(user));
}

/** 읽음 처리. body.echoNum 이 있으면 그 건만, 없으면 전부 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    echoNum?: string;
  } | null;

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message: `읽음 상태를 저장하지 못했습니다. ${writeDisabledReason()}`,
      },
      { status: 202 },
    );
  }

  const changed = await markNotificationsRead(user, body?.echoNum?.trim());
  return NextResponse.json({ code: "OK", changed });
}
