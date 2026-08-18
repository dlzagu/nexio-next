import { cookies } from "next/headers";
import { USER_TYPE, type UserRole } from "./codes";
import { select } from "./db";
import type { CustomerConfig, User } from "./types";

/**
 * 데모 세션. "누구로 볼 것인가"를 쿠키로 고른다 —
 * 역할별 UX(대시보드 구성·canDo 결과·가시성 범위)를 실제로 체험할 수 있게 하는 장치다.
 * 페르소나는 전부 시드 데이터의 **가상 인물**이다 (src/lib/dev-seed/corpus.ts).
 */
export const USER_COOKIE = "nx_user";

/** 기본 사용자 — 시드 데이터의 운영팀 계정 (가상) */
export const DEFAULT_USER_ID = "sy.kim";

/** 역할 전환용 페르소나 — 권한 모델의 네 축을 모두 체험할 수 있게 구성 */
export const PERSONAS = [
  { id: "sy.kim", hint: "운영팀 (내부)" },
  { id: "th.oh", hint: "운영팀 관리자 — 고객사 비활성 가능" },
  { id: "hb.yoon", hint: "고객사 — 한빛제약 (승인권자)" },
  { id: "sj.moon", hint: "고객사 — 세진식품" },
  { id: "vd.kang", hint: "외부업체 (배정건만)" },
] as const;

interface MemberRow {
  MBER_ID: string;
  MBER_NM: string | null;
  USER_TYPE: string | null;
  COMPANY_CODE: string | null;
  COMPANY_NAME_LOC: string | null;
  DEPT: string | null;
  EMAIL: string | null;
  APPROVER: string | null;
}

function toRole(raw: string | null): UserRole {
  const mapped = (USER_TYPE as Record<string, UserRole>)[
    String(raw ?? "").trim()
  ];
  // 알 수 없는 USER_TYPE 은 권한이 가장 좁은 CUSTOMER 로 떨군다 (fail-closed)
  return mapped ?? "CUSTOMER";
}

export async function loadUser(userId: string): Promise<User | null> {
  const rows = await select<MemberRow>(
    `SELECT m.MBER_ID, m.MBER_NM, m.USER_TYPE, m.COMPANY_CODE, m.DEPT, m.EMAIL, m.APPROVER,
            c.COMPANY_NAME_LOC
       FROM MEMBER_MST m
       LEFT JOIN COMPANY_MST c ON c.COMPANY_CODE = m.COMPANY_CODE
      WHERE m.MBER_ID = @id`,
    [{ name: "id", value: userId }],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.MBER_ID,
    name: r.MBER_NM?.trim() || r.MBER_ID,
    role: toRole(r.USER_TYPE),
    custCode: r.COMPANY_CODE?.trim() || "",
    custName: r.COMPANY_NAME_LOC?.trim() || r.COMPANY_CODE?.trim() || "",
    dept: r.DEPT?.trim() || null,
    email: r.EMAIL?.trim() || null,
    isApprover:
      String(r.APPROVER ?? "")
        .trim()
        .toUpperCase() === "Y",
  };
}

/** 현재 사용자. 쿠키에 지정된 계정이 없으면 기본 계정으로 되돌린다 */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const id = store.get(USER_COOKIE)?.value || DEFAULT_USER_ID;
  const user = await loadUser(id);
  if (user) return user;
  return id === DEFAULT_USER_ID ? null : loadUser(DEFAULT_USER_ID);
}

interface CompanyRow {
  COMPANY_CODE: string;
  COMPANY_NAME_LOC: string | null;
  SHOWYN: string | null;
  CONFYN: string | null;
  TESTYN: string | null;
  SYSTEMYN: string | null;
  DEF_PRIVATE_YN: string | null;
}

const isY = (v: string | null | undefined) =>
  String(v ?? "")
    .trim()
    .toUpperCase() === "Y";

export async function loadCustomerConfig(
  custCode: string,
): Promise<CustomerConfig | null> {
  if (!custCode) return null;
  const rows = await select<CompanyRow>(
    `SELECT COMPANY_CODE, COMPANY_NAME_LOC, SHOWYN, CONFYN, TESTYN, SYSTEMYN, DEF_PRIVATE_YN
       FROM COMPANY_MST WHERE COMPANY_CODE = @c`,
    [{ name: "c", value: custCode }],
  );
  const r = rows[0];
  // 미등록 고객사는 확장 단계를 전부 끈 상태로 본다 (fail-closed)
  if (!r) return null;
  return {
    custCode: r.COMPANY_CODE,
    custName: r.COMPANY_NAME_LOC?.trim() || r.COMPANY_CODE,
    showsContractTime: isY(r.SHOWYN),
    usesApproval: isY(r.CONFYN),
    usesTestStage: isY(r.TESTYN),
    usesSystemStage: isY(r.SYSTEMYN),
    defaultPrivate: isY(r.DEF_PRIVATE_YN),
  };
}

/** 역할 전환 목록의 한 줄. `available=false` 면 **DB 에 그 계정이 없다** */
export interface Persona {
  id: string;
  hint: string;
  available: boolean;
}

/**
 * 역할 전환 목록. 힌트는 코드에, **사람은 DB 에** 있다 — 둘은 따로 배포된다
 * (코드는 git push, 데모 데이터는 시드). 그래서 코드가 제시하는 사람이 DB 에 없을 수 있다:
 * 로컬 파일 DB 는 SCHEMA_VERSION 이 바뀌면 통째로 다시 만들어지지만,
 * **공유 DB 는 아무 일도 일어나지 않는다** (실측: 새로 추가한 페르소나가 라이브에서 404).
 *
 * 없는 사람을 목록에서 지우지는 않는다 — 지우면 "왜 없지"가 남는다.
 * 비활성으로 두고 이유를 붙인다 (막힌 액션·취소 힌트와 같은 규칙).
 */
export async function listPersonas(): Promise<Persona[]> {
  const params = PERSONAS.map((p, i) => ({ name: `p${i}`, value: p.id }));
  const rows = await select<{ MBER_ID: string }>(
    `SELECT MBER_ID FROM MEMBER_MST
      WHERE MBER_ID IN (${params.map((p) => `@${p.name}`).join(",")})`,
    params,
  );
  const present = new Set(rows.map((r) => r.MBER_ID));
  return PERSONAS.map((p) => ({ ...p, available: present.has(p.id) }));
}

/** 목록에 있는데 DB 에 없는 계정 — 코드와 데모 데이터가 어긋난 지점 */
export async function missingPersonaIds(): Promise<string[]> {
  return (await listPersonas()).filter((p) => !p.available).map((p) => p.id);
}
