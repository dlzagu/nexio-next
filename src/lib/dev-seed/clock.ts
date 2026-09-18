import type { WriteStatement } from "../db";
import { NOTICES } from "./corpus";

/**
 * 데모 시계 (ADR-0012) — 가상 시드의 날짜를 오늘로 끌어온다.
 *
 * 시드는 '만든 날'을 오늘로 보고 "3일 전·2주 전"을 찍는다. 그 뒤로 달력만 흐르면
 * 세계가 통째로 늙는다 — 라이브 실측(9/18): 조회 첫 화면('내 담당 · 최근 15일')이 **모든
 * 방문자에게 0건**, 보드의 진행 카드가 전부 D+30, 최근 완료·알림(30일 창)이 비어 가는 중이었다.
 *
 * 해법은 재시드가 아니라 **민다(rebase)**: 기준 시각(ANCHOR) 이전의 기록을 하루 단위로
 * 통째로 앞으로 옮긴다. 공유 DB 에서 방문자가 만든 티켓·댓글을 버리지 않고, UPDATE 만 쓰므로
 * 쓰기 관문(write — INSERT/UPDATE 만)을 그대로 지난다.
 *
 * 🔴 지키는 불변식
 *  ① **미래를 만들지 않는다** — 미는 폭은 '기준 이후 흐른 만 하루 수'라 옮긴 값은 언제나 지금 이전이다.
 *  ② **한 요청은 통째로 움직인다** — 요청·댓글·첨부 가운데 하나라도 기준 뒤에 생긴 것이 있으면
 *     그 요청은 이번에 옮기지 않는다. 일부만 옮기면 '완료'가 '신청'보다 앞서고 스레드 순서가 뒤집힌다.
 *  ③ **이상치는 이상치로 둔다** — 1900-01-01(이관분 날짜 누락)·먼 미래 값은 건드리지 않는다.
 *  ④ **두 번 밀지 않는다** — 모든 구문이 "기준이 아직 그 값일 때만"을 조건으로 달고 한
 *     트랜잭션에서 돈다. 서버리스 인스턴스 둘이 동시에 밀어도 뒤의 것은 아무것도 바꾸지 않는다.
 */

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD HH:MM:SS' 벽시계 → 비교용 밀리초 (타임존 없이 같은 기준끼리만 뺀다) */
function wallMs(stamp: string): number {
  const s = stamp.trim();
  const iso = s.length === 10 ? `${s}T00:00:00Z` : `${s.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

function fmtWall(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * 시드의 기준 시각 = 시드를 만든 날의 **끝**. 시드는 '오늘' 항목을 업무시간 중 아무 시각에나
 * 찍으므로(만든 순간보다 늦을 수 있다) 그날 전체를 이 세계에 포함시킨다.
 */
export function seedAnchor(nowStamp: string): string {
  return `${nowStamp.slice(0, 10)} 23:59:59`;
}

/** 기준 이후 흐른 **만 하루** 수. 하루가 안 됐거나 값이 이상하면 0 — 밀 필요가 없다 */
export function shiftDays(anchor: string, nowStamp: string): number {
  const d = Math.floor((wallMs(nowStamp) - wallMs(anchor)) / DAY_MS);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function addDaysStamp(stamp: string, days: number): string {
  return fmtWall(wallMs(stamp) + days * DAY_MS);
}

/**
 * 옛 DB 의 기준을 역산할 증인 = **시드가 만든 공지만.**
 *
 * 🔴 BOARD_DETAIL 전체를 보면 안 된다. 고객사 관리가 등록·비활성 때마다 이 표에 **숨김 이력 행**
 *    (DELETE_FG='Y', REG_DT=지금)을 쓴다. 그 행을 증인으로 읽으면 기준이 오늘(또는 미래)로 잡혀
 *    'aligned' 가 되고, 한 달 늙은 세계가 **영영 따라잡지 못한다**(리뷰 재현). 시드 공지는
 *    보이는 행이고 번호가 1~N 이다.
 */
export const SEED_NOTICE_FILTER =
  `COALESCE(DELETE_FG,'N') <> 'Y' AND COALESCE(USE_FG,'Y') = 'Y' ` +
  `AND NTT_ID <= ${NOTICES.length}`;

export const LEGACY_WITNESS_SQL = `SELECT MAX(REG_DT) AS m FROM BOARD_DETAIL WHERE ${SEED_NOTICE_FILTER}`;

/**
 * 기준 시각이 기록되기 전에 만들어진 DB(옛 공유 DB)의 기준을 **시드 공지에서** 역산한다 —
 * 가장 최근 시드 공지는 시드 날로부터 정확히 min(daysAgo) 일 전에 찍혔다.
 * 역산한 기준이 지금보다 뒤면 증인이 틀린 것이다 → null(모름). 모르는 기준으로 밀지 않는다.
 */
export function inferLegacyAnchor(
  latestNoticeRegDt: string | null,
  nowStamp: string,
): string | null {
  if (!latestNoticeRegDt || latestNoticeRegDt < "2000") return null;
  const newest = Math.min(...NOTICES.map((n) => n.daysAgo));
  const day = addDaysStamp(
    `${latestNoticeRegDt.slice(0, 10)} 00:00:00`,
    newest,
  );
  const anchor = seedAnchor(day);
  return anchor > seedAnchor(nowStamp) ? null : anchor;
}

/** 요청(티켓) 한 건의 '일어난 일' 시각들. 예상처리일(SCHEDATE)은 계획이라 판정에서 뺀다 */
const TICKET_EVENT_COLS = [
  "REQDATE",
  "SUCCDATE",
  "CONFIRMDT",
  "CANCELDT",
  "CANCELREQDT",
  "TESTDT",
  "TESTCOMDT",
  "SYSTEMDT",
  "FINALSUCCDATE",
] as const;
const TICKET_DATE_COLS = [...TICKET_EVENT_COLS, "SCHEDATE"] as const;

/**
 * 이번에 통째로 옮길 요청들. 요청·댓글·첨부의 모든 시각이 기준 이전인 것만.
 * 구시스템 이관분은 빼는 것이 아니라 **옮길 이유가 없다** — 몇 년 전 기록이고, 화면의 어떤
 * 기간 창에도 걸리지 않는다(원격 DB 에 쓸 양만 늘어난다).
 */
export const ELIGIBLE_UNITS_SQL = `
  SELECT d.ECHONUM
    FROM NX_OPTREPORTD d
   WHERE COALESCE(d.REQTYPE, '') <> 'MIGRATION'
     AND max(${TICKET_EVENT_COLS.map((c) => `COALESCE(d.${c}, '')`).join(", ")}) <= @anchor
     AND NOT EXISTS (SELECT 1 FROM NX_OPTREPORTR r
                      WHERE r.PECHONUM = d.ECHONUM AND r.COMMDATE > @anchor)
     AND NOT EXISTS (SELECT 1 FROM NX_OPTREPORT_FILE f
                      WHERE f.PECHONUM = d.ECHONUM AND f.REG_DT > @anchor)`;

/**
 * 값을 민다. 날짜만 있는 값('YYYY-MM-DD')은 날짜로 돌려줘 형식이 바뀌지 않게 한다.
 *
 * 일어난 일의 시각은 **값마다 기준 이전인지 다시 본다**(`col <= @anchor`). 옮길 요청은 트랜잭션
 * 밖에서 먼저 고르므로, 그 사이(원격 왕복 수백 ms) 다른 인스턴스가 그 요청에 단 댓글·완료일이
 * 끼어들 수 있다. 가드가 없으면 그 '지금'이 N일 미래로 밀린다(리뷰 재현 — 불변식 ①).
 * 끼어든 값은 제자리에 남고, 민 값(≤ 기준+N ≤ 지금)은 늘 그보다 앞이라 순서도 지켜진다.
 * 예상처리일(SCHEDATE)은 계획이라 원래 기준 뒤에 있을 수 있다 — 요청과 함께 무조건 민다.
 */
const shifted = (col: string, planned = false) =>
  `CASE WHEN ${col} >= '2000'${planned ? "" : ` AND ${col} <= @anchor`} ` +
  `THEN (CASE WHEN length(${col}) = 10 ` +
  `THEN date(${col}, @shift) ELSE datetime(${col}, @shift) END) ELSE ${col} END`;

/** 기준이 아직 그 값일 때만 — 불변식 ④ */
const GUARD = `(SELECT ANCHOR FROM NX_DEMO_CLOCK) = @anchor`;

const CHUNK = 300;

/**
 * 한 트랜잭션에 넘길 구문들. 마지막 구문이 기준을 옮긴다.
 * @param units ELIGIBLE_UNITS_SQL 로 고른 접수번호 — 구문이 돌기 **전에** 골라야 한다
 *              (댓글을 먼저 밀면 그 요청이 '기준 뒤에 생긴 게 있는' 요청으로 바뀌어 반쪽만 옮겨진다)
 */
export function rebaseStatements(
  anchor: string,
  days: number,
  units: readonly string[],
): WriteStatement[] {
  const base = [
    { name: "anchor", value: anchor },
    { name: "shift", value: `+${days} days` },
  ];
  const out: WriteStatement[] = [];

  for (let i = 0; i < units.length; i += CHUNK) {
    const part = units.slice(i, i + CHUNK);
    const ids = part.map((_, j) => `@u${j}`).join(", ");
    const params = [
      ...base,
      ...part.map((value, j) => ({ name: `u${j}`, value })),
    ];
    out.push(
      {
        sql: `UPDATE NX_OPTREPORTD SET ${TICKET_DATE_COLS.map((c) => `${c} = ${shifted(c, c === "SCHEDATE")}`).join(", ")}
               WHERE ECHONUM IN (${ids}) AND ${GUARD}`,
        params,
      },
      {
        sql: `UPDATE NX_OPTREPORTR SET COMMDATE = ${shifted("COMMDATE")}
               WHERE PECHONUM IN (${ids}) AND ${GUARD}`,
        params,
      },
      {
        sql: `UPDATE NX_OPTREPORT_FILE SET REG_DT = ${shifted("REG_DT")}
               WHERE PECHONUM IN (${ids}) AND ${GUARD}`,
        params,
      },
    );
  }

  // 공지·정기 업무 템플릿은 행 하나가 한 단위다
  out.push(
    {
      sql: `UPDATE BOARD_DETAIL SET REG_DT = ${shifted("REG_DT")}
             WHERE REG_DT <= @anchor AND ${GUARD}`,
      params: base,
    },
    {
      sql: `UPDATE NX_TASK_TEMPLATE SET REG_DT = ${shifted("REG_DT")}
             WHERE REG_DT <= @anchor AND ${GUARD}`,
      params: base,
    },
  );

  /**
   * ⚠️ 정기 업무의 LAST_RUN_YM(이번 달에 만들었나)은 **옮기지 않는다.** 실제 달력의 중복 생성을
   *    막는 유일한 장치다. 한때 달이 바뀌면 '이번 달 생성됨'으로 따라 올렸는데, 그 회차 티켓은
   *    기준 뒤라 안 옮겨지는 경우가 있어 **이번 달 회차가 조용히 사라졌다**(리뷰 재현 — ADR-0011
   *    HOW NOT '다음 달이 조용히 빈다'). 달이 바뀌면 정기 업무가 다시 대기로 뜨는 것이 맞다.
   */
  const next = addDaysStamp(anchor, days);
  out.push({
    sql: `UPDATE NX_DEMO_CLOCK SET ANCHOR = @next WHERE ANCHOR = @anchor`,
    params: [...base, { name: "next", value: next }],
  });
  return out;
}
