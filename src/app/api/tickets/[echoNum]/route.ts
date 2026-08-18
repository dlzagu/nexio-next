import { NextResponse } from "next/server";
import { listAttachments } from "@/lib/data/attachments";
import { listSystems } from "@/lib/data/meta";
import { getTicket } from "@/lib/data/tickets";
import {
  availableActions,
  canDo,
  cancelHint,
  editSolutionHint,
} from "@/lib/permissions";
import { currentUser, loadCustomerConfig } from "@/lib/session";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ echoNum: string }> },
) {
  const { echoNum } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  const ticket = await getTicket(decodeURIComponent(echoNum), user);
  // 가시성 밖의 건은 "없음"으로 응답한다 — 존재 여부를 흘리지 않는다
  if (!ticket) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const [config, attachments, systems] = await Promise.all([
    loadCustomerConfig(ticket.custCode),
    listAttachments(ticket.echoNum, user),
    // 접수 화면이 분류를 바로잡을 때 고를 목록 — 그 고객사 것만
    user.role === "CUSTOMER"
      ? Promise.resolve([])
      : listSystems(ticket.custCode),
  ]);
  return NextResponse.json({
    ticket,
    config,
    attachments,
    systems,
    actions: availableActions(ticket, user, config),
    cancelHint: cancelHint(ticket, user),
    // 액션바는 최대 3개만 노출하므로, 화면이 편집 UI 를 켤지 판단할 플래그를 따로 내린다.
    // 판정은 같은 canDo() 한 곳을 거친다 (fail-closed).
    can: {
      editSolution: canDo("save", ticket, user, config),
      comment: canDo("comment", ticket, user, config),
      // 내부 전용 댓글은 운영팀만 — 읽기 가드가 INTERNAL 에게만 열려 있어서, 외부업체에게
      // 체크박스를 주면 "쓸 수는 있는데 본인에게도 안 보이는" 댓글이 된다
      postInternalComment:
        user.role === "INTERNAL" && canDo("comment", ticket, user, config),
      // 편집 UI 가 조용히 사라지지 않게, 막힌 이유를 함께 내린다
      editSolutionReason: editSolutionHint(ticket, user, config),
    },
  });
}
