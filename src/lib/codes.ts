/**
 * 코드 정본. 원본 시스템의 코드 체계(COMMON_CODE 실측, 2026-07-30)를 그대로 따르며,
 * 시드 데이터도 이 표 기준으로 생성된다.
 * 자주 바뀌지 않아 상수로 두되, 매핑 실패 시 원문을 그대로 보여준다(빈칸 금지).
 */

/** COMMON_CODE UPPER_CD='STEPSTAT' (12개) */
export const PROGRESS = {
  "1": "대기",
  "2": "신청",
  "3": "진행",
  "4": "해결안제시",
  "5": "테스트요청",
  "6": "테스트완료",
  "7": "시스템이관요청",
  "8": "시스템이관승인",
  "9": "완료",
  "10": "취소요청",
  "11": "취소",
  "12": "반려",
} as const;
export type ProgressCode = keyof typeof PROGRESS;

/** 종료 상태 — 전체 폼이 잠긴다 (원본 ST001.jsp:3082) */
export const TERMINAL_PROGRESS: readonly ProgressCode[] = ["9", "11", "12"];

/** 주 경로 — 실측 99.9%. Stepper 가 그리는 5단계 */
export const MAIN_FLOW: readonly ProgressCode[] = ["1", "2", "3", "4", "9"];
/** 확장 경로 — 고객사 플래그가 켜졌을 때만 (DEV 실측 5·6=8건, 7·8=3건) */
export const TEST_FLOW: readonly ProgressCode[] = ["5", "6"];
export const SYSTEM_FLOW: readonly ProgressCode[] = ["7", "8"];

export type Tone =
  "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/** 상태 → 톤. 색만으로 구분하지 않으려고 배지에 도형도 함께 넣는다 */
export const PROGRESS_TONE: Record<ProgressCode, Tone> = {
  "1": "warning",
  "2": "info",
  "3": "accent",
  "4": "info",
  "5": "info",
  "6": "info",
  "7": "info",
  "8": "info",
  "9": "success",
  "10": "warning",
  "11": "neutral",
  "12": "danger",
};

/** COMMON_CODE UPPER_CD='B1GUBUN2' (26개) — NX_OPTREPORTD.MODULE 이 이걸 참조한다 */
export const MODULE = {
  "1": "운영관리",
  "2": "재무관리",
  "3": "관리회계",
  "4": "전자세금계산서",
  "5": "고정자산",
  "6": "예산관리",
  "7": "판매관리",
  "8": "구매관리",
  "9": "BP관리",
  "10": "자금관리",
  "11": "재고관리",
  "12": "품질관리",
  "13": "생산관리",
  "14": "서비스관리",
  "15": "인사관리",
  "16": "경영계획",
  "17": "세무관리",
  "18": "서버관리",
  "19": "시스템관리",
  "20": "경비관리",
  "21": "WMS",
  "22": "MES",
  "23": "GW",
  "24": "기타IF",
  "25": "HR",
  "26": "CMS",
} as const;

/** COMMON_CODE UPPER_CD='PRIORLVL' — NX_OPTREPORTD.REQLEVEL. 실측 3(중간)이 98% */
export const PRIORITY = {
  "1": "긴급",
  "2": "높음",
  "3": "중간",
  "4": "낮음",
} as const;
export type PriorityCode = keyof typeof PRIORITY;

export const PRIORITY_TONE: Record<PriorityCode, Tone> = {
  "1": "danger",
  "2": "warning",
  "3": "neutral",
  "4": "neutral",
};

/**
 * NX_OPTREPORTD.REQTYPE 실측 분포 — MIGRATION 18,274 / SERVICE 2,947 / WORK 147.
 * ⚠️ 문서상 '요청유형'(B1GUBUN3)과 다른 축이다. B1GUBUN3 을 담는 컬럼은 없다.
 * MIGRATION = 구시스템 이관분(날짜 1900-01-01 계열의 정체)이라 목록 기본에서 감춘다.
 */
export const REQ_TYPE = {
  SERVICE: "서비스 요청",
  WORK: "작업 요청",
  MIGRATION: "이관 데이터",
} as const;

/** COMMON_CODE UPPER_CD='B0001' — MEMBER_MST.USER_TYPE */
export const USER_TYPE = {
  B0001_01: "INTERNAL",
  B0001_02: "CUSTOMER",
  B0001_03: "VENDOR",
} as const;
export type UserRole = (typeof USER_TYPE)[keyof typeof USER_TYPE];

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  INTERNAL: "운영팀",
  CUSTOMER: "고객사",
  VENDOR: "외부업체",
};

/**
 * 코드 → 라벨. 매핑에 없으면 **원문을 그대로 돌려준다.**
 * 구시스템 이관분은 코드 대신 한글 원문('재무관리')이 들어 있는 행이 있어서다.
 */
export function labelOf(
  map: Record<string, string>,
  raw: string | null | undefined,
): string {
  if (raw === null || raw === undefined) return "";
  const key = String(raw).trim();
  if (key === "") return "";
  return map[key] ?? key;
}

export function progressLabel(raw: string | null | undefined) {
  return labelOf(PROGRESS, raw);
}

export function progressTone(raw: string | null | undefined): Tone {
  const key = String(raw ?? "").trim();
  return (PROGRESS_TONE as Record<string, Tone>)[key] ?? "neutral";
}

export function isTerminal(raw: string | null | undefined) {
  return TERMINAL_PROGRESS.includes(String(raw ?? "").trim() as ProgressCode);
}

/**
 * 주 경로 5단계에서 현재 위치(0-based). 확장 경로(5~8)는 4단계(해결안제시)에
 * 머문 것으로 본다 — 주 경로만 그리기 때문.
 */
export function mainFlowIndex(raw: string | null | undefined): number {
  const p = String(raw ?? "").trim();
  const direct = MAIN_FLOW.indexOf(p as ProgressCode);
  if (direct >= 0) return direct;
  if (
    TEST_FLOW.includes(p as ProgressCode) ||
    SYSTEM_FLOW.includes(p as ProgressCode)
  )
    return 3;
  if (p === "10") return 2; // 취소요청은 진행 중에 걸린 상태
  if (p === "11" || p === "12") return -1; // 종료(취소·반려) — 게이지를 채우지 않는다
  return 0;
}

/**
 * 조회 화면 첫 진입의 기본값.
 *
 * 목록은 검색창이 아니라 **작업 큐**다 — 열자마자 "내가 지금 볼 것"이 떠 있어야 한다.
 * 그래서 내 담당 + 최근 15일로 좁혀서 시작하고, 더 봐야 하면 사용자가 넓힌다.
 * ⚠️ 파라미터가 하나도 없을 때만 적용한다 — 대시보드 카드처럼 조건을 갖고 들어오는
 *    링크를 기간으로 다시 자르면 **카드 숫자와 목록 건수가 어긋난다**.
 */
export const DEFAULT_LIST_VIEW = "mine";
export const DEFAULT_RANGE_DAYS = 15;
