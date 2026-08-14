import { cn } from "@/lib/cn";
import {
  PRIORITY_TONE,
  progressLabel,
  progressTone,
  type PriorityCode,
  type Tone,
} from "@/lib/codes";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "badge-neutral",
  accent: "badge-accent",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
};

export function Badge({
  tone = "neutral",
  glyph,
  children,
  className,
}: {
  tone?: Tone;
  glyph?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("badge", TONE_CLASS[tone], className)}>
      {glyph ? (
        <span aria-hidden className="text-[9px] leading-none">
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * 상태를 **색만으로 구분하지 않는다** — 상태군마다 글리프가 다르다.
 * 색약 사용자와 흑백 인쇄에서도 구분된다.
 */
function glyphOf(progress: string): string {
  const p = String(progress).trim();
  if (p === "9") return "✓"; // 완료
  if (p === "12") return "✕"; // 반려
  if (p === "11") return "—"; // 취소
  if (p === "1" || p === "10") return "◇"; // 대기·취소요청
  return "●"; // 진행 중 계열
}

export function StatusBadge({
  progress,
  className,
}: {
  progress: string;
  className?: string;
}) {
  const label = progressLabel(progress) || progress || "-";
  return (
    <Badge
      tone={progressTone(progress)}
      glyph={glyphOf(progress)}
      className={className}
    >
      {label}
    </Badge>
  );
}

/** 우선순위. 실측 98%가 '중간'이라 중간·낮음은 조용하게 둔다 */
export function PriorityBadge({
  code,
  label,
}: {
  code: string;
  label: string;
}) {
  const key = String(code).trim() as PriorityCode;
  const tone = PRIORITY_TONE[key] ?? "neutral";
  if (!label) return <span className="text-fg-subtle">-</span>;
  if (tone === "neutral") {
    return <span className="text-12 text-fg-subtle">{label}</span>;
  }
  return (
    <Badge tone={tone} glyph={key === "1" ? "▲" : "△"}>
      {label}
    </Badge>
  );
}
