import type { ProgressCode } from "../codes";
import { select, write, type Param, type WriteStatement } from "../db";
import { toDbStamp } from "../format";
import { sanitize } from "../sanitize";
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
  receive: {
    to: "3",
    log: "담당자가 배정되어 처리를 시작합니다.",
  },
  propose: {
    to: "4",
    log: "해결안이 등록되었습니다. 처리결과를 확인해 주세요.",
  },
  complete: {
    to: "9",
    stamp: (u, now) => ({
      SUCCDATE: now,
      FINALSUCCER: u.id,
      FINALSUCCDATE: now,
    }),
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
  suggestCancel: {},
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

export class UnsupportedActionError extends Error {
  constructor(action: string) {
    super(`지원하지 않는 액션입니다: ${action}`);
    this.name = "UnsupportedActionError";
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
  reason?: string;
}): Promise<ActionResult> {
  const { ticket, user, action, solution, comment, reason } = opts;

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

  if (rule.to) {
    patch.PROGRESS = rule.to;
    Object.assign(patch, rule.stamp?.(user, now) ?? {});
    // 미배정 건을 접수하면 접수한 사람이 담당자가 된다. 이미 배정돼 있으면 건드리지 않는다.
    if (action === "receive" && !ticket.assigneeId) patch.SUCCERSON = user.id;
  }
  if (rule.reasonCol && reason?.trim()) {
    patch[rule.reasonCol] = sanitize(`<p>${reason.trim()}</p>`);
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
        body: rule.log,
        adminOnly: false,
        isLog: true,
        progress: rule.to ?? ticket.progress,
        at: now,
      }),
    );
  }
  if (action === "suggestCancel") {
    const tail = reason?.trim() ? ` ${reason.trim()}` : "";
    statements.push(
      insertComment({
        echoNum: ticket.echoNum,
        author: user,
        body: sanitize(
          `<p>담당자가 요청 취소를 권유했습니다.${tail}</p>` +
            `<p>취소 실행은 신청자 본인만 할 수 있습니다.</p>`,
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
  custCode: string;
  requesterId: string;
  systemId: string;
  title: string;
  symptom: string;
  content: string;
  moduleCode: string;
  priority: string;
  scheDate: string;
  isPublic: boolean;
  refEmails: string[];
  /** 재신청 원본 (없으면 신규) */
  parentEchoNum: string | null;
  /** 고객사가 승인 단계를 쓰는가 — 쓰면 대기(1), 아니면 바로 신청(2)으로 접수된다 */
  usesApproval: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 접수번호 채번. 형식은 시드와 동일한 `<접두>-<YYYYMM>-<일련 3자리>`.
 * 접두는 COMPANY_MST 에 없어서(원본에도 없다) **그 고객사의 기존 번호에서 이어받는다.**
 * 첫 번호가 없는 고객사는 코드 앞 두 글자로 시작한다.
 */
async function nextEchoNum(custCode: string, at: Date): Promise<string> {
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
  const key = `${prefix}-${at.getFullYear()}${pad2(at.getMonth() + 1)}`;

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
  const at = new Date();
  const now = toDbStamp(at);
  const echoNum = await nextEchoNum(input.custCode, at);
  // 승인 단계를 쓰는 고객사는 대기(1)에서 승인권자를 기다린다
  const progress: ProgressCode = input.usesApproval ? "1" : "2";

  const content = sanitize(composeBody(input.symptom, input.content));

  await write([
    {
      sql: `INSERT INTO NX_OPTREPORTD
              (ECHONUM, CUSTCODE, TITLE, CONTENT, REMARKS, PROGRESS, B1GUBUN, MODULE,
               REQLEVEL, REQTYPE, CUSTPERSON, REQDATE, SCHEDATE, PUBLICYN, MEDIA,
               REFMAIL, REREQYN, P_ECHONUM, EXPETIME)
            VALUES (@echo, @cc, @title, @content, @remarks, @pg, @sys, @module,
                    @level, 'SERVICE', @person, @reqdate, @sche, @public, '포털',
                    @refmail, @rereq, @parent, NULL)`,
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
        { name: "person", value: input.requesterId },
        { name: "reqdate", value: now },
        {
          name: "sche",
          value: input.scheDate ? `${input.scheDate} 00:00:00` : null,
        },
        { name: "public", value: input.isPublic ? "Y" : "N" },
        { name: "refmail", value: input.refEmails.join(", ") || null },
        { name: "rereq", value: input.parentEchoNum ? "Y" : "N" },
        { name: "parent", value: input.parentEchoNum },
      ],
    },
    insertComment({
      echoNum,
      author: user,
      body:
        progress === "1"
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
  ]);

  return { echoNum, progress };
}
