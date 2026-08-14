import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { ko } from "date-fns/locale";

/**
 * 날짜 이상치를 타입 경계에서 흡수한다.
 * 실측: 1900-01-01 계열 1,252건(구시스템 이관분 날짜 누락) · 미래 3건(최대 2105-07-22).
 * 범위 밖이면 null → 화면에서 "-" 로 표시하고 정렬 시 최후위로 보낸다.
 */
const MIN_DATE = new Date("2015-01-01");
const MAX_DATE = new Date(new Date().getFullYear() + 2, 11, 31);

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

/** HTML 을 걷어낸 요약 텍스트 — 목록의 미리보기용 */
export function plainPreview(
  html: string | null | undefined,
  max = 140,
): string {
  if (!html) return "";
  // 저장값이 이스케이프된 HTML 인 레코드가 있어(`&lt;div&gt;`) 먼저 풀고 태그를 걷는다.
  // 그 다음 한 번 더 풀어 본문의 실제 엔티티(`&#39;`)까지 평문으로 만든다.
  const text = decodeEntities(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|tr)>/gi, " ")
    .replace(/<[^>]+>/g, "");
  const plain = decodeEntities(text)
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}
