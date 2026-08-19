// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 라우트 핸들러 — **권한이 실제로 집행되는 지점**.
 *
 * 나머지 테스트는 전부 lib 단위인데, 화면의 버튼을 숨기는 것은 표시일 뿐이고
 * 요청을 막는 것은 여기다. 그래서 이 파일은 "버튼이 없다"가 아니라
 * **"직접 호출해도 거부된다"** 를 고정한다 (canDo 재판정 · 소속 교차 조회 · 202 계약).
 *
 * ⚠️ 존재를 흘리지 않는 거부는 403 이 아니라 **404** 다 — 타사 티켓에 403 을 주면
 *    "그 번호는 있다"는 사실이 새어 나간다.
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

// 데모 세션은 쿠키 하나로 정해진다 — 그 쿠키만 갈아 끼우면 페르소나가 바뀐다
const session = vi.hoisted(() => ({ userId: "sy.kim" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "nx_user" ? { value: session.userId } : undefined,
  }),
}));

import { PATCH as patchCustomer } from "@/app/api/customers/[code]/route";
import { POST as postCustomer } from "@/app/api/customers/route";
import { POST as postRequest } from "@/app/api/requests/route";
import { POST as postSession } from "@/app/api/session/route";
import { POST as postAction } from "@/app/api/tickets/[echoNum]/action/route";
import { GET as getAttachment } from "@/app/api/tickets/[echoNum]/attachments/[id]/route";
import RequestsPage from "@/app/requests/page";
import { select } from "@/lib/db";
import { todaySeoul } from "@/lib/format";

const as = (id: string) => {
  session.userId = id;
};
const body = (v: unknown) =>
  new Request("http://test/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(v),
  });
const ctx = <T extends object>(params: T) => ({
  params: Promise.resolve(params),
});
const json = async (res: Response) =>
  (await res.json()) as { code?: string; message?: string; progress?: string };

/** 시드에서 조건에 맞는 티켓 — 접수번호를 코드에 박지 않는다 */
async function pickTickets(where: string, n = 1): Promise<string[]> {
  const rows = await select<{ ECHONUM: string }>(
    "SELECT ECHONUM FROM NX_OPTREPORTD WHERE " +
      where +
      " ORDER BY ECHONUM LIMIT " +
      n,
  );
  if (rows.length < n) throw new Error("시드에 해당 티켓이 부족하다: " + where);
  return rows.map((r) => r.ECHONUM);
}

const pickTicket = async (where: string) => (await pickTickets(where))[0];

async function progressOf(echoNum: string): Promise<string> {
  const rows = await select<{ PROGRESS: string }>(
    "SELECT PROGRESS FROM NX_OPTREPORTD WHERE ECHONUM = @e",
    [{ name: "e", value: echoNum }],
  );
  return rows[0].PROGRESS;
}

let hbTicket: string; // 한빛제약 건 — 세진식품 사용자에게는 남의 회사
let colleaguePrivate: string; // 세진식품 동료가 쓴 비공개 건
let moonCancelable: string; // 문가영 본인 건, 취소 가능한 단계
let moonTerminal: string; // 문가영 본인 건, 종료
// 상태를 실제로 바꾸는 테스트는 **각자 다른 티켓**을 쓴다 —
// 하나를 돌려쓰면 앞 테스트의 전이가 뒤 테스트의 전제를 무너뜨려 원인이 엉뚱한 곳으로 보인다
let receivable: string[]; // 접수 대기(2) 건 3개
let hbFile: { echoNum: string; id: number };

beforeAll(async () => {
  hbTicket = await pickTicket("CUSTCODE='HB001'");
  colleaguePrivate = await pickTicket(
    "CUSTCODE='SJ001' AND COALESCE(PUBLICYN,'N')<>'Y' AND CUSTPERSON='sj.oh'",
  );
  moonCancelable = await pickTicket(
    "CUSTCODE='SJ001' AND CUSTPERSON='sj.moon' AND PROGRESS IN ('1','2')",
  );
  moonTerminal = await pickTicket(
    "CUSTCODE='SJ001' AND CUSTPERSON='sj.moon' AND PROGRESS='9'",
  );
  receivable = await pickTickets("CUSTCODE='SJ001' AND PROGRESS='2'", 3);

  const f = await select<{ ID: number; PECHONUM: string }>(
    `SELECT f.ID, f.PECHONUM FROM NX_OPTREPORT_FILE f
       JOIN NX_OPTREPORTD d ON d.ECHONUM = f.PECHONUM
      WHERE d.CUSTCODE='HB001' LIMIT 1`,
  );
  hbFile = { echoNum: f[0].PECHONUM, id: f[0].ID };
});

describe("액션 라우트 — 화면을 거치지 않고 직접 불러도 막힌다", () => {
  it("타사 티켓은 404 — 존재 여부조차 흘리지 않는다", async () => {
    as("sj.moon");
    const res = await postAction(
      body({ action: "comment", comment: { body: "<p>안녕</p>" } }),
      ctx({ echoNum: hbTicket }),
    );
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("NOT_FOUND");
  });

  it("같은 회사라도 동료의 비공개 건은 404", async () => {
    as("sj.moon");
    const res = await postAction(
      body({ action: "comment", comment: { body: "<p>안녕</p>" } }),
      ctx({ echoNum: colleaguePrivate }),
    );
    expect(res.status).toBe(404);
  });

  it("🔒 취소는 신청자 본인만 — 운영팀이 대신 취소할 수 없다 (회사 정책)", async () => {
    as("sy.kim"); // 운영팀. 티켓은 보이지만 취소는 못 한다
    const res = await postAction(
      body({ action: "cancel" }),
      ctx({ echoNum: moonCancelable }),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("FORBIDDEN");
  });

  it("종료된 건에는 댓글도 달 수 없다 (전이표에 없는 조합 = 차단)", async () => {
    as("sj.moon");
    const res = await postAction(
      body({ action: "comment", comment: { body: "<p>추가로</p>" } }),
      ctx({ echoNum: moonTerminal }),
    );
    expect(res.status).toBe(403);
  });

  it("접수 시 분류값도 서버가 다시 검증한다 — 타사 운영시스템은 400", async () => {
    const other = await select<{ OPER_SYS_ID: number }>(
      "SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM WHERE COMPANY_CODE='HB001' LIMIT 1",
    );
    as("sy.kim");
    const res = await postAction(
      body({
        action: "receive",
        triage: {
          systemId: String(other[0].OPER_SYS_ID),
          moduleCode: "",
          expeTime: "",
          scheDate: "",
        },
      }),
      ctx({ echoNum: receivable[0] }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_SYSTEM");
  });

  it("예상 시간·처리일·모듈이 범위를 벗어나면 400", async () => {
    as("sy.kim");
    const base = { systemId: "", moduleCode: "", expeTime: "", scheDate: "" };
    const status = async (triage: Record<string, string>) =>
      (
        await postAction(
          body({ action: "receive", triage }),
          ctx({ echoNum: receivable[0] }),
        )
      ).status;
    expect(await status({ ...base, expeTime: "-1" })).toBe(400);
    expect(await status({ ...base, scheDate: "2026-13-40" })).toBe(400);
    expect(await status({ ...base, moduleCode: "없는모듈" })).toBe(400);
  });

  it("쓰기가 잠기면 200 이 아니라 202 — 그리고 상태가 바뀌지 않는다", async () => {
    process.env.ALLOW_DEV_WRITES = "false";
    try {
      as("sy.kim");
      const before = await progressOf(receivable[1]);
      const res = await postAction(
        body({ action: "receive" }),
        ctx({ echoNum: receivable[1] }),
      );
      expect(res.status).toBe(202);
      expect((await json(res)).code).toBe("WRITE_DISABLED");
      expect(await progressOf(receivable[1])).toBe(before);
    } finally {
      process.env.ALLOW_DEV_WRITES = "true";
    }
  });

  it("권한이 맞으면 200 이고 상태가 실제로 넘어간다", async () => {
    as("sy.kim");
    const res = await postAction(
      body({ action: "receive" }),
      ctx({ echoNum: receivable[2] }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).progress).toBe("3");
    expect(await progressOf(receivable[2])).toBe("3");
  });
});

describe("신청 라우트 — 폼이 보낸 값을 믿지 않는다", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    custCode: "SJ001",
    requesterId: "sj.moon",
    requesterEmail: "sjmoon@sejin.example",
    systemId: "1",
    title: "테스트 신청",
    symptom: "증상",
    content: "<p>내용</p>",
    moduleCode: "",
    priority: "3",
    scheDate: "",
    isPublic: false,
    refEmails: [],
    attachments: [],
    ...over,
  });

  it("외부업체는 신청 주체가 아니다 — 403", async () => {
    as("vd.kang");
    const res = await postRequest(body(form()));
    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain("외부업체");
  });

  it("남의 회사 사람을 신청자로 보내면 403 — 소속을 서버가 다시 조회한다", async () => {
    as("sj.moon");
    const res = await postRequest(body(form({ requesterId: "hb.yoon" })));
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("INVALID_REQUESTER");
  });

  it("고객사 사용자는 custCode 를 바꿔 보내도 본인 회사로 고정된다", async () => {
    as("sj.moon");
    // 한빛제약으로 위장 + 한빛제약 사람 → 세진식품으로 고정되므로 소속 검증에서 걸린다
    const res = await postRequest(
      body(form({ custCode: "HB001", requesterId: "hb.yoon" })),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("INVALID_REQUESTER");
  });

  it("운영시스템이 그 고객사 것이 아니면 400", async () => {
    const other = await select<{ OPER_SYS_ID: number }>(
      "SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM WHERE COMPANY_CODE='HB001' LIMIT 1",
    );
    as("sj.moon");
    const res = await postRequest(
      body(form({ systemId: String(other[0].OPER_SYS_ID) })),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_SYSTEM");
  });
});

describe("고객사 관리 라우트 — 권한 2단", () => {
  it("고객사 계정은 등록도 못 한다 — 403", async () => {
    as("hb.yoon");
    const res = await postCustomer(
      body({ custCode: "ZZ999", custName: "테스트" }),
    );
    expect(res.status).toBe(403);
  });

  it("일반 운영팀은 비활성할 수 없다 — 403 + 이유", async () => {
    as("sy.kim");
    const res = await patchCustomer(
      body({ active: false }),
      ctx({ code: "SJ001" }),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain("관리자");
  });

  it("운영팀 관리자만 통과한다", async () => {
    as("th.oh");
    const res = await patchCustomer(
      body({ active: false }),
      ctx({ code: "SJ001" }),
    );
    expect(res.status).toBe(200);
    // 되돌린다 — 다른 테스트의 시드 전제를 흔들지 않는다
    await patchCustomer(body({ active: true }), ctx({ code: "SJ001" }));
  });
});

describe("첨부 다운로드 — 파일 id 만으로는 못 받는다", () => {
  it("타사 사용자에게는 404 (존재를 흘리지 않는다)", async () => {
    as("sj.moon");
    const res = await getAttachment(
      new Request("http://test/"),
      ctx({ echoNum: hbFile.echoNum, id: String(hbFile.id) }),
    );
    expect(res.status).toBe(404);
  });

  it("볼 수 있는 사람에게는 내려주되 항상 attachment + nosniff", async () => {
    as("sy.kim");
    const res = await getAttachment(
      new Request("http://test/"),
      ctx({ echoNum: hbFile.echoNum, id: String(hbFile.id) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("접수번호와 파일 id 가 짝이 맞아야 한다", async () => {
    as("sy.kim");
    const res = await getAttachment(
      new Request("http://test/"),
      ctx({ echoNum: moonTerminal, id: String(hbFile.id) }),
    );
    expect(res.status).toBe(404);
  });
});

describe("세션 전환 라우트", () => {
  it("없는 계정은 404 — 화면은 이 코드를 문장으로 바꿔 보여준다", async () => {
    const res = await postSession(body({ userId: "없는사람" }));
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("USER_NOT_FOUND");
  });

  it("빈 값은 400", async () => {
    expect((await postSession(body({ userId: "  " }))).status).toBe(400);
  });
});

describe("조회 화면의 기본 조건", () => {
  it("오늘·N일 전 계산은 서버 타임존과 무관하게 KST 로 고정된다", () => {
    const today = todaySeoul();
    const before = todaySeoul(15);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days =
      (Date.parse(today + "T00:00:00Z") - Date.parse(before + "T00:00:00Z")) /
      86_400_000;
    expect(days).toBe(15);
  });

  it("첫 진입은 내 담당 · 최근 15일로 되돌린다", async () => {
    // redirect() 는 특수 예외를 던진다 — digest 에 목적지가 실려 있다
    const err = await RequestsPage({ searchParams: Promise.resolve({}) }).then(
      () => null,
      (e: { digest?: string }) => e,
    );
    expect(err?.digest ?? "").toContain(`/requests?view=mine&from=`);
    expect(err?.digest ?? "").toContain(`to=${todaySeoul()}`);
  });

  it("조건을 갖고 들어온 링크는 기간으로 다시 자르지 않는다", async () => {
    // 대시보드 카드가 이렇게 들어온다. 여기서 기간을 끼우면 카드 숫자와 목록이 어긋난다
    as("sy.kim");
    const err = await RequestsPage({
      searchParams: Promise.resolve({ view: "open", progress: "3" }),
    }).then(
      () => null,
      (e: { digest?: string }) => e,
    );
    expect(err).toBeNull();
  });
});
