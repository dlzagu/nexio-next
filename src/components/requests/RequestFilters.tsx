"use client";

import {
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { MODULE, PRIORITY, PROGRESS } from "@/lib/codes";
import type { Option } from "@/lib/data/meta";
import { useUrlState } from "./useUrlState";

const toOptions = (m: Record<string, string>): Option[] =>
  Object.entries(m).map(([value, label]) => ({ value, label }));

/**
 * 필터 13개 중 **상시 4개**, 나머지는 접는다 (P1).
 * myOnlyYn 은 필터가 아니라 뷰 전환 탭으로 승격했다.
 */
export function RequestFilters({
  companies,
  assignees,
  requesters,
  advancedOpenDefault,
}: {
  companies: Option[];
  assignees: Option[];
  requesters: Option[];
  advancedOpenDefault: boolean;
}) {
  const { params, set, pending } = useUrlState();
  const [advanced, setAdvanced] = useState(advancedOpenDefault);
  const get = (k: string) => params.get(k) ?? "";

  /**
   * 검색어는 URL 이 정본이고 입력 중에만 로컬 초안을 쓴다.
   * 초안에 기준값(base)을 함께 담아 두면 URL 이 바뀌는 순간 초안이 자동으로 버려진다
   * → effect 로 동기화할 필요가 없다.
   */
  const urlQ = get("q");
  const [draft, setDraft] = useState<{ base: string; value: string } | null>(
    null,
  );
  const kw = draft?.base === urlQ ? draft.value : urlQ;
  const setKw = (value: string) => setDraft({ base: urlQ, value });
  const activeAdvanced = [
    "assignee",
    "requester",
    "module",
    "priority",
    "migration",
    "unread",
  ].filter((k) => get(k)).length;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: kw }, { resetPage: true });
          }}
        >
          <Search
            size={13}
            aria-hidden
            className="text-fg-subtle pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="제목 · 내용 · 요청번호 검색"
            aria-label="검색어"
            className="input input-lead"
          />
        </form>

        <div className="w-[168px]">
          <Combobox
            options={companies}
            value={get("custCode")}
            onChange={(v) => set({ custCode: v }, { resetPage: true })}
            placeholder="고객사"
            clearLabel="전체 고객사"
          />
        </div>

        <div className="w-[148px]">
          <Combobox
            options={toOptions(PROGRESS)}
            value={get("progress")}
            onChange={(v) => set({ progress: v }, { resetPage: true })}
            placeholder="상태"
            clearLabel="전체 상태"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="시작일"
            value={get("from")}
            onChange={(e) => set({ from: e.target.value }, { resetPage: true })}
            className="input w-[134px]"
          />
          <span className="text-fg-subtle">~</span>
          <input
            type="date"
            aria-label="종료일"
            value={get("to")}
            onChange={(e) => set({ to: e.target.value }, { resetPage: true })}
            className="input w-[134px]"
          />
        </div>

        <button
          type="button"
          className="btn btn-outline"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          <SlidersHorizontal size={13} aria-hidden />
          상세 필터
          {activeAdvanced ? (
            <span className="badge badge-accent">{activeAdvanced}</span>
          ) : null}
          <ChevronDown
            size={12}
            aria-hidden
            className={
              advanced
                ? "rotate-180 transition-transform"
                : "transition-transform"
            }
          />
        </button>

        {pending ? (
          <span className="text-11 text-fg-subtle" role="status">
            불러오는 중…
          </span>
        ) : null}
      </div>

      {advanced ? (
        <div className="border-line-subtle bg-subtle flex flex-wrap items-end gap-2 rounded-md border p-2.5">
          <Labeled label="담당자" className="w-[168px]">
            <Combobox
              options={assignees}
              value={get("assignee")}
              onChange={(v) => set({ assignee: v }, { resetPage: true })}
              placeholder="전체"
              clearLabel="전체 담당자"
            />
          </Labeled>
          <Labeled label="신청자" className="w-[168px]">
            <Combobox
              options={requesters}
              value={get("requester")}
              onChange={(v) => set({ requester: v }, { resetPage: true })}
              placeholder="전체"
              clearLabel="전체 신청자"
            />
          </Labeled>
          <Labeled label="모듈" className="w-[168px]">
            <Combobox
              options={toOptions(MODULE)}
              value={get("module")}
              onChange={(v) => set({ module: v }, { resetPage: true })}
              placeholder="전체"
              clearLabel="전체 모듈"
            />
          </Labeled>
          <Labeled label="우선순위" className="w-[132px]">
            <Combobox
              options={toOptions(PRIORITY)}
              value={get("priority")}
              onChange={(v) => set({ priority: v }, { resetPage: true })}
              placeholder="전체"
              clearLabel="전체"
            />
          </Labeled>

          <label className="text-12 text-fg-muted flex h-[var(--ctl-h-md)] cursor-pointer items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={get("migration") === "1"}
              onChange={(e) =>
                set(
                  { migration: e.target.checked ? "1" : null },
                  { resetPage: true },
                )
              }
            />
            이관 데이터 포함
            <span className="text-11 text-fg-subtle">
              구시스템에서 옮겨온 과거 이력
            </span>
          </label>

          {/* 대시보드 '미읽음 댓글' 카드가 이 필터로 들어온다 — 숫자를 누르면
              그 숫자를 만든 목록이 나와야 한다 */}
          <label className="text-12 text-fg-muted flex h-[var(--ctl-h-md)] cursor-pointer items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={get("unread") === "1"}
              onChange={(e) =>
                set(
                  { unread: e.target.checked ? "1" : null },
                  { resetPage: true },
                )
              }
            />
            안 읽은 글이 있는 요청만
          </label>

          <button
            type="button"
            className="btn btn-ghost ml-auto"
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
                  migration: null,
                  unread: null,
                },
                { resetPage: true },
              )
            }
          >
            <RotateCcw size={13} aria-hidden />
            필터 초기화
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Labeled({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
