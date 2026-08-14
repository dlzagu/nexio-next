import { cn } from "@/lib/cn";
import { isBlankHtml, sanitize, type SafeHtml } from "@/lib/sanitize";

/**
 * 🔴 SafeHtml 만 받는다. 날 문자열을 넘기면 타입 에러가 난다 →
 *    dangerouslySetInnerHTML 우회에는 캐스팅이 필요하고, 캐스팅은 리뷰에서 걸린다.
 */
export function RichText({
  html,
  className,
}: {
  html: SafeHtml;
  className?: string;
}) {
  return (
    <div
      className={cn("prose-nx", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 원본 문자열을 받아 새니타이즈까지 한 번에. 비어 있으면 대체 문구를 보여준다 */
export function RichTextBlock({
  raw,
  empty = "작성된 내용이 없습니다.",
  className,
}: {
  raw: string | null | undefined;
  empty?: string;
  className?: string;
}) {
  if (isBlankHtml(raw)) {
    return <p className="text-12 text-fg-subtle">{empty}</p>;
  }
  return <RichText html={sanitize(raw)} className={className} />;
}
