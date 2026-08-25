// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 업무 등록(대리 등록)과 정기 업무.
 *
 * 여기서 고정하는 것은 세 가지다.
 *   1. **운영팀만** 등록할 수 있다 — 직접 호출해도 거부된다
 *   2. 대리 등록은 **승인 줄에 서지 않는다** — 승인 단계를 쓰는 고객사에 넣어도
 *      대기(1)로 떨어지면 고객사 승인권자만 풀 수 있는 갇힌 티켓이 된다
 *      (시드가 같은 실수를 해서 8건이 갇혔던 적이 있다)
 *   3. 정기 업무는 **여러 번 눌러도 한 건** — LAST_RUN_YM 이 티켓과 한 트랜잭션이다
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

import { POST as postTask } from "@/app/api/tasks/route";
import { PATCH as patchTemplate } from "@/app/api/tasks/templates/route";
import { POST as runTemplates } from "@/app/api/tasks/templates/run/route";
import { listViewForStage } from "@/lib/board";
import { currentYm, listPendingTemplates } from "@/lib/data/tasks";
import { listRecentlyDone, listTickets } from "@/lib/data/tickets";
import { select, write } from "@/lib/db";
import { todaySeoul } from "@/lib/format";
import { currentUser } from "@/lib/session";

const as = (id: string) => {
  session.userId = id;
};

const body = (v: unknown, method: "POST" | "PATCH" = "POST") =>
  new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(v),
  });

const json = async (res: Response) =>
  (await res.json()) as {
    code?: string;
    message?: string;
    echoNum?: string;
    created?: string[];
    repeating?: boolean;
  };

interface TicketRow {
  PROGRESS: string;
  SUCCERSON: string | null;
  CUSTPERSON: string;
  MEDIA: string | null;
  REQTYPE: string | null;
  PUBLICYN: string | null;
}

async function ticketOf(echoNum: string): Promise<TicketRow> {
  const rows = await select<TicketRow>(
    `SELECT PROGRESS, SUCCERSON, CUSTPERSON, MEDIA, REQTYPE, PUBLICYN
       FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
    [{ name: "e", value: echoNum }],
  );
  return rows[0];
}

/** 승인 단계를 쓰는 고객사 / 안 쓰는 고객사 — 시드에서 코드를 박지 않고 찾는다 */
let approvalCust: { code: string; system: number };
let plainCust: { code: string; system: number };

async function firstSystemOf(custCode: string): Promise<number> {
  const rows = await select<{ OPER_SYS_ID: number }>(
    `SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM
      WHERE COMPANY_CODE = @cc ORDER BY SORT_ORD, OPER_SYS_ID LIMIT 1`,
    [{ name: "cc", value: custCode }],
  );
  return Number(rows[0].OPER_SYS_ID);
}

const form = (over: Record<string, unknown> = {}) => ({
  kind: "phone",
  custCode: plainCust.code,
  systemId: String(plainCust.system),
  title: "전화로 받은 건",
  content: "마감 후 수정 요청을 전화로 받았습니다.",
  ...over,
});

beforeAll(async () => {
  const withApproval = await select<{ COMPANY_CODE: string }>(
    `SELECT COMPANY_CODE FROM COMPANY_MST WHERE CONFYN='Y' LIMIT 1`,
  );
  const without = await select<{ COMPANY_CODE: string }>(
    `SELECT COMPANY_CODE FROM COMPANY_MST
      WHERE COALESCE(CONFYN,'N')<>'Y' AND COALESCE(ACTIVE,'Y')='Y' LIMIT 1`,
  );
  approvalCust = {
    code: withApproval[0].COMPANY_CODE,
    system: await firstSystemOf(withApproval[0].COMPANY_CODE),
  };
  plainCust = {
    code: without[0].COMPANY_CODE,
    system: await firstSystemOf(without[0].COMPANY_CODE),
  };
});

describe("업무 등록 — 운영팀만, 직접 호출해도 막힌다", () => {
  it("고객사 계정은 403 — 신청 화면으로 안내한다", async () => {
    as("sj.moon");
    const res = await postTask(body(form()));
    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain("서비스 신청");
  });

  it("외부업체 계정도 403 — 배정받아 처리하는 쪽이지 발의 주체가 아니다", async () => {
    as("vd.kang");
    const res = await postTask(body(form()));
    expect(res.status).toBe(403);
  });

  it("정기 업무 생성·내리기도 같은 게이트를 쓴다", async () => {
    as("sj.moon");
    expect((await runTemplates()).status).toBe(403);
    expect(
      (await patchTemplate(body({ id: 1, active: false }, "PATCH"))).status,
    ).toBe(403);
  });
});

describe("업무 등록 — 저장되는 값", () => {
  it("등록하면 내 담당·진행(3)에서 시작하고, 출처가 남는다", async () => {
    as("sy.kim");
    const res = await postTask(body(form({ kind: "phone" })));
    expect(res.status).toBe(201);

    const created = await json(res);
    const t = await ticketOf(created.echoNum!);
    expect(t.PROGRESS).toBe("3");
    expect(t.SUCCERSON).toBe("sy.kim");
    // 포털로 들어온 것처럼 보이면 나중에 어디서 온 건인지 알 수 없다
    expect(t.MEDIA).toBe("전화");
    expect(t.REQTYPE).toBe("SERVICE");
  });

  it("'접수 전'으로 등록하면 신청(2) 에 남아 누구나 접수할 수 있다", async () => {
    as("sy.kim");
    const res = await postTask(body(form({ stage: "2" })));
    const t = await ticketOf((await json(res)).echoNum!);
    expect(t.PROGRESS).toBe("2");
    expect(t.SUCCERSON).toBeNull();
  });

  it("우리가 발의한 작업(정기·패치)은 REQTYPE=WORK 로 남는다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(form({ kind: "patch", title: "부가세 세법 패치 적용" })),
    );
    const t = await ticketOf((await json(res)).echoNum!);
    expect(t.REQTYPE).toBe("WORK");
    expect(t.MEDIA).toBe("내부");
  });

  it("🔴 승인 단계를 쓰는 고객사에 넣어도 대기(1)로 떨어지지 않는다", async () => {
    // 대기(1)은 고객사 승인권자만 풀 수 있다 — 우리가 받아 적은 건을 그 줄에 세우면
    // 아무도 진행시킬 수 없는 티켓이 된다
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          custCode: approvalCust.code,
          systemId: String(approvalCust.system),
          stage: "2",
        }),
      ),
    );
    const t = await ticketOf((await json(res)).echoNum!);
    expect(t.PROGRESS).not.toBe("1");
    expect(t.PROGRESS).toBe("2");
  });

  it("본문에 빈 '증상' 제목을 남기지 않는다", async () => {
    // 업무 등록은 증상을 따로 받지 않는다. 구획만 남으면 상세 화면에 빈 제목이 뜬다
    as("sy.kim");
    const res = await postTask(body(form({ content: "받아 적은 내용" })));
    const rows = await select<{ CONTENT: string }>(
      `SELECT CONTENT FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    expect(rows[0].CONTENT).not.toContain("증상");
    expect(rows[0].CONTENT).toContain("받아 적은 내용");
  });

  it("이력 첫 줄이 대신 등록했다는 사실을 남긴다", async () => {
    as("sy.kim");
    const res = await postTask(body(form({ kind: "email" })));
    const echoNum = (await json(res)).echoNum!;
    const logs = await select<{ COMMENT: string }>(
      `SELECT COMMENT FROM NX_OPTREPORTR WHERE PECHONUM = @e AND IS_LOG_YN='Y'`,
      [{ name: "e", value: echoNum }],
    );
    expect(logs[0].COMMENT).toContain("메일 문의");
    expect(logs[0].COMMENT).toContain("대신 등록");
  });
});

describe("업무 등록 — 이미 끝난 일도 그 상태로 기록한다", () => {
  it("완료로 등록하면 완료일·최종처리자·처리내용이 함께 찍힌다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          stage: "9",
          title: "전화로 받아 바로 처리한 건",
          answer: "권한 그룹을 다시 부여해 정상 조회되는 것을 확인했습니다.",
          workTime: "1.5",
        }),
      ),
    );
    expect(res.status).toBe(201);

    const echoNum = (await json(res)).echoNum!;
    const rows = await select<{
      PROGRESS: string;
      SUCCDATE: string | null;
      FINALSUCCER: string | null;
      FINALSUCCDATE: string | null;
      ANSWER: string | null;
      WORKTIME: number | null;
      SUCCERSON: string | null;
    }>(
      `SELECT PROGRESS, SUCCDATE, FINALSUCCER, FINALSUCCDATE, ANSWER, WORKTIME, SUCCERSON
         FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
      [{ name: "e", value: echoNum }],
    );
    const t = rows[0];
    expect(t.PROGRESS).toBe("9");
    // 🔴 완료일이 없으면 '최근 완료'(SUCCDATE 기준)와 보드 완료 컬럼에서 통째로 빠진다
    expect(t.SUCCDATE).toBeTruthy();
    expect(t.FINALSUCCDATE).toBe(t.SUCCDATE);
    expect(t.FINALSUCCER).toBe("sy.kim");
    expect(t.SUCCERSON).toBe("sy.kim");
    expect(String(t.ANSWER)).toContain("권한 그룹");
    expect(Number(t.WORKTIME)).toBe(1.5);
  });

  it("완료로 등록한 건은 '최근 완료'에 실제로 잡힌다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          stage: "9",
          title: "최근 완료 확인용",
          answer: "처리 완료했습니다.",
        }),
      ),
    );
    const echoNum = (await json(res)).echoNum!;
    const me = await currentUser();
    const done = await listRecentlyDone(me!);
    expect(done.map((r) => r.echoNum)).toContain(echoNum);
  });

  it("지난 날짜로 완료를 적을 수 있다 (나중에 기록하는 경우)", async () => {
    as("sy.kim");
    const past = todaySeoul(3);
    const res = await postTask(
      body(
        form({
          stage: "9",
          answer: "사흘 전에 처리한 건입니다.",
          doneDate: past,
        }),
      ),
    );
    expect(res.status).toBe(201);
    const rows = await select<{ SUCCDATE: string }>(
      `SELECT SUCCDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    expect(rows[0].SUCCDATE.slice(0, 10)).toBe(past);
  });

  it("🔴 처리 내용 없이 완료·해결안 제시로 등록할 수 없다", async () => {
    // 그 단계부터 고객 화면은 처리결과 탭이 기본으로 열린다 — 비면 빈 화면이 뜬다
    as("sy.kim");
    for (const stage of ["4", "9"]) {
      const res = await postTask(body(form({ stage, answer: "   " })));
      expect(res.status).toBe(400);
    }
  });

  it("완료일을 미래로 적을 수 없다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          stage: "9",
          answer: "처리했습니다.",
          doneDate: todaySeoul(-2),
        }),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("해결안 제시(4)로 등록하면 담당이 붙고 답변이 남는다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          stage: "4",
          answer: "이렇게 처리하면 됩니다. 확인 부탁드립니다.",
        }),
      ),
    );
    const rows = await select<{
      PROGRESS: string;
      SUCCERSON: string | null;
      ANSWER: string | null;
      SUCCDATE: string | null;
    }>(
      `SELECT PROGRESS, SUCCERSON, ANSWER, SUCCDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    expect(rows[0].PROGRESS).toBe("4");
    expect(rows[0].SUCCERSON).toBe("sy.kim");
    expect(String(rows[0].ANSWER)).toContain("확인 부탁");
    // 아직 끝나지 않았으므로 완료일은 없다
    expect(rows[0].SUCCDATE).toBeNull();
  });

  it("완료로 기록한 건은 이력이 '이미 끝난 건'이라고 말한다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(form({ stage: "9", answer: "처리 완료." })),
    );
    const logs = await select<{ COMMENT: string; PPROGRESS: string }>(
      `SELECT COMMENT, PPROGRESS FROM NX_OPTREPORTR
        WHERE PECHONUM = @e AND IS_LOG_YN='Y'`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    expect(logs[0].PPROGRESS).toBe("9");
    expect(logs[0].COMMENT).toContain("이미 처리가 끝난 건");
  });
});

describe("업무 등록 — 소속을 서버가 다시 확인한다 (fail-closed)", () => {
  it("다른 고객사의 운영시스템을 보내면 400", async () => {
    as("sy.kim");
    const res = await postTask(
      body(form({ systemId: String(approvalCust.system) })),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_SYSTEM");
  });

  it("그 고객사 소속이 아닌 사람을 신청자로 보내면 403", async () => {
    as("sy.kim");
    const outsider = await select<{ MBER_ID: string }>(
      `SELECT MBER_ID FROM MEMBER_MST
        WHERE USER_TYPE='B0001_02' AND COMPANY_CODE <> @cc LIMIT 1`,
      [{ name: "cc", value: plainCust.code }],
    );
    const res = await postTask(
      body(form({ requesterId: outsider[0].MBER_ID })),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("INVALID_REQUESTER");
  });

  it("없는 고객사는 400", async () => {
    as("sy.kim");
    const res = await postTask(body(form({ custCode: "ZZ999" })));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_CUSTOMER");
  });

  it("29일 이후 반복은 받지 않는다 — 없는 달이 생긴다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(form({ repeatMonthly: true, repeatDay: 31 })),
    );
    expect(res.status).toBe(400);
    // 이 앱은 한국어 전용이다 — zod 기본 영어 문구가 화면까지 새어 나가면 안 된다
    const detail = JSON.stringify((await res.json()) as unknown);
    expect(detail).toContain("반복 기준일");
    expect(detail).not.toContain("Too big");
  });
});

describe("업무 등록 — 단계에 맞지 않는 값은 서버가 버린다", () => {
  it("진행(3)으로 보내면서 처리내용·완료일·작업시간을 실어도 저장되지 않는다", async () => {
    // 화면에서 완료로 적다가 진행으로 되돌리면 감춰진 값이 그대로 실려 온다.
    // 그대로 저장하면 '해결안 없이 다음 단계로 못 간다'는 전이표 규칙이 무의미해진다.
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          stage: "3",
          answer: "실수로 남은 처리 내용",
          doneDate: todaySeoul(1),
          workTime: "2",
        }),
      ),
    );
    expect(res.status).toBe(201);
    const rows = await select<{
      PROGRESS: string;
      ANSWER: string | null;
      WORKTIME: number | null;
      SUCCDATE: string | null;
    }>(
      `SELECT PROGRESS, ANSWER, WORKTIME, SUCCDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    expect(rows[0].PROGRESS).toBe("3");
    expect(rows[0].ANSWER).toBeNull();
    expect(rows[0].WORKTIME).toBeNull();
    expect(rows[0].SUCCDATE).toBeNull();
  });

  it("완료일을 안 고르면 완료일과 접수일이 같은 시계에서 나온다", async () => {
    // 날짜(KST)와 시각(서버 로컬)을 섞으면 KST 새벽에 완료일이 접수일보다 하루 뒤가 된다
    as("sy.kim");
    const res = await postTask(
      body(form({ stage: "9", answer: "바로 처리했습니다." })),
    );
    const rows = await select<{ REQDATE: string; SUCCDATE: string }>(
      `SELECT REQDATE, SUCCDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e`,
      [{ name: "e", value: (await json(res)).echoNum! }],
    );
    expect(rows[0].SUCCDATE).toBe(rows[0].REQDATE);
  });

  it("완료일 형식이 날짜가 아니면 거부한다 — 그대로 저장하면 영원히 '-' 로 보인다", async () => {
    as("sy.kim");
    for (const doneDate of [
      "2026-08-01T00:00:00Z",
      "2026-08-20 10:00:00",
      "1970-01-01",
    ]) {
      const res = await postTask(
        body(form({ stage: "9", answer: "처리했습니다.", doneDate })),
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("등록 후 어디서 보이나 — 목록이 비어 보이면 저장 실패로 읽힌다", () => {
  it("접수 전(2)은 '진행 중', 나머지는 '내 담당'으로 데려간다", () => {
    // 2 는 담당이 없고 신청자도 고객사 사람이라 '내 담당'에는 안 걸린다
    expect(listViewForStage("2")).toBe("open");
    // 9 는 미완료 목록에서 빠지지만 담당이 나라서 '내 담당'에는 있다
    expect(listViewForStage("9")).toBe("mine");
    expect(listViewForStage("3")).toBe("mine");
    expect(listViewForStage("4")).toBe("mine");
  });

  it("접수 전으로 등록한 건은 실제로 '진행 중' 목록에 있다", async () => {
    as("sy.kim");
    const requester = await select<{ MBER_ID: string }>(
      `SELECT MBER_ID FROM MEMBER_MST
        WHERE USER_TYPE='B0001_02' AND COMPANY_CODE = @cc LIMIT 1`,
      [{ name: "cc", value: plainCust.code }],
    );
    const res = await postTask(
      body(
        form({
          stage: "2",
          title: "접수 전으로 남겨 둔 건",
          requesterId: requester[0].MBER_ID,
        }),
      ),
    );
    const echoNum = (await json(res)).echoNum!;
    const me = await currentUser();
    const open = await listTickets(
      {
        view: "open",
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
      },
      me!,
    );
    expect(open.rows.map((r) => r.echoNum)).toContain(echoNum);
  });
});

describe("정기 업무 — 여러 번 눌러도 한 건", () => {
  it("반복으로 등록하면 템플릿이 남고, 이번 달은 이미 만든 것으로 표시된다", async () => {
    as("sy.kim");
    const res = await postTask(
      body(
        form({
          kind: "routine",
          title: "월 백업 확인 (테스트)",
          repeatMonthly: true,
          repeatDay: 5,
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).repeating).toBe(true);

    const rows = await select<{ LAST_RUN_YM: string | null; OWNER: string }>(
      `SELECT LAST_RUN_YM, OWNER FROM NX_TASK_TEMPLATE
        WHERE TITLE = '월 백업 확인 (테스트)'`,
    );
    expect(rows).toHaveLength(1);
    // 방금 이번 달 건을 만들었으니 이번 달은 다시 만들지 않는다
    expect(rows[0].LAST_RUN_YM).toBe(currentYm());
    expect(rows[0].OWNER).toBe("sy.kim");
  });

  it("이번 달 생성을 두 번 눌러도 두 번째는 만들 것이 없다", async () => {
    as("sy.kim");
    const first = await json(await runTemplates());
    expect(first.code).toBe("CREATED");
    expect((first.created ?? []).length).toBeGreaterThan(0);

    const second = await json(await runTemplates());
    expect(second.code).toBe("NOTHING_TO_DO");
    expect(second.created ?? []).toHaveLength(0);
  });

  it("만들어진 정기 업무는 템플릿의 담당자에게 붙는다", async () => {
    const rows = await select<{ ECHONUM: string; SUCCERSON: string | null }>(
      `SELECT ECHONUM, SUCCERSON FROM NX_OPTREPORTD
        WHERE MEDIA='내부' AND REQTYPE='WORK' AND PROGRESS='3'
        ORDER BY ECHONUM DESC LIMIT 5`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.SUCCERSON).not.toBeNull();
  });

  it("내린 템플릿은 다음 달 생성 대상에서 빠진다", async () => {
    as("sy.kim");
    const target = await select<{ ID: number }>(
      `SELECT ID FROM NX_TASK_TEMPLATE WHERE COALESCE(ACTIVE,'Y')='Y' LIMIT 1`,
    );
    const res = await patchTemplate(
      body({ id: target[0].ID, active: false }, "PATCH"),
    );
    expect(res.status).toBe(200);

    const after = await select<{ ACTIVE: string }>(
      `SELECT ACTIVE FROM NX_TASK_TEMPLATE WHERE ID = @id`,
      [{ name: "id", value: target[0].ID }],
    );
    // 지우지 않는다 — 이미 만들어진 티켓이 어디서 왔는지 남아야 한다
    expect(after[0].ACTIVE).toBe("N");
  });

  it("비활성 고객사의 정기 업무는 생성 대상에서 빠진다", async () => {
    // 고객사 '삭제'는 비활성이다(ADR-0010). 거래가 끝난 곳에 매달 티켓이 계속 생기면
    // 그 고객사는 화면 어디에도 없어 아무도 눈치채지 못한다
    as("sy.kim");
    const before = await listPendingTemplates();
    const target = await select<{ ID: number; CUSTCODE: string }>(
      `SELECT ID, CUSTCODE FROM NX_TASK_TEMPLATE WHERE COALESCE(ACTIVE,'Y')='Y' LIMIT 1`,
    );
    await write([
      {
        sql: `UPDATE NX_TASK_TEMPLATE SET LAST_RUN_YM = NULL WHERE ID = @id`,
        params: [{ name: "id", value: target[0].ID }],
      },
      {
        sql: `UPDATE COMPANY_MST SET ACTIVE = 'N' WHERE COMPANY_CODE = @cc`,
        params: [{ name: "cc", value: target[0].CUSTCODE }],
      },
    ]);

    const after = await listPendingTemplates();
    expect(after.map((t) => t.id)).not.toContain(target[0].ID);
    expect(after.length).toBeLessThanOrEqual(before.length);

    // 되돌린다 — 뒤 테스트가 이 고객사를 쓸 수 있다
    await write([
      {
        sql: `UPDATE COMPANY_MST SET ACTIVE = 'Y' WHERE COMPANY_CODE = @cc`,
        params: [{ name: "cc", value: target[0].CUSTCODE }],
      },
    ]);
  });

  it("이번 달 기준은 한국 벽시계다 — UTC 로 재면 1일 새벽에 지난달을 본다", () => {
    expect(currentYm()).toBe(todaySeoul().slice(0, 7));
  });

  it("없는 템플릿을 내리면 404 — 200 을 주면 화면만 성공한 것처럼 보인다", async () => {
    as("sy.kim");
    const res = await patchTemplate(
      body({ id: 999999, active: false }, "PATCH"),
    );
    expect(res.status).toBe(404);
  });
});
