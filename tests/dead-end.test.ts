// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * 막다른 상태가 없는가 — **전이표의 구조**를 검사한다.
 *
 * 두 번 같은 사고가 났다:
 *  1. 시드가 승인 단계를 안 쓰는 고객사에 '대기'를 만들어 8건이 갇혔다
 *  2. '취소 요청'은 들어가는 길만 있고 나가는 길이 없어, 신청자가 버튼 하나로
 *     아무도 손댈 수 없는 티켓을 만들 수 있었다 (진행 중 78건 전부 해당)
 *
 * 둘 다 "그 상태에 실제로 가 보기" 전에는 안 보인다. 그래서 눈이 아니라 **표**를 본다:
 * 어떤 전이로 도달할 수 있는 상태는, 종료가 아니라면 누군가는 다음 행동을 할 수 있어야 한다.
 */
process.env.SQLITE_PATH = ":memory:";

import {
  MAIN_FLOW,
  PROGRESS,
  TERMINAL_PROGRESS,
  type ProgressCode,
} from "@/lib/codes";
import { canDo } from "@/lib/permissions";
import type {
  CustomerConfig,
  TicketAction,
  TicketRow,
  User,
} from "@/lib/types";

const ACTIONS: TicketAction[] = [
  "approve",
  "reject",
  "cancel",
  "cancelRequest",
  "cancelApprove",
  "cancelDeny",
  "suggestCancel",
  "receive",
  "save",
  "propose",
  "complete",
  "testComplete",
  "reapply",
];

const base: User = {
  id: "sy.kim",
  name: "김서연",
  role: "INTERNAL",
  custCode: "NX000",
  custName: "(주)넥시오솔루션",
  dept: "서비스운영팀",
  email: "sy.kim@nexio-ops.example",
  isApprover: false,
};

/** 그 상태를 볼 수 있는 사람들 — 담당자·신청자·승인권자·외부업체 */
const people = (ticket: TicketRow): { who: string; user: User }[] => [
  { who: "담당자(운영팀)", user: { ...base, id: ticket.assigneeId! } },
  {
    who: "외부업체",
    user: { ...base, id: ticket.assigneeId!, role: "VENDOR" },
  },
  {
    who: "신청자",
    user: {
      ...base,
      id: ticket.requesterId!,
      role: "CUSTOMER",
      custCode: ticket.custCode,
    },
  },
  {
    who: "승인권자",
    user: {
      ...base,
      id: "approver",
      role: "CUSTOMER",
      custCode: ticket.custCode,
      isApprover: true,
    },
  },
];

const ticketAt = (progress: string): TicketRow =>
  ({
    echoNum: "TS-202608-001",
    custCode: "HB001",
    custName: "한빛제약",
    title: "테스트",
    progress,
    requesterId: "hb.yoon",
    requesterName: "윤서라",
    assigneeId: "sy.kim",
    assigneeName: "김서연",
  }) as unknown as TicketRow;

/** 확장 단계까지 켠 고객사 — 어느 조합에서도 길이 있는지 보려면 최대 설정을 준다 */
const config: CustomerConfig = {
  custCode: "HB001",
  custName: "한빛제약",
  showsContractTime: true,
  usesApproval: true,
  usesTestStage: true,
  usesSystemStage: true,
  defaultPrivate: true,
};

describe("막다른 상태가 없다", () => {
  it("종료가 아닌 상태에는 반드시 다음 행동이 있다", () => {
    const stuck: string[] = [];
    for (const code of Object.keys(PROGRESS) as ProgressCode[]) {
      if (TERMINAL_PROGRESS.includes(code)) continue;
      // 도입 이래 0건이라 만들지 않은 워크플로는 제외 (들어가는 길도 없다)
      if (code === "7" || code === "8") continue;

      const t = ticketAt(code);
      const found = people(t).flatMap(({ who, user }) =>
        ACTIONS.filter((a) => canDo(a, t, user, config)).map(
          (a) => `${who}:${a}`,
        ),
      );
      if (found.length === 0) {
        stuck.push(`${code}(${PROGRESS[code]})`);
      }
    }
    expect(stuck).toEqual([]);
  });

  it("주 경로의 각 단계는 앞으로 나아갈 수단을 가진다 (댓글 말고)", () => {
    for (const code of MAIN_FLOW) {
      if (TERMINAL_PROGRESS.includes(code)) continue;
      const t = ticketAt(code);
      const forward = people(t).some(({ user }) =>
        (["approve", "receive", "propose", "complete"] as TicketAction[]).some(
          (a) => canDo(a, t, user, config),
        ),
      );
      expect(forward, `${code}(${PROGRESS[code]}) 에서 전진할 수 없다`).toBe(
        true,
      );
    }
  });

  it("취소 요청(10)은 신청자가 만들고, 처리자가 두 갈래로 닫는다", () => {
    const t = ticketAt("10");
    const [handler, , requester] = people(t);
    expect(canDo("cancelApprove", t, handler.user, config)).toBe(true);
    expect(canDo("cancelDeny", t, handler.user, config)).toBe(true);
    // 판단은 처리자 몫 — 신청자가 자기 요청을 스스로 승인하지 않는다
    expect(canDo("cancelApprove", t, requester.user, config)).toBe(false);
    expect(canDo("cancelDeny", t, requester.user, config)).toBe(false);
  });
});
