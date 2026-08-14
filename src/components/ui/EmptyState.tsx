import { cn } from "@/lib/cn";

/**
 * P7 — 빈 상태는 **이유와 다음 행동**을 말한다.
 * 실측 비공개 78.7%(18,485/23,473). 고객사 사용자에게 목록이 비어 보이는 것은
 * 정상 동작인데 원본이 이를 설명하지 않아 "조회가 안 돼요" 문의가 발생했다.
 */
export function EmptyState({
  title,
  reason,
  actions,
  className,
}: {
  title: string;
  reason?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="bg-muted text-16 text-fg-subtle flex h-10 w-10 items-center justify-center rounded-full"
      >
        ∅
      </div>
      <p className="text-14 text-fg-strong font-medium">{title}</p>
      {reason ? (
        <div className="text-12 text-fg-muted max-w-md leading-relaxed">
          {reason}
        </div>
      ) : null}
      {actions ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function InlineError({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="border-danger-border bg-danger-subtle rounded-md border px-3 py-2.5">
      <p className="text-12 text-danger-text font-medium">{title}</p>
      {detail ? (
        <p className="text-11 text-danger-text/80 mt-1 font-mono break-all">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger" | "accent";
  children: React.ReactNode;
}) {
  const map = {
    info: "border-info-border bg-info-subtle text-info-text",
    warning: "border-warning-border bg-warning-subtle text-warning-text",
    danger: "border-danger-border bg-danger-subtle text-danger-text",
    accent: "border-accent-border bg-accent-subtle text-accent-text",
  } as const;
  return (
    <div
      className={cn(
        "text-12 rounded-md border px-3 py-2 leading-relaxed",
        map[tone],
      )}
    >
      {children}
    </div>
  );
}
