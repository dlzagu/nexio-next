"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { usePref } from "@/lib/usePref";

/** 시트 폭 3단계. 사용자가 고른 값은 다음에도 유지된다 */
export const SHEET_WIDTHS = ["sm", "md", "lg", "full"] as const;
export type SheetWidth = (typeof SHEET_WIDTHS)[number];

const WIDTH_LABEL: Record<SheetWidth, string> = {
  sm: "좁게",
  md: "기본",
  lg: "넓게",
  full: "전체 화면",
};

/** 확장 버튼을 누를 때의 다음 단계 (기본 → 넓게 → 전체 → 기본) */
const NEXT: Record<SheetWidth, SheetWidth> = {
  sm: "md",
  md: "lg",
  lg: "full",
  full: "md",
};

/**
 * 연 요소가 다시 그려져 DOM 에서 빠졌으면, 같은 표식(`data-focus-id`)을 단 새 요소를 찾는다.
 * 목록 행처럼 갱신 때 노드가 바뀔 수 있는 트리거는 이 표식을 달아 두면 된다.
 */
export function returnTarget(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  if (el.isConnected) return el;
  const id = el.dataset.focusId;
  if (!id) return null;
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-focus-id]")).find(
      (x) => x.dataset.focusId === id,
    ) ?? null
  );
}

/**
 * 닫으면 포커스를 **연 요소**로 돌려준다 (WCAG 2.4.3 포커스 순서).
 *
 * 🔴 Radix 는 `Dialog.Trigger` 로 열었을 때만 트리거로 돌려준다 — 닫힐 때 기본 동작을 막고
 *    `triggerRef` 에 포커스를 주는데, 우리는 전부 `open` prop 으로 열어서 그 ref 가 비어 있다.
 *    그래서 포커스가 body 로 떨어졌고, 목록 40번째 행에서 Esc 로 닫으면 Tab 이 상단바부터
 *    다시 시작했다. 열리는 순간(`onOpenAutoFocus` — 아직 포커스를 안쪽으로 옮기기 전)에
 *    붙잡아 두었다가 닫힐 때 돌려준다.
 */
function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const el = document.activeElement;
      opener.current =
        el instanceof HTMLElement && el !== document.body ? el : null;
    },
    onCloseAutoFocus: (e: Event) => {
      const el = returnTarget(opener.current) ?? dialogBelow();
      opener.current = null;
      if (!el) return; // 돌려줄 곳이 없으면 Radix 기본 동작에 맡긴다
      e.preventDefault();
      el.focus();
    },
  };
}

/**
 * 시트 위에 띄운 모달이 닫혔는데 연 버튼이 사라졌으면(액션 뒤 버튼 목록이 바뀐다) 아래 시트로.
 * 닫힌 쪽은 이 시점에 이미 DOM 에서 빠져 있어 남은 것 중 맨 위가 곧 '아래'다.
 */
function dialogBelow(): HTMLElement | null {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
}

/**
 * 우측 슬라이드 시트. 목록 위에 덮으므로 목록의 스크롤·필터가 유지된다 (P3).
 * 포커스 트랩·Esc·스크롤 락은 Radix 가 처리한다 — 직접 구현하면 a11y 가 깨진다.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  titleHidden,
  header,
  footer,
  children,
  className,
  resizable,
  bodyScroll = true,
  widthKey = "nx-sheet-w",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  titleHidden?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 헤더에 폭 조절 버튼을 노출한다 */
  resizable?: boolean;
  /**
   * 본문을 시트가 직접 스크롤한다 (기본값).
   *
   * 🔴 안쪽에 자체 스크롤 영역(탭 패널 등)을 두는 화면은 `false` 로 꺼야 한다.
   *    켜 두면 본문이 **스크롤 컨테이너**가 되어 자식의 `flex-1 min-h-0` 이 무력화되고,
   *    안쪽 영역은 스크롤되지 않으면서 `overscroll-behavior: contain` 때문에
   *    **휠을 바깥으로 넘기지도 않는다** — 스크롤바를 직접 끌어야만 움직이는 상태가 된다.
   */
  bodyScroll?: boolean;
  widthKey?: string;
}) {
  const [width, setWidth] = usePref<SheetWidth>(widthKey, "md", SHEET_WIDTHS);
  const returnFocus = useReturnFocus();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ovl" />
        <Dialog.Content
          className={cn("sheet", className)}
          data-width={width}
          aria-describedby={undefined}
          {...returnFocus}
        >
          <div className="border-line-subtle flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              {titleHidden ? (
                <Dialog.Title className="sr-only">{title}</Dialog.Title>
              ) : (
                <Dialog.Title className="text-15 text-fg-strong font-semibold">
                  {title}
                </Dialog.Title>
              )}
              {header}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {resizable ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={`창 넓히기 (현재 ${WIDTH_LABEL[width]})`}
                    title={`창 넓히기 — 현재 ${WIDTH_LABEL[width]}`}
                    onClick={() => setWidth(NEXT[width])}
                  >
                    {width === "full" ? (
                      <Minimize2 size={15} />
                    ) : (
                      <Maximize2 size={15} />
                    )}
                  </button>
                  {width !== "sm" ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label="창 좁히기"
                      title="창 좁히기"
                      onClick={() =>
                        setWidth(
                          width === "full"
                            ? "lg"
                            : width === "lg"
                              ? "md"
                              : "sm",
                        )
                      }
                    >
                      <Minimize2 size={15} />
                    </button>
                  ) : null}
                </>
              ) : null}
              <Dialog.Close
                className="btn btn-ghost btn-icon btn-sm"
                aria-label="닫기"
              >
                <X size={15} />
              </Dialog.Close>
            </div>
          </div>

          <div
            className={cn(
              "min-h-0 flex-1",
              bodyScroll ? "scroll-y" : "flex flex-col",
            )}
          >
            {children}
          </div>

          {footer ? (
            <div className="border-line-subtle bg-subtle border-t px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ovl" />
        <Dialog.Content className="modal" {...returnFocus}>
          <div className="px-5 pt-5">
            <Dialog.Title className="text-15 text-fg-strong font-semibold">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="text-12 text-fg-muted mt-1.5 leading-relaxed">
                {description}
              </Dialog.Description>
            ) : null}
          </div>
          {children ? (
            <div className="scroll-y min-h-0 px-5 py-4">{children}</div>
          ) : (
            <div className="h-4" />
          )}
          {footer ? (
            <div className="flex justify-end gap-2 px-5 pb-5">{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
