"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Maximize2, Minimize2, X } from "lucide-react";
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
  widthKey?: string;
}) {
  const [width, setWidth] = usePref<SheetWidth>(widthKey, "md", SHEET_WIDTHS);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ovl" />
        <Dialog.Content
          className={cn("sheet", className)}
          data-width={width}
          aria-describedby={undefined}
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

          <div className="scroll-y min-h-0 flex-1">{children}</div>

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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ovl" />
        <Dialog.Content className="modal">
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
