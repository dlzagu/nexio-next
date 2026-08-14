import type { ProgressCode, UserRole } from "./codes";

/** 로그인 사용자. 원본 MEMBER_MST 를 정규화한 것 */
export interface User {
  id: string; // MBER_ID
  name: string; // MBER_NM
  role: UserRole; // USER_TYPE(B0001_*) → INTERNAL | CUSTOMER | VENDOR
  custCode: string; // COMPANY_CODE
  custName: string;
  dept: string | null;
  email: string | null;
  /** 승인 권한 보유자 (MEMBER_MST.APPROVER='Y') */
  isApprover: boolean;
}

/** 고객사별 기능 토글. 안 쓰는 단계를 "접는" 근거 (COMPANY_MST) */
export interface CustomerConfig {
  custCode: string;
  custName: string;
  /** SHOWYN — 계약시간 정보 노출 */
  showsContractTime: boolean;
  /** CONFYN — 승인 단계 사용 */
  usesApproval: boolean;
  /** TESTYN — 테스트 이관 단계 사용 */
  usesTestStage: boolean;
  /** SYSTEMYN — 시스템 이관 단계 사용 */
  usesSystemStage: boolean;
  /** DEF_PRIVATE_YN — 신규 신청의 기본 공개여부가 비공개인가 */
  defaultPrivate: boolean;
}

/** 목록 행 — 컬럼 7개 + 정렬/판정에 필요한 최소 필드 */
export interface TicketRow {
  echoNum: string;
  custCode: string;
  custName: string;
  title: string;
  progress: ProgressCode;
  progressRaw: string;
  systemName: string | null; // B1GUBUN → COMPANY_OPER_SYSTEM.SYSTEM_NAME
  moduleLabel: string; // MODULE → B1GUBUN2
  priority: string; // REQLEVEL 의 라벨 (PRIORLVL)
  priorityCode: string; // REQLEVEL 원본 코드 — 정렬·톤 판정용
  reqType: string; // REQTYPE (MIGRATION/SERVICE/WORK)
  requesterId: string | null;
  requesterName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  reqDate: string | null;
  scheDate: string | null;
  succDate: string | null;
  isPublic: boolean;
  commentCount: number;
  hasUnreadComment: boolean;
  workTime: number | null;
}

/** 상세 — 탭 구조와 같은 모양으로 중첩한다. 102필드를 평면으로 두지 않는다 */
export interface TicketDetail extends TicketRow {
  request: {
    content: string; // CONTENT (HTML)
    remarks: string; // REMARKS (HTML)
    reqRemarks: string; // REQREMARKS
    media: string; // MEDIA — 레거시 자유값
    refMail: string;
    isReRequest: boolean; // REREQYN
    parentEchoNum: string | null; // P_ECHONUM
  };
  solution: {
    cause: string;
    process: string;
    improvement: string;
    answer: string;
    result: string;
    devReason: string;
    devContent: string;
    okRemarks: string;
    expeTime: number | null;
    workTime: number | null;
    rWorkTime: number | null;
    surTime: number | null;
  };
  history: {
    approver: string | null;
    approvedAt: string | null;
    canceler: string | null;
    canceledAt: string | null;
    cancelReqAt: string | null;
    cancelReqBy: string | null;
    testAt: string | null;
    testCompletedAt: string | null;
    systemAt: string | null;
    finalAssignee: string | null;
    finalSuccDate: string | null;
    memos: { label: string; value: string }[];
  };
  comments: Comment[];
}

export interface Comment {
  id: number;
  userId: string;
  userName: string;
  userRole: UserRole | null;
  body: string; // HTML
  at: string | null;
  adminOnly: boolean;
  /** 시스템이 남긴 로그성 코멘트("상태 변경 [진행] → [해결안제시]") */
  isLog: boolean;
  progressAt: string | null;
}

/** 목록 뷰 — 재설계 §1. myOnlyYn 은 필터가 아니라 뷰다 */
export type ListView = "open" | "mine" | "all";

export interface TicketFilters {
  view: ListView;
  keyword: string;
  custCode: string;
  progress: string;
  from: string;
  to: string;
  /** 접어둔 상세 필터 */
  assignee: string;
  requester: string;
  module: string;
  priority: string;
  includeMigration: boolean;
}

export interface TicketListResult {
  rows: TicketRow[];
  total: number;
  /** 서버 상한에 걸려 잘렸는가 — 조용한 절단은 "정렬이 이상해요"로 돌아온다 */
  truncated: boolean;
  /** 정렬을 클라이언트에서 전량 처리할 수 있는 뷰인가 */
  clientSortable: boolean;
}

export type TicketAction =
  | "approve" // 승인 (대기 → 신청)
  | "reject" // 반려
  | "cancel" // 취소 — 🔒 신청자 본인만
  | "cancelRequest" // 취소요청 — 신청자만
  | "suggestCancel" // 취소 권유 — 담당자가 보내고, 실행은 신청자가
  | "receive" // 접수 (신청 → 진행)
  | "save" // 처리내역 저장
  | "propose" // 해결안 제시
  | "complete" // 완료
  | "testComplete" // 테스트 완료 (확장 경로)
  | "reapply" // 재신청
  | "comment"; // 댓글 작성

export interface DashboardData {
  scope: { role: UserRole; custCode: string; custName: string };
  cards: {
    myPending: number;
    inProgress: number;
    awaitingSolution: number;
    unreadComments: number;
  };
  myPending: TicketRow[];
  companyUnresolved: TicketRow[];
  trend: { month: string; created: number; completed: number }[];
  openByStatus: { code: string; label: string; n: number }[];
  completedTotal: number;
  duration: { bucket: string; n: number }[];
  topCustomers: { custCode: string; custName: string; n: number }[];
  assigneePerf: { id: string; name: string; open: number; done: number }[];
  notices: { id: string; title: string; author: string; at: string | null }[];
  recent: TicketRow[];
}
