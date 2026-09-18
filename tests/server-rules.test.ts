// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 서버 규칙 — 권한·입력·데이터 불변식을 **라우트와 데이터 계층에서** 고정한다.
 *
 * 화면이 버튼을 숨기거나 칸을 막는 것은 표시일 뿐이다. 이 파일은 각 규칙이
 * "직접 불러도 거부된다"와 "저장된 값이 그 규칙대로다"를 함께 본다.
 * (감사 항목 번호를 describe 제목에 남긴다 — 왜 생긴 테스트인지 찾아갈 수 있게)
 *
 * ⚠️ 상태를 바꾸는 테스트는 **각자 다른 티켓**을 집는다(pick). 필요한 상태는 시드에서
 *    우연히 찾지 않고 UPDATE 로 만든다 — 시드 구성이 바뀌어도 전제가 무너지지 않게.
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

const session = vi.hoisted(() => ({ userId: "sy.kim" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "nx_user" ? { value: session.userId } : undefined,
  }),
}));

import { GET as getNotifications } from "@/app/api/notifications/route";
import { POST as postNotifications } from "@/app/api/notifications/route";
import { POST as postRequest } from "@/app/api/requests/route";
import { POST as postTask } from "@/app/api/tasks/route";
import { GET as getTemplates } from "@/app/api/tasks/templates/route";
import { POST as runTemplates } from "@/app/api/tasks/templates/run/route";
import { POST as postAction } from "@/app/api/tickets/[echoNum]/action/route";
import { GET as getTicketRoute } from "@/app/api/tickets/[echoNum]/route";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@/lib/attachments";
import { PROGRESS, type ProgressCode } from "@/lib/codes";
import {
  AttachmentError,
  validateUploads,
  type IncomingFile,
} from "@/lib/data/attachments";
import { getDashboard } from "@/lib/data/dashboard";
import {
  addComment,
  applyAction,
  InternalAttachmentError,
  SolutionRequiredError,
} from "@/lib/data/mutations";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/data/notifications";
import { composeBody, toParagraphs } from "@/lib/data/request-body";
import { getTicket, listTickets } from "@/lib/data/tickets";
import { select, write } from "@/lib/db";
import { decodeEntities, todaySeoul } from "@/lib/format";
import { canDo, cancelHint } from "@/lib/permissions";
import { sanitize } from "@/lib/sanitize";
import {
  actionSchema,
  requestFormSchema,
  taskIntakeSchema,
} from "@/lib/schemas";
import { loadUser } from "@/lib/session";
import type {
  CustomerConfig,
  TicketFilters,
  TicketRow,
  User,
} from "@/lib/types";

/* ── 도구 ─────────────────────────────────────────────────── */

const as = (id: string) => {
  session.userId = id;
};

const req = (v: unknown, method = "POST") =>
  new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(v),
  });

const ctx = <T extends object>(params: T) => ({
  params: Promise.resolve(params),
});

interface Body {
  code?: string;
  message?: string;
  progress?: string;
  echoNum?: string;
  created?: string[];
  changed?: number;
  templates?: unknown[];
  items?: { echoNum: string }[];
  total?: number;
}
const json = async (res: Response) => (await res.json()) as Body;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const txt = (name: string, body: string) => ({
  name,
  mime: "text/plain",
  data: b64(body),
});

const filters = (over: Partial<TicketFilters> = {}): TicketFilters => ({
  view: "all",
  keyword: "",
  custCode: "",
  progress: "",
  from: "",
  to: "",
  assignee: "",
  requester: "",
  module: "",
  priority: "",
  includeMigration: false,
  ...over,
});

const blankSolution = {
  cause: "",
  process: "",
  improvement: "",
  answer: "",
  result: "",
  devReason: "",
  devContent: "",
  expeTime: "",
  workTime: "",
  rWorkTime: "",
  surTime: "",
};

/** 렌더된 HTML 을 사람이 읽는 글자로 — 태그를 걷고 엔티티를 푼다 */
const visible = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ""));

/** 테스트끼리 같은 티켓을 물지 않게 */
const taken = new Set<string>();
async function pick(where: string): Promise<string> {
  const rows = await select<{ ECHONUM: string }>(
    `SELECT ECHONUM FROM NX_OPTREPORTD
      WHERE ${where} AND COALESCE(REQTYPE,'') <> 'MIGRATION'
      ORDER BY ECHONUM`,
  );
  const hit = rows.find((r) => !taken.has(r.ECHONUM));
  if (!hit) throw new Error("시드에 해당 티켓이 없다: " + where);
  taken.add(hit.ECHONUM);
  return hit.ECHONUM;
}

/** 필요한 상태를 직접 만든다 — 컬럼명은 테스트 고정값이라 SET 절에 그대로 둔다 */
async function setTicket(echoNum: string, patch: Record<string, string>) {
  const cols = Object.keys(patch);
  await write([
    {
      sql: `UPDATE NX_OPTREPORTD SET ${cols.map((c) => `${c} = @${c}`).join(", ")}
             WHERE ECHONUM = @echo`,
      params: [
        ...cols.map((c) => ({ name: c, value: patch[c] })),
        { name: "echo", value: echoNum },
      ],
    },
  ]);
}

async function col(echoNum: string, column: string): Promise<string | null> {
  const rows = await select<Record<string, string | null>>(
    `SELECT ${column} AS v FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
    [{ name: "e", value: echoNum }],
  );
  return rows[0]?.v ?? null;
}

async function counts(echoNum: string) {
  const [c, f] = await Promise.all([
    select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM NX_OPTREPORTR WHERE PECHONUM = @e",
      [{ name: "e", value: echoNum }],
    ),
    select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM NX_OPTREPORT_FILE WHERE PECHONUM = @e",
      [{ name: "e", value: echoNum }],
    ),
  ]);
  return { comments: Number(c[0].n), files: Number(f[0].n) };
}

/** 쓰기 잠금 상태에서 돌린다 — 202 경로에서도 판정이 먼저인지 본다 */
async function locked<T>(run: () => Promise<T>): Promise<T> {
  const prev = process.env.ALLOW_DEV_WRITES;
  process.env.ALLOW_DEV_WRITES = "false";
  try {
    return await run();
  } finally {
    process.env.ALLOW_DEV_WRITES = prev;
  }
}

async function me(id: string): Promise<User> {
  const u = await loadUser(id);
  if (!u) throw new Error("시드에 계정이 없다: " + id);
  return u;
}

async function systemOf(custCode: string): Promise<string> {
  const rows = await select<{ OPER_SYS_ID: number }>(
    `SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM WHERE COMPANY_CODE = @cc
      AND COALESCE(USE_YN,'Y')='Y' AND COALESCE(DEL_YN,'N')<>'Y' LIMIT 1`,
    [{ name: "cc", value: custCode }],
  );
  return String(rows[0].OPER_SYS_ID);
}

/** 한빛제약(승인·테스트 단계를 쓰는 고객사)의 고객 계정 — 이름을 박지 않고 시드에서 찾는다 */
let hb: { requester: string; colleague: string; approver: string };
let sjSystem: string;

const requestForm = (over: Record<string, unknown> = {}) => ({
  custCode: "SJ001",
  requesterId: "sj.moon",
  requesterEmail: "sj.moon@sejin.example",
  systemId: sjSystem,
  title: "서버 규칙 테스트 신청",
  symptom: "증상",
  content: "내용",
  moduleCode: "",
  priority: "3",
  scheDate: "",
  isPublic: false,
  refEmails: [],
  attachments: [],
  ...over,
});

beforeAll(async () => {
  await select("SELECT 1 AS ok");
  // 이 파일이 기대는 고객사 설정을 명시한다 (시드가 바뀌어도 전제가 흔들리지 않게)
  await write([
    {
      sql: "UPDATE COMPANY_MST SET CONFYN='Y', TESTYN='Y' WHERE COMPANY_CODE='HB001'",
    },
  ]);
  const members = await select<{ MBER_ID: string; APPROVER: string | null }>(
    `SELECT MBER_ID, APPROVER FROM MEMBER_MST
      WHERE COMPANY_CODE='HB001' AND USER_TYPE='B0001_02'
        AND COALESCE(ACTIVE,'Y')='Y' ORDER BY MBER_ID`,
  );
  const plain = members.filter((m) => (m.APPROVER ?? "").trim() !== "Y");
  const approver = members.find((m) => (m.APPROVER ?? "").trim() === "Y");
  if (plain.length < 2 || !approver) throw new Error("한빛제약 계정 구성 부족");
  hb = {
    requester: plain[0].MBER_ID,
    colleague: plain[1].MBER_ID,
    approver: approver.MBER_ID,
  };
  sjSystem = await systemOf("SJ001");
});

/* ── SEC-1 ────────────────────────────────────────────────── */

describe("🔒 내부 전용 댓글에는 첨부를 붙일 수 없다 (SEC-1)", () => {
  /**
   * 첨부 표(NX_OPTREPORT_FILE)에는 '어느 댓글에서 왔는지'가 없어 티켓 단위로 공개된다.
   * 내부 전용 글의 첨부를 받으면 글은 숨는데 파일은 고객사·외부업체에게 열린다.
   */
  it("라우트: 400 INTERNAL_ATTACHMENT — 댓글도 파일도 남지 않는다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3' AND CUSTCODE='HB001'");
    const before = await counts(echoNum);

    const res = await postAction(
      req({
        action: "comment",
        comment: {
          body: "<p>내부 점검 로그입니다.</p>",
          adminOnly: true,
          attachments: [txt("점검.txt", "내부 전용 로그")],
        },
      }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.code).toBe("INTERNAL_ATTACHMENT");
    expect(b.message).toMatch(/내부 전용/);
    expect(await counts(echoNum)).toEqual(before);
  });

  it("쓰기가 잠겨 있어도 202 가 아니라 400 — 무엇이 틀렸는지 먼저 알려준다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3' AND CUSTCODE='HB001'");
    const res = await locked(() =>
      postAction(
        req({
          action: "comment",
          comment: {
            body: "<p>내부 메모</p>",
            adminOnly: true,
            attachments: [txt("a.txt", "x")],
          },
        }),
        ctx({ echoNum }),
      ),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INTERNAL_ATTACHMENT");
  });

  it("대조군 — 공개 댓글의 첨부는 그대로 올라간다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3' AND CUSTCODE='HB001'");
    const before = await counts(echoNum);
    const res = await postAction(
      req({
        action: "comment",
        comment: {
          body: "<p>재현 로그 첨부합니다.</p>",
          adminOnly: false,
          attachments: [txt("재현.txt", "로그")],
        },
      }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(200);
    expect((await counts(echoNum)).files).toBe(before.files + 1);
  });

  it("판정은 데이터 계층 안에 있다 — addComment·applyAction 을 직접 불러도 막힌다", async () => {
    const internal = await me("sy.kim");
    const echoNum = await pick("PROGRESS='3' AND CUSTCODE='HB001'");
    const before = await counts(echoNum);
    const files: IncomingFile[] = [
      { name: "a.txt", mime: "text/plain", bytes: Buffer.from("x") },
    ];

    await expect(
      addComment({
        echoNum,
        user: internal,
        body: "<p>내부</p>",
        adminOnly: true,
        files,
      }),
    ).rejects.toBeInstanceOf(InternalAttachmentError);

    const ticket = (await getTicket(echoNum, internal))!;
    await expect(
      applyAction({
        ticket,
        user: internal,
        action: "comment",
        comment: { body: "<p>내부</p>", adminOnly: true, files },
      }),
    ).rejects.toBeInstanceOf(InternalAttachmentError);

    expect(await counts(echoNum)).toEqual(before);
  });
});

/* ── 문구 ─────────────────────────────────────────────────── */

describe("문구 — 기계가 쓴 문장처럼 읽히지 않는다", () => {
  it("필수 항목 안내는 받침에 맞는 조사를 쓴다", () => {
    expect(new SolutionRequiredError("답변").message).toBe(
      "답변을 입력해야 이 단계로 넘어갈 수 있습니다.",
    );
  });

  it("라우트도 같은 문장이다 — '을(를)' 이 새지 않는다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim" });
    const res = await postAction(
      req({ action: "propose", solution: blankSolution }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).message).toBe(
      "답변을 입력해야 이 단계로 넘어갈 수 있습니다.",
    );
  });

  it("완료 안내가 '완료 처리 처리했습니다' 가 되지 않는다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='4'");
    await setTicket(echoNum, {
      SUCCERSON: "sy.kim",
      ANSWER: "<p>패치를 적용했습니다.</p>",
    });
    const res = await postAction(req({ action: "complete" }), ctx({ echoNum }));
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.message).toBe("완료 처리했습니다.");
    expect(b.progress).toBe("9");
  });

  it("대리 등록 이력 첫 줄이 조사를 맞춰 쓴다", async () => {
    as("sy.kim");
    const res = await postTask(
      req({
        kind: "phone",
        custCode: "SJ001",
        systemId: sjSystem,
        title: "전화로 받은 건 (문구)",
        content: "전화로 받은 내용",
      }),
    );
    expect(res.status).toBe(201);
    const logs = await select<{ COMMENT: string }>(
      `SELECT COMMENT FROM NX_OPTREPORTR
        WHERE PECHONUM = @e AND IS_LOG_YN='Y' ORDER BY ID LIMIT 1`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    const line = logs[0].COMMENT;
    expect(line).toContain("전화 문의를 김서연이 대신 등록했습니다.");
    expect(line).not.toMatch(/\((를|가)\)/);
  });

  it("정기 업무 — 괄호로 끝나는 출처도 괄호 앞 낱말로 조사를 고르고, 템플릿 본문(HTML)은 글자로 바뀌지 않는다", async () => {
    as("sy.kim");
    const title = "월말 백업 점검 (문구 테스트)";
    const res = await postTask(
      req({
        kind: "routine",
        custCode: "SJ001",
        systemId: sjSystem,
        title,
        content: "백업 로그 확인\n<오류> 가 있으면 보고",
        repeatMonthly: true,
        repeatDay: 5,
      }),
    );
    expect(res.status).toBe(201);
    // 이번 달은 방금 만들었다고 표시돼 있다 — 다음 달이 된 것처럼 표시를 지운다
    await write([
      {
        sql: `UPDATE NX_TASK_TEMPLATE SET LAST_RUN_YM = NULL
               WHERE ID = (SELECT MAX(ID) FROM NX_TASK_TEMPLATE WHERE TITLE = @t)`,
        params: [{ name: "t", value: title }],
      },
    ]);

    const run = await runTemplates();
    expect(run.status).toBe(200);
    const created = (await json(run)).created ?? [];
    const rows = await select<{
      ECHONUM: string;
      CONTENT: string;
    }>(
      `SELECT ECHONUM, CONTENT FROM NX_OPTREPORTD
        WHERE TITLE LIKE @t ORDER BY ECHONUM DESC LIMIT 1`,
      [{ name: "t", value: `${title} (%` }],
    );
    expect(created).toContain(rows[0].ECHONUM);

    // 본문은 문단 HTML 그대로 — 이스케이프됐으면 화면에 '<p>' 가 글자로 보인다
    expect(rows[0].CONTENT).toContain("<p>");
    expect(rows[0].CONTENT).not.toContain("&lt;p&gt;");
    // 평문으로 받은 꺾쇠는 글자로 남는다
    expect(visible(sanitize(rows[0].CONTENT))).toContain(
      "<오류> 가 있으면 보고",
    );

    const logs = await select<{ COMMENT: string }>(
      `SELECT COMMENT FROM NX_OPTREPORTR
        WHERE PECHONUM = @e AND IS_LOG_YN='Y' ORDER BY ID LIMIT 1`,
      [{ name: "e", value: rows[0].ECHONUM }],
    );
    expect(logs[0].COMMENT).toMatch(/정기 업무\(매월 5일\)를 /);
  });
});

/* ── SEC-3 ────────────────────────────────────────────────── */

describe("🔒 테스트 완료는 신청자 본인만 (SEC-3)", () => {
  const config: CustomerConfig = {
    custCode: "HB001",
    custName: "한빛제약",
    showsContractTime: false,
    usesApproval: true,
    usesTestStage: true,
    usesSystemStage: false,
    defaultPrivate: true,
  };
  const at5 = (requesterId: string) =>
    ({
      echoNum: "HB-202609-001",
      custCode: "HB001",
      progress: "5",
      requesterId,
      assigneeId: "sy.kim",
      isPublic: true,
    }) as unknown as TicketRow;
  const customer = (id: string, isApprover = false): User => ({
    id,
    name: id,
    role: "CUSTOMER",
    custCode: "HB001",
    custName: "한빛제약",
    dept: null,
    email: null,
    isApprover,
  });

  it("같은 회사 비신청자·승인권자는 false, 신청자만 true", () => {
    const t = at5("hb.req");
    expect(canDo("testComplete", t, customer("hb.req"), config)).toBe(true);
    expect(canDo("testComplete", t, customer("hb.other"), config)).toBe(false);
    expect(canDo("testComplete", t, customer("hb.boss", true), config)).toBe(
      false,
    );
  });

  it("라우트: 동료·승인권자는 403, 상태 그대로 — 신청자는 200", async () => {
    const echoNum = await pick("CUSTCODE='HB001'");
    await setTicket(echoNum, {
      PROGRESS: "5",
      CUSTPERSON: hb.requester,
      PUBLICYN: "Y",
    });

    for (const who of [hb.colleague, hb.approver]) {
      as(who);
      const res = await postAction(
        req({ action: "testComplete" }),
        ctx({ echoNum }),
      );
      expect(res.status, who).toBe(403);
    }
    expect(await col(echoNum, "PROGRESS")).toBe("5");

    as(hb.requester);
    const ok = await postAction(
      req({ action: "testComplete" }),
      ctx({ echoNum }),
    );
    expect(ok.status).toBe(200);
    expect(await col(echoNum, "PROGRESS")).toBe("6");
  });
});

/* ── UX-2 ─────────────────────────────────────────────────── */

describe("취소 권유는 신청자가 실제로 취소할 수 있을 때만 (UX-2)", () => {
  const config: CustomerConfig = {
    custCode: "HB001",
    custName: "한빛제약",
    showsContractTime: true,
    usesApproval: true,
    usesTestStage: true,
    usesSystemStage: true,
    defaultPrivate: true,
  };
  const ticketAt = (progress: string) =>
    ({
      echoNum: "HB-202609-002",
      custCode: "HB001",
      progress,
      requesterId: "hb.req",
      requesterName: "신청자",
      assigneeId: "sy.kim",
      assigneeName: "김서연",
    }) as unknown as TicketRow;
  const handler: User = {
    id: "sy.kim",
    name: "김서연",
    role: "INTERNAL",
    custCode: "NX000",
    custName: "넥시오",
    dept: null,
    email: null,
    isApprover: false,
  };
  const vendor: User = { ...handler, role: "VENDOR" };
  const requester: User = {
    ...handler,
    id: "hb.req",
    role: "CUSTOMER",
    custCode: "HB001",
  };

  it("불변식 — 권유가 가능한 모든 상태에서 신청자는 cancel|cancelRequest 를 가진다", () => {
    const suggestable: string[] = [];
    for (const code of Object.keys(PROGRESS) as ProgressCode[]) {
      const t = ticketAt(code);
      const canSuggest = [handler, vendor].some((u) =>
        canDo("suggestCancel", t, u, config),
      );
      if (!canSuggest) continue;
      suggestable.push(code);
      const canCancel =
        canDo("cancel", t, requester, config) ||
        canDo("cancelRequest", t, requester, config);
      expect(
        canCancel,
        `${code}(${PROGRESS[code]}) 에서 권유가 막다른 길이다`,
      ).toBe(true);
    }
    // 공허한 통과를 막는다 — 권유 자체는 살아 있어야 한다
    expect(suggestable).toContain("3");
  });

  it("해결안 제시 이후(4~6) 힌트가 서로를 가리키지 않는다", () => {
    for (const code of ["4", "5", "6"]) {
      const t = ticketAt(code);
      expect(canDo("suggestCancel", t, handler, config)).toBe(false);
      // 신청자에게 '담당자에게 문의'라고 보내면, 담당자는 할 수 있는 게 없다
      expect(cancelHint(t, requester) ?? "").not.toContain("담당자에게 문의");
      // 담당자에게 '취소 권유를 보낼 수 있다'고 말하지 않는다
      expect(cancelHint(t, handler) ?? "").not.toContain("취소 권유");
    }
  });

  it("라우트: 해결안 제시(4)에서 권유는 403", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='4'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim" });
    const res = await postAction(
      req({ action: "suggestCancel", reason: "중복 요청입니다." }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(403);
  });

  it("권유 댓글이 신청자가 누를 버튼을 가리킨다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim" });
    const res = await postAction(
      req({ action: "suggestCancel", reason: "동일 건이 이미 처리됐습니다." }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(200);
    const rows = await select<{ COMMENT: string }>(
      `SELECT COMMENT FROM NX_OPTREPORTR
        WHERE PECHONUM = @e AND IS_LOG_YN <> 'Y' ORDER BY ID DESC LIMIT 1`,
      [{ name: "e", value: echoNum }],
    );
    const text = visible(rows[0].COMMENT);
    expect(text).toContain("동일 건이 이미 처리됐습니다.");
    expect(text).toContain("'취소 요청'");
  });
});

/* ── UX-7 ─────────────────────────────────────────────────── */

describe("되돌릴 수 없는 판단에는 사유가 필요하다 (UX-7)", () => {
  it("반려 — 사유가 없거나 공백이면 400 REASON_REQUIRED, 상태 그대로", async () => {
    const echoNum = await pick("CUSTCODE='HB001'");
    await setTicket(echoNum, { PROGRESS: "1" });
    as(hb.approver);
    for (const reason of [undefined, "   "]) {
      const res = await postAction(
        req({ action: "reject", reason }),
        ctx({ echoNum }),
      );
      expect(res.status).toBe(400);
      const b = await json(res);
      expect(b.code).toBe("REASON_REQUIRED");
      expect(b.message).toMatch(/사유/);
    }
    expect(await col(echoNum, "PROGRESS")).toBe("1");
  });

  it("반려 — 사유를 주면 반려되고 처리 메모에 남는다", async () => {
    const echoNum = await pick("CUSTCODE='HB001'");
    await setTicket(echoNum, { PROGRESS: "1" });
    as(hb.approver);
    const res = await postAction(
      req({ action: "reject", reason: "같은 내용이 이미 접수돼 있습니다." }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(200);
    expect(await col(echoNum, "PROGRESS")).toBe("12");
    expect(visible(String(await col(echoNum, "AMEMO")))).toContain(
      "같은 내용이 이미 접수돼 있습니다.",
    );
  });

  it("계속 진행(cancelDeny) — 라우트가 이 액션을 받고, 사유 없이는 거절하지 않는다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS IN ('3','4')");
    await setTicket(echoNum, { PROGRESS: "10", SUCCERSON: "sy.kim" });

    const bare = await postAction(
      req({ action: "cancelDeny" }),
      ctx({ echoNum }),
    );
    expect(bare.status).toBe(400);
    expect((await json(bare)).code).toBe("REASON_REQUIRED");
    expect(await col(echoNum, "PROGRESS")).toBe("10");

    const ok = await postAction(
      req({
        action: "cancelDeny",
        reason: "이미 반영 작업이 끝나 가는 중입니다.",
      }),
      ctx({ echoNum }),
    );
    expect(ok.status).toBe(200);
    expect(await col(echoNum, "PROGRESS")).toBe("3");
  });

  it("취소 승인(cancelApprove) 은 사유가 선택이다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS IN ('3','4')");
    await setTicket(echoNum, { PROGRESS: "10", SUCCERSON: "sy.kim" });
    const res = await postAction(
      req({ action: "cancelApprove" }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(200);
    expect(await col(echoNum, "PROGRESS")).toBe("11");
  });

  it("취소 권유 — 사유 없으면 400, 댓글도 남지 않는다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim" });
    const before = await counts(echoNum);
    const res = await postAction(
      req({ action: "suggestCancel" }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("REASON_REQUIRED");
    expect(await counts(echoNum)).toEqual(before);
  });

  it("쓰기가 잠겨 있어도 사유 누락은 400 — 202 로 '통과'를 알리지 않는다", async () => {
    const echoNum = await pick("CUSTCODE='HB001'");
    await setTicket(echoNum, { PROGRESS: "1" });
    as(hb.approver);
    const res = await locked(() =>
      postAction(req({ action: "reject" }), ctx({ echoNum })),
    );
    expect(res.status).toBe(400);
  });
});

/* ── DATA-2 ───────────────────────────────────────────────── */

describe("빈 처리결과로는 종료할 수 없다 (DATA-2)", () => {
  it("답변이 빈 해결안 제시(4) → 완료는 400, 상태 그대로", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='4'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim", ANSWER: "" });
    const res = await postAction(req({ action: "complete" }), ctx({ echoNum }));
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.code).toBe("SOLUTION_REQUIRED");
    expect(b.message).toBe("답변을 입력해야 이 단계로 넘어갈 수 있습니다.");
    expect(await col(echoNum, "PROGRESS")).toBe("4");
  });

  it("완료 버튼이 쓰던 답변을 함께 보내면 그 답변으로 판정하고 저장한다", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='4'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim", ANSWER: "" });
    const res = await postAction(
      req({
        action: "complete",
        solution: { ...blankSolution, answer: "<p>설정 변경으로 해결</p>" },
      }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(200);
    expect(await col(echoNum, "PROGRESS")).toBe("9");
    expect(String(await col(echoNum, "ANSWER"))).toContain("설정 변경");
  });
});

/* ── DATA-3 ───────────────────────────────────────────────── */

describe("미읽음 — 내가 한 일은 나에게 새 글이 아니다 (DATA-3)", () => {
  it("내가 한 전이는 목록·대시보드·알림 어디에서도 미읽음이 아니다", async () => {
    const internal = await me("sy.kim");
    const echoNum = await pick("PROGRESS='2'");
    await setTicket(echoNum, { SUCCERSON: "sy.kim" });
    await markNotificationsRead(internal, echoNum);
    expect((await getTicket(echoNum, internal))?.hasUnreadComment).toBe(false);
    const dashBefore = (await getDashboard(internal)).cards.unreadComments;

    as("sy.kim");
    const res = await postAction(req({ action: "receive" }), ctx({ echoNum }));
    expect(res.status).toBe(200);

    // 네 축이 같은 정의를 본다 — 상세(뱃지) · 목록 필터 · 대시보드 카드 · 알림
    expect((await getTicket(echoNum, internal))?.hasUnreadComment).toBe(false);
    const unreadList = await listTickets(
      filters({ view: "open", unreadOnly: true }),
      internal,
    );
    expect(unreadList.rows.map((r) => r.echoNum)).not.toContain(echoNum);
    expect((await getDashboard(internal)).cards.unreadComments).toBe(
      dashBefore,
    );
    expect(
      (await listNotifications(internal)).items.map((n) => n.echoNum),
    ).not.toContain(echoNum);
  });

  it("남의 미읽음 댓글은 내가 전이를 해도 남는다 (조용히 읽음 처리하지 않는다)", async () => {
    const internal = await me("sy.kim");
    const echoNum = await pick(
      "PROGRESS='3' AND CUSTCODE='SJ001' AND CUSTPERSON='sj.moon'",
    );
    await setTicket(echoNum, { SUCCERSON: "sy.kim" });
    await markNotificationsRead(internal, echoNum);

    await addComment({
      echoNum,
      user: await me("sj.moon"),
      body: "<p>추가 자료 보내드립니다.</p>",
      adminOnly: false,
    });

    as("sy.kim");
    const res = await postAction(
      req({
        action: "propose",
        solution: { ...blankSolution, answer: "<p>조치 방법 안내</p>" },
      }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(200);

    expect((await getTicket(echoNum, internal))?.hasUnreadComment).toBe(true);
    expect(
      (await listNotifications(internal)).items.map((n) => n.echoNum),
    ).toContain(echoNum);
  });
});

/* ── SEC-4 ────────────────────────────────────────────────── */

describe("평문 칸의 꺾쇠는 글자다 (SEC-4)", () => {
  it("toParagraphs 는 이스케이프한 뒤 문단으로 감싼다", () => {
    expect(toParagraphs("<select> 에서 a<b")).toBe(
      "<p>&lt;select&gt; 에서 a&lt;b</p>",
    );
  });

  it("새니타이즈를 지나도 원문이 그대로 읽힌다 — 코드·SQL 이 잘리지 않는다", () => {
    for (const text of [
      "<select> 에서 a<b",
      "List<string> items = new List<string>();",
      "WHERE DocTotal<>0 AND a<b",
      'A & B "인용"',
    ]) {
      expect(visible(sanitize(composeBody(text, text)))).toContain(text);
    }
  });

  it("평문 칸으로 마크업을 넣을 수 없다 — <img> 는 태그가 아니라 글자다", () => {
    const rendered = sanitize(
      toParagraphs('<img src="https://pixel.example/p.gif">'),
    );
    expect(rendered).not.toMatch(/<img/i);
    expect(visible(rendered)).toContain("<img");
  });

  it("신청 라우트로 저장해도 보존된다", async () => {
    as("sj.moon");
    const res = await postRequest(
      req(
        requestForm({
          symptom: "<select> 에서 a<b",
          content: "SELECT * FROM OINV WHERE DocTotal<>0",
        }),
      ),
    );
    expect(res.status).toBe(201);
    const t = await getTicket((await json(res)).echoNum!, await me("sj.moon"));
    const text = visible(sanitize(t!.request.content));
    expect(text).toContain("<select> 에서 a<b");
    expect(text).toContain("DocTotal<>0");
  });
});

/* ── SEC-9 ────────────────────────────────────────────────── */

describe("쓰기 본문의 길이 상한 (SEC-9)", () => {
  const long = (n: number) => "가".repeat(n);

  it("댓글은 4,000자까지 — 넘으면 400 과 이유 문장", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3'");
    const res = await postAction(
      req({ action: "comment", comment: { body: `<p>${long(4001)}</p>` } }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.code).toBe("BAD_REQUEST");
    expect(b.message).toMatch(/4,000자/);
  });

  it("서식 태그는 글자 수에 세지 않는다 (보이는 글자 기준)", () => {
    const body = Array.from({ length: 1500 }, () => "<p>가</p>").join("");
    expect(body.length).toBeGreaterThan(4000);
    expect(
      actionSchema.safeParse({
        echoNum: "X-1",
        action: "comment",
        comment: { body },
      }).success,
    ).toBe(true);
  });

  it("처리내역·사유·신청 본문·업무 내용에도 상한이 있다", () => {
    const action = (over: Record<string, unknown>) =>
      actionSchema.safeParse({ echoNum: "X-1", action: "save", ...over })
        .success;
    expect(
      action({ solution: { ...blankSolution, answer: long(20001) } }),
    ).toBe(false);
    expect(action({ solution: { ...blankSolution, answer: long(100) } })).toBe(
      true,
    );
    expect(action({ reason: long(1001) })).toBe(false);

    const form = {
      custCode: "SJ001",
      requesterId: "sj.moon",
      requesterEmail: "a@b.example",
      systemId: "1",
      title: "t",
      symptom: "s",
      content: "c",
    };
    expect(
      requestFormSchema.safeParse({ ...form, symptom: long(20001) }).success,
    ).toBe(false);
    expect(
      requestFormSchema.safeParse({ ...form, content: long(20001) }).success,
    ).toBe(false);
    expect(requestFormSchema.safeParse(form).success).toBe(true);

    const task = {
      kind: "phone",
      custCode: "SJ001",
      systemId: "1",
      title: "t",
      content: "c",
    };
    expect(
      taskIntakeSchema.safeParse({ ...task, content: long(20001) }).success,
    ).toBe(false);
    expect(
      taskIntakeSchema.safeParse({
        ...task,
        stage: "9",
        answer: long(20001),
      }).success,
    ).toBe(false);
  });
});

/* ── SEC-2 · SEC-6 ────────────────────────────────────────── */

describe("신청 라우트 — 받을 수 없는 신청 (SEC-2 · SEC-6)", () => {
  it("비활성 고객사로는 고객사 사용자도 운영팀도 신청할 수 없다 → 400 INVALID_CUSTOMER", async () => {
    const setActive = (v: string) =>
      write([
        {
          sql: "UPDATE COMPANY_MST SET ACTIVE = @v WHERE COMPANY_CODE = 'SJ001'",
          params: [{ name: "v", value: v }],
        },
      ]);
    await setActive("N");
    try {
      for (const who of ["sj.moon", "sy.kim"]) {
        as(who);
        const res = await postRequest(req(requestForm()));
        expect(res.status, who).toBe(400);
        const b = await json(res);
        expect(b.code).toBe("INVALID_CUSTOMER");
        expect(b.message).toBeTruthy();
      }
    } finally {
      await setActive("Y");
    }
  });

  it("진행 중인 건은 재신청 원본이 될 수 없다 → 400 INVALID_PARENT", async () => {
    const parent = await pick("CUSTCODE='SJ001' AND CUSTPERSON='sj.moon'");
    await setTicket(parent, { PROGRESS: "3" });
    as("sj.moon");
    const res = await postRequest(req(requestForm({ from: parent })));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_PARENT");
  });

  it("같은 회사 동료의 종료건(공개)도 원본이 될 수 없다 — 재신청은 신청자 본인", async () => {
    const parent = await pick("CUSTCODE='SJ001' AND CUSTPERSON='sj.oh'");
    await setTicket(parent, { PROGRESS: "9", PUBLICYN: "Y" });
    as("sj.moon");
    const res = await postRequest(req(requestForm({ from: parent })));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_PARENT");
  });

  it("운영팀의 대리 재신청은 규칙에 없다 → 400 (fail-closed)", async () => {
    const parent = await pick("CUSTCODE='SJ001' AND CUSTPERSON='sj.moon'");
    await setTicket(parent, { PROGRESS: "9" });
    as("sy.kim");
    const res = await postRequest(req(requestForm({ from: parent })));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_PARENT");
  });

  it("타사 건은 원본이 될 수 없다 → 400 (존재 여부를 흘리지 않는 같은 코드)", async () => {
    const parent = await pick("CUSTCODE='HB001'");
    as("sj.moon");
    const res = await postRequest(req(requestForm({ from: parent })));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_PARENT");
  });

  it("본인 종료건은 원본이 된다 → 201, 원본과 연결", async () => {
    const parent = await pick("CUSTCODE='SJ001' AND CUSTPERSON='sj.moon'");
    await setTicket(parent, { PROGRESS: "11" });
    as("sj.moon");
    const res = await postRequest(req(requestForm({ from: parent })));
    expect(res.status).toBe(201);
    expect(await col((await json(res)).echoNum!, "P_ECHONUM")).toBe(parent);
  });
});

/* ── FE-3 · SEC-8 ─────────────────────────────────────────── */

describe("첨부 합계는 배포처의 요청 본문 한도 안에 든다 (FE-3)", () => {
  /** Vercel Functions 의 요청 본문 상한 — 넘으면 함수에 닿기 전에 413 이 난다 */
  const PLATFORM_BODY_LIMIT = 4_500_000;

  it("허용 최대 조합을 base64 로 실어도(4/3) 본문 여유를 두고 4.5MB 안이다", () => {
    const encoded = Math.ceil(MAX_TOTAL_BYTES / 3) * 4;
    const jsonAndText = 256 * 1024;
    expect(encoded + jsonAndText).toBeLessThan(PLATFORM_BODY_LIMIT);
  });

  it("개당 한도 안의 파일이라도 합계가 넘으면 서버가 거부한다", () => {
    const two = [0, 1].map((i) => ({
      name: `${i}.txt`,
      mime: "text/plain",
      bytes: Buffer.alloc(MAX_FILE_BYTES, 0x41),
    }));
    expect(() => validateUploads(two)).toThrow(AttachmentError);
    expect(() => validateUploads(two)).toThrow(/합계/);
  });
});

/* ── DATA-8 ───────────────────────────────────────────────── */

describe("지난 일을 기록해도 시간이 거꾸로 흐르지 않는다 (DATA-8)", () => {
  async function doneTask(doneDate: string) {
    as("sy.kim");
    const res = await postTask(
      req({
        kind: "phone",
        custCode: "SJ001",
        systemId: sjSystem,
        title: "지난 일 기록",
        content: "전화로 받아 바로 처리",
        stage: "9",
        answer: "처리했습니다.",
        doneDate,
      }),
    );
    expect(res.status).toBe(201);
    const echoNum = (await json(res)).echoNum!;
    const rows = await select<{ REQDATE: string; SUCCDATE: string }>(
      "SELECT REQDATE, SUCCDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e",
      [{ name: "e", value: echoNum }],
    );
    return { echoNum, ...rows[0] };
  }

  it("지난 날짜로 완료 등록 → 신청일 ≤ 완료일, 번호의 월도 신청일을 따른다", async () => {
    const past = todaySeoul(40);
    const t = await doneTask(past);
    expect(t.SUCCDATE.slice(0, 10)).toBe(past);
    expect(t.REQDATE <= t.SUCCDATE).toBe(true);
    const ym = t.echoNum.split("-")[1];
    expect(ym).toBe(t.REQDATE.slice(0, 4) + t.REQDATE.slice(5, 7));
  });

  it("오늘을 고르면 '지금'으로 기록한다 — 접수와 완료가 같은 시각", async () => {
    const t = await doneTask(todaySeoul());
    expect(t.SUCCDATE).toBe(t.REQDATE);
  });
});

/* ── QA-6 ─────────────────────────────────────────────────── */

describe("한 번도 불리지 않던 라우트·분기 (QA-6)", () => {
  it("정기 업무 목록 GET — 고객사·외부업체 403, 운영팀 200", async () => {
    for (const who of ["sj.moon", "vd.kang"]) {
      as(who);
      const res = await getTemplates();
      expect(res.status, who).toBe(403);
    }
    as("sy.kim");
    const ok = await getTemplates();
    expect(ok.status).toBe(200);
    expect(Array.isArray((await json(ok)).templates)).toBe(true);
  });

  it("정기 업무 생성 POST — 외부업체 403", async () => {
    as("vd.kang");
    expect((await runTemplates()).status).toBe(403);
  });

  it("알림 GET — 목록과 건수를 준다", async () => {
    as("sy.kim");
    const res = await getNotifications();
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(Array.isArray(b.items)).toBe(true);
    expect(typeof b.total).toBe("number");
  });

  it("알림 POST — 쓰기가 잠기면 202 이고 읽음선이 움직이지 않는다", async () => {
    const line = async () =>
      (
        await select<{ n: number; s: number }>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(LAST_SEEN_COMMENT_ID),0) AS s
             FROM NX_OPTREPORT_READ_STATE WHERE USER_ID = 'sy.kim'`,
        )
      )[0];
    as("sy.kim");
    const before = await line();
    const res = await locked(() => postNotifications(req({})));
    expect(res.status).toBe(202);
    expect(await line()).toEqual(before);
  });

  it("알림 POST — 못 보는 건은 읽음선도 못 만든다 (changed 0)", async () => {
    const other = await pick("CUSTCODE='HB001'");
    as("sj.moon");
    const res = await postNotifications(req({ echoNum: other }));
    expect(res.status).toBe(200);
    expect((await json(res)).changed).toBe(0);
  });

  it("알림 POST — echoNum 이 문자열이 아니면 400 (500 으로 터지지 않는다)", async () => {
    as("sy.kim");
    const res = await postNotifications(req({ echoNum: 123 }));
    expect(res.status).toBe(400);
  });

  it("빈 댓글은 400 EMPTY_COMMENT", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3'");
    const res = await postAction(
      req({ action: "comment", comment: { body: "<p> </p>" } }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("EMPTY_COMMENT");
  });

  it("재신청(reapply)은 상태 전이가 아니다 — 쓰기가 잠겨 있어도 202 가 아니라 400", async () => {
    const echoNum = await pick("CUSTCODE='SJ001' AND CUSTPERSON='sj.moon'");
    await setTicket(echoNum, { PROGRESS: "9" });
    as("sj.moon");
    for (const run of [
      () => postAction(req({ action: "reapply" }), ctx({ echoNum })),
      () =>
        locked(() => postAction(req({ action: "reapply" }), ctx({ echoNum }))),
    ]) {
      const res = await run();
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe("UNSUPPORTED_ACTION");
    }
  });

  it("모르는 액션은 400 BAD_REQUEST", async () => {
    as("sy.kim");
    const echoNum = await pick("PROGRESS='3'");
    const res = await postAction(
      req({ action: "deleteEverything" }),
      ctx({ echoNum }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("BAD_REQUEST");
  });

  it("상세 GET — 타사 건은 404", async () => {
    const other = await pick("CUSTCODE='HB001'");
    as("sj.moon");
    const res = await getTicketRoute(
      new Request("http://test/"),
      ctx({ echoNum: other }),
    );
    expect(res.status).toBe(404);
  });
});
