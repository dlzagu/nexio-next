import { isTerminal, type ProgressCode } from "./codes";
import type { CustomerConfig, TicketAction, TicketRow, User } from "./types";

/**
 * 권한 판정 단일 함수. 원본은 권한 축 11개가 JSP 전역에 흩어져 있었다.
 *
 * 🔒 fail-closed — 기본은 차단이다. 규칙표에 없는 (액션, 상태, 역할) 조합은 전부 false.
 *    원본 applyTopButtonsByRow 가 "전부 숨김 → 조건 맞으면 show" 구조라 이미
 *    fail-closed 였고, 그 성질을 유지한다.
 *
 * ⚠️ 이건 **UI 표시용**이다. 버튼을 숨긴다고 요청이 막히지 않는다 —
 *    액션 라우트에서 서버가 티켓을 다시 읽고 같은 함수로 한 번 더 판정한다.
 */
export function canDo(
  action: TicketAction,
  ticket: TicketRow | null,
  user: User | null,
  config?: CustomerConfig | null,
): boolean {
  // 미로그인·티켓 없음 = 차단 (미등록·NULL·빈 결과는 허용이 아니다)
  if (!user || !ticket) return false;

  const p = ticket.progress as ProgressCode;
  if (!p) return false;

  const isInternal = user.role === "INTERNAL";
  const isCustomer = user.role === "CUSTOMER";
  const isVendor = user.role === "VENDOR";
  const isRequester = !!ticket.requesterId && ticket.requesterId === user.id;
  const isAssignee = !!ticket.assigneeId && ticket.assigneeId === user.id;
  const terminal = isTerminal(p);

  // 처리자 측 = 운영팀(내부) 또는 외부업체
  const isHandler = isInternal || isVendor;

  switch (action) {
    /* ── 고객사 측 ─────────────────────────────────────────── */

    case "approve":
    case "reject":
      // 대기(1) 에서 승인권자만. 고객사가 승인 단계를 쓰는 경우에 한정
      if (p !== "1") return false;
      if (!isCustomer) return false;
      if (config && !config.usesApproval) return false;
      return user.isApprover;

    case "cancel":
      // 🔒 회사 정책 — 취소 실행은 신청자 본인만. 담당자에게 주지 않는다.
      if (!isCustomer || !isRequester) return false;
      return p === "1" || p === "2";

    case "cancelRequest":
      // 진행(3) 부터는 바로 취소가 아니라 취소요청. 역시 신청자만
      if (!isCustomer || !isRequester) return false;
      return p === "3";

    case "reapply":
      // 종료건 재신청 — 신청자 본인
      return terminal && isCustomer && isRequester;

    case "testComplete":
      // 확장 경로. 고객사가 테스트 단계를 쓸 때만
      if (p !== "5") return false;
      if (!config?.usesTestStage) return false;
      return isCustomer;

    /* ── 처리자 측 ─────────────────────────────────────────── */

    case "receive":
      // 신청(2) → 진행(3) 접수
      return p === "2" && isHandler;

    case "save":
      // 처리내역 저장 — 진행 중인 단계에서 담당자
      if (terminal) return false;
      if (!isHandler) return false;
      if (!["3", "4", "5", "6", "7", "8"].includes(p)) return false;
      // 담당자가 배정된 건은 그 담당자만. 미배정이면 처리자 측 누구나 집을 수 있다.
      return ticket.assigneeId ? isAssignee : true;

    case "propose":
      // 진행(3) → 해결안제시(4)
      if (p !== "3" || !isHandler) return false;
      return ticket.assigneeId ? isAssignee : true;

    case "complete":
      // 해결안제시(4) 또는 테스트완료(6) → 완료(9)
      if (!isHandler) return false;
      if (p !== "4" && p !== "6") return false;
      if (p === "6" && !config?.usesTestStage) return false;
      return ticket.assigneeId ? isAssignee : true;

    case "suggestCancel":
      // 담당자가 취소를 "권유"만 한다. 실행 버튼은 신청자 화면에만 있다.
      // 코멘트 4회 왕복 → 알림 1 + 클릭 1 로 줄이는 장치.
      if (terminal || !isHandler) return false;
      return ["1", "2", "3", "4", "5", "6"].includes(p);

    /* ── 공통 ──────────────────────────────────────────────── */

    case "comment":
      // 종료건에는 댓글을 달지 않는다 (원본 종료 시 전체 잠금과 동일)
      if (terminal) return false;
      if (isInternal || isVendor) return true;
      // 고객사는 자기 회사 건에만
      return isCustomer && ticket.custCode === user.custCode;

    default:
      // 새 액션이 추가되면 여기로 떨어져 차단된다 — 의도된 동작이다
      return false;
  }
}

export interface ActionSpec {
  action: TicketAction;
  label: string;
  variant: "primary" | "outline" | "ghost" | "danger" | "danger-soft";
}

/** 상태·역할로 계산된 액션만. 최대 3개까지만 노출한다 (재설계 §3) */
const ACTION_ORDER: ActionSpec[] = [
  { action: "approve", label: "승인", variant: "primary" },
  { action: "receive", label: "접수", variant: "primary" },
  { action: "propose", label: "해결안 제시", variant: "primary" },
  { action: "complete", label: "완료 처리", variant: "primary" },
  { action: "testComplete", label: "테스트 완료", variant: "primary" },
  { action: "reapply", label: "재신청", variant: "primary" },
  { action: "save", label: "저장", variant: "outline" },
  { action: "suggestCancel", label: "취소 권유", variant: "outline" },
  { action: "cancelRequest", label: "취소 요청", variant: "danger-soft" },
  { action: "cancel", label: "취소", variant: "danger-soft" },
  { action: "reject", label: "반려", variant: "danger-soft" },
];

/** 액션 라벨 정본 — 화면 버튼과 처리 결과 안내가 같은 말을 쓰게 한다 */
export function actionLabel(action: TicketAction): string {
  return (
    ACTION_ORDER.find((s) => s.action === action)?.label ??
    (action === "comment" ? "댓글" : action)
  );
}

export function availableActions(
  ticket: TicketRow | null,
  user: User | null,
  config?: CustomerConfig | null,
): ActionSpec[] {
  return ACTION_ORDER.filter((s) =>
    canDo(s.action, ticket, user, config),
  ).slice(0, 3);
}

/**
 * 처리내역을 **왜 수정할 수 없는지** 알려준다.
 * 편집 UI 가 조용히 사라지면 담당자는 "입력할 곳이 없다"고 느낀다 — 이유를 말한다 (P7).
 */
export function editSolutionHint(
  ticket: TicketRow | null,
  user: User | null,
  config?: CustomerConfig | null,
): string | null {
  if (!ticket || !user) return null;
  if (canDo("save", ticket, user, config)) return null;

  if (isTerminal(ticket.progress)) {
    return "종료된 요청이라 처리내역이 잠겨 있습니다.";
  }
  if (user.role === "CUSTOMER") {
    return "처리내역은 담당 엔지니어가 작성합니다. 추가로 전달할 내용은 아래 댓글로 남겨 주세요.";
  }
  if (ticket.assigneeId && ticket.assigneeId !== user.id) {
    return `이 요청의 담당자(${ticket.assigneeName ?? ticket.assigneeId})만 처리내역을 수정할 수 있습니다.`;
  }
  if (ticket.progress === "1" || ticket.progress === "2") {
    return "아직 접수 전입니다. '접수'한 뒤에 처리내역을 작성할 수 있습니다.";
  }
  return "현재 단계에서는 처리내역을 수정할 수 없습니다.";
}

/**
 * 취소가 안 되는 이유를 신청자에게 알려준다.
 * 원본은 규칙을 화면에 설명하지 않아 "왜 취소가 안 되나" 문의가 발생했다.
 */
export function cancelHint(
  ticket: TicketRow | null,
  user: User | null,
): string | null {
  if (!ticket || !user) return null;
  if (canDo("cancel", ticket, user) || canDo("cancelRequest", ticket, user))
    return null;

  const isRequester = ticket.requesterId === user.id;
  if (user.role !== "CUSTOMER") {
    return "요청 취소는 신청자 본인만 실행할 수 있습니다. 담당자는 '취소 권유'를 보낼 수 있습니다.";
  }
  if (!isRequester) {
    return `이 요청의 신청자(${ticket.requesterName})만 취소할 수 있습니다.`;
  }
  if (isTerminal(ticket.progress)) {
    return "이미 종료된 요청은 취소할 수 없습니다. 필요하면 재신청해 주세요.";
  }
  return "현재 단계에서는 취소할 수 없습니다. 담당자에게 문의해 주세요.";
}
