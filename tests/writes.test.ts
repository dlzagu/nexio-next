import { beforeAll, describe, expect, it } from "vitest";
import type { TicketDetail, TicketFilters, User } from "@/lib/types";

/**
 * 쓰기 경로 통합 테스트 — 실제 SQLite(:memory:)에 시드를 만들고 진짜로 INSERT/UPDATE 한다.
 *
 * 핵심 검증 대상:
 *  1. 쓰기 관문(write)이 fail-closed 인가 — 플래그·구문 종류
 *  2. 상태 전이가 정본표대로 돌고 **이력 로그가 같은 트랜잭션에서** 남는가
 *  3. 저장 시점 새니타이즈 — 읽기에서만 거르지 않는다
 *  4. 신청 저장의 채번·승인 분기·재신청 연결
 *
 * ⚠️ 환경변수는 db() 최초 호출 "전"에 세팅해야 한다 (dbPath 가 지연 평가).
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

import {
  applyAction,
  SolutionRequiredError,
  addComment,
  createTicket,
  UnsupportedActionError,
} from "@/lib/data/mutations";
import {
  getComments,
  getReRequestSeed,
  getTicket,
  listTickets,
} from "@/lib/data/tickets";
import {
  devWritesAllowed,
  isSharedDb,
  select,
  write,
  writeDisabledReason,
  WriteDisabledError,
} from "@/lib/db";

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

const internal: User = {
  id: "sy.kim",
  name: "김서연",
  role: "INTERNAL",
  custCode: "NX000",
  custName: "(주)넥시오솔루션",
  dept: "서비스운영팀",
  email: "sy.kim@nexio-ops.example",
  isApprover: false,
};
const hbApprover: User = {
  ...internal,
  id: "hb.yoon",
  role: "CUSTOMER",
  custCode: "HB001",
  custName: "한빛제약",
  isApprover: true,
};

/** 아직 손대지 않은 티켓을 상태별로 하나 집는다 (테스트끼리 같은 건을 물지 않게) */
const taken = new Set<string>();
async function pick(
  progress: string,
  over: Partial<TicketFilters> = {},
): Promise<TicketDetail> {
  const { rows } = await listTickets(
    filters({ progress, ...over }),
    internal,
    1,
  );
  const row = rows.find((r) => !taken.has(r.echoNum));
  if (!row) throw new Error(`상태 ${progress} 인 티켓이 없다`);
  taken.add(row.echoNum);
  const t = await getTicket(row.echoNum, internal);
  if (!t) throw new Error(`${row.echoNum} 상세 조회 실패`);
  return t;
}

async function logRows(echoNum: string) {
  return select<{ PPROGRESS: string; COMMENT: string }>(
    `SELECT PPROGRESS, COMMENT FROM NX_OPTREPORTR
      WHERE PECHONUM = @en AND IS_LOG_YN = 'Y' ORDER BY ID`,
    [{ name: "en", value: echoNum }],
  );
}

beforeAll(async () => {
  // 첫 쿼리가 시드를 트리거한다
  await select("SELECT 1 AS ok");
});

/** 처리내역 패치의 빈 형태. 여러 곳에서 answer 만 채워 쓴다 */
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

describe("쓰기 관문 — fail-closed", () => {
  it("INSERT/UPDATE 외 구문은 실행하지 않는다", async () => {
    await expect(
      write([{ sql: "DELETE FROM NX_OPTREPORTR WHERE ID = 1" }]),
    ).rejects.toThrow(/INSERT\/UPDATE/);
    await expect(write([{ sql: "DROP TABLE NX_OPTREPORTD" }])).rejects.toThrow(
      /INSERT\/UPDATE/,
    );
    // 주석으로 앞을 가려도 통하지 않는다
    await expect(
      write([{ sql: "/* update */ DELETE FROM NX_OPTREPORTR" }]),
    ).rejects.toThrow(/INSERT\/UPDATE/);
  });

  it("ALLOW_DEV_WRITES 가 꺼져 있으면 관문 안쪽에서 막힌다", async () => {
    process.env.ALLOW_DEV_WRITES = "false";
    try {
      await expect(
        write([
          {
            sql: "UPDATE NX_OPTREPORTD SET TITLE = 'x' WHERE ECHONUM = 'none'",
          },
        ]),
      ).rejects.toBeInstanceOf(WriteDisabledError);
    } finally {
      process.env.ALLOW_DEV_WRITES = "true";
    }
  });

  it("전이표에 없는 액션은 실행되지 않는다", async () => {
    const t = await pick("9");
    await expect(
      applyAction({ ticket: t, user: internal, action: "reapply" }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });
});

describe("상태 전이 + 이력 로그", () => {
  it("접수(2→3) — 미배정 건은 접수한 사람이 담당자가 된다", async () => {
    const t = await pick("2");
    const before = (await logRows(t.echoNum)).length;

    await applyAction({ ticket: t, user: internal, action: "receive" });

    const after = await getTicket(t.echoNum, internal);
    expect(after?.progress).toBe("3");
    expect(after?.assigneeId).toBe(t.assigneeId ?? internal.id);

    const logs = await logRows(t.echoNum);
    expect(logs.length).toBe(before + 1);
    expect(logs[logs.length - 1].PPROGRESS).toBe("3");
  });

  it("🔴 답변이 비어 있으면 해결안을 제시할 수 없다", async () => {
    const t = await pick("3");
    // 상태만 4 로 넘어가면 고객 화면의 '처리결과' 탭이 빈 채로 열린다
    await expect(
      applyAction({ ticket: t, user: internal, action: "propose" }),
    ).rejects.toBeInstanceOf(SolutionRequiredError);
    expect((await getTicket(t.echoNum, internal))?.progress).toBe("3");
  });

  it("해결안 제시(3→4) 와 완료(4→9) — 완료는 종료일·최종처리자를 찍는다", async () => {
    const t = await pick("3");
    await applyAction({
      ticket: t,
      user: internal,
      action: "propose",
      solution: { ...blankSolution, answer: "<p>패치 적용했습니다</p>" },
    });
    const proposed = await getTicket(t.echoNum, internal);
    expect(proposed?.progress).toBe("4");
    expect(proposed?.succDate).toBeNull();

    await applyAction({
      ticket: proposed!,
      user: internal,
      action: "complete",
    });
    const done = await getTicket(t.echoNum, internal);
    expect(done?.progress).toBe("9");
    expect(done?.succDate).not.toBeNull();
    expect(done?.history.finalAssignee).toBe(internal.id);
  });

  it("승인(1→2) — 승인자·승인일시가 남는다", async () => {
    const t = await pick("1", { custCode: "HB001" });
    await applyAction({
      ticket: t,
      user: hbApprover,
      action: "approve",
      reason: "예산 범위 내 진행 승인합니다.",
    });
    const after = await getTicket(t.echoNum, internal);
    expect(after?.progress).toBe("2");
    expect(after?.history.approver).toBe(hbApprover.id);
    expect(after?.history.approvedAt).not.toBeNull();
    expect(after?.history.memos.some((m) => m.label === "승인 메모")).toBe(
      true,
    );
  });

  it("취소(2→11) — 취소자·취소일시가 남는다", async () => {
    const t = await pick("2");
    await applyAction({ ticket: t, user: hbApprover, action: "cancel" });
    const after = await getTicket(t.echoNum, internal);
    expect(after?.progress).toBe("11");
    expect(after?.history.canceler).toBe(hbApprover.id);
    expect(after?.history.canceledAt).not.toBeNull();
  });

  it("취소 권유는 상태를 바꾸지 않고 **사람 댓글**로 남는다 (시스템 기록에 묻히지 않게)", async () => {
    const t = await pick("3");
    await applyAction({
      ticket: t,
      user: internal,
      action: "suggestCancel",
      reason: "중복 접수로 보입니다.",
    });
    const after = await getTicket(t.echoNum, internal);
    expect(after?.progress).toBe("3");
    const posted = after!.comments.filter(
      (c) => !c.isLog && c.body.includes("취소를 권유"),
    );
    expect(posted.length).toBe(1);
    expect(posted[0].body).toContain("중복 접수로 보입니다.");
  });
});

describe("처리내역 저장", () => {
  it("저장 시점에도 새니타이즈한다 — 읽기에서만 거르면 저장된 마크업이 남는다", async () => {
    const t = await pick("3");
    await applyAction({
      ticket: t,
      user: internal,
      action: "save",
      solution: {
        ...blankSolution,
        cause: "<p>원인 확인</p><script>alert(1)</script>",
        answer: "<p>조치 완료</p>",
        workTime: "2.5",
        surTime: "",
      },
    });

    const stored = await select<{ CAUSE: string; SURTIME: number | null }>(
      `SELECT CAUSE, SURTIME FROM NX_OPTREPORTD WHERE ECHONUM = @en`,
      [{ name: "en", value: t.echoNum }],
    );
    expect(stored[0].CAUSE).not.toContain("script");
    expect(stored[0].CAUSE).toContain("원인 확인");
    // 빈 시간 입력은 0 이 아니라 미입력(null)이다
    expect(stored[0].SURTIME).toBeNull();

    const after = await getTicket(t.echoNum, internal);
    expect(after?.progress).toBe("3"); // 저장은 상태를 바꾸지 않는다
    expect(after?.solution.workTime).toBe(2.5);
    // 저장할 때마다 이력이 쌓이면 이력 탭이 무의미해진다 → 로그를 남기지 않는다
    expect((await logRows(t.echoNum)).every((l) => l.PPROGRESS !== null)).toBe(
      true,
    );
  });
});

describe("댓글", () => {
  it("등록한 댓글이 보이고, 본인에게는 미읽음으로 뜨지 않는다", async () => {
    const t = await pick("3");
    await addComment({
      echoNum: t.echoNum,
      user: internal,
      body: "<p>확인 후 회신드리겠습니다.</p>",
      adminOnly: false,
    });

    const comments = await getComments(t.echoNum, "INTERNAL");
    expect(comments.at(-1)?.body).toContain("확인 후 회신드리겠습니다");
    expect(comments.at(-1)?.userId).toBe(internal.id);

    const { rows } = await listTickets(
      filters({ keyword: t.echoNum }),
      internal,
    );
    expect(rows[0].hasUnreadComment).toBe(false);
  });

  it("액션에 딸려 온 댓글도 내부 전용 강등을 지난다 — addComment 경로만 막으면 뚫린다", async () => {
    const t = await pick("2");
    const requester: User = {
      ...hbApprover,
      id: t.requesterId ?? hbApprover.id,
      custCode: t.custCode,
    };
    // 고객사 신청자가 취소하면서 '내부 전용' 댓글을 끼워 보낸다
    await applyAction({
      ticket: t,
      user: requester,
      action: "cancel",
      comment: { body: "<p>중복 접수라 취소합니다.</p>", adminOnly: true },
    });

    const stored = await select<{ ADMIN_ONLY_YN: string; COMMENT: string }>(
      `SELECT ADMIN_ONLY_YN, COMMENT FROM NX_OPTREPORTR
        WHERE PECHONUM = @en AND IS_LOG_YN = 'N' ORDER BY ID DESC LIMIT 1`,
      [{ name: "en", value: t.echoNum }],
    );
    expect(stored[0].COMMENT).toContain("중복 접수");
    expect(stored[0].ADMIN_ONLY_YN).toBe("N");
  });

  it("외부업체도 내부 전용을 켤 수 없다 — 쓰기 축과 읽기 축이 같아야 한다", async () => {
    const t = await pick("3");
    const vendor: User = {
      ...internal,
      id: "vd.kang",
      role: "VENDOR",
      custCode: "VN001",
    };
    await addComment({
      echoNum: t.echoNum,
      user: vendor,
      body: "<p>외부업체 처리 메모</p>",
      adminOnly: true,
    });
    // 읽기 가드는 INTERNAL 만 통과시키므로, 켜졌다면 본인에게도 안 보인다
    const asVendor = await getComments(t.echoNum, "VENDOR");
    expect(asVendor.some((c) => c.body.includes("외부업체 처리 메모"))).toBe(
      true,
    );
  });

  it("고객사가 내부 전용으로 보내도 내부 전용이 되지 않는다 (fail-closed)", async () => {
    const t = await pick("3");
    await addComment({
      echoNum: t.echoNum,
      user: hbApprover,
      body: "<p>고객사 코멘트</p>",
      adminOnly: true,
    });
    const asCustomer = await getComments(t.echoNum, "CUSTOMER");
    expect(asCustomer.some((c) => c.body.includes("고객사 코멘트"))).toBe(true);
  });
});

describe("신청 저장", () => {
  const form = {
    requesterId: "sj.moon",
    systemId: "",
    title: "매출 마감 화면에서 조회 오류",
    symptom: "조회 버튼을 누르면 아무 반응이 없습니다.\n두 번째 줄 증상.",
    content: "원인 확인 부탁드립니다.",
    moduleCode: "7",
    priority: "2",
    scheDate: "",
    isPublic: true,
    refEmails: [] as string[],
    parentEchoNum: null,
  };

  async function systemOf(custCode: string): Promise<string> {
    const rows = await select<{ OPER_SYS_ID: number }>(
      `SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM WHERE COMPANY_CODE = @cc LIMIT 1`,
      [{ name: "cc", value: custCode }],
    );
    return String(rows[0].OPER_SYS_ID);
  }

  it("승인 단계를 안 쓰는 고객사는 바로 신청(2)으로 접수된다", async () => {
    const created = await createTicket(
      {
        ...form,
        custCode: "SJ001",
        systemId: await systemOf("SJ001"),
        usesApproval: false,
      },
      internal,
    );
    expect(created.progress).toBe("2");
    expect(created.echoNum).toMatch(/^SJ-\d{6}-\d{3}$/);

    const t = await getTicket(created.echoNum, internal);
    expect(t?.title).toBe(form.title);
    expect(t?.requesterId).toBe("sj.moon");
    expect(t?.isPublic).toBe(true);
    expect(t?.assigneeId).toBeNull(); // 미배정으로 접수
    // 접수 로그가 같이 남는다
    expect((await logRows(created.echoNum)).length).toBe(1);
  });

  it("승인 단계를 쓰는 고객사는 대기(1)에서 승인을 기다린다", async () => {
    const created = await createTicket(
      {
        ...form,
        custCode: "HB001",
        requesterId: "hb.yoon",
        systemId: await systemOf("HB001"),
        usesApproval: true,
      },
      hbApprover,
    );
    expect(created.progress).toBe("1");
    expect(created.echoNum).toMatch(/^HB-\d{6}-\d{3}$/);
  });

  it("채번이 그 고객사의 기존 번호를 이어받는다", async () => {
    const sys = await systemOf("SJ001");
    const a = await createTicket(
      { ...form, custCode: "SJ001", systemId: sys, usesApproval: false },
      internal,
    );
    const b = await createTicket(
      { ...form, custCode: "SJ001", systemId: sys, usesApproval: false },
      internal,
    );
    const seq = (echo: string) => Number(echo.split("-")[2]);
    expect(seq(b.echoNum)).toBe(seq(a.echoNum) + 1);
    expect(b.echoNum.slice(0, 10)).toBe(a.echoNum.slice(0, 10));
  });

  it("재신청은 원본과 연결되고, 본문이 폼 두 칸으로 되돌아온다", async () => {
    const parent = await pick("9");
    const created = await createTicket(
      {
        ...form,
        custCode: parent.custCode,
        requesterId: parent.requesterId!,
        systemId: await systemOf(parent.custCode),
        usesApproval: false,
        parentEchoNum: parent.echoNum,
      },
      internal,
    );

    const t = await getTicket(created.echoNum, internal);
    expect(t?.request.isReRequest).toBe(true);
    expect(t?.request.parentEchoNum).toBe(parent.echoNum);

    // 저장 본문(HTML 한 덩어리) → 증상/요청내용 두 칸 왕복
    const seed = await getReRequestSeed(created.echoNum, internal);
    expect(seed?.symptom).toBe(form.symptom);
    expect(seed?.content).toBe(form.content);
    expect(seed?.priority).toBe("2");
    expect(seed?.moduleCode).toBe("7");
  });
});

describe("쓰기 기본값 — 저장소가 정한다", () => {
  const withEnv = (
    env: Record<string, string | undefined>,
    run: () => void,
  ) => {
    const prev = { ...process.env };
    try {
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      run();
    } finally {
      process.env.ALLOW_DEV_WRITES = prev.ALLOW_DEV_WRITES;
      process.env.VERCEL = prev.VERCEL;
      if (prev.VERCEL === undefined) delete process.env.VERCEL;
    }
  };

  it("로컬(파일 DB)에서는 환경변수 없이도 저장된다", () => {
    withEnv({ ALLOW_DEV_WRITES: undefined, VERCEL: undefined }, () => {
      expect(devWritesAllowed()).toBe(true);
    });
  });

  it("서버리스(:memory:)에서는 잠긴다 — 인스턴스마다 DB 가 달라 저장이 어긋난다", () => {
    withEnv({ ALLOW_DEV_WRITES: undefined, VERCEL: "1" }, () => {
      expect(devWritesAllowed()).toBe(false);
      // 안내 문구가 "켜세요"가 아니라 **왜 잠갔는지**를 말한다
      expect(writeDisabledReason()).toContain("인스턴스");
    });
  });

  it("환경변수를 주면 그 값이 이긴다 (공유 DB 를 붙이면 배포에서도 연다)", () => {
    withEnv({ ALLOW_DEV_WRITES: "true", VERCEL: "1" }, () => {
      expect(devWritesAllowed()).toBe(true);
    });
    withEnv({ ALLOW_DEV_WRITES: "false", VERCEL: undefined }, () => {
      expect(devWritesAllowed()).toBe(false);
    });
  });
});

describe("공유 DB — 붙으면 배포에서도 열린다", () => {
  it("TURSO_DATABASE_URL 이 있으면 서버리스에서도 쓰기가 허용된다", () => {
    const prev = { ...process.env };
    try {
      delete process.env.ALLOW_DEV_WRITES;
      process.env.VERCEL = "1";
      // 공유 DB 없이는 잠긴다 (인스턴스마다 메모리 DB 라 저장이 어긋난다)
      delete process.env.TURSO_DATABASE_URL;
      expect(isSharedDb()).toBe(false);
      expect(devWritesAllowed()).toBe(false);

      // 모든 인스턴스가 같은 DB 를 보면 잠글 이유가 없다
      process.env.TURSO_DATABASE_URL = "libsql://demo.example.turso.io";
      expect(isSharedDb()).toBe(true);
      expect(devWritesAllowed()).toBe(true);

      // 그래도 명시적 잠금은 이긴다
      process.env.ALLOW_DEV_WRITES = "false";
      expect(devWritesAllowed()).toBe(false);
    } finally {
      process.env.ALLOW_DEV_WRITES = prev.ALLOW_DEV_WRITES;
      if (prev.ALLOW_DEV_WRITES === undefined)
        delete process.env.ALLOW_DEV_WRITES;
      if (prev.VERCEL === undefined) delete process.env.VERCEL;
      if (prev.TURSO_DATABASE_URL === undefined)
        delete process.env.TURSO_DATABASE_URL;
    }
  });
});

describe("접수 — 분류 확정", () => {
  it("접수하면서 운영시스템·모듈·예상시간·예상처리일을 함께 확정한다", async () => {
    const t = await pick("2");
    const before = (await logRows(t.echoNum)).length;

    await applyAction({
      ticket: t,
      user: internal,
      action: "receive",
      triage: {
        systemId: "14",
        systemName: "ERP 운영계",
        moduleCode: "4",
        expeTime: 8,
        scheDate: "2026-09-01",
      },
    });

    const after = await getTicket(t.echoNum, internal);
    expect(after?.progress).toBe("3");
    expect(after?.systemId).toBe("14");
    expect(after?.moduleCode).toBe("4");
    expect(after?.solution.expeTime).toBe(8);
    expect(after?.scheDate?.slice(0, 10)).toBe("2026-09-01");

    // 🔴 무엇을 바꿨는지 이력에 남는다 — 안 남기면 누가 언제 분류를 바꿨는지 알 수 없다
    const logs = await logRows(t.echoNum);
    expect(logs.length).toBe(before + 1);
    expect(logs.at(-1)?.COMMENT).toContain("ERP 운영계");
    expect(logs.at(-1)?.COMMENT).toContain("예상 8h");
  });

  it("빈 값은 **건드리지 않는다** (지우기가 아니라 유지)", async () => {
    const t = await pick("2");
    const keepSystem = t.systemId;
    const keepModule = t.moduleCode;

    await applyAction({
      ticket: t,
      user: internal,
      action: "receive",
      triage: { systemId: "", moduleCode: "", scheDate: "" },
    });

    const after = await getTicket(t.echoNum, internal);
    expect(after?.systemId).toBe(keepSystem);
    expect(after?.moduleCode).toBe(keepModule);
  });

  it("접수가 아닌 액션에는 분류가 딸려 가지 않는다", async () => {
    const t = await pick("3");
    const keep = t.systemId;
    await applyAction({
      ticket: t,
      user: internal,
      action: "propose",
      solution: { ...blankSolution, answer: "<p>조치했습니다</p>" },
      triage: { systemId: "14", systemName: "ERP 운영계" },
    });
    expect((await getTicket(t.echoNum, internal))?.systemId).toBe(keep);
  });
});
