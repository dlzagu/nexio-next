"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, Lock, MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { MiniStepper } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";
import { dateSortKey, fmtDate } from "@/lib/format";
import { mainFlowIndex } from "@/lib/codes";
import type { TicketRow } from "@/lib/types";

const col = createColumnHelper<TicketRow>();

/**
 * 자물쇠 한 개로는 **누구에게** 비공개인지 알 수 없다 — 목록에는 신청자 칸이 없어서
 * 담당자 이름이 신청자로 읽히고, "남의 비공개 건이 보인다"는 오해가 생긴다.
 * 실제 규칙(tickets.ts scopeClause)을 그대로 문장으로 적는다.
 */
const PRIVATE_HINT = "비공개 — 신청한 사람과 그 회사 승인권자만 볼 수 있습니다";

/**
 * 컬럼 7개로 제한한다. 나머지 90여 필드는 전부 상세 Sheet 로 —
 * 원본은 목록 화면에 상세 편집 컨트롤 56개가 얹혀 있었다.
 *
 * 정렬: 진행중/내요청 뷰는 전량을 받았으므로 **전 컬럼 클라이언트 정렬**.
 *      아카이브는 페이지 내 정렬만 가능하고, 그 한계를 화면에 표기한다.
 */
export function RequestTable({
  rows,
  selected,
  onSelect,
  pageScopedSort,
}: {
  rows: TicketRow[];
  selected: string | null;
  onSelect: (echoNum: string) => void;
  pageScopedSort: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      col.accessor("progress", {
        header: "단계",
        size: 132,
        sortingFn: (a, b) =>
          mainFlowIndex(a.original.progress) -
          mainFlowIndex(b.original.progress),
        cell: (c) => (
          <span className="flex items-center gap-2">
            <MiniStepper progress={c.row.original.progress} />
            <StatusBadge progress={c.row.original.progress} />
          </span>
        ),
      }),
      col.accessor("title", {
        header: "제목",
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            {!c.row.original.isPublic ? (
              // 아이콘 자체는 title 을 받지 않는다 — 감싼 요소에 붙인다
              <span
                role="img"
                title={PRIVATE_HINT}
                aria-label={PRIVATE_HINT}
                className="flex shrink-0"
              >
                <Lock size={11} aria-hidden className="text-fg-subtle" />
              </span>
            ) : null}
            <span className="ell font-medium">{c.getValue()}</span>
          </span>
        ),
      }),
      col.accessor("custName", { header: "고객사", size: 116 }),
      col.accessor("assigneeName", {
        header: "담당자",
        size: 92,
        cell: (c) =>
          c.getValue() ?? <span className="text-fg-subtle">미배정</span>,
      }),
      col.accessor("priorityCode", {
        header: "우선순위",
        size: 84,
        // 코드 오름차순 = 긴급(1) → 낮음(4)
        cell: (c) => (
          <PriorityBadge code={c.getValue()} label={c.row.original.priority} />
        ),
      }),
      col.accessor("commentCount", {
        header: "댓글",
        size: 68,
        cell: (c) => {
          const r = c.row.original;
          if (!r.commentCount) return <span className="text-fg-subtle">-</span>;
          return (
            <span className="text-12 text-fg-muted flex items-center gap-1">
              <MessageSquare size={11} aria-hidden />
              <span className="num">{r.commentCount}</span>
              {r.hasUnreadComment ? (
                <span
                  role="img"
                  aria-label="새 댓글"
                  className="bg-danger h-1.5 w-1.5 rounded-full"
                />
              ) : null}
            </span>
          );
        },
      }),
      col.accessor("reqDate", {
        header: "신청일",
        size: 96,
        // 이상치(1900-01-01)와 null 은 항상 최후위
        sortingFn: (a, b) =>
          dateSortKey(a.original.reqDate) - dateSortKey(b.original.reqDate),
        cell: (c) => <span className="num">{fmtDate(c.getValue())}</span>,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="scroll-y max-h-[calc(100dvh-278px)]">
      <table className="tbl">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const dir = h.column.getIsSorted();
                return (
                  <th key={h.id} style={{ width: h.column.columnDef.size }}>
                    <button
                      type="button"
                      onClick={h.column.getToggleSortingHandler()}
                      className="hover:text-fg-default flex items-center gap-1"
                      title={
                        pageScopedSort
                          ? "이 페이지 안에서만 정렬됩니다"
                          : "전체 결과를 정렬합니다"
                      }
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {dir === "asc" ? (
                        <ChevronUp size={11} aria-hidden />
                      ) : dir === "desc" ? (
                        <ChevronDown size={11} aria-hidden />
                      ) : (
                        <ChevronDown
                          size={11}
                          aria-hidden
                          className="opacity-25"
                        />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr
              key={r.id}
              data-selected={selected === r.original.echoNum}
              onClick={() => onSelect(r.original.echoNum)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(r.original.echoNum);
                }
              }}
              aria-label={`${r.original.title} 상세 보기`}
            >
              {r.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    cell.column.id === "title"
                      ? "max-w-0"
                      : "whitespace-nowrap",
                    ["custName", "assigneeName"].includes(cell.column.id) &&
                      "ell text-fg-muted",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
