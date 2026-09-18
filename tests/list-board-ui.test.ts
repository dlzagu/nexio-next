// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TicketRow, User } from "@/lib/types";

/**
 * 목록 · 보드 · 대시보드 · 신청 폼 · 고객사 — 화면이 **다음 행동을 틀리게 안내하던** 자리들.
 *
 * 화면을 그리지 않고 판정 함수를 고정한다. 버튼의 모양이 아니라
 * "이 이동은 API 를 부르는가, 상세를 여는가" · "저장한 건을 어느 목록에서 찾는가" 가
 * 틀리면 사용자는 **저장이 안 됐다**고 믿고 다시 누른다.
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

// 데모 세션은 쿠키 하나로 정해진다 — 그 쿠키만 갈아 끼우면 페르소나가 바뀐다
const session = vi.hoisted(() => ({ userId: "sy.kim" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "nx_user" ? { value: session.userId } : undefined,
  }),
}));

/**
 * 공유 DB 드리프트(새 표가 라이브에 없음)를 흉내 낸다 — 켜 두면 읽음선 표를 건드리는
 * 조회만 실패한다. 나머지는 실제 select 를 그대로 탄다.
 */
const drift = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  async function select<T = Record<string, unknown>>(
    sql: string,
    params?: Parameters<typeof real.select>[1],
  ): Promise<T[]> {
    if (drift.on && sql.includes("NX_OPTREPORT_READ_STATE")) {
      throw new Error("no such table: NX_OPTREPORT_READ_STATE");
    }
    return real.select<T>(sql, params);
  }
  return { ...real, select };
});

import { POST as postCustomer } from "@/app/api/customers/route";
import { POST as postRequest } from "@/app/api/requests/route";
import {
  afterCreateHref,
  listViewAfterCreate,
  planAfterRejection,
  planMove,
  quickMove,
} from "@/lib/board";
import { getDashboard, myPendingHref } from "@/lib/data/dashboard";
import { listSystems } from "@/lib/data/meta";
import { getTicket, listTickets } from "@/lib/data/tickets";
import { select } from "@/lib/db";
import { loadUser } from "@/lib/session";
import {
  emptyListReason,
  hasListFilters,
  listFilterResetPatch,
} from "@/components/requests/useUrlState";
import { newRequestBlockedReason } from "@/components/layout/request-gate";

const as = (id: string) => {
  session.userId = id;
};
const post = (v: unknown) =>
  new Request("http://test/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(v),
  });
const json = async (res: Response) =>
  (await res.json()) as {
    code?: string;
    message?: string;
    echoNum?: string;
    progress?: string;
  };

const internal: User = {
  id: "sy.kim",
  name: "김서연",
  role: "INTERNAL",
  custCode: "NX000",
  custName: "(주)넥시오솔루션",
  dept: "서비스운영팀",
  email: "sy.kim@nexio-ops.example",
  isApprover: false,
};
const vendor: User = { ...internal, id: "vd.kang", role: "VENDOR" };
const customer = (over: Partial<User> = {}): User => ({
  ...internal,
  id: "sj.moon",
  role: "CUSTOMER",
  custCode: "SJ001",
  custName: "세진식품",
  isApprover: false,
  ...over,
});

const row = (over: Partial<TicketRow>): TicketRow =>
  ({
    echoNum: "SJ-TEST-0001",
    custCode: "SJ001",
    custName: "세진식품",
    title: "테스트",
    progress: "3",
    progressRaw: "3",
    requesterId: "sj.moon",
    assigneeId: internal.id,
    ...over,
  }) as TicketRow;

beforeAll(async () => {
  await select("SELECT 1 AS ok");
});

afterEach(() => {
  drift.on = false;
  vi.restoreAllMocks();
});

/* ── 1·2·3. 보드 이동 ─────────────────────────────────────── */

describe("보드 이동 — API 를 부를 것인가, 상세를 열 것인가", () => {
  it("진행 → 해결안 제시는 API 를 부르지 않는다 — 답변을 쓸 처리결과 탭을 연다", () => {
    const plan = planMove(row({ progress: "3" }), "4", internal);
    expect(plan).toMatchObject({
      kind: "detail",
      action: "propose",
      tab: "solution",
    });
    expect(plan?.kind === "detail" && plan.note).toContain("해결안 제시");
  });

  it("빠른 버튼도 같은 판정을 탄다 — '해결안 제시'라고 써 놓고 400 을 맞게 두지 않는다", () => {
    const q = quickMove(row({ progress: "3" }), internal);
    expect(q?.plan.kind).toBe("detail");
    expect(q?.label).not.toBe("해결안 제시");
  });

  it("🔒 취소요청(10) 카드는 1클릭으로 판단하지 않는다 — '판단하기'로 상세를 연다", () => {
    const card = row({ progress: "10" });
    const q = quickMove(card, internal);
    expect(q?.label).toBe("판단하기");
    expect(q?.plan).toMatchObject({ kind: "detail", action: "cancelDeny" });
    // 드롭도 같다 — 10 → 3 은 '거절'이라 사유가 필요하다
    expect(planMove(card, "3", internal)?.kind).toBe("detail");
  });

  it("입력이 필요 없는 이동은 그대로 API 로 간다", () => {
    expect(planMove(row({ progress: "2" }), "3", internal)).toEqual({
      kind: "api",
      action: "receive",
    });
    expect(planMove(row({ progress: "4" }), "9", internal)).toEqual({
      kind: "api",
      action: "complete",
    });
  });

  it("표에 없는 이동·권한 없는 이동은 계획 자체가 없다 (fail-closed)", () => {
    expect(planMove(row({ progress: "3" }), "2", internal)).toBeNull();
    // 남의 담당 건
    expect(
      planMove(row({ progress: "3", assigneeId: "someone" }), "4", internal),
    ).toBeNull();
    expect(quickMove(row({ progress: "9" }), internal)).toBeNull();
  });

  it("서버가 답변 부족으로 되돌려 보내면 같은 버튼을 다시 누르게 두지 않고 처리결과 탭을 연다", () => {
    expect(planAfterRejection("SOLUTION_REQUIRED")).toMatchObject({
      tab: "solution",
    });
    expect(planAfterRejection("FORBIDDEN")).toBeNull();
    expect(planAfterRejection(undefined)).toBeNull();
  });
});

/* ── 4. 신청 후 이동 ──────────────────────────────────────── */

describe("신청 저장 후 — 그 건이 실제로 걸리는 목록으로", () => {
  it("신청자가 나면 '내 요청'", () => {
    expect(
      listViewAfterCreate(
        { requesterId: "sj.moon", isPublic: false, progress: "2" },
        customer(),
      ),
    ).toBe("mine");
  });

  it("운영팀의 대리 신청은 '진행 중' — 신청자도 담당자도 내가 아니다", () => {
    expect(
      listViewAfterCreate(
        { requesterId: "sj.moon", isPublic: false, progress: "2" },
        internal,
      ),
    ).toBe("open");
  });

  it("고객사 비승인권자가 동료 명의로 비공개 신청하면 **볼 수 없다** → 상세를 열지 않는다", () => {
    const me = customer();
    const hidden = { requesterId: "sj.oh", isPublic: false, progress: "2" };
    expect(listViewAfterCreate(hidden, me)).toBeNull();
    const href = afterCreateHref("SJ-X-1", hidden, me);
    expect(href).not.toContain("open=");
    expect(href).toContain("created=SJ-X-1");

    // 공개로 두거나 승인권자면 보인다
    expect(listViewAfterCreate({ ...hidden, isPublic: true }, me)).toBe("open");
    expect(listViewAfterCreate(hidden, customer({ isApprover: true }))).toBe(
      "open",
    );
  });

  it("보이는 건은 상세를 연 채로 보낸다", () => {
    expect(
      afterCreateHref(
        "SJ-X-2",
        { requesterId: "sj.moon", isPublic: false, progress: "2" },
        internal,
      ),
    ).toBe("/requests?view=open&open=SJ-X-2");
  });

  it("판정이 실제 가시성(scopeClause)과 어긋나지 않는다 — 비공개 동료 명의 신청", async () => {
    const systems = await listSystems("SJ001");
    as("sj.moon");
    const res = await postRequest(
      post({
        custCode: "SJ001",
        requesterId: "sj.oh",
        requesterEmail: "sjmoon@sejin.example",
        systemId: systems[0].value,
        title: "동료 대신 신청",
        symptom: "증상",
        content: "<p>내용</p>",
        moduleCode: "",
        priority: "3",
        scheDate: "",
        isPublic: false,
        refEmails: [],
        attachments: [],
      }),
    );
    expect(res.status).toBe(201);
    const created = await json(res);
    const me = (await loadUser("sj.moon"))!;
    const view = listViewAfterCreate(
      {
        requesterId: "sj.oh",
        isPublic: false,
        progress: created.progress ?? "",
      },
      me,
    );
    // 화면 판정 = 서버 가시성: 못 본다고 판정했으면 실제로도 못 본다
    expect(view).toBeNull();
    expect(await getTicket(created.echoNum!, me)).toBeNull();
  });

  it("판정이 실제 목록과 어긋나지 않는다 — 운영팀 대리 신청은 '진행 중'에 걸린다", async () => {
    const systems = await listSystems("SJ001");
    as("sy.kim");
    const res = await postRequest(
      post({
        custCode: "SJ001",
        requesterId: "sj.moon",
        requesterEmail: "sy.kim@nexio-ops.example",
        systemId: systems[0].value,
        title: "운영팀 대리 신청",
        symptom: "증상",
        content: "<p>내용</p>",
        moduleCode: "",
        priority: "3",
        scheDate: "",
        isPublic: false,
        refEmails: [],
        attachments: [],
      }),
    );
    expect(res.status).toBe(201);
    const created = await json(res);
    const view = listViewAfterCreate(
      {
        requesterId: "sj.moon",
        isPublic: false,
        progress: created.progress ?? "",
      },
      internal,
    );
    expect(view).toBe("open");
    const list = await listTickets(
      {
        view: view!,
        keyword: created.echoNum!,
        custCode: "",
        progress: "",
        from: "",
        to: "",
        assignee: "",
        requester: "",
        module: "",
        priority: "",
        includeMigration: false,
      },
      internal,
    );
    expect(list.rows.map((r) => r.echoNum)).toContain(created.echoNum);
  });
});

/* ── 7. 미읽음 필터의 빈 상태 ─────────────────────────────── */

describe("목록 빈 상태 — 미읽음 필터도 '필터'다", () => {
  const params = (q: string) => new URLSearchParams(q);

  it("unread=1 은 필터로 센다 — 초기화 버튼이 떠야 한다", () => {
    expect(hasListFilters(params("view=open&unread=1"))).toBe(true);
    expect(hasListFilters(params("view=open&migration=1"))).toBe(true);
    expect(hasListFilters(params("view=open"))).toBe(false);
  });

  it("대시보드 '미읽음 댓글 0' 카드로 들어오면 이유는 '미완료가 없다'가 아니라 '모두 읽었다'", () => {
    expect(
      emptyListReason(params("view=open&unread=1"), "INTERNAL", "open"),
    ).toBe("unread");
    // 고객사도 '비공개 79%' 같은 무관한 이유를 먼저 대지 않는다
    expect(
      emptyListReason(params("view=open&unread=1"), "CUSTOMER", "open"),
    ).toBe("unread");
  });

  it("다른 필터가 걸려 있으면 '미완료가 없다'고 단정하지 않는다", () => {
    expect(
      emptyListReason(params("view=open&progress=5"), "INTERNAL", "open"),
    ).toBe("filtered");
    expect(emptyListReason(params("view=open"), "INTERNAL", "open")).toBe(
      "noOpen",
    );
    expect(emptyListReason(params("view=open"), "CUSTOMER", "open")).toBe(
      "customerPrivate",
    );
  });

  it("초기화는 미읽음·이관 포함까지 전부 지운다", () => {
    const patch = listFilterResetPatch();
    expect(patch).toMatchObject({ unread: null, migration: null, q: null });
    // 뷰·열린 상세는 필터가 아니다 — 초기화가 건드리지 않는다
    expect(patch).not.toHaveProperty("view");
    expect(patch).not.toHaveProperty("open");
  });
});

/* ── 8·9. 대시보드 ───────────────────────────────────────── */

describe("대시보드 — 숫자와 링크, 실패와 0건", () => {
  it("'내가 담당한 미처리' [전체] 링크 = 카드와 같은 조건 (view=mine 이 아니다)", () => {
    expect(myPendingHref(internal)).toBe("/requests?view=open&assignee=sy.kim");
    expect(myPendingHref(customer())).toBe(
      "/requests?view=open&requester=sj.moon",
    );
    expect(myPendingHref(vendor)).toContain("assignee=vd.kang");
  });

  it("링크한 목록의 건수 = 카드 숫자", async () => {
    const d = await getDashboard(internal);
    const q = new URLSearchParams(myPendingHref(internal).split("?")[1]);
    const list = await listTickets(
      {
        view: q.get("view") as "open",
        keyword: "",
        custCode: "",
        progress: "",
        from: "",
        to: "",
        assignee: q.get("assignee") ?? "",
        requester: q.get("requester") ?? "",
        module: "",
        priority: "",
        includeMigration: false,
      },
      internal,
    );
    expect(list.total).toBe(d.cards.myPending);
  });

  it("정상 조회면 실패 표시가 없다", async () => {
    const d = await getDashboard(internal);
    expect(d.failed).toEqual([]);
  });

  it("🔴 조회 실패를 '0건'으로 그리지 않는다 — 실패한 위젯을 따로 알린다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    drift.on = true;
    const d = await getDashboard(internal);
    drift.on = false;

    // 읽음선 표를 건드리는 위젯은 실패로 표시된다 (값은 비어 있어도 '없음'이 아니다)
    expect(d.failed).toEqual(
      expect.arrayContaining(["cards", "myPending", "companyUnresolved"]),
    );
    // 공지는 그 표와 무관하다 — 멀쩡한 위젯까지 실패로 칠하지 않는다
    expect(d.failed).not.toContain("notices");
    expect(d.notices.length).toBeGreaterThan(0);
    // 서버 로그에는 남는다
    expect(log).toHaveBeenCalled();
  });
});

/* ── 10. 외부업체의 신청 버튼 ─────────────────────────────── */

describe("서비스 신청 진입 — 외부업체는 막되 이유를 말한다", () => {
  it("운영팀·고객사는 열린다", () => {
    expect(newRequestBlockedReason(internal)).toBeNull();
    expect(newRequestBlockedReason(customer())).toBeNull();
  });

  it("외부업체는 막히고 이유가 있다 — 라우트의 403 과 같은 축", () => {
    expect(newRequestBlockedReason(vendor)).toContain("외부업체");
  });

  it("모르는 역할·미로그인은 차단 (fail-closed)", () => {
    expect(newRequestBlockedReason(null)).not.toBeNull();
    expect(
      newRequestBlockedReason({ role: "UNKNOWN" as User["role"] }),
    ).not.toBeNull();
  });
});

/* ── 11. 고객사 등록 — 운영시스템 필수 ─────────────────────── */

describe("고객사 등록 라우트 — 운영시스템 없이는 만들지 않는다", () => {
  it("운영시스템을 비우면 400 + 읽을 수 있는 문장 (쓸 수 없는 고객사를 만들지 않는다)", async () => {
    as("sy.kim");
    const res = await postCustomer(
      post({ custCode: "NS001", custName: "무시스템물산", systemName: "" }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.message).toContain("운영시스템");
    // 만들어지지 않았다
    const rows = await select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM COMPANY_MST WHERE COMPANY_CODE = 'NS001'",
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("운영시스템 필드를 아예 빼도 400", async () => {
    as("sy.kim");
    const res = await postCustomer(
      post({ custCode: "NS002", custName: "무시스템상사" }),
    );
    expect(res.status).toBe(400);
  });

  it("형식 오류 400 도 코드가 아니라 문장을 준다 (모달에 'BAD_REQUEST' 가 뜨지 않게)", async () => {
    as("sy.kim");
    const res = await postCustomer(
      post({ custCode: "AB", custName: "짧은코드", systemName: "ERP" }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).message).toBeTruthy();
  });

  it("운영시스템과 함께면 201 — 신청 화면에서 바로 고를 수 있다", async () => {
    as("sy.kim");
    const res = await postCustomer(
      post({ custCode: "NS003", custName: "시스템상사", systemName: "ERP" }),
    );
    expect(res.status).toBe(201);
    expect(await listSystems("NS003")).toHaveLength(1);
  });
});
