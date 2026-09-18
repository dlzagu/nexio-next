"use client";

import { NewRequestButton } from "@/components/layout/NewRequestButton";
import { EmptyState, Notice } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Tabs";
import type { Option } from "@/lib/data/meta";
import type { ListView, TicketListResult, User } from "@/lib/types";
import { DetailSheet } from "./DetailSheet";
import { RequestFilters } from "./RequestFilters";
import { RequestTable } from "./RequestTable";
import {
  ADVANCED_FILTER_KEYS,
  emptyListReason,
  hasListFilters,
  listFilterResetPatch,
  useUrlState,
} from "./useUrlState";

/** 신청 직후 안내에 싣는 접수번호 — URL 에서 오는 값이라 모양이 맞을 때만 글로 옮긴다 */
const ECHO_SHAPE = /^[A-Za-z0-9-]{1,40}$/;

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
  // 필터 키는 정본 하나(useUrlState)를 본다 — 미읽음·이관 포함이 빠지면 초기화 버튼이 사라진다
  const hasFilters = hasListFilters(params);
  const reason = emptyListReason(params, user.role, view);

  /**
   * 비공개 동료 명의 신청처럼 **신청한 사람이 볼 수 없는 건**은 상세를 열지 않고 여기로 온다
   * (afterCreateHref). 상세를 열면 404 가 떠서 저장이 실패한 줄 알고 다시 낸다.
   */
  const createdRaw = params.get("created") ?? "";
  const createdPrivate =
    params.get("notice") === "private" && ECHO_SHAPE.test(createdRaw)
      ? createdRaw
      : null;

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
        {/* 외부업체에게는 숨기지 않고 비활성 + 이유 (제출에서야 막히는 막다른 길을 만들지 않는다) */}
        <NewRequestButton user={user} />
      </header>

      {createdPrivate ? (
        <Notice tone="accent">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex-1">
              신청되었습니다 (접수번호{" "}
              <span className="mono">{createdPrivate}</span>). 비공개라{" "}
              <strong>신청자와 승인권자만</strong> 볼 수 있어 이 목록에는 나오지
              않습니다.
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => set({ created: null, notice: null })}
            >
              닫기
            </button>
          </span>
        </Notice>
      ) : null}

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
        // 상세 필터가 걸려 있으면 펼친 채로 — 대시보드 '미읽음' 카드로 들어온 사람이
        // 원인(체크박스)을 접힌 패널 안에서 찾지 않게 한다
        advancedOpenDefault={ADVANCED_FILTER_KEYS.some((k) => !!params.get(k))}
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
              <EmptyReason reason={reason} role={user.role} view={view} />
            }
            actions={
              <>
                {hasFilters ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() =>
                      set(listFilterResetPatch(), { resetPage: true })
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
            // 다른 건을 열 때 지난 건의 탭 지정(tab=)이 따라가지 않게 지운다
            onSelect={(echoNum) => set({ open: echoNum, tab: null })}
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

      <DetailSheet
        echoNum={opened}
        onClose={() => set({ open: null, tab: null })}
      />
    </div>
  );
}

/** 빈 목록의 이유 (P7). 판정은 emptyListReason — 여기서는 문장만 고른다 */
function EmptyReason({
  reason,
  role,
  view,
}: {
  reason: ReturnType<typeof emptyListReason>;
  role: User["role"];
  view: ListView;
}) {
  const privateNote = (
    <>
      비공개로 등록된 요청은 <strong>작성자와 승인자에게만</strong> 보입니다.
      전체 요청의 약 79%가 비공개입니다.
    </>
  );
  switch (reason) {
    case "unread":
      return (
        <>
          <strong>안 읽은 글이 있는 요청만</strong> 보는 중입니다 — 이 뷰의
          요청은 모두 읽었습니다. &lsquo;필터 초기화&rsquo;로 전체 목록을
          보세요.
        </>
      );
    case "filtered":
      return (
        <>
          지금 걸린 조건(검색어·기간·상세 필터)에 맞는 요청이 없습니다. 필터를
          초기화하거나 범위를 넓혀 보세요.
          {role === "CUSTOMER" ? (
            <>
              <br />
              {privateNote}
            </>
          ) : null}
        </>
      );
    case "customerPrivate":
      return (
        <>
          {privateNote}
          {view === "open" ? " 완료된 요청은 '전체 검색' 뷰에 있습니다." : ""}
        </>
      );
    case "noOpen":
      return (
        <>
          미완료 요청이 없습니다. 완료된 요청은 &lsquo;전체 검색&rsquo; 뷰에서
          볼 수 있습니다.
        </>
      );
    default:
      return <>검색 범위를 넓혀 보세요.</>;
  }
}
