/**
 * 서비스 신청 진입 판정 — 정본은 `permissions.ts` 다(신청 라우트와 공유).
 * 막힌 진입점은 숨기지 않고 비활성 + 이 문장으로 말한다 (버튼이 사라지면 "왜 없지"가 남는다).
 */
export { newRequestBlockedReason } from "@/lib/permissions";
