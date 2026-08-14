"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { Option } from "@/lib/data/meta";

/**
 * 검색형 선택. 모듈 26개 · 고객사 86개 · 운영시스템 126개는
 * 단일 select 로는 못 고른다 (재설계 §5).
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "선택",
  searchPlaceholder = "검색…",
  emptyText = "결과가 없습니다",
  allowClear = true,
  clearLabel = "전체",
  id,
  invalid,
  className,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  clearLabel?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, 200);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          o.value.toLowerCase().includes(needle) ||
          (o.hint ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 200);
  }, [options, q]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQ("");
      }}
    >
      <Popover.Trigger
        id={id}
        aria-invalid={invalid ? "true" : undefined}
        className={cn(
          "input flex items-center justify-between gap-2 text-left",
          className,
        )}
      >
        <span className={cn("ell", !selected && "text-fg-placeholder")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={13}
          className="text-fg-subtle shrink-0"
          aria-hidden
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="border-line bg-surface shadow-3 z-[var(--z-dropdown)] w-[min(320px,90vw)] overflow-hidden rounded-md border"
        >
          <div className="border-line-subtle flex items-center gap-2 border-b px-2.5 py-2">
            <Search size={13} className="text-fg-subtle shrink-0" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="text-13 placeholder:text-fg-placeholder w-full bg-transparent outline-none"
            />
          </div>
          <div className="scroll-y max-h-[280px] p-1">
            {allowClear ? (
              <Row
                label={clearLabel}
                active={value === ""}
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              />
            ) : null}
            {filtered.length === 0 ? (
              <p className="text-12 text-fg-subtle px-2.5 py-6 text-center">
                {emptyText}
              </p>
            ) : (
              filtered.map((o) => (
                <Row
                  key={o.value}
                  label={o.label}
                  hint={o.hint}
                  active={o.value === value}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({
  label,
  hint,
  active,
  onSelect,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-13 hover:bg-hover flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left",
        active && "bg-selected text-accent-text",
      )}
    >
      <Check
        size={13}
        className={cn("shrink-0", active ? "opacity-100" : "opacity-0")}
        aria-hidden
      />
      <span className="ell flex-1">{label}</span>
      {hint ? (
        <span className="text-11 text-fg-subtle shrink-0">{hint}</span>
      ) : null}
    </button>
  );
}
