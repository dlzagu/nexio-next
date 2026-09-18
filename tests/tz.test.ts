// @vitest-environment node
/**
 * 서버 시계 — 배포처(Vercel)는 **UTC** 다. 개발 PC(KST)에서는 절대 드러나지 않는다.
 *
 * 저장값은 전부 타임존 없는 한국 벽시계라, 쓰기 스탬프·채번·'최근 N일' 경계가 서버 로컬
 * 시계를 보면 라이브에서만 9시간 어긋난다 — 월초 새벽에 만든 요청이 지난달 번호를 받고,
 * 방금 단 댓글이 '9시간 전'으로 그려진다. 그래서 이 파일은 **서버 조건(UTC)을 고정**하고 본다.
 *
 * ⚠️ TZ 는 import 보다 먼저 둔다. Node 는 실행 중에 바꾼 TZ 도 반영하지만, 반영이 안 되는
 *    실행 환경이면 아래 첫 테스트가 먼저 깨져 "통과했는데 아무것도 안 본" 상태를 막는다.
 */
process.env.TZ = "UTC";
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTicket } from "@/lib/data/mutations";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/data/notifications";
import { listRecentlyDone } from "@/lib/data/tickets";
import { select, write } from "@/lib/db";
import { toDbStamp } from "@/lib/format";
import type { User } from "@/lib/types";

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

/** KST 10월 1일 03:00 = UTC 9월 30일 18:00 — 서버 로컬로 재면 '지난달'이 되는 순간 */
const MONTH_EDGE = new Date("2026-09-30T18:00:00Z");

beforeAll(async () => {
  // 시드는 실제 시각으로 먼저 만든다 (가짜 시계로 시드를 만들면 다른 것을 재게 된다)
  await select("SELECT 1 AS ok");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("서버 타임존이 UTC 여도 저장 시계는 한국 벽시계다", () => {
  it("전제 — 이 파일은 정말 UTC 로 돈다", () => {
    expect(MONTH_EDGE.getHours()).toBe(18);
    expect(MONTH_EDGE.getDate()).toBe(30);
  });

  it("toDbStamp 는 서버 로컬이 아니라 KST 로 찍는다", () => {
    expect(toDbStamp(MONTH_EDGE)).toBe("2026-10-01 03:00:00");
  });

  it("🔴 채번의 연·월은 REQDATE 와 같은 시계를 본다 — 월초 새벽에 지난달 번호를 받지 않는다", async () => {
    const sys = await select<{ OPER_SYS_ID: number }>(
      `SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM WHERE COMPANY_CODE = 'SJ001' LIMIT 1`,
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MONTH_EDGE);

    const created = await createTicket(
      {
        custCode: "SJ001",
        requesterId: "sj.moon",
        systemId: String(sys[0].OPER_SYS_ID),
        title: "월초 새벽 신청",
        symptom: "증상",
        content: "내용",
        moduleCode: "",
        priority: "3",
        scheDate: "",
        isPublic: true,
        refEmails: [],
        parentEchoNum: null,
        usesApproval: false,
      },
      internal,
    );
    vi.useRealTimers();

    const rows = await select<{ REQDATE: string }>(
      "SELECT REQDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e",
      [{ name: "e", value: created.echoNum }],
    );
    const reqDate = rows[0].REQDATE;
    expect(reqDate).toBe("2026-10-01 03:00:00");

    // 번호의 YYYYMM == REQDATE 의 연·월 (한 트랜잭션 안에 시계가 둘이면 안 된다)
    const ym = created.echoNum.split("-")[1];
    expect(ym).toBe(reqDate.slice(0, 4) + reqDate.slice(5, 7));
    expect(ym).toBe("202610");
  });
});

describe("'최근 N일' 경계도 저장과 같은 시계로 자른다", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  /** 지금부터 ms 전의 저장 스탬프 (한국 벽시계) */
  const ago = (ms: number) => toDbStamp(new Date(Date.now() - ms));

  it("보드 '최근 완료'(30일) — 30일 4시간 전 완료는 빠지고 29일 20시간 전은 들어온다", async () => {
    const rows = await select<{ ECHONUM: string }>(
      `SELECT ECHONUM FROM NX_OPTREPORTD
        WHERE COALESCE(REQTYPE,'') <> 'MIGRATION' ORDER BY ECHONUM LIMIT 2`,
    );
    const [outside, inside] = rows.map((r) => r.ECHONUM);
    const done = (echo: string, at: string) => ({
      sql: `UPDATE NX_OPTREPORTD SET PROGRESS = '9', SUCCDATE = @at WHERE ECHONUM = @e`,
      params: [
        { name: "at", value: at },
        { name: "e", value: echo },
      ],
    });
    await write([
      done(outside, ago(30 * DAY + 4 * HOUR)),
      done(inside, ago(30 * DAY - 4 * HOUR)),
    ]);

    // 서버 로컬(UTC)로 경계를 만들면 창이 9시간 넓어져 30일 4시간 전 건까지 들어온다
    const list = (await listRecentlyDone(internal, 30, 100_000)).map(
      (r) => r.echoNum,
    );
    expect(list).toContain(inside);
    expect(list).not.toContain(outside);
  });

  it("알림(30일) — 창 밖의 안 읽은 글은 알림이 아니다", async () => {
    const rows = await select<{ ECHONUM: string }>(
      `SELECT ECHONUM FROM NX_OPTREPORTD
        WHERE SUCCERSON = 'sy.kim' AND PROGRESS = '3' ORDER BY ECHONUM LIMIT 1`,
    );
    const echoNum = rows[0].ECHONUM;
    await markNotificationsRead(internal, echoNum);

    const comment = (at: string) => ({
      sql: `INSERT INTO NX_OPTREPORTR
              (PECHONUM, USERID, COMMENT, COMMDATE, ADMIN_ONLY_YN, IS_LOG_YN)
            VALUES (@e, 'vd.kang', '<p>오래된 글</p>', @at, 'N', 'N')`,
      params: [
        { name: "e", value: echoNum },
        { name: "at", value: at },
      ],
    });

    await write([comment(ago(30 * DAY + 4 * HOUR))]);
    expect(
      (await listNotifications(internal)).items.map((n) => n.echoNum),
    ).not.toContain(echoNum);

    // 대조군 — 창 안의 글은 알림이 된다
    await write([comment(ago(30 * DAY - 4 * HOUR))]);
    expect(
      (await listNotifications(internal)).items.map((n) => n.echoNum),
    ).toContain(echoNum);
  });
});
