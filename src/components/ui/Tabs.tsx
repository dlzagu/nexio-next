"use client";

import * as RTabs from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export interface TabDef {
  value: string;
  label: string;
  /** 탭 라벨 옆 숫자 배지 (댓글 3, 첨부 2 …) */
  count?: number;
  /** 미읽음 등 강조 점 */
  dot?: boolean;
}

export function Tabs({
  tabs,
  value,
  onValueChange,
  children,
  className,
}: {
  tabs: TabDef[];
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RTabs.Root
      value={value}
      onValueChange={onValueChange}
      className={cn("flex min-h-0 flex-col", className)}
    >
      <RTabs.List className="tabs shrink-0 px-5">
        {tabs.map((t) => (
          <RTabs.Trigger key={t.value} value={t.value} className="tab">
            {t.label}
            {typeof t.count === "number" && t.count > 0 ? (
              <span className="num bg-muted text-11 text-fg-muted rounded-full px-1.5">
                {t.count}
              </span>
            ) : null}
            {t.dot ? (
              <span
                aria-label="새 항목 있음"
                className="bg-danger h-1.5 w-1.5 rounded-full"
              />
            ) : null}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export function TabPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RTabs.Content
      value={value}
      className={cn(
        "scroll-y min-h-0 flex-1 px-5 py-4 outline-none",
        className,
      )}
    >
      {children}
    </RTabs.Content>
  );
}

/** 뷰 전환용 세그먼트 컨트롤 — 필터가 아니라 "어느 큐를 볼 것인가" */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-state={value === o.value ? "active" : "inactive"}
          className="seg-i"
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {typeof o.count === "number" ? (
            // 흐리게가 아니라 **작게** 낮춘다 — opacity 로 죽이면 대비가 3.17:1 이라
            // AA 미달이다(실측). 크기 차이만으로도 위계는 충분히 읽힌다.
            <span className="num text-11">
              {o.count.toLocaleString("ko-KR")}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
