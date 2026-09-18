import { NextResponse } from "next/server";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/data/notifications";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { notificationReadSchema } from "@/lib/schemas";
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

  // 🔒 본문을 캐스팅으로 믿지 않는다 — 문자열이 아닌 echoNum 이 오면 .trim() 에서 500 이 났고,
  //    잘못 온 값을 '모두 읽음'으로 해석하면 한 건을 읽으려다 전부 지운다
  const parsed = notificationReadSchema.safeParse(
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
        message: `읽음 상태를 저장하지 못했습니다. ${writeDisabledReason()}`,
      },
      { status: 202 },
    );
  }

  const changed = await markNotificationsRead(user, parsed.data.echoNum);
  return NextResponse.json({ code: "OK", changed });
}
