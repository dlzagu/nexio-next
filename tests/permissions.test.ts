import { describe, expect, it } from "vitest";
import { availableActions, canDo, cancelHint } from "@/lib/permissions";
import type {
  CustomerConfig,
  TicketAction,
  TicketRow,
  User,
} from "@/lib/types";

const ticket = (over: Partial<TicketRow> = {}): TicketRow => ({
  echoNum: "HB-202607-001",
  custCode: "HB001",
  custName: "한빛제약",
  title: "테스트",
  progress: "3",
  systemId: "",
  moduleCode: "",
  progressRaw: "3",
  systemName: "ERP",
  moduleLabel: "재무관리",
  priority: "중간",
  priorityCode: "3",
  reqType: "SERVICE",
  requesterId: "cust1",
  requesterName: "고객담당",
  assigneeId: "eng1",
  assigneeName: "엔지니어",
  reqDate: "2026-07-01T00:00:00.000Z",
  scheDate: null,
  succDate: null,
  isPublic: true,
  commentCount: 0,
  hasUnreadComment: false,
  workTime: null,
  ...over,
});

const user = (over: Partial<User> = {}): User => ({
  id: "cust1",
  name: "고객담당",
  role: "CUSTOMER",
  custCode: "HB001",
  custName: "한빛제약",
  dept: null,
  email: "a@b.com",
  isApprover: false,
  ...over,
});

const config = (over: Partial<CustomerConfig> = {}): CustomerConfig => ({
  custCode: "HB001",
  custName: "한빛제약",
  showsContractTime: false,
  usesApproval: false,
  usesTestStage: false,
  usesSystemStage: false,
  defaultPrivate: true,
  ...over,
});

const ALL_ACTIONS: TicketAction[] = [
  "approve",
  "reject",
  "cancel",
  "cancelRequest",
  "suggestCancel",
  "receive",
  "save",
  "propose",
  "complete",
  "testComplete",
  "reapply",
  "comment",
];

describe("canDo — fail-closed", () => {
  it("사용자가 없으면 모든 액션을 차단한다", () => {
    for (const a of ALL_ACTIONS) {
      expect(canDo(a, ticket(), null)).toBe(false);
    }
  });

  it("티켓이 없으면 모든 액션을 차단한다", () => {
    for (const a of ALL_ACTIONS) {
      expect(canDo(a, null, user())).toBe(false);
    }
  });

  it("상태값이 비어 있으면 차단한다 (미등록·NULL 은 허용이 아니다)", () => {
    const t = ticket({ progress: "" as TicketRow["progress"] });
    for (const a of ALL_ACTIONS) {
      expect(canDo(a, t, user({ role: "INTERNAL" }))).toBe(false);
    }
  });

  it("규칙표에 없는 액션은 차단한다", () => {
    expect(
      canDo("nope" as TicketAction, ticket(), user({ role: "INTERNAL" })),
    ).toBe(false);
  });
});

describe("canDo — 취소는 신청자 본인만 (회사 정책)", () => {
  it("신청자 본인은 상태 1·2 에서 취소할 수 있다", () => {
    expect(canDo("cancel", ticket({ progress: "1" }), user())).toBe(true);
    expect(canDo("cancel", ticket({ progress: "2" }), user())).toBe(true);
  });

  it("같은 회사 다른 사용자는 취소할 수 없다", () => {
    expect(
      canDo("cancel", ticket({ progress: "2" }), user({ id: "cust2" })),
    ).toBe(false);
  });

  it("운영팀(담당자)에게는 취소 권한이 없다", () => {
    const internal = user({ id: "eng1", role: "INTERNAL", custCode: "ADMIN" });
    expect(canDo("cancel", ticket({ progress: "1" }), internal)).toBe(false);
    expect(canDo("cancel", ticket({ progress: "2" }), internal)).toBe(false);
    expect(canDo("cancelRequest", ticket({ progress: "3" }), internal)).toBe(
      false,
    );
  });

  it("담당자는 취소 '권유'만 할 수 있다", () => {
    const internal = user({ id: "eng1", role: "INTERNAL", custCode: "ADMIN" });
    expect(canDo("suggestCancel", ticket({ progress: "3" }), internal)).toBe(
      true,
    );
    // 종료건에는 권유도 불가
    expect(canDo("suggestCancel", ticket({ progress: "9" }), internal)).toBe(
      false,
    );
  });

  it("진행(3) 부터는 즉시 취소가 아니라 취소요청이다", () => {
    expect(canDo("cancel", ticket({ progress: "3" }), user())).toBe(false);
    expect(canDo("cancelRequest", ticket({ progress: "3" }), user())).toBe(
      true,
    );
  });
});

describe("canDo — 승인은 승인권자만, 그리고 승인 단계를 쓰는 고객사에서만", () => {
  it("승인권자가 아니면 차단", () => {
    expect(
      canDo(
        "approve",
        ticket({ progress: "1" }),
        user(),
        config({ usesApproval: true }),
      ),
    ).toBe(false);
  });

  it("승인권자면 허용", () => {
    expect(
      canDo(
        "approve",
        ticket({ progress: "1" }),
        user({ isApprover: true }),
        config({ usesApproval: true }),
      ),
    ).toBe(true);
  });

  it("설정을 모르면 차단한다 — 미등록 고객사가 오히려 통과하던 구멍 (fail-closed)", () => {
    const approver = user({ isApprover: true });
    // config 를 아예 안 넘긴 경우 · null 인 경우 둘 다 차단이어야 한다
    expect(canDo("approve", ticket({ progress: "1" }), approver)).toBe(false);
    expect(canDo("approve", ticket({ progress: "1" }), approver, null)).toBe(
      false,
    );
    expect(canDo("reject", ticket({ progress: "1" }), approver, null)).toBe(
      false,
    );
    // 확장 단계(테스트 완료)와 **같은 축**이다 — 여기만 opt-out 이면 안 된다
    expect(canDo("testComplete", ticket({ progress: "5" }), user(), null)).toBe(
      false,
    );
  });

  it("고객사가 승인 단계를 쓰지 않으면 승인권자여도 차단", () => {
    expect(
      canDo(
        "approve",
        ticket({ progress: "1" }),
        user({ isApprover: true }),
        config({ usesApproval: false }),
      ),
    ).toBe(false);
  });
});

describe("canDo — 확장 경로는 고객사 플래그가 켜졌을 때만", () => {
  it("설정이 없으면 테스트 완료를 차단한다 (fail-closed)", () => {
    expect(canDo("testComplete", ticket({ progress: "5" }), user(), null)).toBe(
      false,
    );
  });

  it("testYn 이 켜지면 허용", () => {
    expect(
      canDo(
        "testComplete",
        ticket({ progress: "5" }),
        user(),
        config({ usesTestStage: true }),
      ),
    ).toBe(true);
  });

  it("상태 6 완료는 테스트 단계를 쓰는 고객사에서만", () => {
    const internal = user({ id: "eng1", role: "INTERNAL", custCode: "ADMIN" });
    expect(
      canDo("complete", ticket({ progress: "6" }), internal, config()),
    ).toBe(false);
    expect(
      canDo(
        "complete",
        ticket({ progress: "6" }),
        internal,
        config({ usesTestStage: true }),
      ),
    ).toBe(true);
  });
});

describe("canDo — 담당자 배정", () => {
  const internal = (id: string) =>
    user({ id, role: "INTERNAL", custCode: "ADMIN" });

  it("배정된 건은 그 담당자만 저장할 수 있다", () => {
    expect(
      canDo("save", ticket({ assigneeId: "eng1" }), internal("eng1")),
    ).toBe(true);
    expect(
      canDo("save", ticket({ assigneeId: "eng1" }), internal("eng2")),
    ).toBe(false);
  });

  it("미배정 건은 처리자 측 누구나 집을 수 있다", () => {
    expect(canDo("save", ticket({ assigneeId: null }), internal("eng9"))).toBe(
      true,
    );
  });

  it("고객사 사용자는 저장할 수 없다", () => {
    expect(canDo("save", ticket(), user())).toBe(false);
  });
});

describe("canDo — 댓글", () => {
  it("종료건에는 댓글을 달 수 없다", () => {
    for (const p of ["9", "11", "12"] as const) {
      expect(canDo("comment", ticket({ progress: p }), user())).toBe(false);
    }
  });

  it("고객사 사용자는 자기 회사 건에만 댓글을 달 수 있다", () => {
    expect(
      canDo("comment", ticket({ custCode: "HP" }), user({ custCode: "HP" })),
    ).toBe(true);
    expect(
      canDo("comment", ticket({ custCode: "AP" }), user({ custCode: "HP" })),
    ).toBe(false);
  });
});

describe("canDo — 외부업체(VENDOR)", () => {
  it("배정된 건은 처리할 수 있다", () => {
    const v = user({ id: "eng1", role: "VENDOR", custCode: "VEND" });
    expect(
      canDo("propose", ticket({ progress: "3", assigneeId: "eng1" }), v),
    ).toBe(true);
  });

  it("취소·승인은 할 수 없다", () => {
    const v = user({ id: "eng1", role: "VENDOR", custCode: "VEND" });
    expect(canDo("cancel", ticket({ progress: "1" }), v)).toBe(false);
    expect(
      canDo(
        "approve",
        ticket({ progress: "1" }),
        v,
        config({ usesApproval: true }),
      ),
    ).toBe(false);
  });
});

describe("availableActions", () => {
  it("액션은 최대 3개까지만 노출한다 (P4)", () => {
    const internal = user({ id: "eng1", role: "INTERNAL", custCode: "ADMIN" });
    const list = availableActions(
      ticket({ progress: "3" }),
      internal,
      config(),
    );
    expect(list.length).toBeLessThanOrEqual(3);
  });

  it("종료건에는 고객 재신청만 남는다", () => {
    const list = availableActions(ticket({ progress: "9" }), user(), config());
    expect(list.map((a) => a.action)).toEqual(["reapply"]);
  });
});

describe("cancelHint — 왜 취소가 안 되는지 설명한다", () => {
  it("취소가 가능하면 힌트가 없다", () => {
    expect(cancelHint(ticket({ progress: "2" }), user())).toBeNull();
  });

  it("담당자에게는 정책을 설명한다", () => {
    const hint = cancelHint(ticket(), user({ id: "eng1", role: "INTERNAL" }));
    expect(hint).toContain("신청자 본인");
  });

  it("다른 사용자에게는 신청자를 알려준다", () => {
    const hint = cancelHint(ticket({ progress: "2" }), user({ id: "cust2" }));
    expect(hint).toContain("고객담당");
  });

  it("종료건은 재신청을 안내한다", () => {
    const hint = cancelHint(ticket({ progress: "11" }), user());
    expect(hint).toContain("재신청");
  });
});
