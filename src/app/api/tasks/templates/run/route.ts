import { NextResponse } from "next/server";
import { createTicket } from "@/lib/data/mutations";
import {
  currentYm,
  listPendingTemplates,
  markTemplateRan,
  templateBody,
} from "@/lib/data/tasks";
import { devWritesAllowed, writeDisabledReason } from "@/lib/db";
import { canCreateTask, taskIntakeHint } from "@/lib/permissions";
import { currentUser } from "@/lib/session";

/**
 * 이번 달 정기 업무 생성. 서버리스라 스케줄러가 없어 **사람이 방아쇠를 당긴다.**
 *
 * 🔒 여러 번 눌러도 한 건이다 — 템플릿마다 `LAST_RUN_YM` 을 티켓과 **같은 트랜잭션**에서
 *    올린다. 나눠 커밋하면 티켓만 생기고 표시가 안 남아, 다음 클릭에 또 만들어진다.
 *
 * 담당자는 템플릿에 적힌 사람(등록할 때의 담당)이고, 비어 있으면 누른 사람이 가져간다 —
 * 주인 없는 정기 업무를 신청(2) 에 쌓아 두면 아무도 자기 일로 보지 않는다.
 */
export async function POST() {
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

  const ym = currentYm();
  const pending = await listPendingTemplates(ym);

  if (pending.length === 0) {
    return NextResponse.json({
      code: "NOTHING_TO_DO",
      message: `${ym} 정기 업무는 이미 모두 만들어져 있습니다.`,
      created: [],
    });
  }

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message: `권한 판정은 통과했습니다. 만들 정기 업무 ${pending.length}건. ${writeDisabledReason()}`,
      },
      { status: 202 },
    );
  }

  const created: string[] = [];
  for (const t of pending) {
    const assignTo = t.ownerId ?? user.id;
    const result = await createTicket(
      {
        custCode: t.custCode,
        requesterId: assignTo,
        systemId: t.systemId,
        title: `${t.title} (${ym})`,
        symptom: "",
        content: templateBody(t, ym),
        moduleCode: t.moduleCode,
        priority: t.priorityCode,
        // 매월 며칠 기준인지가 곧 기한이다 — 없으면 보드에서 D-day 가 안 잡힌다
        scheDate: `${ym}-${String(t.day).padStart(2, "0")}`,
        isPublic: false,
        refEmails: [],
        files: [],
        parentEchoNum: null,
        usesApproval: false,
        intake: {
          media: "내부",
          reqType: "WORK",
          // 정기 업무는 만들자마자 담당자의 할 일이다 — 진행에서 시작한다
          stage: "3",
          assignTo,
          assignToName: t.ownerName ?? user.name,
          sourceLabel: `정기 업무(매월 ${t.day}일)`,
        },
        extra: [markTemplateRan(t.id, ym)],
      },
      user,
    );
    created.push(result.echoNum);
  }

  return NextResponse.json({
    code: "CREATED",
    message: `${ym} 정기 업무 ${created.length}건을 만들었습니다.`,
    created,
  });
}
