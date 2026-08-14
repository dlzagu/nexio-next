import { beforeAll, describe, expect, it } from "vitest";
import type { TicketFilters, User } from "@/lib/types";

/**
 * 데이터 계층 통합 테스트 — 실제 SQLite(:memory:)에 시드를 생성해 검증한다.
 *
 * 핵심 검증 대상:
 *  1. 가시성 게이트(scopeClause)가 fail-closed 로 동작하는가 — 역할별 범위 축소
 *  2. 시드가 원본 실측 프로파일의 불변식을 지키는가 — 상태 7/8/10 = 0건 등
 *  3. SQLite 방언 변환 후 대시보드 집계가 실제로 도는가
 *
 * ⚠️ SQLITE_PATH 는 db() 최초 호출 "전"에만 설정하면 된다 (dbPath 가 지연 평가).
 */
process.env.SQLITE_PATH = ":memory:";

import { getComments, getTicket, listTickets } from "@/lib/data/tickets";
import { getDashboard } from "@/lib/data/dashboard";
import { select } from "@/lib/db";

const filters = (over: Partial<TicketFilters> = {}): TicketFilters => ({
  view: "all",
  keyword: "",
  custCode: "",
  progress: "",
  from: "",
  to: "",
  assignee: "",
  requester: "",
  module: "",
  priority: "",
  includeMigration: true,
  ...over,
});

const baseUser: User = {
  id: "sy.kim",
  name: "김서연",
  role: "INTERNAL",
  custCode: "NX000",
  custName: "(주)넥시오솔루션",
  dept: "서비스운영팀",
  email: "sy.kim@nexio-ops.example",
  isApprover: false,
};

const internal = baseUser;
const hbApprover: User = {
  ...baseUser,
  id: "hb.yoon",
  name: "윤서라",
  role: "CUSTOMER",
  custCode: "HB001",
  custName: "한빛제약",
  isApprover: true,
};
const hbMember: User = {
  ...hbApprover,
  id: "hb.lim",
  name: "임도현",
  isApprover: false,
};
const sjMember: User = {
  ...baseUser,
  id: "sj.moon",
  name: "문가영",
  role: "CUSTOMER",
  custCode: "SJ001",
  custName: "세진식품",
  isApprover: false,
};
const vendor: User = {
  ...baseUser,
  id: "vd.kang",
  name: "강태오",
  role: "VENDOR",
  custCode: "VN001",
  custName: "(주)코드웍스",
};

beforeAll(async () => {
  // 첫 쿼리가 시드를 트리거한다
  await select("SELECT 1 AS ok");
});

describe("시드 불변식 (원본 실측 프로파일 재현)", () => {
  it("상태 7(이관요청)·8(이관승인)·10(취소요청)은 0건이다 — 실측상 미사용 워크플로", async () => {
    const rows = await select<{ PROGRESS: string; n: number }>(
      "SELECT PROGRESS, COUNT(*) AS n FROM NX_OPTREPORTD GROUP BY PROGRESS",
    );
    const byCode = Object.fromEntries(rows.map((r) => [r.PROGRESS, r.n]));
    expect(byCode["7"]).toBeUndefined();
    expect(byCode["8"]).toBeUndefined();
    expect(byCode["10"]).toBeUndefined();
    // 주 경로 상태는 전부 존재
    for (const p of ["1", "2", "3", "4", "9"]) {
      expect(byCode[p], `상태 ${p}`).toBeGreaterThan(0);
    }
  });

  it("이관(MIGRATION) 건이 과반이고, 기본 목록에서는 제외된다", async () => {
    const all = await listTickets(filters(), internal);
    const noMig = await listTickets(
      filters({ includeMigration: false }),
      internal,
    );
    expect(all.total).toBeGreaterThan(2000);
    expect(noMig.total).toBeLessThan(all.total / 2 + 200);
  });

  it("비공개(PUBLICYN='N')가 다수다", async () => {
    const rows = await select<{ pub: string; n: number }>(
      "SELECT COALESCE(PUBLICYN,'N') AS pub, COUNT(*) AS n FROM NX_OPTREPORTD GROUP BY pub",
    );
    const priv = rows.find((r) => r.pub === "N")?.n ?? 0;
    const pub = rows.find((r) => r.pub === "Y")?.n ?? 0;
    expect(priv).toBeGreaterThan(pub);
  });
});

describe("가시성 게이트 — fail-closed", () => {
  it("역할별 범위: 내부 > 고객사 > 0", async () => {
    const all = await listTickets(filters(), internal);
    const hb = await listTickets(filters(), hbApprover);
    expect(all.total).toBeGreaterThan(hb.total);
    expect(hb.total).toBeGreaterThan(0);
  });

  it("고객사 사용자는 타사 티켓을 열 수 없다 (존재 여부도 흘리지 않음)", async () => {
    const hbTickets = await listTickets(filters(), hbApprover);
    const someHb = hbTickets.rows[0];
    expect(someHb).toBeDefined();
    const stolen = await getTicket(someHb.echoNum, sjMember);
    expect(stolen).toBeNull();
  });

  it("비승인권자는 동료의 비공개 티켓을 볼 수 없다", async () => {
    const rows = await listTickets(filters(), hbMember);
    for (const r of rows.rows) {
      expect(
        r.isPublic || r.requesterId === hbMember.id,
        `${r.echoNum} 이 비공개인데 노출됨`,
      ).toBe(true);
    }
  });

  it("승인권자는 자사의 비공개 티켓을 볼 수 있다", async () => {
    const rows = await listTickets(filters(), hbApprover);
    const othersPrivate = rows.rows.filter(
      (r) => !r.isPublic && r.requesterId !== hbApprover.id,
    );
    expect(othersPrivate.length).toBeGreaterThan(0);
  });

  it("외부업체는 본인에게 배정된 건만 본다", async () => {
    const rows = await listTickets(filters(), vendor);
    expect(rows.total).toBeGreaterThan(0);
    for (const r of rows.rows) {
      expect(r.assigneeId).toBe(vendor.id);
    }
  });

  it("내부 전용 댓글은 고객사 조회에서 제외된다", async () => {
    const adminRows = await select<{ PECHONUM: string }>(
      `SELECT DISTINCT PECHONUM FROM NX_OPTREPORTR WHERE ADMIN_ONLY_YN = 'Y' LIMIT 5`,
    );
    expect(adminRows.length).toBeGreaterThan(0);
    for (const { PECHONUM } of adminRows) {
      const asInternal = await getComments(PECHONUM, "INTERNAL");
      const asCustomer = await getComments(PECHONUM, "CUSTOMER");
      expect(asInternal.some((c) => c.adminOnly)).toBe(true);
      expect(asCustomer.some((c) => c.adminOnly)).toBe(false);
    }
  });
});

describe("대시보드 집계 (SQLite 방언)", () => {
  it("내부 사용자 대시보드의 위젯이 전부 채워진다", async () => {
    const d = await getDashboard(internal);
    expect(d.trend.length).toBeGreaterThanOrEqual(10); // 최근 12개월 추이
    expect(d.openByStatus.length).toBeGreaterThan(0);
    expect(d.completedTotal).toBeGreaterThan(0);
    expect(d.duration.length).toBe(5); // 처리기간 버킷 5개
    expect(d.topCustomers.length).toBeGreaterThan(3);
    expect(d.assigneePerf.length).toBeGreaterThan(3);
    expect(d.notices.length).toBeGreaterThan(0);
  });

  it("고객사 대시보드는 자사 범위로 축소되고 담당자 실적이 감춰진다", async () => {
    const d = await getDashboard(hbApprover);
    expect(d.assigneePerf).toEqual([]);
    expect(d.topCustomers.every((c) => c.custCode === "HB001")).toBe(true);
  });
});
