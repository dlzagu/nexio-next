"use client";

import { Info, Save } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/ui/EmptyState";
import { RichEditor } from "@/components/ui/RichEditor";
import { RichTextBlock } from "@/components/ui/RichText";
import { fmtHours } from "@/lib/format";
import { isBlankHtml } from "@/lib/sanitize";
import type { TicketDetail } from "@/lib/types";

/**
 * 처리결과 탭 = 엔지니어의 **처리 폼**이다 (원본의 '관리자 처리 폼' 대응).
 *
 * 원본 라벨 정본: `OK_SECTION_LABEL` (ST001.jsp:2259)
 *   원인 · 해결과정 · 개선사항 · 답변 · 결과 · 개발사유 · 개발내용
 *
 * 🔴 편집 권한이 있으면 **빈 필드도 전부 렌더한다.** 값이 있는 것만 보여주면
 *    담당자가 "쓸 칸이 없다"고 느낀다. 읽기 전용일 때만 빈 필드를 접는다.
 */

export interface SolutionDraft {
  cause: string;
  process: string;
  improvement: string;
  answer: string;
  result: string;
  devReason: string;
  devContent: string;
  expeTime: string;
  workTime: string;
  rWorkTime: string;
  surTime: string;
}

const TEXT_FIELDS = [
  { key: "cause", label: "원인", hint: "왜 발생했는지" },
  {
    key: "process",
    label: "해결 과정",
    hint: "무엇을 확인하고 어떻게 조치했는지",
  },
  { key: "improvement", label: "개선 사항", hint: "재발 방지를 위해 바꾼 것" },
  { key: "answer", label: "답변", hint: "고객이 실제로 읽는 부분입니다" },
  { key: "result", label: "결과", hint: "최종 상태" },
  { key: "devReason", label: "개발 사유", hint: "개발이 필요했다면 그 근거" },
  { key: "devContent", label: "개발 내용", hint: "변경한 프로그램·객체" },
] as const satisfies readonly {
  key: keyof SolutionDraft;
  label: string;
  hint: string;
}[];

const TIME_FIELDS = [
  { key: "expeTime", label: "예상 시간" },
  { key: "workTime", label: "작업 시간" },
  { key: "rWorkTime", label: "실작업 시간" },
  { key: "surTime", label: "추가 시간" },
] as const satisfies readonly { key: keyof SolutionDraft; label: string }[];

const num = (v: number | null) =>
  v === null || v === undefined ? "" : String(v);

export function toDraft(t: TicketDetail): SolutionDraft {
  const s = t.solution;
  return {
    cause: s.cause,
    process: s.process,
    improvement: s.improvement,
    answer: s.answer,
    result: s.result,
    devReason: s.devReason,
    devContent: s.devContent,
    expeTime: num(s.expeTime),
    workTime: num(s.workTime),
    rWorkTime: num(s.rWorkTime),
    surTime: num(s.surTime),
  };
}

export function SolutionPanel({
  ticket,
  canEdit,
  readOnlyReason,
  draft,
  onChange,
  onSave,
  saving,
  dirty,
}: {
  ticket: TicketDetail;
  canEdit: boolean;
  readOnlyReason?: string | null;
  draft: SolutionDraft;
  onChange: (patch: Partial<SolutionDraft>) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const [pasteWarning, setPasteWarning] = useState(false);

  /* ── 읽기 전용 ─────────────────────────────────────────── */
  if (!canEdit) {
    const filled = TEXT_FIELDS.filter(
      (f) =>
        !isBlankHtml(
          ticket.solution[f.key as keyof typeof ticket.solution] as string,
        ),
    );
    // 옛 레코드는 분리 필드가 비고 OKREMARKS 만 있다 (이어 붙인 레거시 요약)
    const legacy =
      filled.length === 0 && !isBlankHtml(ticket.solution.okRemarks);

    return (
      <div>
        {/* 편집 UI 가 조용히 사라지면 "입력할 곳이 없다"가 된다 — 이유를 먼저 말한다 */}
        {readOnlyReason ? (
          <p className="text-fg-subtle text-11 mb-4 flex items-start gap-1.5 leading-relaxed">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
            {readOnlyReason}
          </p>
        ) : null}
        {filled.map((f) => (
          <section key={f.key} className="mb-4">
            <p className="label">{f.label}</p>
            <RichTextBlock
              raw={
                ticket.solution[f.key as keyof typeof ticket.solution] as string
              }
            />
          </section>
        ))}
        {legacy ? (
          <section className="mb-4">
            <p className="label">처리 내용</p>
            <RichTextBlock raw={ticket.solution.okRemarks} />
          </section>
        ) : null}
        {filled.length === 0 && !legacy ? (
          <Notice tone="info">
            아직 처리 결과가 등록되지 않았습니다. 담당자가 해결안을 제시하면 이
            탭에 표시됩니다.
          </Notice>
        ) : null}
        <TimeStrip
          values={[
            ticket.solution.expeTime,
            ticket.solution.workTime,
            ticket.solution.rWorkTime,
            ticket.solution.surTime,
          ]}
        />
      </div>
    );
  }

  /* ── 편집 ──────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-subtle text-11 flex items-center gap-1.5">
          <Info size={12} aria-hidden />
          비어 있는 항목도 모두 표시됩니다. 필요한 것만 채우세요.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onSave}
          disabled={saving || !dirty}
        >
          <Save size={13} aria-hidden />
          {saving ? "저장 중…" : dirty ? "처리내역 저장" : "변경 없음"}
        </button>
      </div>

      {pasteWarning ? (
        <Notice tone="warning">
          붙여넣은 이미지는 저장되지 않습니다. 아래 댓글 입력창의{" "}
          <strong>파일 첨부</strong>로 올려 주세요 — 첨부 탭에 함께 쌓입니다.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setPasteWarning(false)}
          >
            닫기
          </button>
        </Notice>
      ) : null}

      {TEXT_FIELDS.map((f) => (
        <section key={f.key}>
          <label className="label" htmlFor={`sol-${f.key}`}>
            {f.label}
          </label>
          <RichEditor
            ariaLabel={f.label}
            value={draft[f.key]}
            onChange={(html) =>
              onChange({ [f.key]: html } as Partial<SolutionDraft>)
            }
            placeholder={f.hint}
            minHeight={f.key === "answer" ? 140 : 96}
            onImagePaste={() => setPasteWarning(true)}
          />
        </section>
      ))}

      <section>
        <p className="label">시간 정산</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIME_FIELDS.map((f) => (
            <div key={f.key}>
              <label
                htmlFor={`sol-${f.key}`}
                className="text-fg-subtle text-11 mb-1 block"
              >
                {f.label}
              </label>
              <div className="relative">
                <input
                  id={`sol-${f.key}`}
                  type="number"
                  step="0.5"
                  min="0"
                  inputMode="decimal"
                  className="input num pr-7"
                  value={draft[f.key]}
                  onChange={(e) =>
                    onChange({
                      [f.key]: e.target.value,
                    } as Partial<SolutionDraft>)
                  }
                />
                <span
                  aria-hidden
                  className="text-fg-subtle text-11 pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2"
                >
                  h
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 레거시 요약은 편집 대상이 아니다 — 분리 필드가 정본이다 */}
      {!isBlankHtml(ticket.solution.okRemarks) ? (
        <details className="border-line-subtle rounded-md border px-3 py-2">
          <summary className="text-fg-subtle text-11 cursor-pointer">
            예전 형식 처리내용 (OKREMARKS) — 읽기 전용
          </summary>
          <div className="mt-2">
            <RichTextBlock raw={ticket.solution.okRemarks} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TimeStrip({ values }: { values: (number | null)[] }) {
  const labels = ["예상 시간", "작업 시간", "실작업 시간", "추가 시간"];
  return (
    <div className="border-line-subtle mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-4">
      {labels.map((label, i) => (
        <div key={label}>
          <p className="text-fg-subtle text-11">{label}</p>
          <p className="text-fg-default num text-13 mt-0.5">
            {fmtHours(values[i])}
          </p>
        </div>
      ))}
    </div>
  );
}
