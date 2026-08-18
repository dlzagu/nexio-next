import { select, write, type Param } from "../db";
import { plainPreview, toWallClockIso } from "../format";
import type { User } from "../types";
import { visibleCommentGuard } from "./read-state";
import { scopeClause } from "./tickets";

/**
 * 알림센터. 원본은 이벤트 발생 시점에 알림 레코드를 쌓는 구조지만,
 * 여기서는 **읽음선(NX_OPTREPORT_READ_STATE)에서 파생**한다 —
 * "내 요청·내 담당 건에 내가 아직 안 본 새 글" 이 곧 알림이다.
 *
 * 이렇게 하면 알림 테이블과 실제 댓글이 어긋날 일이 없고, 읽음 처리가 목록의
 * 미읽음 뱃지와 자동으로 같은 값을 가리킨다 (두 곳을 따로 관리하면 반드시 틀어진다).
 *
 * 🔒 내부 전용 댓글은 고객사에게 알림으로도 새지 않는다 (조회와 같은 가드).
 */

export interface NotificationItem {
  id: number;
  echoNum: string;
  title: string;
  /** 본문 미리보기 (평문) — 그 요청의 **가장 최근** 글 */
  body: string;
  authorName: string;
  at: string | null;
  /** 시스템이 남긴 상태 변경 기록인가 */
  isLog: boolean;
  /** 내가 신청자인가 (아니면 담당) */
  mine: "requester" | "assignee";
  /** 이 요청에 쌓인 안 읽은 글 수 */
  unread: number;
}

interface RawRow {
  ID: number;
  PECHONUM: string;
  TITLE: string | null;
  COMMENT: string | null;
  COMMDATE: string | null;
  IS_LOG_YN: string | null;
  authorName: string | null;
  CUSTPERSON: string | null;
  unread: number;
}

const LIMIT = 20;
/**
 * 알림 유효기간. 읽음선만으로 자르면 **몇 달 전 종료건의 상태 로그까지** 알림으로 쏟아진다
 * (오래된 건은 애초에 읽지 않고 지나간 경우가 많다). 지난 일은 알림이 아니라 이력이다 —
 * 목록의 미읽음 뱃지에는 그대로 남는다.
 */
const WINDOW_DAYS = 30;

/** 알림 창의 시작 시각. 저장값이 벽시계 TEXT 라 같은 형식으로 만들어 비교한다 */
function sinceStamp(): string {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  return toWallClockIso(since)?.replace("T", " ") ?? "";
}

export async function listNotifications(
  user: User,
): Promise<{ items: NotificationItem[]; total: number }> {
  const params: Param[] = [{ name: "me", value: user.id }];
  const adminGuard = visibleCommentGuard(user.role, "r");
  params.push({ name: "since", value: sinceStamp() });

  const from = `
      FROM NX_OPTREPORTR r
      JOIN NX_OPTREPORTD d ON d.ECHONUM = r.PECHONUM
      LEFT JOIN MEMBER_MST m ON m.MBER_ID = r.USERID
      LEFT JOIN NX_OPTREPORT_READ_STATE rs
             ON rs.ECHONUM = r.PECHONUM AND rs.USER_ID = @me
     WHERE (d.CUSTPERSON = @me OR d.SUCCERSON = @me)
       AND r.USERID <> @me
       AND r.ID > COALESCE(rs.LAST_SEEN_COMMENT_ID, 0)
       AND r.COMMDATE >= @since
       AND ${adminGuard}`;

  const [countRow, rows] = await Promise.all([
    // 알림의 단위는 글이 아니라 **요청**이다 ("확인할 요청 N건")
    select<{ n: number }>(
      `SELECT COUNT(DISTINCT r.PECHONUM) AS n ${from}`,
      params,
    ),
    // MAX(r.ID) 를 쓰면 SQLite 는 나머지 컬럼도 **그 최대 행의 값**으로 채운다 →
    // 요청별 최신 글 1건 + 안 읽은 글 수를 한 번에 얻는다.
    // ⚠️ 이 규칙은 쿼리에 min/max 집계가 **정확히 하나**일 때만 성립한다 →
    //    정렬도 집계를 새로 쓰지 않고 별칭(ID)을 참조한다. ID 는 AUTOINCREMENT 라 등록순이다.
    select<RawRow>(
      `SELECT MAX(r.ID) AS ID, r.PECHONUM, COUNT(*) AS unread,
              d.TITLE, d.CUSTPERSON, r.COMMENT, r.COMMDATE, r.IS_LOG_YN,
              m.MBER_NM AS authorName
         ${from}
        GROUP BY r.PECHONUM
        ORDER BY ID DESC
        LIMIT ${LIMIT}`,
      params,
    ),
  ]);

  return {
    total: Number(countRow[0]?.n ?? 0),
    items: rows.map((r) => ({
      id: Number(r.ID),
      echoNum: r.PECHONUM,
      title: plainPreview(r.TITLE, 60) || "(제목 없음)",
      body: plainPreview(r.COMMENT, 90),
      authorName: (r.authorName ?? "").trim() || "시스템",
      at: toWallClockIso(r.COMMDATE),
      isLog: (r.IS_LOG_YN ?? "").trim().toUpperCase() === "Y",
      mine: (r.CUSTPERSON ?? "").trim() === user.id ? "requester" : "assignee",
      unread: Number(r.unread ?? 1),
    })),
  };
}

/**
 * 읽음 처리. 목록의 미읽음 뱃지와 **같은 값**을 옮긴다.
 * echoNum 을 주면 그 건만, 없으면 알림에 잡힌 전 건을 한 번에 읽음으로 만든다.
 */
export async function markNotificationsRead(
  user: User,
  echoNum?: string,
): Promise<number> {
  const params: Param[] = [];
  let scope: string;
  if (echoNum) {
    // 🔴 한 건을 열어서 읽는 경우는 '내 건'으로 좁히지 않는다 — 목록 뱃지는 **볼 수 있는
    //    모든 건**에 뜨므로(내가 신청자·담당자가 아닌 건 포함), 소유로 좁히면 운영팀에게
    //    지울 수 없는 미읽음 점이 남는다. 범위는 가시성 게이트가 대신 잠근다:
    //    못 보는 건은 읽음선도 만들 수 없다(fail-closed).
    scope = `${scopeClause(user, params)} AND d.ECHONUM = @en`;
    params.push({ name: "en", value: echoNum });
  } else {
    // '모두 읽음'의 대상은 알림 창에 뜬 **내 건**이다 (알림의 정의 그대로)
    params.push({ name: "me", value: user.id });
    scope = "(d.CUSTPERSON = @me OR d.SUCCERSON = @me)";
    // 창 밖(30일 이전)까지 넓히면 목록 뱃지가 통째로 사라진다 — 지난 일은 이력이다
    params.push({ name: "since", value: sinceStamp() });
    scope += ` AND EXISTS (
        SELECT 1 FROM NX_OPTREPORTR x
        LEFT JOIN NX_OPTREPORT_READ_STATE rs ON rs.ECHONUM = x.PECHONUM AND rs.USER_ID = @me
         WHERE x.PECHONUM = d.ECHONUM
           AND x.USERID <> @me
           AND x.COMMDATE >= @since
           AND x.ID > COALESCE(rs.LAST_SEEN_COMMENT_ID, 0)
           AND ${visibleCommentGuard(user.role, "x")})`;
  }

  // 대상 티켓의 마지막 댓글 id 로 읽음선을 끌어올린다 (건별 UPSERT)
  const changes = await write([
    {
      sql: `INSERT OR REPLACE INTO NX_OPTREPORT_READ_STATE
              (ECHONUM, USER_ID, LAST_SEEN_COMMENT_ID)
            SELECT d.ECHONUM, @me, MAX(r.ID)
              FROM NX_OPTREPORTD d
              JOIN NX_OPTREPORTR r ON r.PECHONUM = d.ECHONUM
             WHERE ${scope}
             GROUP BY d.ECHONUM`,
      params,
    },
  ]);
  return changes[0] ?? 0;
}
