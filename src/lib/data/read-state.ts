import type { UserRole } from "../codes";

/**
 * 미읽음 축 정본 — 알림센터 · 목록 뱃지 · 대시보드 집계가 **같은 기준**을 본다.
 *
 * 🔴 축이 어긋나면 고객사 화면에 **지울 방법이 없는 빨간 점**이 남는다:
 *    내부 전용 댓글이 뱃지에만 잡히고, 상세를 열어도 그 글은 보이지 않으니
 *    사용자가 할 수 있는 일이 없다. 그래서 "안 읽은 글"의 정의를 여기 한 곳에 둔다.
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
 * 그 요청에서 이 사용자가 볼 수 있는 **마지막 글의 id**.
 * 읽음선(NX_OPTREPORT_READ_STATE.LAST_SEEN_COMMENT_ID)과 비교해 미읽음을 판정한다.
 */
export function lastVisibleCommentIdSql(
  role: UserRole | null,
  ticketAlias = "d",
  alias = "r",
): string {
  return `(SELECT MAX(${alias}.ID) FROM NX_OPTREPORTR ${alias}
            WHERE ${alias}.PECHONUM = ${ticketAlias}.ECHONUM
              AND ${visibleCommentGuard(role, alias)})`;
}
