import { isTerminal, type ProgressCode } from "./codes";
import { canDo } from "./permissions";
import type {
  CustomerConfig,
  ListView,
  TicketAction,
  TicketRow,
  User,
} from "./types";

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

/**
 * 이동을 실행하는 방법. 권한(canMove)과 **별개의 축**이다 — 할 수 있는 이동이라도
 * 사람의 입력이 필요하면 보드에서 곧바로 부르지 않는다.
 *   · api    — 버튼·드롭 한 번으로 끝나는 전이 (접수·승인·완료)
 *   · detail — 입력이 있어야 하는 전이. 상세를 열어 **쓸 자리**로 데려간다
 */
export type BoardMovePlan =
  | { kind: "api"; action: TicketAction }
  | {
      kind: "detail";
      action: TicketAction;
      /** 상세에서 먼저 열 탭 (null = 상태별 기본 탭) */
      tab: "solution" | null;
      /** 보드 위에 한 줄로 남길 안내 — 왜 이동 대신 상세가 열렸는지 */
      note: string;
    };

/**
 * 🔴 입력이 필요한 전이. 보드는 `{ action }` 만 보내므로 여기 있는 것을 API 로 부르면
 *    400 문장만 뜨고 카드는 그대로다 (진행 카드 78건 전부 — 답변은 4 부터 채워진다).
 *    · 해결안 제시 — 답변 필수(전이표 requires). 처리결과 탭에서 쓰고 거기서 누른다
 *    · 취소요청 판단 — 고객의 요청을 받거나 거절하는 **종결 판단**이라 사유와 확인이 필요하다.
 *      1클릭으로 거절되면 고객은 이유 없이 취소가 막힌다
 */
const NEEDS_INPUT: Partial<
  Record<TicketAction, { tab: "solution" | null; note: string }>
> = {
  propose: {
    tab: "solution",
    note: "답변을 쓰고 '해결안 제시'를 누르세요.",
  },
  cancelApprove: {
    tab: null,
    note: "고객의 취소 요청입니다 — 상세에서 사유와 함께 판단하세요.",
  },
  cancelDeny: {
    tab: null,
    note: "고객의 취소 요청입니다 — 상세에서 사유와 함께 판단하세요.",
  },
};

export function planMove(
  ticket: TicketRow,
  to: ProgressCode,
  user: User,
  config?: CustomerConfig | null,
): BoardMovePlan | null {
  const action = canMove(ticket, to, user, config);
  if (!action) return null;
  const input = NEEDS_INPUT[action];
  return input ? { kind: "detail", action, ...input } : { kind: "api", action };
}

/**
 * 카드의 빠른 버튼(키보드·클릭 경로). 드래그와 **같은 판정**을 탄다.
 * 라벨은 컬럼 이름이 아니라 **누르면 일어나는 일**로 말한다 — 상세가 열리는데
 * '해결안 제시 ›' 라고 쓰면 이동한 줄 안다. 취소요청(10)은 어느 쪽으로 가든 판단이다.
 */
export function quickMove(
  ticket: TicketRow,
  user: User,
  config?: CustomerConfig | null,
): { to: ProgressCode; label: string; plan: BoardMovePlan } | null {
  for (const col of BOARD_COLUMNS) {
    if (col.progress === ticket.progress) continue;
    const plan = planMove(ticket, col.progress, user, config);
    if (!plan) continue;
    const label =
      plan.kind === "api"
        ? col.label
        : plan.action === "propose"
          ? "해결안 쓰기"
          : "판단하기";
    return { to: col.progress, label, plan };
  }
  return null;
}

/**
 * 서버가 입력 부족으로 이동을 되돌려 보냈을 때 — 같은 버튼을 다시 누르게 두지 않고
 * 쓸 자리를 연다. (완료 4→9 도 서버가 답변을 요구한다. 보통은 4 에 이미 답변이 있지만
 * 비어 있는 건이 오면 이 길로 간다)
 */
export function planAfterRejection(
  code: string | undefined,
): { tab: "solution"; note: string } | null {
  if (code === "SOLUTION_REQUIRED") {
    return {
      tab: "solution",
      note: "답변(처리내용)이 비어 있어 옮기지 못했습니다 — 처리결과 탭에서 채운 뒤 다시 시도하세요.",
    };
  }
  return null;
}

/**
 * 방금 **신청한** 건을 신청한 사람이 어느 목록에서 볼 수 있는가. 못 보면 null.
 *
 * `scopeClause`(data/tickets.ts)와 같은 규칙을 화면 쪽에서 되짚는다:
 *   · 신청자가 나 → '내 요청'(mine)
 *   · 운영팀 → 전부 보인다. 대리 신청은 신청자도 담당자도 내가 아니라 mine 에 안 걸린다 → open
 *   · 고객사 → 공개건이거나 내가 승인권자일 때만 보인다
 *   · 그 밖(외부업체 등) → 배정건만 보이는데 새 신청은 담당이 없다 → 못 본다
 * 🔴 못 보는 건의 상세를 열면 404 가 뜨고, 사용자는 저장이 실패한 줄 알고 다시 낸다
 *    (자기도 볼 수 없는 중복 티켓이 쌓인다).
 */
export function listViewAfterCreate(
  created: { requesterId: string; isPublic: boolean; progress: string },
  user: User,
): ListView | null {
  if (created.requesterId && created.requesterId === user.id) return "mine";
  const visible =
    user.role === "INTERNAL" ||
    (user.role === "CUSTOMER" && (user.isApprover || created.isPublic));
  if (!visible) return null;
  return isTerminal(created.progress) ? "all" : "open";
}

/** 신청 저장 후 보낼 주소. 볼 수 없는 건은 상세를 열지 않고 목록에 안내만 남긴다 */
export function afterCreateHref(
  echoNum: string,
  created: { requesterId: string; isPublic: boolean; progress: string },
  user: User,
): string {
  const view = listViewAfterCreate(created, user);
  const no = encodeURIComponent(echoNum);
  return view
    ? `/requests?view=${view}&open=${no}`
    : `/requests?view=open&created=${no}&notice=private`;
}

/**
 * 방금 등록한 건을 **실제로 볼 수 있는** 목록.
 *
 * 목록 뷰마다 조건이 다르다 — '진행 중'(open)은 종료건을 빼고, '내 담당'(mine)은
 * `신청자 = 나 OR 담당자 = 나` 만 담는다. 접수 전(2)으로 등록하면 담당이 없고
 * 신청자는 고객사 사람이라 **어느 쪽 조건에도 안 걸려** 목록이 0건으로 보인다
 * (상세 시트만 열리고 뒤가 비어 있어 저장이 안 된 것처럼 읽힌다).
 */
export function listViewForStage(stage: string): "open" | "mine" {
  // 접수 전은 담당이 없다 → 미완료 목록에서 찾는다
  if (stage === "2") return "open";
  // 완료(9)는 미완료 목록에서 빠지지만 담당이 나라서 '내 담당'에는 있다
  return "mine";
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
