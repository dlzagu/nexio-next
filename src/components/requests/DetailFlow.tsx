"use client";

import { MessageSquare } from "lucide-react";
import { extendedStagesOf } from "@/components/ui/Stepper";
import {
  SUGGEST_CANCEL_LEAD,
  SUGGEST_CANCEL_TAIL,
} from "@/lib/cancel-suggestion";
import { fmtDateTime, fmtRelative, htmlToPlain } from "@/lib/format";
import type { UserRole } from "@/lib/codes";
import type { ActionSpec } from "@/lib/permissions";
import type { Comment, CustomerConfig, TicketDetail } from "@/lib/types";

/**
 * 상세 시트의 **흐름 판정** — 어느 탭으로 열지, 이력에 무엇을 그릴지, 다음에 무엇을 하라고 할지.
 * 판정은 전부 순수 함수로 두고(tests/detail-flow.test.tsx), 시트는 결과를 그리기만 한다.
 */

/* ── 최초 탭 ─────────────────────────────────────────────── */

export const DETAIL_TABS = [
  "request",
  "solution",
  "comments",
  "files",
  "history",
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export function isDetailTab(v: string | null | undefined): v is DetailTab {
  return !!v && (DETAIL_TABS as readonly string[]).includes(v);
}

/**
 * 상세를 열 때 **처음** 보일 탭. 사용자가 탭을 고르면 그 선택이 이긴다(시트의 tabPick).
 *
 * 1. URL 의 `tab` — 보드가 '해결안 제시'처럼 입력이 필요한 이동을 만나면
 *    `?open=<접수번호>&tab=solution` 으로 연다. 쓸 칸이 있는 탭으로 바로 데려가야
 *    카드를 끌었는데 아무 일도 없는 것처럼 보이지 않는다.
 *    ⚠️ 그 건에 없는 탭(첨부 없는 건의 files)은 무시한다 — 빈 탭 바 위치로 열리면 고장으로 보인다.
 * 2. 상태 4(해결안제시) 이상이면 고객이 실제로 읽는 '처리결과'. 취소요청(10)은 진행 중 곁가지라 제외.
 */
export function initialTab(opts: {
  progress: string;
  urlTab?: string | null;
  hasFiles: boolean;
}): DetailTab {
  const u = opts.urlTab;
  if (isDetailTab(u) && (u !== "files" || opts.hasFiles)) return u;
  const n = Number(String(opts.progress).trim());
  return n >= 4 && n !== 10 ? "solution" : "request";
}

/* ── 이력 탭 ─────────────────────────────────────────────── */

export interface HistoryItem {
  key: string;
  label: string;
  who?: string | null;
  at?: string | null;
}

/**
 * 이력 탭에 그릴 행.
 *
 * 🔴 예전엔 테스트·시스템 이관·취소 행을 **늘 그리면서** 바로 아래에 "이 고객사는 테스트·시스템
 *    이관 단계를 사용하지 않습니다. 해당 단계는 표시되지 않습니다"라고 썼다 — 화면이 스스로를
 *    반박했다(실측). 행을 실제로 거르고, 거른 것이 있을 때만 그 사실을 말한다.
 *
 * - 테스트 2행·시스템 이관: 이 건이 **실제로 그 단계에 있거나 지나갔을 때만** — 스테퍼와 같은
 *   판정(extendedStagesOf)이다. 고객사가 단계를 '쓴다'는 플래그만 보면, 들어가는 전이가 없는
 *   이 앱에서는 영원히 '미진행'인 행이 되고 스테퍼(그리지 않음)와 말이 갈린다.
 *   (설정을 끈 뒤에도 과거 기록은 지우지 않는다 — 있었던 일은 보인다)
 * - 취소 요청·취소: 실제로 일어났을 때만. 고객사 설정이 아니라 사건이라 '미진행' 칸이 뜻이 없다
 */
export function historyItems(
  t: Pick<TicketDetail, "history" | "succDate" | "progress">,
  config: CustomerConfig | null | undefined,
): { rows: HistoryItem[]; hiddenStages: string[] } {
  const h = t.history;
  const reached = extendedStagesOf(t);
  const rows: HistoryItem[] = [
    { key: "approve", label: "승인", who: h.approver, at: h.approvedAt },
  ];
  const hiddenStages: string[] = [];

  if (h.cancelReqAt || h.cancelReqBy) {
    rows.push({
      key: "cancelReq",
      label: "취소 요청",
      who: h.cancelReqBy,
      at: h.cancelReqAt,
    });
  }
  if (h.canceledAt || h.canceler) {
    rows.push({
      key: "cancel",
      label: "취소",
      who: h.canceler,
      at: h.canceledAt,
    });
  }

  if (reached.usesTestStage) {
    rows.push(
      { key: "test", label: "테스트 요청", at: h.testAt },
      { key: "testDone", label: "테스트 완료", at: h.testCompletedAt },
    );
  } else if (config?.usesTestStage !== false) {
    // 쓰는 고객사이거나 설정을 모를 때만 '감췄다'고 말한다 — 안 쓰는 고객사에겐 할 말이 없다
    hiddenStages.push("테스트");
  }

  if (reached.usesSystemStage) {
    rows.push({ key: "system", label: "시스템 이관", at: h.systemAt });
  } else if (config?.usesSystemStage !== false) {
    hiddenStages.push("시스템 이관");
  }

  rows.push(
    {
      key: "final",
      label: "최종 처리",
      who: h.finalAssignee,
      at: h.finalSuccDate,
    },
    { key: "done", label: "완료", at: t.succDate },
  );
  return { rows, hiddenStages };
}

/**
 * 감춘 단계가 있을 때만 이유를 말한다. 감추는 것은 '이 건이 거치지 않은' 단계뿐이라
 * 문장도 그것만 말한다 — 고객사가 그 단계를 쓰는지 여부를 단정하지 않는다.
 */
export function hiddenStageNotice(hiddenStages: string[]): string | null {
  if (hiddenStages.length === 0) return null;
  return `이 요청이 거치지 않은 ${hiddenStages.join("·")} 단계는 이력에 표시하지 않습니다.`;
}

/* ── 신청자에게 온 취소 권유 ─────────────────────────────── */

/**
 * 권유 댓글의 첫 문장 — 서버(`mutations.ts` suggestCancel)가 남기는 본문과 **같은 문장**이어야 한다.
 * ⚠️ 서버 문구를 바꾸면 여기도 바꾼다. tests/detail-flow.test.tsx 가 서버가 **실제로 남긴**
 *    본문으로 한 번 더 확인한다 — 문구가 갈라지면 카드가 조용히 사라지기 때문이다.
 */
export { SUGGEST_CANCEL_LEAD };

/**
 * 권유 댓글이면 사유를 꺼낸다(없으면 null). 권유가 아니면 null.
 *
 * 줄 단위로 읽는다 — 사유는 첫 문장과 같은 문단에 붙어 오기도 하고(`권유했습니다. 사유`)
 * 별도 문단(여러 줄)으로 오기도 한다. 어느 쪽이든 끝의 안내 문단 앞까지가 사유다.
 */
export function parseCancelSuggestion(
  body: string,
): { reason: string | null } | null {
  const lines = htmlToPlain(body).split("\n");
  if (!lines[0]?.startsWith(SUGGEST_CANCEL_LEAD)) return null;
  const parts = [lines[0].slice(SUGGEST_CANCEL_LEAD.length)];
  for (const line of lines.slice(1)) {
    if (line.startsWith(SUGGEST_CANCEL_TAIL)) break;
    parts.push(line);
  }
  // 서버가 사유 앞에 '사유:' 를 붙여도 같은 결과가 나오게 한다
  const reason = parts
    .join("\n")
    .trim()
    .replace(/^[-—–·]?\s*사유\s*[:：]\s*/, "")
    .trim();
  return { reason: reason || null };
}

export interface CancelSuggestion {
  reason: string | null;
  by: string;
  at: string | null;
  /** 이 사용자가 지금 실행할 수 있는 취소 수단 */
  exec: "cancel" | "cancelRequest";
}

/**
 * 신청자 상세 상단에 '취소 권유 카드'를 띄울지.
 *
 * - 실행 수단(cancel·cancelRequest)이 **서버가 내려준 액션**에 있어야 한다. canDo 가 이미
 *   '신청자 본인 + 고객사'를 판정한 결과라, 화면이 역할을 따로 추측하지 않는다(fail-closed).
 * - **가장 최근의 사람 댓글**(시스템 기록 제외)이 권유여야 한다 — 신청자가 이미 답했거나
 *   대화가 이어졌다면 카드는 지난 이야기다. 댓글은 서버가 시간순(오래된 것 먼저)으로 준다.
 * - 권유는 처리자 측(운영팀·외부업체)이 쓴 글이어야 한다 — 고객이 같은 문장을 적었다고 뜨지 않게.
 */
export function cancelSuggestionFor(
  comments: Comment[],
  actions: Pick<ActionSpec, "action">[],
): CancelSuggestion | null {
  const exec = actions.find(
    (a) => a.action === "cancel" || a.action === "cancelRequest",
  )?.action as CancelSuggestion["exec"] | undefined;
  if (!exec) return null;

  const human = comments.filter((c) => !c.isLog);
  const last = human[human.length - 1];
  if (!last) return null;
  if (last.userRole !== "INTERNAL" && last.userRole !== "VENDOR") return null;

  const parsed = parseCancelSuggestion(last.body);
  if (!parsed) return null;
  return { reason: parsed.reason, by: last.userName, at: last.at, exec };
}

/* ── 고객의 다음 행동 ────────────────────────────────────── */

/**
 * 해결안제시(4)에서 고객에게 할 일이 있는가.
 *
 * 🔴 대시보드는 이 건을 '해결안 확인 대기 — 고객 확인 필요'로 보내는데, 설계상 4단계의
 *    고객 액션은 없다(완료는 담당자 — redesign-ST001 §3). 그래서 상세를 열면 "실행할 수 있는
 *    액션이 없습니다"만 보였다 — 확인하러 왔는데 막다른 길이다. 정책은 그대로 두고
 *    **확인했다는 사실을 댓글로 알리는 길**을 안내한다.
 *
 * 🔒 누가 보는지 모르면(viewerRole 없음) 안내하지 않는다 — 운영팀에게 "확인하셨다면 알려
 *    주세요"를 띄우면 그게 더 헷갈린다.
 */
export function customerNextStep(opts: {
  progress: string;
  viewerRole: UserRole | null | undefined;
  canComment: boolean;
  actionCount: number;
}): "confirmSolution" | null {
  if (String(opts.progress).trim() !== "4") return null;
  if (opts.viewerRole !== "CUSTOMER") return null;
  if (!opts.canComment || opts.actionCount > 0) return null;
  return "confirmSolution";
}

/** 댓글 초안에 채워 주는 문장 — 전송은 사용자가 누른다 */
export const CONFIRM_SOLUTION_COMMENT =
  "<p>처리결과를 확인했습니다. 완료 처리 부탁드립니다.</p>";
export const DECLINE_CANCEL_COMMENT =
  "<p>취소하지 않고 계속 진행을 원합니다.</p>";

/* ── 화면 조각 ───────────────────────────────────────────── */

/**
 * 신청자 상세 상단의 취소 권유 카드 (redesign-ST001 §3 "알림 도착 시 상세 상단에").
 * 취소 실행은 여전히 신청자 본인의 버튼이다 — 카드는 확인 모달을 여는 지름길일 뿐이다.
 */
export function CancelSuggestionCard({
  suggestion,
  onCancel,
  onReply,
  disabled,
}: {
  suggestion: CancelSuggestion;
  onCancel: () => void;
  /** 댓글을 남길 수 없으면 undefined — 버튼을 그리지 않는다 */
  onReply?: () => void;
  disabled?: boolean;
}) {
  return (
    <section
      aria-label="취소 권유"
      className="border-warning-border bg-warning-subtle rounded-md border px-3 py-2.5"
    >
      <p className="text-12 text-warning-text font-semibold">
        담당자가 취소를 권유했습니다
      </p>
      <p className="text-12 text-fg-default mt-1 leading-relaxed whitespace-pre-line">
        {suggestion.reason ? (
          <>사유: {suggestion.reason}</>
        ) : (
          <span className="text-fg-muted">사유는 적혀 있지 않습니다.</span>
        )}
      </p>
      <p className="text-11 text-fg-subtle mt-1">
        {suggestion.by} ·{" "}
        <span title={fmtDateTime(suggestion.at)}>
          {fmtRelative(suggestion.at)}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-danger-soft btn-sm"
          onClick={onCancel}
          disabled={disabled}
        >
          {suggestion.exec === "cancel" ? "취소하기" : "취소 요청하기"}
        </button>
        {onReply ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onReply}
          >
            <MessageSquare size={12} aria-hidden />
            계속 진행 — 댓글로 답하기
          </button>
        ) : null}
      </div>
    </section>
  );
}
