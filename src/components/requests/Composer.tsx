"use client";

import { ChevronDown, Lock, Send } from "lucide-react";
import { useState } from "react";
import { RichEditor } from "@/components/ui/RichEditor";
import { cn } from "@/lib/cn";
import { isBlankHtml } from "@/lib/sanitize";
import { AttachPicker } from "./AttachPicker";

/**
 * 상세 하단에 **항상 보이는** 댓글 입력창 (재설계 §2 "탭 전환 없이 코멘트").
 *
 * 원래는 '댓글' 탭 안에만 있었는데, 상태 4 이상이면 기본 탭이 '처리결과'라
 * 사용자가 "쓸 곳이 없다"고 느꼈다. 탭과 무관하게 노출한다.
 */
export function Composer({
  value,
  onChange,
  files,
  onFilesChange,
  onSubmit,
  sending,
  disabled,
  disabledReason,
  canPostInternal,
  internalOnly,
  onInternalOnlyChange,
}: {
  value: string;
  onChange: (html: string) => void;
  files: File[];
  onFilesChange: (next: File[]) => void;
  onSubmit: () => void;
  sending: boolean;
  disabled?: boolean;
  disabledReason?: string;
  canPostInternal: boolean;
  internalOnly: boolean;
  onInternalOnlyChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [pasteWarning, setPasteWarning] = useState(false);
  const empty = isBlankHtml(value);

  if (disabled) {
    return (
      <div className="border-line-subtle bg-subtle text-fg-subtle text-11 border-t px-5 py-2.5">
        {disabledReason ?? "이 요청에는 댓글을 남길 수 없습니다."}
      </div>
    );
  }

  return (
    <div className="border-line-subtle bg-subtle border-t px-5 py-2.5">
      <button
        type="button"
        className="text-fg-muted hover:text-fg-default text-11 flex w-full items-center gap-1.5"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          size={12}
          aria-hidden
          className={cn("transition-transform", !open && "-rotate-90")}
        />
        댓글 남기기
        {!open && !empty ? (
          <span className="badge badge-accent ml-1">작성 중</span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          {pasteWarning ? (
            <p className="text-warning-text text-11">
              붙여넣은 이미지는 저장되지 않습니다. 아래{" "}
              <strong>파일 첨부</strong> 로 올려 주세요.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setPasteWarning(false)}
              >
                닫기
              </button>
            </p>
          ) : null}

          <RichEditor
            ariaLabel="댓글 입력"
            value={value}
            onChange={onChange}
            placeholder="처리 상황이나 확인이 필요한 내용을 적어 주세요"
            minHeight={72}
            onImagePaste={() => setPasteWarning(true)}
          />

          <AttachPicker files={files} onChange={onFilesChange} compact />

          <div className="flex flex-wrap items-center justify-between gap-2">
            {canPostInternal ? (
              <label className="text-fg-muted text-11 flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={internalOnly}
                  onChange={(e) => onInternalOnlyChange(e.target.checked)}
                />
                <Lock size={11} aria-hidden />
                내부 전용 — 고객사에는 보이지 않습니다
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onSubmit}
              disabled={empty || sending}
            >
              <Send size={12} aria-hidden />
              {sending ? "등록 중…" : "등록"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
