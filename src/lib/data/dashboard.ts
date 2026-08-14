import { PROGRESS, progressLabel } from "../codes";
import { select, type Param } from "../db";
import { toWallClockIso } from "../format";
import type { DashboardData, TicketFilters, User } from "../types";
import { listTickets, scopeClause } from "./tickets";

/**
 * 대시보드. 원본은 페이지당 19회+ 호출(중복 포함)했다 —
 * 여기서 서버측 병렬 조회 1회로 묶는다.
 *
 * ⚠️ 위젯 하나가 죽어도 대시보드 전체가 죽지 않게 allSettled 로 모은다.
 *    실패한 위젯은 빈 값으로 내리고 화면에서 개별 상태로 표시한다.
 */

const TERMINAL = "'9','11','12'";
const NOT_MIGRATION = "COALESCE(d.REQTYPE,'') <> 'MIGRATION'";

function baseFilters(over: Partial<TicketFilters> = {}): TicketFilters {
  return {
    view: "open",
    keyword: "",
    custCode: "",
    progress: "",
    from: "",
    to: "",
    assignee: "",
    requester: "",
    module: "",
    priority: "",
    includeMigration: false,
    ...over,
  };
}

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    // 조용히 삼키지 않는다 — 서버 로그에 남긴다
    console.error("[dashboard widget]", e instanceof Error ? e.message : e);
    return fallback;
  }
}

export async function getDashboard(user: User): Promise<DashboardData> {
  /**
   * "내 건"의 정의가 역할마다 다르다.
   * 고객사 사용자에게는 **내가 낸 요청**(CUSTPERSON), 처리자에게는 **내가 담당한 건**(SUCCERSON).
   * 이걸 구분하지 않으면 고객사 화면의 카드가 항상 0으로 보인다.
   */
  const MINE_COL = user.role === "CUSTOMER" ? "d.CUSTPERSON" : "d.SUCCERSON";
  const mineListFilters = baseFilters(
    user.role === "CUSTOMER"
      ? { view: "open", requester: user.id }
      : { view: "open", assignee: user.id },
  );

  const scoped = (extra: string) => {
    const params: Param[] = [];
    const scope = scopeClause(user, params);
    return {
      params,
      where: `${scope} AND ${NOT_MIGRATION}${extra ? ` AND ${extra}` : ""}`,
    };
  };

  const cardsQ = async () => {
    const { params, where } = scoped("");
    const r = await select<{
      myPending: number;
      inProgress: number;
      awaitingSolution: number;
      unread: number;
    }>(
      // 집계식 안에 서브쿼리를 두지 않도록 파생 테이블로 먼저 평탄화한다
      // (원본 SQL Server 시절의 제약을 유지 — 구조를 바꿀 이유가 없다)
      `SELECT
         SUM(CASE WHEN t.mineFg = 1 AND t.openFg = 1 THEN 1 ELSE 0 END) AS myPending,
         SUM(CASE WHEN t.PROGRESS = '3' THEN 1 ELSE 0 END) AS inProgress,
         SUM(CASE WHEN t.PROGRESS = '4' THEN 1 ELSE 0 END) AS awaitingSolution,
         SUM(CASE WHEN t.openFg = 1 AND t.lastCommentId > t.lastSeen THEN 1 ELSE 0 END) AS unread
       FROM (
         SELECT d.PROGRESS,
                CASE WHEN ${MINE_COL} = @me THEN 1 ELSE 0 END AS mineFg,
                CASE WHEN d.PROGRESS NOT IN (${TERMINAL}) THEN 1 ELSE 0 END AS openFg,
                COALESCE((SELECT MAX(r2.ID) FROM NX_OPTREPORTR r2
                           WHERE r2.PECHONUM = d.ECHONUM), 0) AS lastCommentId,
                COALESCE(rs.LAST_SEEN_COMMENT_ID, 0) AS lastSeen
           FROM NX_OPTREPORTD d
           LEFT JOIN NX_OPTREPORT_READ_STATE rs
                  ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me
          WHERE ${where}
       ) t`,
      params,
    );
    const row = r[0];
    return {
      myPending: Number(row?.myPending ?? 0),
      inProgress: Number(row?.inProgress ?? 0),
      awaitingSolution: Number(row?.awaitingSolution ?? 0),
      unreadComments: Number(row?.unread ?? 0),
    };
  };

  const trendQ = async () => {
    const { params, where } = scoped(
      "d.REQDATE >= date('now', '-11 months', 'start of month')",
    );
    const rows = await select<{
      ym: string;
      created: number;
      completed: number;
    }>(
      `SELECT strftime('%Y-%m', d.REQDATE) AS ym,
              COUNT(*) AS created,
              SUM(CASE WHEN d.PROGRESS = '9' THEN 1 ELSE 0 END) AS completed
         FROM NX_OPTREPORTD d
         LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me
        WHERE ${where}
        GROUP BY strftime('%Y-%m', d.REQDATE)
        ORDER BY ym`,
      params,
    );
    return rows.map((r) => ({
      month: r.ym,
      created: Number(r.created),
      completed: Number(r.completed),
    }));
  };

  /**
   * 🔴 상태 분포는 완료가 99%다 → 한 도넛에 그리면 원 하나가 되고 정보량이 0.
   *    완료는 큰 숫자로 따로 빼고, 도넛은 **미완료만** 그린다.
   */
  const statusQ = async () => {
    const { params, where } = scoped("");
    const rows = await select<{ PROGRESS: string; n: number }>(
      `SELECT d.PROGRESS, COUNT(*) AS n
         FROM NX_OPTREPORTD d
         LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me
        WHERE ${where}
        GROUP BY d.PROGRESS`,
      params,
    );
    const completed = rows
      .filter((r) => ["9", "11", "12"].includes(String(r.PROGRESS).trim()))
      .reduce((a, r) => a + Number(r.n), 0);
    const open = rows
      .filter((r) => !["9", "11", "12"].includes(String(r.PROGRESS).trim()))
      .map((r) => ({
        code: String(r.PROGRESS).trim(),
        label: progressLabel(r.PROGRESS) || String(r.PROGRESS),
        n: Number(r.n),
      }))
      .sort(
        (a, b) =>
          Object.keys(PROGRESS).indexOf(a.code) -
          Object.keys(PROGRESS).indexOf(b.code),
      );
    return { open, completed };
  };

  const durationQ = async () => {
    const { params, where } = scoped(
      "d.PROGRESS = '9' AND d.SUCCDATE IS NOT NULL AND d.REQDATE >= '2015-01-01'",
    );
    const rows = await select<{ bucket: string; n: number; ord: number }>(
      `SELECT bucket, COUNT(*) AS n, MIN(ord) AS ord FROM (
         SELECT CASE
                  WHEN days <= 1 THEN '1일 이내'
                  WHEN days <= 3 THEN '2~3일'
                  WHEN days <= 7 THEN '4~7일'
                  WHEN days <= 30 THEN '8~30일'
                  ELSE '30일 초과' END AS bucket,
                CASE
                  WHEN days <= 1 THEN 1
                  WHEN days <= 3 THEN 2
                  WHEN days <= 7 THEN 3
                  WHEN days <= 30 THEN 4
                  ELSE 5 END AS ord
           FROM (
             SELECT CAST(julianday(d.SUCCDATE) - julianday(d.REQDATE) AS INTEGER) AS days
               FROM NX_OPTREPORTD d
               LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me
              WHERE ${where}
           )
       ) t GROUP BY bucket ORDER BY ord`,
      params,
    );
    return rows.map((r) => ({ bucket: r.bucket, n: Number(r.n) }));
  };

  const topCustQ = async () => {
    const { params, where } = scoped(`d.PROGRESS NOT IN (${TERMINAL})`);
    const rows = await select<{
      CUSTCODE: string;
      nm: string | null;
      n: number;
    }>(
      `SELECT d.CUSTCODE, c.COMPANY_NAME_LOC AS nm, COUNT(*) AS n
         FROM NX_OPTREPORTD d
         LEFT JOIN COMPANY_MST c ON c.COMPANY_CODE = d.CUSTCODE
         LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me
        WHERE ${where}
        GROUP BY d.CUSTCODE, c.COMPANY_NAME_LOC
        ORDER BY COUNT(*) DESC
        LIMIT 8`,
      params,
    );
    return rows.map((r) => ({
      custCode: String(r.CUSTCODE ?? ""),
      custName: (r.nm ?? r.CUSTCODE ?? "").trim(),
      n: Number(r.n),
    }));
  };

  const assigneeQ = async () => {
    // 고객사 사용자에게는 담당자별 실적이 의미가 없다 → 아예 조회하지 않는다
    if (user.role !== "INTERNAL") return [];
    const { params, where } = scoped("d.SUCCERSON IS NOT NULL");
    const rows = await select<{
      id: string;
      nm: string | null;
      open_n: number;
      done_n: number;
    }>(
      `SELECT d.SUCCERSON AS id, m.MBER_NM AS nm,
              SUM(CASE WHEN d.PROGRESS NOT IN (${TERMINAL}) THEN 1 ELSE 0 END) AS open_n,
              SUM(CASE WHEN d.PROGRESS = '9' AND d.SUCCDATE >= date('now', '-3 months')
                       THEN 1 ELSE 0 END) AS done_n
         FROM NX_OPTREPORTD d
         LEFT JOIN MEMBER_MST m ON m.MBER_ID = d.SUCCERSON
         LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me
        WHERE ${where}
        GROUP BY d.SUCCERSON, m.MBER_NM
        ORDER BY SUM(CASE WHEN d.PROGRESS NOT IN (${TERMINAL}) THEN 1 ELSE 0 END) DESC
        LIMIT 8`,
      params,
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: (r.nm ?? r.id ?? "").trim(),
      open: Number(r.open_n),
      done: Number(r.done_n),
    }));
  };

  const noticeQ = async () => {
    const rows = await select<{
      NTT_ID: string;
      NTT_SJ: string | null;
      NTCR_NM: string | null;
      REG_DT: string | null;
    }>(
      `SELECT NTT_ID, NTT_SJ, NTCR_NM, REG_DT
         FROM BOARD_DETAIL
        WHERE COALESCE(DELETE_FG,'N') <> 'Y' AND COALESCE(USE_FG,'Y') = 'Y'
        ORDER BY REG_DT DESC
        LIMIT 5`,
    );
    return rows.map((r) => ({
      id: String(r.NTT_ID),
      title: (r.NTT_SJ ?? "").trim() || "(제목 없음)",
      author: (r.NTCR_NM ?? "").trim(),
      at: toWallClockIso(r.REG_DT),
    }));
  };

  const [
    cards,
    myPendingList,
    unresolvedList,
    recentList,
    trend,
    status,
    duration,
    topCustomers,
    assigneePerf,
    notices,
  ] = await Promise.all([
    settle(cardsQ(), {
      myPending: 0,
      inProgress: 0,
      awaitingSolution: 0,
      unreadComments: 0,
    }),
    settle(listTickets(mineListFilters, user), {
      rows: [],
      total: 0,
      truncated: false,
      clientSortable: true,
    }),
    settle(listTickets(baseFilters({ view: "open" }), user), {
      rows: [],
      total: 0,
      truncated: false,
      clientSortable: true,
    }),
    settle(listTickets(baseFilters({ view: "all" }), user), {
      rows: [],
      total: 0,
      truncated: false,
      clientSortable: false,
    }),
    settle(trendQ(), []),
    settle(statusQ(), { open: [], completed: 0 }),
    settle(durationQ(), []),
    settle(topCustQ(), []),
    settle(assigneeQ(), []),
    settle(noticeQ(), []),
  ]);

  return {
    scope: {
      role: user.role,
      custCode: user.custCode,
      custName: user.custName,
    },
    cards,
    myPending: myPendingList.rows.slice(0, 6),
    companyUnresolved: unresolvedList.rows.slice(0, 6),
    trend,
    openByStatus: status.open,
    completedTotal: status.completed,
    duration,
    topCustomers,
    assigneePerf,
    notices,
    recent: recentList.rows.slice(0, 5),
  };
}
