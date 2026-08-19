import type { ProgressCode } from "./codes";
import { canDo } from "./permissions";
import type { CustomerConfig, TicketAction, TicketRow, User } from "./types";

/**
 * 업무 현황 보드(칸반)의 컬럼과 이동 규칙.
 *
 * 원본은 상태 코드를 그대로 컬럼으로 폈다(할 일/해야함/진행중/리뷰/테스트요청/해결됨/종료/취소).
 * 여기서는 실측을 반영해 줄인다 — 7·8·10 은 도입 이래 0건이고, 종료건이 전체의 95% 라
 * '종료' 컬럼을 전부 그리면 컬럼 하나가 화면을 삼킨다 (대시보드 도넛과 같은 판단).
 *   · 주 경로 4컬럼은 항상 그린다 (카드가 없어도 — 드롭 대상이 사라지면 안 된다)
 *   · 테스트 단계는 그 고객사가 쓸 때만, 카드가 있을 때만 나타난다
 *   · 완료 컬럼은 **최근 완료분만** 담는다
 */

export interface BoardColumn {
  progress: ProgressCode;
  label: string;
  /** 카드가 있을 때만 그리는 확장 컬럼 */
  optional?: boolean;
  hint?: string;
}

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { progress: "1", label: "대기", hint: "승인 대기" },
  { progress: "2", label: "신청", hint: "접수 전" },
  { progress: "3", label: "진행" },
  { progress: "4", label: "해결안 제시" },
  { progress: "5", label: "테스트 요청", optional: true },
  { progress: "6", label: "테스트 완료", optional: true },
  // 곁가지 — 신청자가 취소를 요청한 건. 카드가 있을 때만 뜬다(optional).
  // 보드에서 안 보이면 담당자는 판단해야 할 건이 있다는 걸 모른다.
  {
    progress: "10",
    label: "취소 요청",
    optional: true,
    hint: "판단 필요",
  },
  { progress: "9", label: "완료", hint: "최근 30일" },
];

/**
 * 컬럼 이동 → 액션. **표에 없는 이동은 드롭 자체가 안 된다** (fail-closed).
 * 되돌리는 이동(진행 → 신청 등)은 일부러 넣지 않았다 — 상태를 되돌리면 이력이 꼬인다.
 */
const MOVES: Record<string, TicketAction> = {
  "1>2": "approve",
  "2>3": "receive",
  "3>4": "propose",
  "4>9": "complete",
  "5>6": "testComplete",
  "6>9": "complete",
  // 취소요청의 두 갈래. 10→3 은 '되돌리기'가 아니라 **판단 결과**다
  "10>11": "cancelApprove",
  "10>3": "cancelDeny",
};

export function moveAction(from: string, to: string): TicketAction | undefined {
  return MOVES[`${from}>${to}`];
}

/**
 * 이 카드를 저 컬럼에 놓을 수 있는가. 화면 표시용 판정이며,
 * 실행은 액션 라우트가 서버에서 티켓을 다시 읽어 같은 canDo() 로 한 번 더 거른다.
 */
export function canMove(
  ticket: TicketRow,
  to: ProgressCode,
  user: User,
  config?: CustomerConfig | null,
): TicketAction | null {
  const action = moveAction(ticket.progress, to);
  if (!action) return null;
  return canDo(action, ticket, user, config) ? action : null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 희망 완료일까지 남은 일수. 지났으면 음수.
 *
 * 🔴 '오늘'을 인자로 받는다 — 렌더 함수 안에서 new Date() 를 읽으면 서버(UTC)와
 *    브라우저(KST)가 다른 D-day 를 그려 하이드레이션이 깨진다(React #418).
 *    양쪽 날짜를 UTC 자정으로 고정해 빼므로 타임존과 무관하게 같은 값이 나온다.
 *
 * @param today 'YYYY-MM-DD' (서버가 벽시계 기준으로 만들어 내려보낸다)
 */
export function daysLeft(
  scheDate: string | null,
  today: string,
): number | null {
  if (!scheDate) return null;
  const target = scheDate.slice(0, 10);
  if (!DATE_ONLY.test(target) || !DATE_ONLY.test(today)) return null;
  const ms =
    Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}
