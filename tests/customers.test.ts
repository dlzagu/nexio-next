import { beforeAll, describe, expect, it } from "vitest";
import type { User } from "@/lib/types";

/**
 * 고객사 관리 — 원본 내부관리 중 유일하게 이식한 화면 (ADR-0010).
 *
 * 검증 축:
 *  1. 등록은 운영팀, **비활성은 운영팀 관리자만** (계정 체계가 없는 데모라 기본은 전부 차단)
 *  2. "삭제"는 행 삭제가 아니라 비활성 — 티켓 이력이 살아남아야 한다
 *  3. 등록하면 그 고객사로 **신청을 시작할 수 있어야** 한다 (운영시스템까지 함께)
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

import {
  createCustomer,
  CustomerError,
  listCustomers,
  setCustomerActive,
} from "@/lib/data/customers";
import { listSystems } from "@/lib/data/meta";
import { listTickets } from "@/lib/data/tickets";
import { select } from "@/lib/db";
import {
  canDeactivateCustomer,
  canManageCustomers,
  customerAdminHint,
} from "@/lib/permissions";

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
const admin: User = {
  ...internal,
  id: "th.oh",
  name: "오태현",
  isApprover: true,
};
const customer: User = {
  ...internal,
  id: "hb.yoon",
  role: "CUSTOMER",
  custCode: "HB001",
  isApprover: true,
};
const vendor: User = { ...internal, id: "vd.kang", role: "VENDOR" };

beforeAll(async () => {
  await select("SELECT 1 AS ok");
});

describe("권한 — 기본은 차단", () => {
  it("고객사 관리는 운영팀만 본다", () => {
    expect(canManageCustomers(internal)).toBe(true);
    expect(canManageCustomers(admin)).toBe(true);
    expect(canManageCustomers(customer)).toBe(false);
    expect(canManageCustomers(vendor)).toBe(false);
    expect(canManageCustomers(null)).toBe(false);
  });

  it("비활성(=삭제)은 운영팀 **관리자만** — 일반 운영팀도 못 한다", () => {
    expect(canDeactivateCustomer(admin)).toBe(true);
    expect(canDeactivateCustomer(internal)).toBe(false);
    // 고객사의 승인권자(isApprover=true)가 관리자로 승격되지 않는다
    expect(canDeactivateCustomer(customer)).toBe(false);
    expect(canDeactivateCustomer(vendor)).toBe(false);
    expect(canDeactivateCustomer(null)).toBe(false);
  });

  it("막힌 이유를 문장으로 알려준다 (버튼이 조용히 사라지지 않는다)", () => {
    expect(customerAdminHint(admin)).toBeNull();
    expect(customerAdminHint(internal)).toContain("관리자");
    expect(customerAdminHint(customer)).toContain("운영팀");
  });
});

describe("등록", () => {
  it("등록하면 그 고객사로 신청을 시작할 수 있다 (운영시스템까지 한 트랜잭션)", async () => {
    const before = (await listCustomers()).length;
    await createCustomer(
      {
        custCode: "zz001",
        custName: "지지물산",
        systemName: "ERP 운영계",
        usesApproval: true,
        usesTestStage: false,
        usesSystemStage: false,
        defaultPrivate: true,
        showsContractTime: false,
      },
      internal,
    );

    const rows = await listCustomers();
    expect(rows.length).toBe(before + 1);
    const created = rows.find((r) => r.custCode === "ZZ001");
    expect(created?.custName).toBe("지지물산");
    expect(created?.active).toBe(true);
    expect(created?.usesApproval).toBe(true);
    // 시스템이 없으면 신청 화면에서 고를 게 없다 → 함께 만들어야 한다
    expect(await listSystems("ZZ001")).toHaveLength(1);
  });

  it("코드 형식·중복을 거부한다", async () => {
    const base = {
      custName: "테스트",
      systemName: "",
      usesApproval: false,
      usesTestStage: false,
      usesSystemStage: false,
      defaultPrivate: true,
      showsContractTime: false,
    };
    await expect(
      createCustomer({ ...base, custCode: "한글코드" }, internal),
    ).rejects.toBeInstanceOf(CustomerError);
    await expect(
      createCustomer({ ...base, custCode: "AB" }, internal),
    ).rejects.toBeInstanceOf(CustomerError);
    await expect(
      createCustomer({ ...base, custCode: "HB001" }, internal),
    ).rejects.toThrow(/이미 있는/);
  });
});

describe("비활성 = 삭제", () => {
  it("비활성해도 **티켓 이력은 그대로 남는다** (행을 지우지 않는다)", async () => {
    const before = await listCustomers();
    const target = before.find((r) => r.tickets > 0);
    expect(target).toBeDefined();
    const ticketsBefore = (
      await listTickets(
        {
          view: "all",
          keyword: "",
          custCode: target!.custCode,
          progress: "",
          from: "",
          to: "",
          assignee: "",
          requester: "",
          module: "",
          priority: "",
          includeMigration: true,
        },
        internal,
      )
    ).total;

    await setCustomerActive(target!.custCode, false, admin);

    const after = (await listCustomers()).find(
      (r) => r.custCode === target!.custCode,
    );
    expect(after?.active).toBe(false);
    // 행이 남아 있으므로 티켓도 그대로다
    expect(after?.tickets).toBe(target!.tickets);
    const ticketsAfter = (
      await listTickets(
        {
          view: "all",
          keyword: "",
          custCode: target!.custCode,
          progress: "",
          from: "",
          to: "",
          assignee: "",
          requester: "",
          module: "",
          priority: "",
          includeMigration: true,
        },
        internal,
      )
    ).total;
    expect(ticketsAfter).toBe(ticketsBefore);

    // 되돌릴 수 있다
    await setCustomerActive(target!.custCode, true, admin);
    expect(
      (await listCustomers()).find((r) => r.custCode === target!.custCode)
        ?.active,
    ).toBe(true);
  });

  it("없는 고객사는 거부한다", async () => {
    await expect(
      setCustomerActive("NOPE9", false, admin),
    ).rejects.toBeInstanceOf(CustomerError);
  });
});
