import { select, type Param } from "../db";
import type { User } from "../types";

/**
 * 코드성 메타. 조회·신청 화면이 엔드포인트 5개를 공유하므로 한 번에 묶어 내린다
 * (화면마다 따로 부르면 같은 목록을 중복 요청하게 된다).
 */

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export interface MetaData {
  companies: Option[];
  assignees: Option[];
  requesters: Option[];
  systems: Option[];
  contractTime: { month: number; used: number; remain: number } | null;
}

export async function getMeta(user: User): Promise<MetaData> {
  const isInternal = user.role === "INTERNAL";

  const companiesQ = async (): Promise<Option[]> => {
    // 고객사 사용자에게 다른 회사 목록을 내려주지 않는다
    if (!isInternal) {
      return user.custCode
        ? [{ value: user.custCode, label: user.custName || user.custCode }]
        : [];
    }
    const rows = await select<{
      COMPANY_CODE: string;
      nm: string | null;
      n: number;
    }>(
      `SELECT c.COMPANY_CODE, c.COMPANY_NAME_LOC AS nm,
              (SELECT COUNT(*) FROM NX_OPTREPORTD d
                WHERE d.CUSTCODE = c.COMPANY_CODE AND d.PROGRESS NOT IN ('9','11','12')) AS n
         FROM COMPANY_MST c
        WHERE COALESCE(c.ACTIVE,'Y') = 'Y'
        ORDER BY c.COMPANY_NAME_LOC`,
    );
    return rows.map((r) => ({
      value: r.COMPANY_CODE,
      label: (r.nm ?? r.COMPANY_CODE).trim(),
      hint: Number(r.n) > 0 ? `미완료 ${r.n}` : undefined,
    }));
  };

  const assigneesQ = async (): Promise<Option[]> => {
    const rows = await select<{ MBER_ID: string; MBER_NM: string | null }>(
      `SELECT DISTINCT m.MBER_ID, m.MBER_NM
         FROM MEMBER_MST m
        WHERE m.USER_TYPE IN ('B0001_01','B0001_03')
          AND COALESCE(m.ACTIVE,'Y') = 'Y'
          AND EXISTS (SELECT 1 FROM NX_OPTREPORTD d WHERE d.SUCCERSON = m.MBER_ID)
        ORDER BY m.MBER_NM`,
    );
    return rows.map((r) => ({
      value: r.MBER_ID,
      label: (r.MBER_NM ?? r.MBER_ID).trim(),
    }));
  };

  const requestersQ = async (): Promise<Option[]> => {
    const params: Param[] = [];
    let where = "m.USER_TYPE = 'B0001_02' AND COALESCE(m.ACTIVE,'Y') = 'Y'";
    if (!isInternal) {
      params.push({ name: "cc", value: user.custCode });
      where += " AND m.COMPANY_CODE = @cc";
    }
    const rows = await select<{
      MBER_ID: string;
      MBER_NM: string | null;
      DEPT: string | null;
      EMAIL: string | null;
    }>(
      `SELECT m.MBER_ID, m.MBER_NM, m.DEPT, m.EMAIL
         FROM MEMBER_MST m WHERE ${where} ORDER BY m.MBER_NM LIMIT 400`,
      params,
    );
    return rows.map((r) => ({
      value: r.MBER_ID,
      label: (r.MBER_NM ?? r.MBER_ID).trim(),
      hint: (r.DEPT ?? "").trim() || undefined,
    }));
  };

  const systemsQ = async (): Promise<Option[]> => {
    const params: Param[] = [];
    let where =
      "COALESCE(os.USE_YN,'Y') = 'Y' AND COALESCE(os.DEL_YN,'N') <> 'Y'";
    if (!isInternal) {
      params.push({ name: "cc2", value: user.custCode });
      where += " AND os.COMPANY_CODE = @cc2";
    }
    const rows = await select<{
      OPER_SYS_ID: string;
      SYSTEM_NAME: string | null;
      COMPANY_CODE: string | null;
    }>(
      `SELECT os.OPER_SYS_ID, os.SYSTEM_NAME, os.COMPANY_CODE
         FROM COMPANY_OPER_SYSTEM os WHERE ${where}
        ORDER BY os.COMPANY_CODE, os.SORT_ORD, os.OPER_SYS_ID`,
      params,
    );
    return rows.map((r) => ({
      value: String(r.OPER_SYS_ID),
      label: (r.SYSTEM_NAME ?? "").trim() || `시스템 ${r.OPER_SYS_ID}`,
      hint: isInternal ? (r.COMPANY_CODE ?? "").trim() : undefined,
    }));
  };

  const [companies, assignees, requesters, systems] = await Promise.all([
    companiesQ().catch(() => []),
    assigneesQ().catch(() => []),
    requestersQ().catch(() => []),
    systemsQ().catch(() => []),
  ]);

  return { companies, assignees, requesters, systems, contractTime: null };
}
