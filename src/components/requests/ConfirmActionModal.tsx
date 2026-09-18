"use client";

import { TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { TEXT_LIMITS } from "@/lib/schemas";
import type { TicketAction } from "@/lib/types";

/**
 * 한 번 누르면 되돌릴 수 없거나, 상대에게 **이유를 전해야 하는** 액션.
 *
 * 🔴 예전엔 액션바가 이것들을 확인 없이 즉시 실행했고 사유를 보낼 곳도 없었다(UX-7).
 *    승인권자가 '반려'를 잘못 누르면 그 자리에서 종료되고, 신청자에게는 사유 없는
 *    "요청이 반려되었습니다" 한 줄만 남았다. 전이표에는 사유 컬럼(AMEMO)이 있는데
 *    화면이 한 번도 채우지 않았다.
 */
export type ConfirmableAction = Extract<
  TicketAction,
  | "reject"
  | "cancel"
  | "cancelRequest"
  | "cancelApprove"
  | "cancelDeny"
  | "suggestCancel"
>;

interface ConfirmSpec {
  title: string;
  /** 누르면 무엇이 되는지 — 결과로 말한다 */
  result: string;
  /** 종료 상태로 가서 되돌리는 전이가 없다 */
  irreversible: boolean;
  /**
   * required = 비었으면 실행 못 함(서버도 막는다) · optional = 비워도 됨 ·
   * none = 서버가 받을 곳이 없다(적게 하면 조용히 버려진다)
   */
  reason: "required" | "optional" | "none";
  reasonLabel?: string;
  placeholder?: string;
  /** 필수 사유가 비었을 때 버튼 옆에 쓰는 이유 */
  requiredHint?: string;
  confirmLabel: string;
  danger: boolean;
}

export const CONFIRM_SPEC: Record<ConfirmableAction, ConfirmSpec> = {
  reject: {
    title: "요청 반려",
    result:
      "이 요청을 반려합니다. 반려된 요청은 종료되어 다시 열 수 없고, 계속하려면 신청자가 재신청해야 합니다.",
    irreversible: true,
    reason: "required",
    reasonLabel: "반려 사유",
    placeholder: "신청자가 무엇을 고치면 되는지 적어 주세요",
    requiredHint: "반려 사유를 입력해야 반려할 수 있습니다.",
    confirmLabel: "반려",
    danger: true,
  },
  cancel: {
    title: "요청 취소",
    result:
      "이 요청을 취소합니다. 취소된 요청은 종료되어 되돌릴 수 없습니다. 다시 필요하면 재신청해 주세요.",
    irreversible: true,
    reason: "optional",
    reasonLabel: "취소 사유 (선택)",
    placeholder: "담당자에게 남길 말이 있으면 적어 주세요",
    confirmLabel: "취소하기",
    danger: true,
  },
  cancelRequest: {
    title: "취소 요청",
    result:
      "담당자에게 취소를 요청합니다. 담당자가 확인하면 취소되거나, 사유와 함께 처리가 계속됩니다. 이유를 전하고 싶다면 댓글로 남겨 주세요.",
    irreversible: false,
    reason: "none",
    confirmLabel: "취소 요청",
    danger: true,
  },
  cancelApprove: {
    title: "취소 승인",
    result:
      "신청자의 취소 요청을 받아들입니다. 요청은 취소로 종료되어 되돌릴 수 없습니다.",
    irreversible: true,
    reason: "optional",
    reasonLabel: "메모 (선택)",
    placeholder: "처리 이력에 남길 내용",
    confirmLabel: "취소 승인",
    danger: true,
  },
  cancelDeny: {
    title: "취소 요청 거절 — 계속 진행",
    result:
      "신청자의 취소 요청을 받아들이지 않고 처리를 계속합니다(진행 단계로 돌아갑니다). 신청자는 왜 계속하는지 알아야 합니다.",
    irreversible: false,
    reason: "required",
    reasonLabel: "계속 진행하는 사유",
    placeholder: "예: 이미 수정본 반영이 끝나 확인만 남았습니다",
    requiredHint: "사유를 입력해야 취소 요청을 거절할 수 있습니다.",
    confirmLabel: "계속 진행",
    danger: false,
  },
  suggestCancel: {
    title: "취소 권유",
    result:
      "신청자에게 취소를 권유하는 댓글이 남습니다. 요청 상태는 바뀌지 않고, 취소 실행은 신청자 본인만 할 수 있습니다.",
    irreversible: false,
    reason: "required",
    reasonLabel: "권유 사유 — 신청자에게 그대로 보입니다",
    placeholder: "예: 같은 내용이 다른 요청에서 처리되었습니다",
    requiredHint: "사유를 입력해야 취소를 권유할 수 있습니다.",
    confirmLabel: "권유 보내기",
    danger: false,
  },
};

export function needsConfirm(action: string): action is ConfirmableAction {
  return Object.hasOwn(CONFIRM_SPEC, action);
}

/** 실행을 막는 이유(없으면 null). 버튼을 조용히 잠그지 않고 이 문장을 함께 보인다 */
export function reasonProblem(
  action: ConfirmableAction,
  reason: string,
): string | null {
  const spec = CONFIRM_SPEC[action];
  if (spec.reason === "required" && !reason.trim()) {
    return spec.requiredHint ?? "사유를 입력해 주세요.";
  }
  return null;
}

/** 서버로 보낼 본문 — 받을 곳이 없는 사유는 싣지 않는다 */
export function confirmPayload(
  action: ConfirmableAction,
  reason: string,
): { reason: string } | undefined {
  const v = reason.trim();
  return CONFIRM_SPEC[action].reason !== "none" && v
    ? { reason: v }
    : undefined;
}

/**
 * 확인 모달. 접수 분류 모달과 같은 `Modal` 프리미티브 — 시트보다 위 레이어(z-modal)이고
 * 스크롤 주체는 모달 본문 하나다(안에 스크롤 영역을 따로 두지 않는다).
 */
export function ConfirmActionModal({
  action,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
  busy,
  message,
}: {
  action: ConfirmableAction | null;
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
  /** 서버가 돌려준 문장(거부 사유 등) — 시트 하단은 모달에 가려 안 보인다 */
  message?: string | null;
}) {
  const spec = action ? CONFIRM_SPEC[action] : null;
  const problem = action ? reasonProblem(action, reason) : null;

  return (
    <Modal
      open={!!action}
      onOpenChange={(v) => !v && onClose()}
      title={spec?.title ?? ""}
      description={spec?.result}
      footer={
        spec ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              돌아가기
            </button>
            <button
              type="button"
              className={cn("btn", spec.danger ? "btn-danger" : "btn-primary")}
              onClick={onConfirm}
              disabled={busy || !!problem}
            >
              {busy ? "처리 중…" : spec.confirmLabel}
            </button>
          </>
        ) : null
      }
    >
      {spec ? (
        <div className="flex flex-col gap-3">
          {spec.irreversible ? (
            <p className="text-12 text-danger-text flex items-start gap-1.5 leading-relaxed">
              <TriangleAlert
                size={13}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              되돌릴 수 없습니다.
            </p>
          ) : null}
          {spec.reason !== "none" ? (
            <label className="flex flex-col gap-1">
              <span className="label">{spec.reasonLabel}</span>
              <textarea
                className="input"
                rows={4}
                maxLength={TEXT_LIMITS.reason}
                value={reason}
                placeholder={spec.placeholder}
                onChange={(e) => onReasonChange(e.target.value)}
                aria-describedby={problem ? "confirm-reason-hint" : undefined}
              />
            </label>
          ) : null}
          {problem ? (
            <p id="confirm-reason-hint" className="text-11 text-fg-subtle">
              {problem}
            </p>
          ) : null}
          {message ? (
            <p className="text-11 text-warning-text">{message}</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
