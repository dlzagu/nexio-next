"use client";

import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  ACCEPT_ATTR,
  MAX_FILES,
  MAX_FILE_BYTES,
  fmtBytes,
  rejectReason,
  resolveMime,
} from "@/lib/attachments";
import { cn } from "@/lib/cn";

/**
 * 첨부 선택 — 신청 폼과 댓글 입력창이 **같은 컨트롤**을 쓴다.
 *
 * 🔴 고르는 순간 거부 사유를 말한다. 원본은 저장을 누른 뒤에야 알려줬고,
 *    그게 이 화면 재설계의 출발점이었다(순차 alert 8단계).
 *    한도·형식 판정은 서버와 **같은 규칙 파일**(lib/attachments.ts)에서 온다.
 */
export function AttachPicker({
  files,
  onChange,
  compact = false,
  inputId,
}: {
  files: File[];
  onChange: (next: File[]) => void;
  /** 댓글창처럼 좁은 자리에서는 버튼 한 줄로 줄인다 */
  compact?: boolean;
  /** 다른 곳(붙여넣기 경고 등)에서 파일 선택을 열 수 있게 하는 id */
  inputId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const add = (list: FileList | null) => {
    const next = [...files];
    const found: string[] = [];

    for (const f of Array.from(list ?? [])) {
      if (next.length >= MAX_FILES) {
        found.push(`첨부는 최대 ${MAX_FILES}개까지 올릴 수 있습니다.`);
        break;
      }
      // 같은 파일을 두 번 고르는 실수는 조용히 넘긴다 (오류가 아니다)
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;

      const total = next.reduce((n, x) => n + x.size, 0);
      const why = rejectReason(f, total);
      if (why) {
        found.push(why);
        continue;
      }
      next.push(f);
    }

    setProblems(found);
    onChange(next);
  };

  const remove = (target: File) => {
    setProblems([]);
    onChange(files.filter((f) => f !== target));
  };

  return (
    <div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        onChange={(e) => {
          add(e.target.files);
          // 같은 파일을 지웠다가 다시 고를 수 있게 비워 둔다
          e.target.value = "";
        }}
      />

      <button
        type="button"
        className={cn(
          compact
            ? "btn btn-outline btn-sm"
            : "border-line-strong text-12 text-fg-muted hover:bg-hover flex w-full items-center justify-center gap-2 rounded-md border border-dashed py-5",
        )}
        onClick={() => inputRef.current?.click()}
        disabled={files.length >= MAX_FILES}
      >
        <Paperclip size={compact ? 12 : 13} aria-hidden />
        {files.length >= MAX_FILES
          ? `첨부 ${MAX_FILES}개 (최대)`
          : compact
            ? "파일 첨부"
            : "클릭해서 파일 선택"}
      </button>

      {!compact ? (
        <p className="text-11 text-fg-subtle mt-1.5">
          이미지·PDF·문서·zip·텍스트 · 개당 {fmtBytes(MAX_FILE_BYTES)} 까지 ·
          최대 {MAX_FILES}개
        </p>
      ) : null}

      {files.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <li key={`${f.name}:${f.size}`} className="chip gap-1">
              <span className="ell max-w-[220px]">{f.name}</span>
              <span className="text-fg-subtle">{fmtBytes(f.size)}</span>
              <button
                type="button"
                aria-label={`${f.name} 첨부 제거`}
                className="text-fg-subtle hover:text-fg-default"
                onClick={() => remove(f)}
              >
                <X size={11} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {problems.length ? (
        <ul className="text-11 text-danger-text mt-1.5 flex flex-col gap-0.5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** File → 전송 형태(base64). 본문과 **한 요청**에 실어 보낸다 (ADR-0008) */
export async function toAttachmentPayload(
  files: File[],
): Promise<{ name: string; mime: string; data: string }[]> {
  return Promise.all(
    files.map(async (f) => ({
      name: f.name,
      mime: resolveMime(f.name, f.type),
      data: await toBase64(f),
    })),
  );
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // 한 번에 넘기면 인자 수 한계(스택)에 걸린다 — 조각내서 잇는다
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
