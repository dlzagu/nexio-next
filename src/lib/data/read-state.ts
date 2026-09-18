import type { UserRole } from "../codes";

/**
 * 미읽음 축 정본 — 알림센터 · 목록 뱃지 · 대시보드 집계 · '모두 읽음'이 **같은 기준**을 본다.
 *
 * 🔴 축이 어긋나면 고객사 화면에 **지울 방법이 없는 빨간 점**이 남는다:
 *    내부 전용 댓글이 뱃지에만 잡히고, 상세를 열어도 그 글은 보이지 않으니
 *    사용자가 할 수 있는 일이 없다. 그래서 "안 읽은 글"의 정의를 여기 한 곳에 둔다.
 *
 * 정의: 안 읽은 글 = **내가 볼 수 있고(visibleCommentGuard) · 남이 쓴(notMineSql)** 글 중
 *       읽음선(NX_OPTREPORT_READ_STATE.LAST_SEEN_COMMENT_ID)보다 뒤의 것.
 */

/** 이 사용자에게 **존재하는** 댓글인가. 내부 전용은 운영팀에게만 보인다 (fail-closed) */
export function visibleCommentGuard(
  role: UserRole | null,
  alias = "r",
): string {
  return role === "INTERNAL"
    ? "1=1"
    : `COALESCE(${alias}.ADMIN_ONLY_YN,'N') <> 'Y'`;
}

/**
 * **남이 쓴** 글인가. 내가 한 일(댓글·상태 전이 로그)은 나에게 새 글이 아니다.
 *
 * 🔴 예전엔 알림·'모두 읽음'만 본인 글을 빼고 목록 뱃지·대시보드는 안 뺐다. 보드에서 카드를
 *    옮기면(전이 로그가 내 명의로 남는다) 목록 점과 대시보드 '미읽음'만 늘고 종에는 안 떠서,
 *    '모두 읽음'으로도 지울 수 없었다. 전이마다 읽음선을 끌어올리는 방식은 쓰지 않는다 —
 *    MAX(ID) 로 올리므로 **아직 안 읽은 남의 댓글까지** 조용히 읽음 처리된다.
 *
 * ⚠️ 호출자가 `@me` 를 바인딩해야 한다 (scopeClause 가 넣는다).
 *    작성자가 비어 있는 행(시스템 기록)은 남의 글로 센다.
 */
export function notMineSql(alias = "r"): string {
  return `COALESCE(${alias}.USERID,'') <> @me`;
}

/**
 * 그 요청에서 이 사용자가 볼 수 있는 **남이 쓴 마지막 글의 id**.
 * 읽음선과 비교해 미읽음을 판정한다. ⚠️ `@me` 바인딩 필요 (notMineSql).
 */
export function lastVisibleCommentIdSql(
  role: UserRole | null,
  ticketAlias = "d",
  alias = "r",
): string {
  return `(SELECT MAX(${alias}.ID) FROM NX_OPTREPORTR ${alias}
            WHERE ${alias}.PECHONUM = ${ticketAlias}.ECHONUM
              AND ${visibleCommentGuard(role, alias)}
              AND ${notMineSql(alias)})`;
}
