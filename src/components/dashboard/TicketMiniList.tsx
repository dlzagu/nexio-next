import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { fmtDateShort } from "@/lib/format";
import type { TicketRow } from "@/lib/types";

/** 대시보드의 목록 위젯. 행을 누르면 해당 건이 열린 조회 화면으로 간다 */
export function TicketMiniList({
  rows,
  emptyTitle,
  emptyReason,
  showCustomer = true,
}: {
  rows: TicketRow[];
  emptyTitle: string;
  emptyReason?: React.ReactNode;
  showCustomer?: boolean;
}) {
  if (!rows.length) {
    return (
      <EmptyState title={emptyTitle} reason={emptyReason} className="py-8" />
    );
  }

  return (
    <ul className="divide-line-subtle divide-y">
      {rows.map((r) => (
        <li key={r.echoNum}>
          <Link
            href={`/requests?view=all&open=${encodeURIComponent(r.echoNum)}`}
            className="hover:bg-hover flex items-center gap-2.5 px-4 py-2.5 no-underline"
          >
            <StatusBadge progress={r.progress} />
            <span className="ell text-13 text-fg-default min-w-0 flex-1">
              {r.title}
            </span>
            {r.commentCount > 0 ? (
              <span
                className="text-11 text-fg-subtle flex shrink-0 items-center gap-1"
                title={`댓글 ${r.commentCount}`}
              >
                <MessageSquare size={11} aria-hidden />
                <span className="num">{r.commentCount}</span>
                {r.hasUnreadComment ? (
                  <span
                    aria-label="새 댓글"
                    className="bg-danger h-1.5 w-1.5 rounded-full"
                  />
                ) : null}
              </span>
            ) : null}
            {showCustomer ? (
              <span className="ell text-11 text-fg-muted hidden w-[96px] shrink-0 sm:block">
                {r.custName}
              </span>
            ) : null}
            <span className="num text-11 text-fg-subtle shrink-0">
              {fmtDateShort(r.reqDate)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 상위 고객사 / 담당자 실적 — 막대 하나로 비중을 보여준다 */
export function RankList({
  items,
  hrefOf,
  unit = "건",
}: {
  items: { key: string; label: string; value: number; sub?: string }[];
  hrefOf?: (key: string) => string;
  unit?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) {
    return <EmptyState title="집계할 데이터가 없습니다" className="py-8" />;
  }
  return (
    <ul className="flex flex-col gap-1.5 px-4 py-3">
      {items.map((i) => {
        const inner = (
          <>
            <span className="ell text-12 text-fg-default w-[112px] shrink-0">
              {i.label}
            </span>
            <span className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
              <span
                className="bg-accent block h-full rounded-full"
                style={{ width: `${(i.value / max) * 100}%` }}
              />
            </span>
            <span className="num text-12 text-fg-muted w-[56px] shrink-0 text-right">
              {i.value.toLocaleString("ko-KR")}
              {unit}
            </span>
            {i.sub ? (
              <span className="num text-11 text-success-text w-[48px] shrink-0 text-right">
                {i.sub}
              </span>
            ) : null}
          </>
        );
        return (
          <li key={i.key}>
            {hrefOf ? (
              <Link
                href={hrefOf(i.key)}
                className="hover:bg-hover flex items-center gap-2 rounded-sm px-1 py-1 no-underline"
              >
                {inner}
              </Link>
            ) : (
              <span className="flex items-center gap-2 px-1 py-1">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
