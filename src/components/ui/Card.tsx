import Link from "next/link";
import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={cn("card", className)}>{children}</section>;
}

export function CardHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="card-hd">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="card-ti">{title}</h2>
        {hint ? <span className="text-11 text-fg-subtle">{hint}</span> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("card-bd", className)}>{children}</div>;
}

/**
 * 요약 카드. 막다른 위젯을 만들지 않는다 — 전부 조건이 걸린 조회 화면으로 이동한다.
 */
export function StatCard({
  label,
  value,
  href,
  tone = "default",
  sub,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "default" | "accent" | "warning" | "danger";
  sub?: string;
}) {
  const toneRing =
    tone === "accent"
      ? "hover:border-accent-border"
      : tone === "warning"
        ? "hover:border-warning-border"
        : tone === "danger"
          ? "hover:border-danger-border"
          : "hover:border-line-strong";
  const valueColor =
    tone === "accent"
      ? "text-accent-text"
      : tone === "warning"
        ? "text-warning-text"
        : tone === "danger"
          ? "text-danger-text"
          : "text-fg-strong";

  return (
    <Link
      href={href}
      className={cn(
        "card group hover:shadow-2 flex flex-col justify-between gap-3 p-4 no-underline transition-[border-color,box-shadow]",
        toneRing,
      )}
    >
      <span className="text-12 text-fg-muted font-medium">{label}</span>
      <span className="flex items-baseline gap-2">
        <span
          className={cn("num text-30 font-semibold tracking-tight", valueColor)}
        >
          {value.toLocaleString("ko-KR")}
        </span>
        {sub ? <span className="text-11 text-fg-subtle">{sub}</span> : null}
      </span>
      <span className="text-11 text-fg-subtle group-hover:text-accent-text transition-colors">
        목록 보기 →
      </span>
    </Link>
  );
}
