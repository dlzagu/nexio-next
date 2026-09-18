"use client";

import { ChevronDown, Lock, Send } from "lucide-react";
import { useState } from "react";
import { RichEditor } from "@/components/ui/RichEditor";
import { cn } from "@/lib/cn";
import { isBlankHtml } from "@/lib/sanitize";
import { AttachPicker } from "./AttachPicker";

/**
 * 🔒 내부 전용 댓글과 첨부는 함께 갈 수 없다.
 *    첨부는 댓글이 아니라 **요청 단위**로 저장돼(ADR-0008) 첨부 탭·다운로드 라우트로
 *    고객사·외부업체에게 그대로 보인다. 본문만 숨고 파일은 새는 조합을 화면에서 먼저 막는다
 *    (서버도 같은 조합을 거부한다 — 화면은 표시일 뿐이다).
 */
export const INTERNAL_NO_FILES =
  "내부 전용 댓글에는 파일을 붙일 수 없습니다 — 첨부는 요청 단위라 고객사에도 보입니다.";

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
  focusKey = 0,
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
  /**
   * 바뀔 때마다 입력창으로 포커스를 가져온다(0 = 요청 없음).
   * 상단 카드의 '댓글로 답하기'·'확인 댓글 쓰기'가 쓴다.
   */
  focusKey?: number;
}) {
  /**
   * 접힘은 **접은 시점의 포커스 요청 번호**로 기억한다. 그 뒤에 새 요청이 오면 파생값으로
   * 다시 펼쳐진다 — effect 안에서 setOpen(true) 하지 않는다(연쇄 렌더).
   */
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const open = closedAt === null || closedAt !== focusKey;
  const [pasteWarning, setPasteWarning] = useState(false);
  const empty = isBlankHtml(value);
  // 정상 조작으로는 둘이 함께 켜질 수 없다(아래에서 서로를 잠근다). 켜져 있으면 풀 때까지 못 보낸다
  const conflict = internalOnly && files.length > 0;

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
        onClick={() => setClosedAt(open ? focusKey : null)}
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
            focusKey={focusKey}
          />

          <AttachPicker
            files={files}
            onChange={onFilesChange}
            compact
            disabled={internalOnly}
          />
          {internalOnly ? (
            <p
              className={cn(
                "text-11",
                conflict ? "text-warning-text" : "text-fg-subtle",
              )}
            >
              {INTERNAL_NO_FILES}
              {conflict
                ? " 붙인 파일을 빼거나 내부 전용을 해제해 주세요."
                : null}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {canPostInternal ? (
              <div className="flex flex-col gap-0.5">
                <label
                  className={cn(
                    "text-fg-muted text-11 flex items-center gap-1.5",
                    files.length > 0 && !internalOnly
                      ? "cursor-not-allowed opacity-60"
                      : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={internalOnly}
                    // 파일을 조용히 버리지 않는다 — 체크를 막고 이유를 말한다
                    disabled={files.length > 0 && !internalOnly}
                    onChange={(e) => onInternalOnlyChange(e.target.checked)}
                  />
                  <Lock size={11} aria-hidden />
                  내부 전용 — 고객사에는 보이지 않습니다
                </label>
                {files.length > 0 && !internalOnly ? (
                  <span className="text-fg-subtle text-11">
                    파일을 붙인 댓글은 내부 전용으로 남길 수 없습니다 — 첨부는
                    요청 단위라 고객사에도 보입니다. 파일을 빼면 선택할 수
                    있습니다.
                  </span>
                ) : null}
              </div>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onSubmit}
              disabled={empty || sending || conflict}
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
