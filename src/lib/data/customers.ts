import { select, write, type Param, type WriteStatement } from "../db";
import { toDbStamp } from "../format";
import type { CustomerConfig, User } from "../types";

/**
 * 고객사 관리. 원본 포털의 내부관리 27종 중 **이것 하나만** 이식했다 —
 * 고객사가 없으면 신청 자체가 시작되지 않기 때문이다 (ADR-0010).
 *
 * 🔴 "삭제"는 행을 지우는 게 아니라 `ACTIVE='N'` 이다. 티켓 수천 건이 고객사 코드를
 *    참조하므로 지우면 과거 이력이 어디에도 매달리지 못한다. 비활성이면 목록·선택지에서
 *    사라져 사용자에게는 삭제와 같고, 이력은 그대로 남는다.
 *    (쓰기 관문이 DELETE 를 아예 거부하는 것과도 같은 방향이다 — ADR-0006)
 */

export interface CustomerRow extends CustomerConfig {
  active: boolean;
  /** 이 고객사의 티켓 수 — 비활성 판단의 근거가 된다 */
  tickets: number;
  openTickets: number;
  systems: number;
}

interface RawCompany {
  COMPANY_CODE: string;
  COMPANY_NAME_LOC: string | null;
  ACTIVE: string | null;
  SHOWYN: string | null;
  CONFYN: string | null;
  TESTYN: string | null;
  SYSTEMYN: string | null;
  DEF_PRIVATE_YN: string | null;
  tickets: number;
  openTickets: number;
  systems: number;
}

const isY = (v: string | null | undefined) =>
  String(v ?? "")
    .trim()
    .toUpperCase() === "Y";

/** 고객사로 취급하지 않는 내부 법인(운영사·외주사)은 목록에서 뺀다 */
const INTERNAL_CODES = "'NX000','VEND0'";

export async function listCustomers(): Promise<CustomerRow[]> {
  const rows = await select<RawCompany>(
    `SELECT c.COMPANY_CODE, c.COMPANY_NAME_LOC, c.ACTIVE,
            c.SHOWYN, c.CONFYN, c.TESTYN, c.SYSTEMYN, c.DEF_PRIVATE_YN,
            (SELECT COUNT(*) FROM NX_OPTREPORTD d
              WHERE d.CUSTCODE = c.COMPANY_CODE) AS tickets,
            (SELECT COUNT(*) FROM NX_OPTREPORTD d
              WHERE d.CUSTCODE = c.COMPANY_CODE
                AND d.PROGRESS NOT IN ('9','11','12')) AS openTickets,
            (SELECT COUNT(*) FROM COMPANY_OPER_SYSTEM os
              WHERE os.COMPANY_CODE = c.COMPANY_CODE
                AND COALESCE(os.DEL_YN,'N') <> 'Y') AS systems
       FROM COMPANY_MST c
      WHERE c.COMPANY_CODE NOT IN (${INTERNAL_CODES})
      ORDER BY c.ACTIVE DESC, c.COMPANY_NAME_LOC`,
  );

  return rows.map((r) => ({
    custCode: r.COMPANY_CODE,
    custName: (r.COMPANY_NAME_LOC ?? "").trim() || r.COMPANY_CODE,
    active: isY(r.ACTIVE),
    showsContractTime: isY(r.SHOWYN),
    usesApproval: isY(r.CONFYN),
    usesTestStage: isY(r.TESTYN),
    usesSystemStage: isY(r.SYSTEMYN),
    defaultPrivate: isY(r.DEF_PRIVATE_YN),
    tickets: Number(r.tickets ?? 0),
    openTickets: Number(r.openTickets ?? 0),
    systems: Number(r.systems ?? 0),
  }));
}

export class CustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerError";
  }
}

export interface NewCustomerInput {
  custCode: string;
  custName: string;
  usesApproval: boolean;
  usesTestStage: boolean;
  usesSystemStage: boolean;
  defaultPrivate: boolean;
  showsContractTime: boolean;
  /** 첫 운영시스템 이름. 없으면 신청 화면에서 고를 게 없다 */
  systemName: string;
}

const yn = (v: boolean) => (v ? "Y" : "N");

/**
 * 고객사 등록. 운영시스템 하나를 **같은 트랜잭션**에서 함께 만든다 —
 * 시스템이 없는 고객사는 신청 폼에서 고를 게 없어 등록해도 아무것도 못 한다.
 */
export async function createCustomer(
  input: NewCustomerInput,
  user: User,
): Promise<{ custCode: string }> {
  const code = input.custCode.trim().toUpperCase();
  const name = input.custName.trim();
  if (!/^[A-Z0-9]{3,10}$/.test(code)) {
    throw new CustomerError(
      "고객사 코드는 영문 대문자·숫자 3~10자로 입력해 주세요.",
    );
  }
  if (!name) throw new CustomerError("고객사명을 입력해 주세요.");

  const dup = await select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM COMPANY_MST WHERE COMPANY_CODE = @c`,
    [{ name: "c", value: code }],
  );
  if (Number(dup[0]?.n ?? 0) > 0) {
    throw new CustomerError(`이미 있는 고객사 코드입니다 (${code}).`);
  }

  const statements: WriteStatement[] = [
    {
      sql: `INSERT INTO COMPANY_MST
              (COMPANY_CODE, COMPANY_NAME_LOC, ACTIVE,
               SHOWYN, CONFYN, TESTYN, SYSTEMYN, DEF_PRIVATE_YN)
            VALUES (@code, @name, 'Y', @show, @conf, @test, @system, @priv)`,
      params: [
        { name: "code", value: code },
        { name: "name", value: name },
        { name: "show", value: yn(input.showsContractTime) },
        { name: "conf", value: yn(input.usesApproval) },
        { name: "test", value: yn(input.usesTestStage) },
        { name: "system", value: yn(input.usesSystemStage) },
        { name: "priv", value: yn(input.defaultPrivate) },
      ],
    },
  ];

  const systemName = input.systemName.trim();
  if (systemName) {
    const next = await select<{ n: number }>(
      `SELECT COALESCE(MAX(OPER_SYS_ID), 0) + 1 AS n FROM COMPANY_OPER_SYSTEM`,
    );
    statements.push({
      sql: `INSERT INTO COMPANY_OPER_SYSTEM
              (OPER_SYS_ID, COMPANY_CODE, SYSTEM_NAME, USE_YN, DEL_YN, SORT_ORD)
            VALUES (@id, @code, @nm, 'Y', 'N', 1)`,
      params: [
        { name: "id", value: Number(next[0]?.n ?? 1) },
        { name: "code", value: code },
        { name: "nm", value: systemName },
      ],
    });
  }

  // 등록 사실을 남긴다 — 누가 언제 만든 고객사인지 알 수 있어야 한다
  statements.push(logRow(`고객사 등록: ${name} (${code})`, user));

  await write(statements);
  return { custCode: code };
}

/**
 * 활성/비활성 전환. 비활성이 곧 "삭제"다 (행은 지우지 않는다).
 * 권한 판정은 여기서 하지 않는다 — 라우트가 `canDeactivateCustomer()` 로 거른 뒤 부른다.
 */
export async function setCustomerActive(
  custCode: string,
  active: boolean,
  user: User,
): Promise<void> {
  const code = custCode.trim().toUpperCase();
  const rows = await select<{ COMPANY_NAME_LOC: string | null }>(
    `SELECT COMPANY_NAME_LOC FROM COMPANY_MST
      WHERE COMPANY_CODE = @c AND COMPANY_CODE NOT IN (${INTERNAL_CODES})`,
    [{ name: "c", value: code }],
  );
  if (rows.length === 0) {
    throw new CustomerError("없는 고객사입니다.");
  }
  const name = (rows[0].COMPANY_NAME_LOC ?? "").trim() || code;

  await write([
    {
      sql: `UPDATE COMPANY_MST SET ACTIVE = @a WHERE COMPANY_CODE = @c`,
      params: [
        { name: "a", value: yn(active) },
        { name: "c", value: code },
      ],
    },
    logRow(
      active
        ? `고객사 재활성: ${name} (${code})`
        : `고객사 비활성: ${name} (${code})`,
      user,
    ),
  ]);
}

/**
 * 관리 이력. 별도 테이블을 만들지 않고 공지 테이블의 숨김 행으로 남긴다 —
 * 데모에 새 도메인 테이블을 늘리지 않으면서도 "누가 언제 무엇을" 은 남는다.
 */
function logRow(text: string, user: User): WriteStatement {
  const params: Param[] = [
    { name: "sj", value: text },
    { name: "cn", value: `<p>${user.name}(${user.id})</p>` },
    { name: "nm", value: user.name },
    { name: "dt", value: toDbStamp() },
  ];
  return {
    sql: `INSERT INTO BOARD_DETAIL (NTT_ID, NTT_SJ, NTT_CN, NTCR_NM, REG_DT, DELETE_FG, USE_FG)
          SELECT COALESCE(MAX(NTT_ID), 0) + 1, @sj, @cn, @nm, @dt, 'Y', 'N'
            FROM BOARD_DETAIL`,
    params,
  };
}
