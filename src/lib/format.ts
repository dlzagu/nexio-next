import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { ko } from "date-fns/locale";

/**
 * 날짜 이상치를 타입 경계에서 흡수한다.
 * 실측: 1900-01-01 계열 1,252건(구시스템 이관분 날짜 누락) · 미래 3건(최대 2105-07-22).
 * 범위 밖이면 null → 화면에서 "-" 로 표시하고 정렬 시 최후위로 보낸다.
 */
const MIN_DATE = new Date("2015-01-01");
const MAX_DATE = new Date(new Date().getFullYear() + 2, 11, 31);

/**
 * 🔴 저장값은 타임존이 없는 **벽시계 시각**이다 ('YYYY-MM-DD HH:MM:SS').
 *    이걸 절대시각(UTC)으로 바꿔 내보내면 서버와 브라우저의 타임존이 다를 때
 *    서로 다른 날짜를 그려 하이드레이션이 깨진다
 *    (Vercel 실측: 서버 UTC 는 08-12, 브라우저 KST 는 08-13 — 하루 차이).
 *
 * → 타임존 표기를 붙이지 않은 채 넘긴다. 양쪽이 각자 로컬로 해석하지만
 *   변환이 없으니 화면에 찍히는 숫자는 동일하다.
 */
export function toWallClockIso(
  input: string | Date | null | undefined,
): string | null {
  if (!input) return null;
  if (input instanceof Date) {
    if (!isValid(input)) return null;
    return format(input, "yyyy-MM-dd'T'HH:mm:ss");
  }
  const s = input.trim();
  if (!s) return null;
  // 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DDTHH:MM:SS' (Z·오프셋은 붙이지 않는다)
  return s.replace(" ", "T").replace(/(?:Z|[+-]\d\d:?\d\d)$/, "");
}

const KST_MS = 9 * 60 * 60 * 1000;

/**
 * 그 순간의 **한국 벽시계**를 로컬 필드로 갖는 Date — `getHours()`·`getMonth()` 가 곧 KST 값이다.
 *
 * 🔴 서버의 로컬 시간대를 믿지 않는다. 개발 PC 는 KST 라 `format(new Date())` 가 맞아
 *    보이지만 Vercel 은 UTC 라, 라이브에서 쓴 행만 **9시간 이르게** 찍혔다 — 오전에 단 댓글이
 *    전날 밤 글이 되어 스레드 순서가 뒤집히고, 월초 새벽에 만든 요청은 지난달 번호를 받는다.
 */
export function seoulWallDate(at: Date = new Date()): Date {
  return new Date(at.getTime() + KST_MS + at.getTimezoneOffset() * 60_000);
}

/**
 * 저장 형식 'YYYY-MM-DD HH:MM:SS' — 한국 벽시계.
 * 🔴 UTC 로 바꾸지 않는다 — 저장값 전체가 타임존 없는 벽시계라
 *    새로 쓰는 행만 UTC 로 넣으면 기존 행과 9시간 어긋난다 (toWallClockIso 주석 참조).
 */
export function toDbStamp(d: Date = new Date()): string {
  return format(seoulWallDate(d), "yyyy-MM-dd HH:mm:ss");
}

/**
 * 받침에 맞는 조사를 붙인다 — '답변을' · '원인을' · '전화를' · '김서연이'.
 * "을(를)" 을 그대로 두면 사람이 아니라 기계가 쓴 문장으로 읽힌다.
 * 끝 글자가 한글이 아니면(영문·숫자) 받침을 알 수 없어 병기형을 쓴다.
 */
export function josa(word: string, pair: "을/를" | "이/가" | "은/는"): string {
  const [withFinal, withoutFinal] = pair.split("/");
  const code = word.trim().charCodeAt(word.trim().length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) {
    return `${word}${withFinal}(${withoutFinal})`;
  }
  return `${word}${(code - 0xac00) % 28 === 0 ? withoutFinal : withFinal}`;
}

export function toValidDate(
  input: string | Date | null | undefined,
): Date | null {
  if (!input) return null;
  const d = typeof input === "string" ? parseISO(input) : input;
  if (!isValid(d)) return null;
  if (d < MIN_DATE || d > MAX_DATE) return null;
  return d;
}

/** 이상치·null 을 "-" 로. 빈칸을 남기지 않는다 */
export function fmtDate(input: string | Date | null | undefined): string {
  const d = toValidDate(input);
  return d ? format(d, "yyyy-MM-dd") : "-";
}

export function fmtDateShort(input: string | Date | null | undefined): string {
  const d = toValidDate(input);
  return d ? format(d, "MM-dd") : "-";
}

export function fmtDateTime(input: string | Date | null | undefined): string {
  const d = toValidDate(input);
  return d ? format(d, "yyyy-MM-dd HH:mm") : "-";
}

export function fmtRelative(input: string | Date | null | undefined): string {
  const d = toValidDate(input);
  if (!d) return "-";
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: ko });
}

/** 정렬용 — 이상치/null 은 항상 최후위 */
export function dateSortKey(input: string | Date | null | undefined): number {
  const d = toValidDate(input);
  return d ? d.getTime() : -Infinity;
}

export function fmtHours(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `${Number(n).toFixed(1)}h`;
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString("ko-KR");
}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * 저장된 값이 HTML 이스케이프된 상태다 (TITLE 에 `&#39;26년`·`&amp;` 가 그대로 들어 있다).
 * React 는 문자열을 다시 이스케이프하므로 평문으로 쓰려면 여기서 한 번 풀어야 한다.
 * ⚠️ 평문 표시 전용이다. HTML 로 렌더할 값에는 쓰지 마라 — sanitize() 를 쓴다.
 */
export function decodeEntities(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(
      /&([a-z]+);/gi,
      (m, name: string) => ENTITY[name.toLowerCase()] ?? m,
    );
}

/**
 * 🔴 저장값이 **이스케이프된 HTML** 인 레코드가 섞여 있다 (실측: `CAUSE`·`ANSWER`·
 *    `OKREMARKS`·`REMARKS` 가 `&lt;div&gt;` 형태). 그대로 렌더하면 태그가 글자로 보인다.
 *    실제 태그는 없고 이스케이프된 태그만 있으면 한 번 풀어준다.
 *
 * ⚠️ **실제 태그가 있으면 풀지 않는다** — 새 신청의 평문은 이스케이프한 뒤 `<p>` 로 감싸
 *    저장한다(`<p>&lt;select&gt; 에서 a&lt;b</p>`). 무조건 풀면 사용자가 쓴 꺾쇠가 태그가
 *    되어 미리보기·재신청 프리필에서 지워진다.
 * ⚠️ 새니타이즈와 함께 쓸 때는 **풀고 나서 새니타이즈**한다. 반대로 하면 걸러지지 않은
 *    마크업이 그대로 살아난다.
 */
export function unescapeStoredMarkup(raw: string): string {
  const hasRealTags = /<\s*\/?[a-z]/i.test(raw);
  const hasEscapedTags = /&lt;\s*\/?[a-z]/i.test(raw);
  return !hasRealTags && hasEscapedTags ? decodeEntities(raw) : raw;
}

/**
 * HTML → 평문. **문단 구분을 줄바꿈으로 살린다** — 재신청 프리필처럼
 * 저장된 HTML 을 textarea 로 되돌릴 때 쓴다 (한 줄로 뭉개면 원문을 못 알아본다).
 * 이스케이프된 레코드(`&lt;div&gt;`)는 먼저 풀고(unescapeStoredMarkup) 태그를 걷은 뒤,
 * 한 번 더 풀어 본문의 실제 엔티티(`&#39;`·사용자가 쓴 `&lt;`)까지 평문으로 만든다.
 */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return "";
  const text = unescapeStoredMarkup(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML 을 걷어낸 요약 텍스트 — 목록의 미리보기용 (줄바꿈까지 공백으로 접는다) */
export function plainPreview(
  html: string | null | undefined,
  max = 140,
): string {
  if (!html) return "";
  // 이스케이프된 레코드만 먼저 풀고 태그를 걷는다 — htmlToPlain 과 같은 순서
  const text = unescapeStoredMarkup(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|tr)>/gi, " ")
    .replace(/<[^>]+>/g, "");
  const plain = decodeEntities(text)
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/**
 * 오늘(한국 시간)의 `YYYY-MM-DD`.
 *
 * 🔴 `new Date()` 를 그대로 쓰면 안 된다 — 서버는 UTC(Vercel), 브라우저는 KST 라
 *    같은 순간에도 **날짜가 하루 다르다**(실측: 서버 08-12 / 브라우저 08-13).
 *    저장값이 전부 KST 벽시계이므로 기준을 KST 로 고정한다.
 *    한국은 서머타임이 없어 +09:00 이 항상 참이다.
 */
export function todaySeoul(daysAgo = 0): string {
  const t = Date.now() + KST_MS - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}
