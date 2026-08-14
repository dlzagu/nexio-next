import { PRIORITY, MODULE, labelOf, type ProgressCode } from "../codes";
import { decodeEntities, plainPreview, toWallClockIso } from "../format";
import { select, type Param } from "../db";
import type {
  Comment,
  TicketDetail,
  TicketFilters,
  TicketListResult,
  TicketRow,
  User,
} from "../types";
import { USER_TYPE, type UserRole } from "../codes";

/**
 * 티켓 조회. 원본 테이블 NX_OPTREPORTD(97컬럼) → 정규화된 TicketRow.
 * 🔴 원본 필드명은 이 파일 밖으로 나가지 않는다. 변환은 여기 한 곳에서만.
 *
 * 코드 매핑 (개발 DB 실측 2026-07-30):
 *   B1GUBUN  → COMPANY_OPER_SYSTEM.OPER_SYS_ID (운영시스템). ⚠️ B1GUBUN1 아님
 *   MODULE   → B1GUBUN2 (26)
 *   REQLEVEL → PRIORLVL (1긴급 2높음 3중간 4낮음)
 *   REQTYPE  → MIGRATION | SERVICE | WORK (구시스템 이관분 18,274건)
 */

/** 진행 중/내 요청 뷰는 전량을 받아 클라이언트가 정렬한다. 실측 미완료 171건 대비 여유 */
const CLIENT_SORT_LIMIT = 1000;
/** 아카이브(전체 검색)는 서버 페이징 */
export const ARCHIVE_PAGE_SIZE = 50;

const TERMINAL = "'9','11','12'";

interface RawRow {
  ECHONUM: string;
  CUSTCODE: string | null;
  custName: string | null;
  TITLE: string | null;
  REMARKS: string | null;
  PROGRESS: string | null;
  systemName: string | null;
  MODULE: string | null;
  REQLEVEL: string | null;
  REQTYPE: string | null;
  CUSTPERSON: string | null;
  requesterName: string | null;
  SUCCERSON: string | null;
  assigneeName: string | null;
  REQDATE: string | null;
  SCHEDATE: string | null;
  SUCCDATE: string | null;
  PUBLICYN: string | null;
  WORKTIME: number | null;
  commentCount: number | null;
  lastCommentId: number | null;
  lastSeenCommentId: number | null;
}

// SQLite 는 날짜를 TEXT('YYYY-MM-DD HH:MM:SS')로 저장한다 → 벽시계 ISO 로 정규화.
// ⚠️ toISOString() 으로 절대시각화하면 안 된다 — toWallClockIso 주석 참조
const iso = toWallClockIso;
const trim = (s: string | null | undefined) => (s ?? "").trim();

function toRow(r: RawRow): TicketRow {
  const progressRaw = trim(r.PROGRESS);
  return {
    echoNum: r.ECHONUM,
    custCode: trim(r.CUSTCODE),
    custName: trim(r.custName) || trim(r.CUSTCODE),
    // TITLE 이 빈 구시스템 이관분은 REMARKS 앞부분으로 대체 (빈칸 금지).
    // 저장값이 HTML 이스케이프돼 있어(`&#39;` `&amp;`) 평문 표시 전에 한 번 풀어준다.
    title:
      decodeEntities(trim(r.TITLE)) ||
      plainPreview(r.REMARKS, 80) ||
      "(제목 없음)",
    progress: (progressRaw || "1") as ProgressCode,
    progressRaw,
    systemName: trim(r.systemName) || null,
    moduleLabel: labelOf(MODULE, r.MODULE),
    priority: labelOf(PRIORITY, r.REQLEVEL),
    priorityCode: trim(r.REQLEVEL),
    reqType: trim(r.REQTYPE),
    requesterId: trim(r.CUSTPERSON) || null,
    requesterName: trim(r.requesterName) || trim(r.CUSTPERSON) || "-",
    assigneeId: trim(r.SUCCERSON) || null,
    assigneeName: trim(r.assigneeName) || trim(r.SUCCERSON) || null,
    reqDate: iso(r.REQDATE),
    scheDate: iso(r.SCHEDATE),
    succDate: iso(r.SUCCDATE),
    isPublic: trim(r.PUBLICYN).toUpperCase() === "Y",
    commentCount: Number(r.commentCount ?? 0),
    hasUnreadComment:
      Number(r.lastCommentId ?? 0) > 0 &&
      Number(r.lastCommentId ?? 0) > Number(r.lastSeenCommentId ?? 0),
    workTime: r.WORKTIME === null ? null : Number(r.WORKTIME),
  };
}

const ROW_SELECT = `
  d.ECHONUM, d.CUSTCODE, c.COMPANY_NAME_LOC AS custName, d.TITLE, d.REMARKS,
  d.PROGRESS, os.SYSTEM_NAME AS systemName, d.MODULE, d.REQLEVEL, d.REQTYPE,
  d.CUSTPERSON, rm.MBER_NM AS requesterName,
  d.SUCCERSON, am.MBER_NM AS assigneeName,
  d.REQDATE, d.SCHEDATE, d.SUCCDATE, d.PUBLICYN, d.WORKTIME,
  (SELECT COUNT(*) FROM NX_OPTREPORTR r
     WHERE r.PECHONUM = d.ECHONUM AND COALESCE(r.IS_LOG_YN,'N') <> 'Y') AS commentCount,
  (SELECT MAX(r.ID) FROM NX_OPTREPORTR r WHERE r.PECHONUM = d.ECHONUM) AS lastCommentId,
  rs.LAST_SEEN_COMMENT_ID AS lastSeenCommentId`;

const ROW_JOINS = `
  FROM NX_OPTREPORTD d
  LEFT JOIN COMPANY_MST c          ON c.COMPANY_CODE = d.CUSTCODE
  LEFT JOIN COMPANY_OPER_SYSTEM os ON os.OPER_SYS_ID = d.B1GUBUN
  LEFT JOIN MEMBER_MST rm          ON rm.MBER_ID = d.CUSTPERSON
  LEFT JOIN MEMBER_MST am          ON am.MBER_ID = d.SUCCERSON
  LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = d.ECHONUM AND rs.USER_ID = @me`;

/**
 * 🔒 가시성 제한. 원본 시스템에서는 백엔드 서버가 하던 일 — 여기서는 DB 를
 *    직접 보므로 이 한 곳에서 fail-closed 로 구현한다. 역할을 모르면 가장 좁은 범위로 떨어진다.
 */
export function scopeClause(user: User, params: Param[]): string {
  params.push({ name: "me", value: user.id });

  if (user.role === "INTERNAL") return "1=1";

  if (user.role === "VENDOR") {
    // 외부업체는 본인에게 배정된 건만
    return "d.SUCCERSON = @me";
  }

  // 고객사: 자기 회사 + 비공개는 본인 작성건이거나 승인권자일 때만
  params.push({ name: "myCust", value: user.custCode });
  const priv = user.isApprover
    ? "1=1"
    : "(COALESCE(d.PUBLICYN,'N') = 'Y' OR d.CUSTPERSON = @me)";
  return `d.CUSTCODE = @myCust AND ${priv}`;
}

function filterClauses(
  f: TicketFilters,
  user: User,
  params: Param[],
): string[] {
  const w: string[] = [];

  if (f.view === "open") w.push(`d.PROGRESS NOT IN (${TERMINAL})`);
  if (f.view === "mine") w.push("(d.CUSTPERSON = @me OR d.SUCCERSON = @me)");

  if (!f.includeMigration) w.push("COALESCE(d.REQTYPE,'') <> 'MIGRATION'");

  if (f.keyword) {
    params.push({ name: "kw", value: `%${f.keyword}%` });
    w.push(
      "(d.TITLE LIKE @kw OR d.ECHONUM LIKE @kw OR d.CONTENT LIKE @kw OR d.REMARKS LIKE @kw)",
    );
  }
  if (f.custCode) {
    params.push({ name: "cc", value: f.custCode });
    w.push("d.CUSTCODE = @cc");
  }
  if (f.progress) {
    params.push({ name: "pg", value: f.progress });
    w.push("d.PROGRESS = @pg");
  }
  if (f.module) {
    params.push({ name: "md", value: f.module });
    w.push("d.MODULE = @md");
  }
  if (f.priority) {
    params.push({ name: "pr", value: f.priority });
    w.push("d.REQLEVEL = @pr");
  }
  if (f.assignee) {
    params.push({ name: "asg", value: f.assignee });
    w.push("d.SUCCERSON = @asg");
  }
  if (f.requester) {
    params.push({ name: "rq", value: f.requester });
    w.push("d.CUSTPERSON = @rq");
  }
  if (f.from) {
    params.push({ name: "df", value: f.from });
    w.push("d.REQDATE >= @df");
  }
  if (f.to) {
    params.push({ name: "dt", value: f.to });
    // 날짜 TEXT 비교 — 종료일 다음날 00:00 미만
    w.push("d.REQDATE < date(@dt, '+1 day')");
  }
  void user;
  return w;
}

export async function listTickets(
  f: TicketFilters,
  user: User,
  page = 1,
): Promise<TicketListResult> {
  const params: Param[] = [];
  const where = [scopeClause(user, params), ...filterClauses(f, user, params)];
  const whereSql = where.join(" AND ");

  const clientSortable = f.view !== "all";
  const limit = clientSortable ? CLIENT_SORT_LIMIT : ARCHIVE_PAGE_SIZE;
  const offset = clientSortable
    ? 0
    : (Math.max(1, page) - 1) * ARCHIVE_PAGE_SIZE;

  const countRow = await select<{ n: number }>(
    `SELECT COUNT(*) AS n ${ROW_JOINS} WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRow[0]?.n ?? 0);

  const rows = await select<RawRow>(
    `SELECT ${ROW_SELECT} ${ROW_JOINS}
      WHERE ${whereSql}
      ORDER BY d.REQDATE DESC, d.ECHONUM DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    rows: rows.map(toRow),
    total,
    // 조용한 절단 금지 — 화면에 경고를 띄운다
    truncated: clientSortable && total > CLIENT_SORT_LIMIT,
    clientSortable,
  };
}

interface RawDetail extends RawRow {
  CONTENT: string | null;
  REQREMARKS: string | null;
  MEDIA: string | null;
  REFMAIL: string | null;
  REREQYN: string | null;
  P_ECHONUM: string | null;
  CAUSE: string | null;
  PROCESS: string | null;
  IMPROVEMENT: string | null;
  ANSWER: string | null;
  RESULT: string | null;
  DEVREASON: string | null;
  DEVCONTENT: string | null;
  OKREMARKS: string | null;
  EXPETIME: number | null;
  RWORKTIME: number | null;
  SURTIME: number | null;
  APPROVER: string | null;
  CONFIRMDT: string | null;
  CANCELER: string | null;
  CANCELDT: string | null;
  CANCELREQDT: string | null;
  CANCELREQER: string | null;
  TESTDT: string | null;
  TESTCOMDT: string | null;
  SYSTEMDT: string | null;
  FINALSUCCER: string | null;
  FINALSUCCDATE: string | null;
  CMEMO: string | null;
  AMEMO: string | null;
  TMEMO: string | null;
  SMEMO: string | null;
}

export async function getTicket(
  echoNum: string,
  user: User,
): Promise<TicketDetail | null> {
  const params: Param[] = [];
  const scope = scopeClause(user, params);
  params.push({ name: "en", value: echoNum });

  const rows = await select<RawDetail>(
    `SELECT ${ROW_SELECT},
            d.CONTENT, d.REQREMARKS,
            d.MEDIA, d.REFMAIL, d.REREQYN, d.P_ECHONUM,
            d.CAUSE, d.PROCESS, d.IMPROVEMENT, d.ANSWER, d.RESULT,
            d.DEVREASON, d.DEVCONTENT, d.OKREMARKS,
            d.EXPETIME, d.RWORKTIME, d.SURTIME,
            d.APPROVER, d.CONFIRMDT, d.CANCELER, d.CANCELDT,
            d.CANCELREQDT, d.CANCELREQER, d.TESTDT, d.TESTCOMDT, d.SYSTEMDT,
            d.FINALSUCCER, d.FINALSUCCDATE,
            d.CMEMO, d.AMEMO, d.TMEMO, d.SMEMO
       ${ROW_JOINS}
      WHERE d.ECHONUM = @en AND ${scope}`,
    params,
  );
  const r = rows[0];
  if (!r) return null;

  const memoPairs: [string, string | null][] = [
    ["승인 메모", r.CMEMO],
    ["처리 메모", r.AMEMO],
    ["테스트 메모", r.TMEMO],
    ["이관 메모", r.SMEMO],
  ];

  return {
    ...toRow(r),
    request: {
      content: r.CONTENT ?? "",
      remarks: r.REMARKS ?? "",
      reqRemarks: r.REQREMARKS ?? "",
      media: trim(r.MEDIA),
      refMail: trim(r.REFMAIL),
      isReRequest: trim(r.REREQYN).toUpperCase() === "Y",
      parentEchoNum: trim(r.P_ECHONUM) || null,
    },
    solution: {
      cause: r.CAUSE ?? "",
      process: r.PROCESS ?? "",
      improvement: r.IMPROVEMENT ?? "",
      answer: r.ANSWER ?? "",
      result: r.RESULT ?? "",
      devReason: r.DEVREASON ?? "",
      devContent: r.DEVCONTENT ?? "",
      okRemarks: r.OKREMARKS ?? "",
      expeTime: r.EXPETIME === null ? null : Number(r.EXPETIME),
      workTime: r.WORKTIME === null ? null : Number(r.WORKTIME),
      rWorkTime: r.RWORKTIME === null ? null : Number(r.RWORKTIME),
      surTime: r.SURTIME === null ? null : Number(r.SURTIME),
    },
    history: {
      approver: trim(r.APPROVER) || null,
      approvedAt: iso(r.CONFIRMDT),
      canceler: trim(r.CANCELER) || null,
      canceledAt: iso(r.CANCELDT),
      cancelReqAt: iso(r.CANCELREQDT),
      cancelReqBy: trim(r.CANCELREQER) || null,
      testAt: iso(r.TESTDT),
      testCompletedAt: iso(r.TESTCOMDT),
      systemAt: iso(r.SYSTEMDT),
      finalAssignee: trim(r.FINALSUCCER) || null,
      finalSuccDate: iso(r.FINALSUCCDATE),
      memos: memoPairs
        .filter(([, v]) => trim(v) !== "")
        .map(([label, v]) => ({ label, value: v ?? "" })),
    },
    comments: await getComments(echoNum, user.role),
  };
}

interface RawComment {
  ID: number;
  USERID: string | null;
  userName: string | null;
  userType: string | null;
  COMMENT: string | null;
  COMMDATE: string | null;
  ADMIN_ONLY_YN: string | null;
  IS_LOG_YN: string | null;
  PPROGRESS: string | null;
}

export async function getComments(
  echoNum: string,
  viewerRole: UserRole,
): Promise<Comment[]> {
  const params: Param[] = [{ name: "en", value: echoNum }];
  // 내부 전용 코멘트는 고객사에게 보이지 않는다 (fail-closed: 내부만 통과)
  const adminGuard =
    viewerRole === "INTERNAL" ? "1=1" : "COALESCE(r.ADMIN_ONLY_YN,'N') <> 'Y'";

  const rows = await select<RawComment>(
    `SELECT r.ID, r.USERID, m.MBER_NM AS userName, m.USER_TYPE AS userType,
            r.COMMENT,
            r.COMMDATE, r.ADMIN_ONLY_YN, r.IS_LOG_YN, r.PPROGRESS
       FROM NX_OPTREPORTR r
       LEFT JOIN MEMBER_MST m ON m.MBER_ID = r.USERID
      WHERE r.PECHONUM = @en AND ${adminGuard}
      ORDER BY r.COMMDATE ASC, r.ID ASC`,
    params,
  );

  return rows.map((r) => ({
    id: Number(r.ID),
    userId: trim(r.USERID),
    userName: trim(r.userName) || trim(r.USERID) || "알 수 없음",
    userRole: (USER_TYPE as Record<string, UserRole>)[trim(r.userType)] ?? null,
    body: r.COMMENT ?? "",
    at: iso(r.COMMDATE),
    adminOnly: trim(r.ADMIN_ONLY_YN).toUpperCase() === "Y",
    isLog: trim(r.IS_LOG_YN).toUpperCase() === "Y",
    progressAt: trim(r.PPROGRESS) || null,
  }));
}
