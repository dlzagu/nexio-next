"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, GripVertical, MessageSquare } from "lucide-react";
import { useState } from "react";
import { DetailSheet } from "@/components/requests/DetailSheet";
import { useUrlState } from "@/components/requests/useUrlState";
import { Notice } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { BOARD_COLUMNS, canMove, daysLeft } from "@/lib/board";
import {
  PRIORITY_TONE,
  type PriorityCode,
  type ProgressCode,
} from "@/lib/codes";
import { fmtDate } from "@/lib/format";
import type { CustomerConfig, TicketRow, User } from "@/lib/types";

type BoardType = "mine" | "all";

/**
 * 칸반. 카드를 끌어 옮기면 **그 이동에 해당하는 액션**이 실행된다 (임의 상태 변경이 아니다).
 *
 * 🔒 드롭 가능 여부는 화면에서도 canDo() 로 판정하지만, 그건 표시일 뿐이다 —
 *    실행은 액션 라우트가 서버에서 티켓을 다시 읽어 한 번 더 거른다.
 *    (원본은 낙관적 락으로 동시 수정을 막는데, 우리 스키마엔 갱신일시가 없어
 *     '서버 재판정'이 그 자리를 대신한다. 남이 먼저 옮겼으면 403 이 돌아온다)
 *
 * ♿ 드래그만 제공하면 키보드 사용자가 아무것도 못 한다 → 카드마다 '다음 단계' 버튼을 함께 둔다.
 */
export function BoardView({
  user,
  rows,
  done,
  configs,
  truncated,
  today,
}: {
  user: User;
  rows: TicketRow[];
  done: TicketRow[];
  configs: Record<string, CustomerConfig | null>;
  truncated: boolean;
  /** 서버가 만든 기준일 'YYYY-MM-DD' — D-day 계산이 SSR/CSR 에서 같아야 한다 */
  today: string;
}) {
  const router = useRouter();
  const { params, set } = useUrlState();
  const boardType = (params.get("b") ?? "mine") as BoardType;
  const opened = params.get("open");

  const [dragging, setDragging] = useState<TicketRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; failed: boolean } | null>(
    null,
  );

  const isMine = (r: TicketRow) =>
    r.assigneeId === user.id || r.requesterId === user.id;
  const visible = boardType === "mine" ? rows.filter(isMine) : rows;
  const visibleDone = boardType === "mine" ? done.filter(isMine) : done;

  const cardsOf = (progress: ProgressCode) =>
    (progress === "9" ? visibleDone : visible)
      .filter((r) => r.progress === progress)
      .sort(
        (a, b) =>
          Number(a.priorityCode || "3") - Number(b.priorityCode || "3") ||
          (b.reqDate ?? "").localeCompare(a.reqDate ?? ""),
      );

  // 확장 컬럼(테스트 단계)은 카드가 있을 때만 — 안 쓰는 고객사에게 빈 칸을 그리지 않는다
  const columns = BOARD_COLUMNS.filter(
    (c) => !c.optional || cardsOf(c.progress).length > 0,
  );

  const move = async (row: TicketRow, to: ProgressCode) => {
    const action = canMove(row, to, user, configs[row.custCode]);
    if (!action) return;
    setBusy(row.echoNum);
    setMsg(null);
    const res = await fetch(
      `/api/tickets/${encodeURIComponent(row.echoNum)}/action`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    setMsg({
      text: body.message ?? body.code ?? `HTTP ${res.status}`,
      failed: !res.ok && res.status !== 202,
    });
    setBusy(null);
    if (res.ok) router.refresh();
  };

  /** 이 카드가 갈 수 있는 다음 컬럼 (키보드·클릭 경로) */
  const nextOf = (row: TicketRow) =>
    BOARD_COLUMNS.find(
      (c) =>
        c.progress !== row.progress &&
        canMove(row, c.progress, user, configs[row.custCode]),
    );

  return (
    <div className="flex min-h-0 flex-col gap-3 p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
            업무 현황
          </h1>
          <p className="text-12 text-fg-muted mt-1">
            미완료 {visible.length}건 · 최근 완료 {visibleDone.length}건 ·
            카드를 끌어 다음 단계로 옮깁니다
          </p>
        </div>
        <Segmented<BoardType>
          ariaLabel="보드 범위"
          value={boardType}
          onChange={(v) => set({ b: v })}
          options={[
            {
              value: "mine",
              label: user.role === "CUSTOMER" ? "내 요청" : "내 업무",
              count: rows.filter(isMine).length,
            },
            { value: "all", label: "전체", count: rows.length },
          ]}
        />
      </header>

      {truncated ? (
        <Notice tone="warning">
          미완료가 1,000건을 넘어 일부만 표시합니다. 조회 화면에서 조건을 좁혀
          확인하세요.
        </Notice>
      ) : null}
      {msg ? (
        <Notice tone={msg.failed ? "danger" : "info"}>{msg.text}</Notice>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = cardsOf(col.progress);
          const droppable =
            !!dragging &&
            !!canMove(dragging, col.progress, user, configs[dragging.custCode]);

          return (
            <section
              key={col.progress}
              onDragOver={(e) => {
                // preventDefault 를 해야만 드롭이 허용된다 → 갈 수 없는 컬럼은 그대로 막힌다
                if (droppable) e.preventDefault();
              }}
              onDrop={() => {
                if (droppable && dragging) move(dragging, col.progress);
                setDragging(null);
              }}
              className={cn(
                "bg-subtle flex w-[280px] shrink-0 flex-col rounded-md border",
                droppable
                  ? "border-accent-border bg-accent-subtle"
                  : "border-line-subtle",
                dragging && !droppable && "opacity-60",
              )}
            >
              <header className="border-line-subtle flex items-baseline gap-2 border-b px-3 py-2">
                <h2 className="text-12 text-fg-strong font-medium">
                  {col.label}
                </h2>
                <span className="num text-11 text-fg-subtle">
                  {cards.length}
                </span>
                {col.hint ? (
                  <span className="text-11 text-fg-subtle ml-auto">
                    {col.hint}
                  </span>
                ) : null}
              </header>

              <ul className="flex min-h-[120px] flex-col gap-2 p-2">
                {cards.length === 0 ? (
                  <li className="text-11 text-fg-subtle px-1 py-3 text-center">
                    {droppable ? "여기에 놓기" : "없음"}
                  </li>
                ) : (
                  cards.map((r) => {
                    const next = nextOf(r);
                    const left = daysLeft(r.scheDate, today);
                    return (
                      <li
                        key={r.echoNum}
                        draggable={!!next}
                        onDragStart={() => setDragging(r)}
                        onDragEnd={() => setDragging(null)}
                        className={cn(
                          "border-line-subtle bg-surface flex flex-col gap-1.5 rounded-md border p-2.5",
                          next ? "cursor-grab" : "cursor-default",
                          busy === r.echoNum && "opacity-50",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {next ? (
                            <GripVertical
                              size={12}
                              aria-hidden
                              className="text-fg-disabled shrink-0"
                            />
                          ) : null}
                          <span className="mono text-11 text-fg-subtle">
                            {r.echoNum}
                          </span>
                          {r.priorityCode && r.priorityCode !== "3" ? (
                            <span
                              className={`badge badge-${PRIORITY_TONE[r.priorityCode as PriorityCode] ?? "neutral"}`}
                            >
                              {r.priority}
                            </span>
                          ) : null}
                          {r.commentCount > 0 ? (
                            <span className="text-11 text-fg-subtle ml-auto flex items-center gap-0.5">
                              <MessageSquare size={10} aria-hidden />
                              {r.commentCount}
                            </span>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          className="text-12 text-fg-strong line-clamp-2 text-left hover:underline"
                          onClick={() => set({ open: r.echoNum })}
                        >
                          {r.title}
                        </button>

                        <div className="text-11 text-fg-subtle flex flex-wrap items-center gap-x-2">
                          <span className="ell">{r.custName}</span>
                          <span aria-hidden>·</span>
                          <span>{r.assigneeName ?? "미배정"}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="num text-11 text-fg-subtle">
                            {fmtDate(r.reqDate)}
                          </span>
                          {left !== null ? (
                            <span
                              className={cn(
                                "text-11",
                                left < 0
                                  ? "text-danger-text"
                                  : left <= 2
                                    ? "text-warning-text"
                                    : "text-fg-subtle",
                              )}
                              title={`희망 완료일 ${fmtDate(r.scheDate)}`}
                            >
                              {left < 0 ? `D+${-left}` : `D-${left}`}
                            </span>
                          ) : null}
                          {next ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs ml-auto"
                              disabled={busy === r.echoNum}
                              onClick={() => move(r, next.progress)}
                              title={`${next.label} 로 이동`}
                            >
                              {next.label}
                              <ChevronRight size={11} aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {/* 상세는 조회 화면과 같은 시트를 그대로 쓴다 — 두 벌로 만들면 반드시 어긋난다 */}
      <DetailSheet echoNum={opened} onClose={() => set({ open: null })} />
    </div>
  );
}
