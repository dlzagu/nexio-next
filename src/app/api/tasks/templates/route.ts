import { NextResponse } from "next/server";
import {
  deactivateTemplate,
  getTemplate,
  listTemplates,
} from "@/lib/data/tasks";
import { devWritesAllowed, write, writeDisabledReason } from "@/lib/db";
import { canCreateTask, taskIntakeHint } from "@/lib/permissions";
import { templatePatchSchema } from "@/lib/schemas";
import { currentUser } from "@/lib/session";

/** 정기 업무 목록 — 운영팀만. 고객사에게는 다른 회사의 반복 업무가 보이면 안 된다 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });
  if (!canCreateTask(user)) {
    return NextResponse.json(
      {
        code: "FORBIDDEN",
        message: taskIntakeHint(user) ?? "권한이 없습니다.",
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ templates: await listTemplates() });
}

/**
 * 정기 업무 내리기(비활성)/되살리기.
 *
 * 행을 지우지 않는다 — 이미 만들어진 이번 달 티켓이 이 템플릿에서 나왔다는 사실이
 * 사라지면 "왜 이 업무가 있었나"를 알 수 없다 (고객사 비활성과 같은 판단, ADR-0010).
 */
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });
  if (!canCreateTask(user)) {
    return NextResponse.json(
      {
        code: "FORBIDDEN",
        message: taskIntakeHint(user) ?? "권한이 없습니다.",
      },
      { status: 403 },
    );
  }

  const parsed = templatePatchSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { code: "BAD_REQUEST", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  // 없는 번호에 200 을 주면 화면은 "내렸다"고 표시하는데 목록은 그대로다
  const target = await getTemplate(parsed.data.id);
  if (!target) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
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

  await write([deactivateTemplate(parsed.data.id, parsed.data.active)]);
  return NextResponse.json({
    code: "UPDATED",
    message: parsed.data.active
      ? `'${target.title}' 정기 업무를 다시 사용합니다.`
      : `'${target.title}' 정기 업무를 목록에서 내렸습니다.`,
  });
}
