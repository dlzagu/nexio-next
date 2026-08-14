import { FilterXSS } from "xss";
import { decodeEntities } from "./format";

/**
 * 새니타이즈를 통과한 HTML 만 이 타입이 된다.
 * 브랜드 타입이라 캐스팅 없이는 못 만들고, 캐스팅은 코드리뷰에서 걸린다.
 */
export type SafeHtml = string & { readonly __brand: "SafeHtml" };

const ALLOWED_TAGS = [
  "p",
  "br",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "target",
  "rel",
  "colspan",
  "rowspan",
];

/**
 * 🔴 저장값이 **이스케이프된 HTML** 인 레코드가 섞여 있다 (실측: `CAUSE`·`ANSWER`·
 *    `OKREMARKS`·`REMARKS` 가 `&lt;div&gt;` 형태). 그대로 렌더하면 태그가 글자로 보인다.
 *    실제 태그는 없고 이스케이프된 태그만 있으면 한 번 풀어준다.
 *
 * ⚠️ 순서가 중요하다 — **풀고 나서 새니타이즈**한다. 반대로 하면 걸러지지 않은
 *    마크업이 그대로 살아난다.
 */
function unescapeStoredMarkup(raw: string): string {
  const hasRealTags = /<\s*\/?[a-z]/i.test(raw);
  const hasEscapedTags = /&lt;\s*\/?[a-z]/i.test(raw);
  return !hasRealTags && hasEscapedTags ? decodeEntities(raw) : raw;
}

/**
 * 🔴 DOM 없이 도는 순수 파서(xss)를 쓴다 — DOMPurify 계열은 서버에서 jsdom 을 요구하고,
 *    jsdom 의 동적 require 가 서버리스 번들에 안 딸려와 SSR 이 통째로 죽었다
 *    (Vercel 배포 실측: RichText 를 가진 /requests·/styleguide 만 500).
 *    새니타이즈는 클라이언트·SSR 양쪽에서 도는 코드라 DOM 의존이 없어야 한다.
 */
const filter = new FilterXSS({
  whiteList: Object.fromEntries(ALLOWED_TAGS.map((t) => [t, ALLOWED_ATTR])),
  // 허용 목록 밖 태그는 이스케이프가 아니라 제거한다 (글자로 남으면 안 된다)
  stripIgnoreTag: true,
  // 스크립트·스타일은 태그뿐 아니라 본문까지 지운다
  stripIgnoreTagBody: ["script", "style"],
});

/**
 * 기존 2.3만 건이 HTML(summernote 산출물)로 저장돼 있다.
 * 그대로 렌더하면 XSS 노출면이 된다 → 렌더 경로는 전부 이 함수를 지난다.
 *
 * class·style 은 허용 목록에 없어 제거된다. 원본이 박아 둔 색(#1d3057 등)을
 * 그대로 들이면 디자인 시스템이 무력화되므로 의도한 동작이다.
 */
export function sanitize(raw: string | null | undefined): SafeHtml {
  return filter.process(unescapeStoredMarkup(raw ?? "")) as SafeHtml;
}

export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  return (
    unescapeStoredMarkup(html)
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/ /g, " ")
      .trim() === ""
  );
}
