import { SUGGEST_CANCEL_LEAD, SUGGEST_CANCEL_TAIL } from "../cancel-suggestion";
import { MODULE, labelOf, type ProgressCode } from "../codes";
import { select, write, type Param, type WriteStatement } from "../db";
import { josa, toDbStamp } from "../format";
import { isBlankHtml, sanitize } from "../sanitize";
import type { SolutionPatch } from "../schemas";
import type { TicketAction, TicketDetail, User } from "../types";
import { attachmentStatements, type IncomingFile } from "./attachments";
import { composeBody, toParagraphs } from "./request-body";

/**
 * 쓰기 경로. 조회(tickets.ts)와 같은 규칙 —
 * 🔴 원본 컬럼명(ECHONUM·SUCCERSON·IS_LOG_YN …)은 이 파일 밖으로 나가지 않는다.
 *
 * 권한 판정은 여기서 하지 않는다. 라우트가 서버에서 티켓을 다시 읽어 canDo() 로
 * 판정한 **뒤에** 이 함수들을 부른다 (판정과 실행을 한 함수에 섞으면 둘 중 하나를 빠뜨린다).
 *
 * 이력 규약: 상태가 바뀌면 NX_OPTREPORTR 에 로그행(IS_LOG_YN='Y', PPROGRESS=새 상태)을
 * **같은 트랜잭션 안에서** 남긴다. 시드가 만드는 로그행과 형식이 같아야 이력 탭이 섞이지 않는다.
 */

interface Transition {
  /** 전이 후 상태. 없으면 상태를 바꾸지 않는다 (저장·권유) */
  to?: ProgressCode;
  /** 상태와 함께 찍는 행위자·시각 컬럼 */
  stamp?: (user: User, now: string) => Record<string, string | number | null>;
  /** 사유(reason)를 담을 메모 컬럼 */
  reasonCol?: "AMEMO" | "CMEMO";
  /** 이력 로그 문구. 없으면 로그를 남기지 않는다 */
  log?: string;
  /** 이 전이에 반드시 채워져 있어야 하는 처리내역 항목 */
  requires?: { key: "answer" | "cause" | "process" | "result"; label: string };
  /**
   * 사유가 **필수**인 전이 — 값은 안내 문장에 쓰는 이름("반려 사유").
   * 되돌릴 수 없거나 상대의 요청을 거절하는 판단은 이유 없이 한 줄로 남기지 않는다.
   * 사유가 없는 반려는 신청자에게 '요청이 반려되었습니다' 한 줄만 남기고, 되물을 곳도 없다.
   */
  requiresReason?: string;
}

/**
 * 상태 전이 정본. 원본은 이 규칙이 JSP 전역에 흩어져 있었다.
 * ⚠️ 표에 없는 액션은 실행되지 않는다 (fail-closed) — 'reapply' 는 상태 전이가 아니라
 *    새 신청 생성이라 여기 없고, 화면이 신청 폼으로 보낸다.
 */
const TRANSITIONS: Partial<Record<TicketAction, Transition>> = {
  approve: {
    to: "2",
    stamp: (u, now) => ({ APPROVER: u.id, CONFIRMDT: now }),
    reasonCol: "CMEMO",
    log: "승인되어 접수되었습니다.",
  },
  reject: {
    to: "12",
    reasonCol: "AMEMO",
    requiresReason: "반려 사유",
    log: "요청이 반려되었습니다.",
  },
  cancel: {
    to: "11",
    stamp: (u, now) => ({ CANCELER: u.id, CANCELDT: now }),
    reasonCol: "AMEMO",
    log: "요청이 취소되었습니다.",
  },
  cancelRequest: {
    to: "10",
    stamp: (u, now) => ({ CANCELREQER: u.id, CANCELREQDT: now }),
    log: "신청자가 취소를 요청했습니다.",
  },
  /**
   * 취소요청(10) 에서 나가는 두 갈래.
   *
   * 🔴 들어가는 길만 있고 나가는 길이 없으면 **아무도 손댈 수 없는 티켓**이 된다 —
   *    상태 10 은 종료도 아니라 목록에 계속 남고, 화면은 "담당자에게 문의하라"고 하는데
   *    담당자도 할 수 있는 게 없었다(실측). 신청자가 버튼 하나로 만들 수 있는 막다른 길이었다.
   */
  cancelApprove: {
    to: "11",
    stamp: (u, now) => ({ CANCELER: u.id, CANCELDT: now }),
    reasonCol: "AMEMO",
    log: "취소 요청이 승인되어 요청이 취소되었습니다.",
  },
  cancelDeny: {
    // 취소하지 않고 진행으로 되돌린다 — 요청 전 상태(3)가 유일한 출발점이다
    to: "3",
    reasonCol: "AMEMO",
    // 신청자에게 '사유와 함께 처리가 계속됩니다'라고 약속했다(cancelHint) — 그 사유다
    requiresReason: "계속 진행하는 사유",
    log: "취소 요청이 반려되어 처리를 계속합니다.",
  },
  receive: {
    to: "3",
    log: "담당자가 배정되어 처리를 시작합니다.",
  },
  propose: {
    to: "4",
    /**
     * 🔴 빈 해결안을 제시할 수는 없다. 고객 화면은 이 단계부터 '처리결과' 탭이
     *    기본으로 열리는데, 열어 보니 아무것도 없으면 상태만 바뀐 셈이다.
     */
    requires: { key: "answer", label: "답변" },
    log: "해결안이 등록되었습니다. 처리결과를 확인해 주세요.",
  },
  complete: {
    to: "9",
    stamp: (u, now) => ({
      SUCCDATE: now,
      FINALSUCCER: u.id,
      FINALSUCCDATE: now,
    }),
    /**
     * 🔴 빈 처리결과로 종료하지 않는다. 해결안 제시(4)에서 답변을 지우고 저장한 뒤 완료하면
     *    고객은 빈 처리결과 탭을 받고, 종료건이라 **아무도 다시 채울 수 없다**.
     *    처리내역 없이 오는 완료(보드 드래그)는 저장된 답변으로 판정한다.
     */
    requires: { key: "answer", label: "답변" },
    log: "처리가 완료되었습니다.",
  },
  testComplete: {
    to: "6",
    stamp: (_u, now) => ({ TESTCOMDT: now }),
    log: "테스트가 완료되었습니다.",
  },
  // 상태를 바꾸지 않는 액션 — 저장할 때마다 로그가 쌓이면 이력 탭이 무의미해진다
  save: {},
  // 취소 권유는 로그가 아니라 **사람 댓글**로 남긴다.
  // 시스템 기록은 접혀 있어서, 신청자에게 미읽음으로 보여야 하는 알림이 묻힌다.
  // 사유 없는 권유는 "왜요?" 댓글 왕복을 부른다 — 권유가 줄이려던 바로 그 왕복이다.
  suggestCancel: { requiresReason: "취소를 권유하는 사유" },
};

const SOLUTION_TEXT_COLS: Record<keyof SolutionPatch, string | null> = {
  cause: "CAUSE",
  process: "PROCESS",
  improvement: "IMPROVEMENT",
  answer: "ANSWER",
  result: "RESULT",
  devReason: "DEVREASON",
  devContent: "DEVCONTENT",
  expeTime: null,
  workTime: null,
  rWorkTime: null,
  surTime: null,
};

const SOLUTION_TIME_COLS: [keyof SolutionPatch, string][] = [
  ["expeTime", "EXPETIME"],
  ["workTime", "WORKTIME"],
  ["rWorkTime", "RWORKTIME"],
  ["surTime", "SURTIME"],
];

/** 빈 문자열·음수·NaN 은 "미입력"으로 떨군다 (0 은 유효한 값이라 살린다) */
function hoursOrNull(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type Patch = Record<string, string | number | null>;

/** 컬럼명은 이 파일의 고정 목록에서만 나온다 — 클라이언트 값이 SET 절에 닿지 않는다 */
function updateTicket(echoNum: string, patch: Patch): WriteStatement {
  const cols = Object.keys(patch);
  const params: Param[] = cols.map((c) => ({ name: c, value: patch[c] }));
  params.push({ name: "echo", value: echoNum });
  return {
    sql: `UPDATE NX_OPTREPORTD
             SET ${cols.map((c) => `${c} = @${c}`).join(", ")}
           WHERE ECHONUM = @echo`,
    params,
  };
}

/**
 * 🔒 내부 전용(ADMIN_ONLY_YN) 판정을 **이 안에서** 한다 — 호출자가 잊을 수 없게.
 *    읽기 가드(getComments·notifications)가 INTERNAL 에게만 열려 있으므로 쓰기도 같은 축으로
 *    좁힌다. 축이 어긋나면 "썼는데 본인에게도 안 보이는 댓글"이 생긴다.
 */
function insertComment(opts: {
  echoNum: string;
  author: User;
  body: string;
  adminOnly: boolean;
  isLog: boolean;
  progress: string | null;
  at: string;
}): WriteStatement {
  return {
    sql: `INSERT INTO NX_OPTREPORTR
            (PECHONUM, USERID, COMMENT, COMMDATE, ADMIN_ONLY_YN, IS_LOG_YN, PPROGRESS)
          VALUES (@echo, @uid, @body, @at, @admin, @log, @pg)`,
    params: [
      { name: "echo", value: opts.echoNum },
      { name: "uid", value: opts.author.id },
      { name: "body", value: opts.body },
      { name: "at", value: opts.at },
      {
        name: "admin",
        value: opts.adminOnly && opts.author.role === "INTERNAL" ? "Y" : "N",
      },
      { name: "log", value: opts.isLog ? "Y" : "N" },
      { name: "pg", value: opts.progress },
    ],
  };
}

/**
 * 본인이 쓴 댓글이 본인에게 '미읽음'으로 보이지 않게 읽음선을 끌어올린다.
 * 방금 INSERT 한 행의 id 를 되돌려받지 않고 MAX(ID) 로 잡는다 — 같은 트랜잭션 안이라 안전하다.
 */
function touchReadState(echoNum: string, userId: string): WriteStatement {
  return {
    sql: `INSERT OR REPLACE INTO NX_OPTREPORT_READ_STATE
            (ECHONUM, USER_ID, LAST_SEEN_COMMENT_ID)
          SELECT @echo, @uid, MAX(ID) FROM NX_OPTREPORTR WHERE PECHONUM = @echo`,
    params: [
      { name: "echo", value: echoNum },
      { name: "uid", value: userId },
    ],
  };
}

/**
 * 조사 붙이기 — 괄호로 끝나는 말('정기 업무(매월 5일)')은 **괄호 앞 낱말**로 고른다.
 * 그대로 josa() 에 넘기면 끝 글자가 ')' 라 받침을 몰라 '…)을(를)' 병기형이 된다.
 */
function withJosa(word: string, pair: "을/를" | "이/가"): string {
  const base = word.replace(/\s*\([^()]*\)\s*$/, "");
  if (!base || base === word) return josa(word, pair);
  return word + josa(base, pair).slice(base.length);
}

/** 전이에 필요한 처리내역이 비어 있다 — 라우트가 400 으로 돌려준다 */
export class SolutionRequiredError extends Error {
  constructor(public readonly label: string) {
    super(`${josa(label, "을/를")} 입력해야 이 단계로 넘어갈 수 있습니다.`);
    this.name = "SolutionRequiredError";
  }
}

/** 사유가 필수인 전이에 사유가 없다 — 라우트가 400 으로 돌려준다 */
export class ReasonRequiredError extends Error {
  constructor(public readonly label: string) {
    super(`${josa(label, "을/를")} 입력해 주세요.`);
    this.name = "ReasonRequiredError";
  }
}

/**
 * 내부 전용 글에 첨부를 붙이려 했다.
 *
 * 🔒 첨부 표(NX_OPTREPORT_FILE)에는 '어느 댓글에서 왔는지'가 없어 첨부는 **티켓 단위로**
 *    공개된다. 글은 내부 전용 가드로 숨는데 파일은 첨부 탭·다운로드로 고객사와 외부업체에게
 *    열린다. 매핑(파일 → 댓글·공개 범위)이 생기기 전까지는 **받지 않는 것**이 유일하게 안전하다.
 */
export class InternalAttachmentError extends Error {
  constructor() {
    super(
      "내부 전용 댓글에는 파일을 첨부할 수 없습니다. 첨부는 고객사에게도 보이므로, 공개 댓글로 올리거나 첨부를 빼 주세요.",
    );
    this.name = "InternalAttachmentError";
  }
}

export class UnsupportedActionError extends Error {
  constructor(action: string) {
    super(`지원하지 않는 액션입니다: ${action}`);
    this.name = "UnsupportedActionError";
  }
}

/** 이 계층이 실행할 수 있는 액션인가 — 'reapply' 처럼 전이가 아닌 것은 신청 폼으로 간다 */
export function supportsAction(action: TicketAction): boolean {
  return action === "comment" || !!TRANSITIONS[action];
}

/**
 * 이 전이에 필요한데 비어 있는 처리내역 항목의 라벨. 없으면 null.
 *
 * 라우트가 **쓰기 게이트 앞에서** 부르고, applyAction 이 마지막에 한 번 더 부른다 —
 * 쓰기가 꺼져 있어도 "무엇을 채워야 하는지"는 알려줘야 하기 때문이다(첨부 검증과 같은 축).
 * 이번에 함께 보낸 초안이 있으면 그것을, 없으면 이미 저장된 값을 본다.
 */
export function missingSolutionField(
  action: TicketAction,
  solution: SolutionPatch | undefined,
  ticket: TicketDetail,
): string | null {
  const requires = TRANSITIONS[action]?.requires;
  if (!requires) return null;
  const value = solution
    ? solution[requires.key]
    : ticket.solution[requires.key];
  return isBlankHtml(value) ? requires.label : null;
}

/**
 * 실행 전 입력 판정 — **아무것도 쓰지 않고 던지기만** 한다.
 *
 * 라우트가 쓰기 게이트 **앞에서** 부르고(쓰기가 꺼져 있어도 무엇이 틀렸는지는 알려준다 —
 * 202 로 '통과'를 알리면 사용자는 맞게 쓴 줄 안다), applyAction·addComment 가 한 번 더
 * 부른다(마지막 방어선). 규칙이 한 함수에 있어서 두 곳이 서로 다른 기준을 볼 수 없다.
 */
export function assertActionInput(opts: {
  ticket: TicketDetail;
  action: TicketAction;
  solution?: SolutionPatch;
  reason?: string;
  comment?: { adminOnly: boolean; files?: IncomingFile[] };
}): void {
  const { ticket, action, solution, reason, comment } = opts;
  if (!supportsAction(action)) throw new UnsupportedActionError(action);

  const missing = missingSolutionField(action, solution, ticket);
  if (missing) throw new SolutionRequiredError(missing);

  const reasonLabel = TRANSITIONS[action]?.requiresReason;
  if (reasonLabel && !reason?.trim()) {
    throw new ReasonRequiredError(reasonLabel);
  }

  assertCommentAttachable(comment);
}

/** 내부 전용 글 + 첨부 = 거부 (InternalAttachmentError 주석) */
function assertCommentAttachable(
  comment: { adminOnly: boolean; files?: IncomingFile[] } | undefined,
): void {
  // 역할과 무관하게 '내부 전용으로 올려 달라'는 요청 자체를 본다 — 요청과 결과가 어긋나는
  // 저장(외부업체의 내부 전용 체크가 공개로 강등되며 첨부까지 공개)을 조용히 하지 않는다
  if (comment?.adminOnly && (comment.files?.length ?? 0) > 0) {
    throw new InternalAttachmentError();
  }
}

export interface ActionResult {
  /** 실행 후 상태 (상태를 바꾸지 않는 액션이면 원래 값) */
  progress: ProgressCode;
  changed: boolean;
}

/**
 * 액션 실행. 상태 전이 + 처리내역 저장 + 댓글을 **한 트랜잭션**으로 처리한다.
 *
 * @param solution 라우트가 canDo('save') 를 통과시킨 경우에만 넘긴다
 */
export async function applyAction(opts: {
  ticket: TicketDetail;
  user: User;
  action: TicketAction;
  solution?: SolutionPatch;
  comment?: { body: string; adminOnly: boolean; files?: IncomingFile[] };
  /** 접수 시 확정한 분류. 라우트가 고객사 소속·코드 유효성을 검증한 뒤에만 넘긴다 */
  triage?: {
    systemId?: string;
    systemName?: string;
    moduleCode?: string;
    expeTime?: number;
    scheDate?: string;
  };
  reason?: string;
}): Promise<ActionResult> {
  const { ticket, user, action, solution, comment, reason, triage } = opts;

  // 마지막 방어선. 같은 판정을 라우트가 **쓰기 게이트 앞에서** 한 번 더 한다
  assertActionInput({ ticket, action, solution, reason, comment });

  if (action === "comment") {
    if (!comment) throw new UnsupportedActionError("comment (본문 없음)");
    await addComment({ echoNum: ticket.echoNum, user, ...comment });
    return { progress: ticket.progress, changed: true };
  }

  const rule = TRANSITIONS[action];
  if (!rule) throw new UnsupportedActionError(action);

  const now = toDbStamp();
  const statements: WriteStatement[] = [];
  const patch: Patch = {};

  /** 접수하며 담당을 가져온 상대 — 이력 문구에 쓴다 */
  let handedOverFrom: string | null = null;

  if (rule.to) {
    patch.PROGRESS = rule.to;
    Object.assign(patch, rule.stamp?.(user, now) ?? {});
    /**
     * 접수 = **인계**다. 접수한 사람이 담당자가 된다.
     *
     * 미배정만 가져가고 배정된 건은 두면, 남의 건을 접수한 사람이 그다음 단계에서
     * 막힌다(save·propose·complete 가 '담당자만'이라서). 그래서 항상 가져온다.
     * 🔴 남의 배정을 옮기는 일이므로 **누구에게서 가져왔는지 이력에 남긴다.**
     *
     * ⚠️ 이력까지만이다 — 원래 담당자에게 **알림은 보내지 않는다.**
     *    현업에서는 담당자를 지정하지 않고 신청하는 경우가 대부분이라(사용자 확인),
     *    접수는 사실상 '최초 배정'이고 인계는 예외 케이스다. 알림 축(신청자·현재 담당자)을
     *    '이전 담당자'까지 넓히는 값이 그 빈도에 비해 크지 않다.
     *    → 지정 신청이 흔해지면 그때 다시 본다.
     */
    if (action === "receive" && ticket.assigneeId !== user.id) {
      patch.SUCCERSON = user.id;
      handedOverFrom = ticket.assigneeName ?? ticket.assigneeId;
    }
  }

  /**
   * 접수하면서 분류를 확정한다. **빈 값은 건드리지 않는다** — 지우기가 아니라 유지다.
   * 무엇을 바꿨는지는 이력 로그에 남긴다(안 남기면 "누가 언제 분류를 바꿨나"를 알 수 없다).
   */
  const triaged: string[] = [];
  if (action === "receive" && triage) {
    if (triage.systemId) {
      patch.B1GUBUN = Number(triage.systemId);
      triaged.push(`운영시스템 ${triage.systemName ?? triage.systemId}`);
    }
    if (triage.moduleCode) {
      patch.MODULE = triage.moduleCode;
      triaged.push(`모듈 ${labelOf(MODULE, triage.moduleCode)}`);
    }
    if (typeof triage.expeTime === "number") {
      patch.EXPETIME = triage.expeTime;
      triaged.push(`예상 ${triage.expeTime}h`);
    }
    if (triage.scheDate) {
      patch.SCHEDATE = `${triage.scheDate} 00:00:00`;
      triaged.push(`예상 처리일 ${triage.scheDate}`);
    }
  }
  if (rule.reasonCol && reason?.trim()) {
    // 사유는 평문 칸이다 — 꺾쇠가 태그로 읽혀 잘리지 않게 평문 변환 정본을 지난다
    patch[rule.reasonCol] = sanitize(toParagraphs(reason));
  }

  if (solution) {
    for (const [key, col] of Object.entries(SOLUTION_TEXT_COLS)) {
      if (!col) continue;
      // 🔒 저장 시점에도 새니타이즈한다. 읽기에서만 거르면 저장된 마크업이 그대로 남는다.
      patch[col] = sanitize(solution[key as keyof SolutionPatch]);
    }
    for (const [key, col] of SOLUTION_TIME_COLS) {
      patch[col] = hoursOrNull(solution[key]);
    }
  }

  if (Object.keys(patch).length > 0) {
    statements.push(updateTicket(ticket.echoNum, patch));
  }
  if (rule.log) {
    statements.push(
      insertComment({
        echoNum: ticket.echoNum,
        author: user,
        body: [
          handedOverFrom
            ? `${rule.log} (${handedOverFrom} → ${user.name} 인계)`
            : rule.log,
          triaged.length ? `(${triaged.join(" · ")})` : null,
        ]
          .filter(Boolean)
          .join(" "),
        adminOnly: false,
        isLog: true,
        progress: rule.to ?? ticket.progress,
        at: now,
      }),
    );
  }
  if (action === "suggestCancel") {
    /**
     * 권유는 신청자가 **지금 누를 수 있는 버튼**을 가리킨다. 권유는 신청자에게 취소 수단이
     * 있는 단계(1~3)에서만 열린다(canDo) — 수단이 없는 단계에서 권유하면 권유는 "신청자만
     * 취소할 수 있다", 신청자 화면은 "담당자에게 문의하라"로 서로를 가리키는 순환이 된다.
     */
    const how =
      ticket.progress === "3"
        ? "상단의 '취소 요청'을 누르면 담당자 확인 후 취소됩니다."
        : "상단의 '취소'를 누르면 바로 취소됩니다.";
    statements.push(
      insertComment({
        echoNum: ticket.echoNum,
        author: user,
        body: sanitize(
          // 화면의 권유 카드가 이 두 문장으로 판별한다 — 문구는 상수만 고친다
          `<p>${SUGGEST_CANCEL_LEAD}</p>` +
            toParagraphs(reason ?? "") +
            `<p>${SUGGEST_CANCEL_TAIL} 할 수 있습니다 — ${how}</p>`,
        ),
        adminOnly: false,
        isLog: false,
        progress: null,
        at: now,
      }),
    );
    statements.push(touchReadState(ticket.echoNum, user.id));
  }
  if (comment?.body?.trim()) {
    statements.push(
      insertComment({
        echoNum: ticket.echoNum,
        author: user,
        body: sanitize(comment.body),
        adminOnly: comment.adminOnly,
        isLog: false,
        progress: null,
        at: now,
      }),
    );
    // 첨부는 댓글과 **같은 트랜잭션**에 실린다 — 따로 커밋하면 한쪽만 남는다
    if (comment.files?.length) {
      statements.push(
        ...attachmentStatements({
          echoNum: ticket.echoNum,
          user,
          files: comment.files,
          at: now,
        }),
      );
    }
    statements.push(touchReadState(ticket.echoNum, user.id));
  }

  const changes = await write(statements);
  return {
    progress: rule.to ?? ticket.progress,
    changed: changes.some((n) => n > 0),
  };
}

export async function addComment(opts: {
  echoNum: string;
  user: User;
  body: string;
  adminOnly: boolean;
  files?: IncomingFile[];
}): Promise<void> {
  // 🔒 applyAction 을 거치지 않는 호출자도 같은 판정을 지난다 (호출자가 잊을 수 없게)
  assertCommentAttachable(opts);
  const at = toDbStamp();
  await write([
    insertComment({
      echoNum: opts.echoNum,
      author: opts.user,
      body: sanitize(opts.body),
      adminOnly: opts.adminOnly,
      isLog: false,
      progress: null,
      at,
    }),
    ...attachmentStatements({
      echoNum: opts.echoNum,
      user: opts.user,
      files: opts.files ?? [],
      at,
    }),
    touchReadState(opts.echoNum, opts.user.id),
  ]);
}

/* ── 신청 저장 ─────────────────────────────────────────────── */

export interface NewRequestInput {
  /** 첨부 파일 (검증은 attachmentStatements 안에서 한 번 더 한다) */
  files?: IncomingFile[];
  /**
   * 이 티켓과 **함께 커밋해야 하는** 문장 (정기 업무 템플릿 저장·생성월 갱신).
   * 첨부와 같은 축이다 — 나눠 커밋하면 "티켓은 생겼는데 반복 등록은 안 된" 상태가 남고,
   * 사용자는 등록됐다고 믿는다.
   */
  extra?: WriteStatement[];
  custCode: string;
  requesterId: string;
  systemId: string;
  title: string;
  /** 평문(textarea). 저장 때 이스케이프해 문단으로 감싼다 (toParagraphs) */
  symptom: string;
  content: string;
  /**
   * **이미 문단 HTML 인** 본문 — 정기 업무 템플릿처럼 저장된 HTML 을 다시 쓰는 경우.
   * 주면 symptom·content 조립을 건너뛴다. 평문 경로에 HTML 을 넣으면 태그가 글자로 보인다.
   */
  bodyHtml?: string;
  moduleCode: string;
  priority: string;
  scheDate: string;
  isPublic: boolean;
  refEmails: string[];
  /** 재신청 원본 (없으면 신규) */
  parentEchoNum: string | null;
  /** 고객사가 승인 단계를 쓰는가 — 쓰면 대기(1), 아니면 바로 신청(2)으로 접수된다 */
  usesApproval: boolean;
  /**
   * 운영팀이 대신 넣는 건일 때의 출처·성격. 없으면 고객사가 포털로 넣은 평범한 신청이다.
   *
   * 🔴 대리 등록은 **승인 단계를 타지 않는다.** 승인은 고객사가 자기 신청을 올릴 때
   *    자기 쪽 승인권자에게 받는 절차인데, 우리가 받아 적은 건을 대기(1)에 두면
   *    고객사 승인권자가 승인해 주기 전까지 아무도 진행시킬 수 없다
   *    (시드가 같은 실수를 해서 '대기' 8건이 갇혔었다).
   */
  intake?: {
    /** MEDIA — 전화·이메일·내부 */
    media: string;
    /** REQTYPE — 고객 문의는 SERVICE, 우리가 발의한 작업은 WORK */
    reqType: "SERVICE" | "WORK";
    /**
     * 등록 시점의 단계. 현업은 **끝난 뒤에 기록하기도 한다** —
     * 전화로 받아 그 자리에서 처리하고 나중에 적는 경우가 흔해서, 진행 중인 건과
     * 이미 끝난 건을 그 상태 그대로 만들 수 있어야 한다.
     *   2 신청(접수 전) · 3 진행 · 4 해결안 제시 · 9 완료
     */
    stage: "2" | "3" | "4" | "9";
    /**
     * 담당자. 접수 이후 단계(3·4·9)는 담당이 있어야 한다 —
     * 없으면 그다음 액션이 전부 '담당자만' 조건에 걸려 아무도 손댈 수 없다.
     */
    assignTo: string | null;
    /**
     * 처리 내용(답변). 4·9 로 등록할 때 채워진다.
     * 🔴 비면 안 된다 — 그 단계부터 고객 화면은 '처리결과' 탭이 기본으로 열린다.
     */
    answer?: string;
    /** 완료 시각(벽시계). 9 로 등록할 때만. 비우면 지금 */
    doneAt?: string;
    /** 실제 작업 시간(h) */
    workTime?: number | null;
    /** 담당자 표시명 — 이력 문구가 아이디가 아니라 사람 이름으로 읽히게 */
    assignToName?: string | null;
    /** 이력에 남길 출처 문구 ("전화 문의") */
    sourceLabel: string;
  };
}

/**
 * 접수번호 채번. 형식은 시드와 동일한 `<접두>-<YYYYMM>-<일련 3자리>`.
 * 접두는 COMPANY_MST 에 없어서(원본에도 없다) **그 고객사의 기존 번호에서 이어받는다.**
 * 첫 번호가 없는 고객사는 코드 앞 두 글자로 시작한다.
 *
 * @param reqDate 이 건의 REQDATE 스탬프('YYYY-MM-DD HH:MM:SS'). 🔴 Date 를 받아 로컬 필드로
 *   연·월을 뽑으면 서버(UTC)에서 KST 월초 새벽의 요청이 **지난달 번호**를 받는다 —
 *   REQDATE 는 10월인데 번호는 9월. 번호와 신청일이 같은 문자열에서 나오게 한다.
 */
async function nextEchoNum(custCode: string, reqDate: string): Promise<string> {
  const seen = await select<{ ECHONUM: string }>(
    `SELECT ECHONUM FROM NX_OPTREPORTD WHERE CUSTCODE = @cc
      ORDER BY REQDATE DESC, ECHONUM DESC LIMIT 1`,
    [{ name: "cc", value: custCode }],
  );
  const prefix =
    seen[0]?.ECHONUM.split("-")[0] ||
    custCode
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 2)
      .toUpperCase() ||
    "NX";
  const key = `${prefix}-${reqDate.slice(0, 4)}${reqDate.slice(5, 7)}`;

  const last = await select<{ ECHONUM: string }>(
    `SELECT ECHONUM FROM NX_OPTREPORTD WHERE ECHONUM LIKE @k
      ORDER BY ECHONUM DESC LIMIT 1`,
    [{ name: "k", value: `${key}-%` }],
  );
  const prevSeq = Number(last[0]?.ECHONUM.slice(key.length + 1));
  const seq = Number.isFinite(prevSeq) ? prevSeq + 1 : 1;
  return `${key}-${String(seq).padStart(3, "0")}`;
}

export async function createTicket(
  input: NewRequestInput,
  user: User,
): Promise<{ echoNum: string; progress: ProgressCode }> {
  // 시계는 하나 — 한국 벽시계 스탬프 하나에서 신청일·번호·이력 시각이 모두 나온다
  const now = toDbStamp();
  const proxy = input.intake;
  /**
   * 승인 단계를 쓰는 고객사는 대기(1)에서 승인권자를 기다린다.
   * 대리 등록은 그 줄에 세우지 않는다 — 위 intake 주석 참고.
   */
  const progress: ProgressCode = proxy
    ? proxy.stage
    : input.usesApproval
      ? "1"
      : "2";
  /** 완료로 기록하는 건이면 그 시각이 곧 완료일이다 (안 주면 지금) */
  const doneAt = progress === "9" ? (proxy?.doneAt ?? now) : null;
  /**
   * 🔴 끝낸 날보다 늦게 **받았다고** 적지 않는다. 지난 일을 나중에 기록하면(전화로 받아
   * 그 자리에서 처리한 건) 받은 날 = 끝낸 날이다. 신청일을 '지금'으로 두면 완료일 < 신청일이
   * 되어 처리기간이 음수가 되고, 대시보드의 '1일 이내'로 잘못 들어간다.
   * 번호의 연·월도 이 신청일을 따른다 (nextEchoNum 주석).
   */
  const reqDate = doneAt && doneAt < now ? doneAt : now;
  const echoNum = await nextEchoNum(input.custCode, reqDate);

  const content = sanitize(
    input.bodyHtml ?? composeBody(input.symptom, input.content),
  );

  await write([
    {
      sql: `INSERT INTO NX_OPTREPORTD
              (ECHONUM, CUSTCODE, TITLE, CONTENT, REMARKS, PROGRESS, B1GUBUN, MODULE,
               REQLEVEL, REQTYPE, CUSTPERSON, SUCCERSON, REQDATE, SCHEDATE, PUBLICYN, MEDIA,
               REFMAIL, REREQYN, P_ECHONUM, EXPETIME,
               ANSWER, WORKTIME, SUCCDATE, FINALSUCCER, FINALSUCCDATE)
            VALUES (@echo, @cc, @title, @content, @remarks, @pg, @sys, @module,
                    @level, @reqtype, @person, @assignee, @reqdate, @sche, @public, @media,
                    @refmail, @rereq, @parent, NULL,
                    @answer, @worktime, @succdate, @finalsucc, @succdate)`,
      params: [
        { name: "echo", value: echoNum },
        { name: "cc", value: input.custCode },
        { name: "title", value: input.title.trim() },
        { name: "content", value: content },
        // 목록 미리보기가 TITLE 이 빈 행에서 REMARKS 를 쓴다 → 증상 앞부분을 넣어 둔다
        { name: "remarks", value: sanitize(toParagraphs(input.symptom)) },
        { name: "pg", value: progress },
        { name: "sys", value: Number(input.systemId) },
        { name: "module", value: input.moduleCode || null },
        { name: "level", value: input.priority || "3" },
        { name: "reqtype", value: proxy?.reqType ?? "SERVICE" },
        { name: "media", value: proxy?.media ?? "포털" },
        { name: "person", value: input.requesterId },
        // 대리 등록에서 담당을 정했으면 접수까지 끝난 셈이라 담당자를 함께 찍는다
        { name: "assignee", value: proxy?.assignTo ?? null },
        { name: "reqdate", value: reqDate },
        {
          name: "sche",
          value: input.scheDate ? `${input.scheDate} 00:00:00` : null,
        },
        { name: "public", value: input.isPublic ? "Y" : "N" },
        { name: "refmail", value: input.refEmails.join(", ") || null },
        { name: "rereq", value: input.parentEchoNum ? "Y" : "N" },
        { name: "parent", value: input.parentEchoNum },
        // 처리결과는 저장 시점에도 새니타이즈한다 — 렌더할 때만 거르면 언젠가 새는 경로가 생긴다
        {
          name: "answer",
          value: proxy?.answer?.trim()
            ? sanitize(toParagraphs(proxy.answer))
            : null,
        },
        { name: "worktime", value: proxy?.workTime ?? null },
        /**
         * 완료일이 없으면 '최근 완료' 목록(SUCCDATE 기준)과 보드의 완료 컬럼에서
         * 통째로 빠진다 — 완료로 만들었는데 어디에도 안 보이는 티켓이 된다.
         */
        { name: "succdate", value: doneAt },
        {
          name: "finalsucc",
          value: doneAt ? (proxy?.assignTo ?? user.id) : null,
        },
      ],
    },
    insertComment({
      echoNum,
      author: user,
      /**
       * 이력 첫 줄이 **어디서 온 건인지** 말한다. 대리 등록은 포털 기록이 없어서,
       * 여기 안 남기면 나중에 "이 건 누가 왜 만들었나"를 알 방법이 사라진다.
       */
      body: proxy
        ? `${withJosa(proxy.sourceLabel, "을/를")} ${withJosa(user.name, "이/가")} 대신 등록했습니다.` +
          (proxy.assignTo
            ? ` 담당자는 ${proxy.assignToName ?? proxy.assignTo}입니다.`
            : "") +
          /**
           * 지나간 일을 지금 일어난 것처럼 적지 않는다 — 끝난 뒤에 기록한 건이면
           * 이력이 그렇게 말해야 나중에 "왜 접수와 완료가 같은 시각인가"에 답할 수 있다.
           */
          (progress === "9"
            ? ` 이미 처리가 끝난 건으로 기록합니다 (완료 ${(doneAt ?? now).slice(0, 10)}).`
            : progress === "4"
              ? " 해결안을 제시한 상태로 기록합니다."
              : "")
        : progress === "1"
          ? "신청이 등록되어 승인을 기다리고 있습니다."
          : "신청이 접수되었습니다.",
      adminOnly: false,
      isLog: true,
      progress,
      at: now,
    }),
    // 신청과 첨부는 **같은 트랜잭션**이다 — 나눠 커밋하면 첨부 없는 신청이 남는다
    ...attachmentStatements({
      echoNum,
      user,
      files: input.files ?? [],
      at: now,
    }),
    ...(input.extra ?? []),
  ]);

  return { echoNum, progress };
}
