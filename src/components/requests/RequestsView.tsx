"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, Notice } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Tabs";
import type { Option } from "@/lib/data/meta";
import type { ListView, TicketListResult, User } from "@/lib/types";
import { DetailSheet } from "./DetailSheet";
import { RequestFilters } from "./RequestFilters";
import { RequestTable } from "./RequestTable";
import { useUrlState } from "./useUrlState";

/**
 * 이 화면의 주된 결정: **"내 요청이 지금 어디까지 왔고, 다음에 뭘 해야 하는가."**
 * 조회는 검색 화면이 아니라 **작업 큐**다 — 열자마자 내가 볼 것이 떠 있어야 한다.
 * 그래서 첫 진입 기본값이 '내 담당 · 최근 15일'이고(page.tsx 에서 URL 로 실어 준다),
 * 넓혀 보는 것은 사용자가 한다 (실측 미완료 171건 vs 완료 23,302건).
 */
export function RequestsView({
  result,
  user,
  companies,
  assignees,
  requesters,
  counts,
  page,
  pageSize,
}: {
  result: TicketListResult;
  user: User;
  companies: Option[];
  assignees: Option[];
  requesters: Option[];
  counts: { open: number; mine: number; all: number };
  page: number;
  pageSize: number;
}) {
  const { params, set } = useUrlState();
  const view = (params.get("view") ?? "open") as ListView;
  const opened = params.get("open");
  const hasFilters = [
    "q",
    "custCode",
    "progress",
    "from",
    "to",
    "assignee",
    "requester",
    "module",
    "priority",
  ].some((k) => params.get(k));

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return (
    <div className="flex min-h-0 flex-col gap-3 p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
            요청 조회
          </h1>
          <p className="text-12 text-fg-muted mt-1">
            {result.total.toLocaleString("ko-KR")}건
            {result.clientSortable
              ? " · 모든 컬럼 정렬 가능"
              : ` · ${page}/${totalPages} 페이지`}
          </p>
        </div>
        <Link href="/requests/new" className="btn btn-primary">
          <Plus size={14} aria-hidden />
          서비스 신청
        </Link>
      </header>

      <Segmented<ListView>
        ariaLabel="목록 뷰"
        value={view}
        onChange={(v) => set({ view: v, page: null }, { resetPage: true })}
        options={[
          { value: "open", label: "진행 중", count: counts.open },
          {
            value: "mine",
            label: user.role === "CUSTOMER" ? "내 요청" : "내 담당",
            count: counts.mine,
          },
          { value: "all", label: "전체 검색", count: counts.all },
        ]}
      />

      <RequestFilters
        companies={companies}
        assignees={assignees}
        requesters={requesters}
        advancedOpenDefault={hasFilters && view === "all"}
      />

      {/* 조용한 절단 금지 — 잘렸으면 화면에 말한다 */}
      {result.truncated ? (
        <Notice tone="warning">
          결과가 1,000건을 넘어 일부만 불러왔습니다. 정렬·필터가 전체를 반영하지
          않으니 조건을 좁혀 주세요.
        </Notice>
      ) : null}
      {!result.clientSortable && result.total > pageSize ? (
        <Notice tone="info">
          전체 검색은 서버 페이징이라{" "}
          <strong>정렬이 현재 페이지 안에서만</strong> 적용됩니다. 전체를 정렬해
          보려면 &lsquo;진행 중&rsquo; 또는 &lsquo;내 담당&rsquo; 뷰를 쓰세요.
        </Notice>
      ) : null}

      <div className="card overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title="조건에 맞는 요청이 없습니다"
            reason={
              user.role === "CUSTOMER" ? (
                <>
                  비공개로 등록된 요청은 <strong>작성자와 승인자에게만</strong>{" "}
                  보입니다. 전체 요청의 약 79%가 비공개입니다.
                  {view === "open"
                    ? " 완료된 요청은 '전체 검색' 뷰에 있습니다."
                    : ""}
                </>
              ) : view === "open" ? (
                <>
                  미완료 요청이 없습니다. 완료된 요청은 &lsquo;전체 검색&rsquo;
                  뷰에서 볼 수 있습니다.
                </>
              ) : (
                "검색 범위를 넓혀 보세요."
              )
            }
            actions={
              <>
                {hasFilters ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() =>
                      set(
                        {
                          q: null,
                          custCode: null,
                          progress: null,
                          from: null,
                          to: null,
                          assignee: null,
                          requester: null,
                          module: null,
                          priority: null,
                        },
                        { resetPage: true },
                      )
                    }
                  >
                    필터 초기화
                  </button>
                ) : null}
                {view !== "all" ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => set({ view: "all" }, { resetPage: true })}
                  >
                    전체 검색으로 넓히기
                  </button>
                ) : null}
              </>
            }
          />
        ) : (
          <RequestTable
            rows={result.rows}
            selected={opened}
            onSelect={(echoNum) => set({ open: echoNum })}
            pageScopedSort={!result.clientSortable}
          />
        )}
      </div>

      {!result.clientSortable && totalPages > 1 ? (
        <nav
          className="flex items-center justify-center gap-2"
          aria-label="페이지 이동"
        >
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => set({ page: String(page - 1) })}
          >
            이전
          </button>
          <span className="num text-12 text-fg-muted">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page >= totalPages}
            onClick={() => set({ page: String(page + 1) })}
          >
            다음
          </button>
        </nav>
      ) : null}

      <DetailSheet echoNum={opened} onClose={() => set({ open: null })} />
    </div>
  );
}
