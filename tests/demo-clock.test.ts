/**
 * 데모 시계 (ADR-0012) — 가상 시드가 달력과 함께 늙지 않는가.
 *
 * 재현한 증상(라이브 9/18): 시드를 8월에 만든 뒤 한 달이 지나자 조회 첫 화면
 * ('내 담당 · 최근 15일')이 모든 방문자에게 0건이었다. 여기서는 '지금'을 주입해
 * 한 달 뒤를 만들고, 밀기 전(0건)과 민 뒤(>0건)를 함께 고정한다.
 *
 * ⚠️ SQLITE_PATH 는 db() 최초 호출 "전"에 설정한다 (dbPath 가 지연 평가).
 */
process.env.SQLITE_PATH = ":memory:";

import { describe, expect, it } from "vitest";
import {
  addDaysStamp,
  ELIGIBLE_UNITS_SQL,
  inferLegacyAnchor,
  rebaseStatements,
  seedAnchor,
  shiftDays,
} from "@/lib/dev-seed/clock";
import { NOTICES } from "@/lib/dev-seed/corpus";
import { listTickets } from "@/lib/data/tickets";
import { alignDemoClock, select, write } from "@/lib/db";
import { loadUser } from "@/lib/session";
import type { TicketFilters } from "@/lib/types";

const one = async <T>(
  sql: string,
  params: { name: string; value: string }[] = [],
) => (await select<T>(sql, params))[0];

const anchorNow = async () =>
  (await one<{ ANCHOR: string }>("SELECT ANCHOR FROM NX_DEMO_CLOCK")).ANCHOR;

describe("데모 시계 — 순수 규칙", () => {
  it("시드 기준은 만든 날의 끝이다 (그날 업무시간에 찍힌 '오늘' 항목까지 포함)", () => {
    expect(seedAnchor("2026-08-25 10:12:00")).toBe("2026-08-25 23:59:59");
  });

  it("만 하루가 지나야 민다 — 미는 폭은 흐른 만 하루 수라 미래를 만들지 않는다", () => {
    const a = "2026-08-25 23:59:59";
    expect(shiftDays(a, "2026-08-26 09:00:00")).toBe(0);
    expect(shiftDays(a, "2026-08-27 00:00:00")).toBe(1);
    expect(shiftDays(a, "2026-09-18 11:00:00")).toBe(23);
    expect(shiftDays(a, "2026-08-20 00:00:00")).toBe(0); // 과거로는 밀지 않는다
    expect(shiftDays("이상한 값", "2026-09-18 11:00:00")).toBe(0);
    // 미래 금지: 기준까지의 모든 값 + 민 폭 ≤ 지금
    expect(
      addDaysStamp(a, shiftDays(a, "2026-09-18 11:00:00")) <=
        "2026-09-18 11:00:00",
    ).toBe(true);
  });

  it("옛 공유 DB 의 기준은 가장 최근 시드 공지에서 역산한다", () => {
    const now = "2026-09-18 11:00:00";
    const newest = Math.min(...NOTICES.map((n) => n.daysAgo));
    const anchor = inferLegacyAnchor("2026-08-16 14:03:00", now);
    expect(anchor).toBe(
      `${addDaysStamp("2026-08-16 00:00:00", newest).slice(0, 10)} 23:59:59`,
    );
    expect(inferLegacyAnchor(null, now)).toBeNull();
    expect(inferLegacyAnchor("1900-01-01 00:00:00", now)).toBeNull();
  });

  it("역산한 기준이 지금보다 뒤면 모른다고 한다 — 틀린 증인으로 기준을 적으면 영영 못 따라잡는다", () => {
    // 예: 증인이 오늘 날짜(숨김 관리 이력 등)면 기준이 '오늘 + 3일'로 잡혀 미래가 된다
    expect(
      inferLegacyAnchor("2026-09-18 10:00:00", "2026-09-18 11:00:00"),
    ).toBeNull();
  });

  it("모든 구문이 UPDATE 이고 '기준이 아직 그 값일 때만' 조건을 단다 (두 번 밀지 않는다)", () => {
    const stmts = rebaseStatements("2026-08-25 23:59:59", 30, ["A-1", "A-2"]);
    for (const s of stmts) expect(s.sql.trim()).toMatch(/^UPDATE\b/);
    // 기준을 옮기는 구문은 마지막이다 — 앞의 조건들이 옛 기준을 볼 수 있게
    expect(stmts.at(-1)!.sql).toMatch(/UPDATE NX_DEMO_CLOCK/);
    for (const s of stmts.slice(0, -1)) {
      expect(s.sql).toMatch(/SELECT ANCHOR FROM NX_DEMO_CLOCK\) = @anchor/);
    }
  });

  it("월을 넘겨 밀어도 정기 업무의 '이번 달 생성' 표시는 건드리지 않는다", () => {
    // 옮기면 실제 달력의 중복 방지 장치가 틀어져 이번 달 회차가 조용히 사라진다 (ADR-0011)
    const stmts = rebaseStatements("2026-08-31 23:59:59", 1, ["A-1"]);
    expect(stmts.some((s) => /LAST_RUN_YM/.test(s.sql))).toBe(false);
  });
});

describe("데모 시계 — 실제 시드", () => {
  it("시드를 만들면 기준이 한 행 기록된다", async () => {
    const rows = await select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM NX_DEMO_CLOCK",
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(await anchorNow()).toMatch(/^\d{4}-\d{2}-\d{2} 23:59:59$/);
  });

  it("한 달이 흐르면: 밀기 전 조회 첫 화면은 0건, 민 뒤에는 다시 보인다 (기간·순서·이상치 보존)", async () => {
    const anchor = await anchorNow();
    // 기준(그날 23:59:59) + 30일 11시간 = 31일째 되는 날 오전 11시
    const now = addDaysStamp(anchor, 31).slice(0, 10) + " 11:00:00";
    const user = (await loadUser("sy.kim"))!;
    const firstScreen = (today: string): TicketFilters => ({
      view: "mine",
      keyword: "",
      custCode: "",
      progress: "",
      from: addDaysStamp(`${today} 00:00:00`, -15).slice(0, 10),
      to: today,
      assignee: "",
      requester: "",
      module: "",
      priority: "",
      includeMigration: false,
    });

    // 밀기 전 — 증상 재현
    expect((await listTickets(firstScreen(now.slice(0, 10)), user)).total).toBe(
      0,
    );

    // 기준 뒤에 생긴 일이 있는 요청(방문자가 방금 단 댓글)은 이번에 옮기지 않는다
    const touched = await one<{ ECHONUM: string; REQDATE: string }>(
      `SELECT ECHONUM, REQDATE FROM NX_OPTREPORTD
        WHERE REQTYPE <> 'MIGRATION' AND PROGRESS = '3' ORDER BY ECHONUM LIMIT 1`,
    );
    const lateComment = addDaysStamp(anchor, 29); // 기준 뒤, 지금 전
    const touchedCommentsBefore = await select<{
      ID: number;
      COMMDATE: string;
    }>(
      "SELECT ID, COMMDATE FROM NX_OPTREPORTR WHERE PECHONUM = @e ORDER BY ID",
      [{ name: "e", value: touched.ECHONUM }],
    );
    await write([
      {
        sql: `INSERT INTO NX_OPTREPORTR (PECHONUM, USERID, COMMENT, COMMDATE, ADMIN_ONLY_YN, IS_LOG_YN)
              VALUES (@e, 'sy.kim', '<p>방금 단 댓글</p>', @at, 'N', 'N')`,
        params: [
          { name: "e", value: touched.ECHONUM },
          { name: "at", value: lateComment },
        ],
      },
    ]);

    const sample = await one<{
      ECHONUM: string;
      REQDATE: string;
      SCHEDATE: string | null;
    }>(
      `SELECT ECHONUM, REQDATE, SCHEDATE FROM NX_OPTREPORTD
        WHERE REQTYPE <> 'MIGRATION' AND SCHEDATE IS NOT NULL AND ECHONUM <> @t
        ORDER BY REQDATE DESC LIMIT 1`,
      [{ name: "t", value: touched.ECHONUM }],
    );
    const sampleComments = await select<{ ID: number; COMMDATE: string }>(
      "SELECT ID, COMMDATE FROM NX_OPTREPORTR WHERE PECHONUM = @e ORDER BY ID",
      [{ name: "e", value: sample.ECHONUM }],
    );
    const migration1900 = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM NX_OPTREPORTD WHERE REQDATE = '1900-01-01 00:00:00'",
    );
    const notice = await one<{ REG_DT: string }>(
      "SELECT REG_DT FROM BOARD_DETAIL ORDER BY NTT_ID LIMIT 1",
    );

    const r = await alignDemoClock(now);
    expect(r.state).toBe("shifted");
    expect(r.state === "shifted" && r.days).toBe(30);
    expect(await anchorNow()).toBe(addDaysStamp(anchor, 30));

    // 증상 해소
    expect(
      (await listTickets(firstScreen(now.slice(0, 10)), user)).total,
    ).toBeGreaterThan(0);

    // 한 요청은 통째로 — 요청·예상처리일·댓글이 같은 폭으로 움직인다
    const after = await one<{ REQDATE: string; SCHEDATE: string }>(
      "SELECT REQDATE, SCHEDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e",
      [{ name: "e", value: sample.ECHONUM }],
    );
    expect(after.REQDATE).toBe(addDaysStamp(sample.REQDATE, 30));
    expect(after.SCHEDATE.slice(0, 10)).toBe(
      addDaysStamp(`${sample.SCHEDATE!.slice(0, 10)} 00:00:00`, 30).slice(
        0,
        10,
      ),
    );
    const commentsAfter = await select<{ ID: number; COMMDATE: string }>(
      "SELECT ID, COMMDATE FROM NX_OPTREPORTR WHERE PECHONUM = @e ORDER BY ID",
      [{ name: "e", value: sample.ECHONUM }],
    );
    expect(commentsAfter.map((c) => c.COMMDATE)).toEqual(
      sampleComments.map((c) => addDaysStamp(c.COMMDATE, 30)),
    );

    // 기준 뒤에 손댄 요청은 그대로 — 일부만 옮기면 스레드 순서가 뒤집힌다
    const touchedAfter = await one<{ REQDATE: string }>(
      "SELECT REQDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e",
      [{ name: "e", value: touched.ECHONUM }],
    );
    expect(touchedAfter.REQDATE).toBe(touched.REQDATE);
    // 그 요청의 **옛 댓글도** 그대로다 — 요청만 두고 댓글을 밀면 스레드가 신청일보다 뒤로 튄다
    const touchedCommentsAfter = await select<{ ID: number; COMMDATE: string }>(
      "SELECT ID, COMMDATE FROM NX_OPTREPORTR WHERE PECHONUM = @e ORDER BY ID",
      [{ name: "e", value: touched.ECHONUM }],
    );
    expect(touchedCommentsAfter.map((c) => c.COMMDATE)).toEqual([
      ...touchedCommentsBefore.map((c) => c.COMMDATE),
      lateComment,
    ]);

    // 미래를 만들지 않는다
    const newest = await one<{ m: string }>(
      `SELECT MAX(REQDATE) AS m FROM NX_OPTREPORTD
        WHERE REQTYPE <> 'MIGRATION' AND REQDATE < '2100'`,
    );
    expect(newest.m <= now).toBe(true);

    // 이상치는 이상치로 · 공지도 같은 폭
    expect(
      (
        await one<{ n: number }>(
          "SELECT COUNT(*) AS n FROM NX_OPTREPORTD WHERE REQDATE = '1900-01-01 00:00:00'",
        )
      ).n,
    ).toBe(migration1900.n);
    expect(
      (
        await one<{ REG_DT: string }>(
          "SELECT REG_DT FROM BOARD_DETAIL ORDER BY NTT_ID LIMIT 1",
        )
      ).REG_DT,
    ).toBe(addDaysStamp(notice.REG_DT, 30));

    // 같은 '지금'으로 다시 불러도 두 번 밀지 않는다
    expect((await alignDemoClock(now)).state).toBe("aligned");
  });

  it("동시에 두 인스턴스가 같은 구문을 보내도 뒤의 것은 아무것도 바꾸지 않는다", async () => {
    const anchor = await anchorNow();
    const units = (
      await select<{ ECHONUM: string }>(
        "SELECT ECHONUM FROM NX_OPTREPORTD WHERE REQTYPE <> 'MIGRATION' ORDER BY ECHONUM LIMIT 5",
      )
    ).map((u) => u.ECHONUM);
    const before = await one<{ REQDATE: string }>(
      "SELECT REQDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e",
      [{ name: "e", value: units[0] }],
    );
    const stmts = rebaseStatements(anchor, 2, units);
    await write(stmts);
    const changes = await write(stmts); // 두 번째 인스턴스
    expect(changes.every((n) => n === 0)).toBe(true);
    const after = await one<{ REQDATE: string }>(
      "SELECT REQDATE FROM NX_OPTREPORTD WHERE ECHONUM = @e",
      [{ name: "e", value: units[0] }],
    );
    expect(after.REQDATE).toBe(addDaysStamp(before.REQDATE, 2));
  });

  it("고르고 나서 밀기 전에 끼어든 댓글은 미래로 밀리지 않는다 (불변식 ①)", async () => {
    // 옮길 요청은 트랜잭션 밖에서 먼저 고른다 — 그 사이 다른 인스턴스가 댓글을 달 수 있다
    const anchor = await anchorNow();
    const units = (
      await select<{ ECHONUM: string }>(ELIGIBLE_UNITS_SQL, [
        { name: "anchor", value: anchor },
      ])
    ).map((u) => u.ECHONUM);
    const now = addDaysStamp(anchor, 4.5); // 기준 + 4일 12시간
    await write([
      {
        sql: `INSERT INTO NX_OPTREPORTR (PECHONUM, USERID, COMMENT, COMMDATE, ADMIN_ONLY_YN, IS_LOG_YN)
              VALUES (@e, 'sy.kim', '<p>끼어든 댓글</p>', @at, 'N', 'N')`,
        params: [
          { name: "e", value: units[0] },
          { name: "at", value: now },
        ],
      },
    ]);
    await write(rebaseStatements(anchor, 4, units));
    const late = await one<{ COMMDATE: string }>(
      "SELECT COMMDATE FROM NX_OPTREPORTR WHERE PECHONUM = @e AND COMMENT = '<p>끼어든 댓글</p>'",
      [{ name: "e", value: units[0] }],
    );
    expect(late.COMMDATE).toBe(now);
  });

  it("기준 행이 비어 있는 옛 DB 는 **시드 공지로** 역산한 기준을 한 번 적는다 — 숨김 관리 이력에 속지 않는다", async () => {
    // 공지는 세계와 함께 밀려 왔으므로, 옳은 역산 = 지금 기준 그대로다 (구현과 무관한 기대값)
    const expected = await anchorNow();
    // 고객사 관리가 같은 표에 쓰는 숨김 이력 행 — '오늘' 날짜다. 이것을 증인으로 읽으면 기준이 미래가 된다
    await write([
      {
        sql: `INSERT INTO BOARD_DETAIL (NTT_ID, NTT_SJ, NTT_CN, NTCR_NM, REG_DT, DELETE_FG, USE_FG)
              VALUES (900, '고객사 등록: 테스트', '', 'sy.kim', @at, 'Y', 'N')`,
        params: [{ name: "at", value: addDaysStamp(expected, 0.4) }],
      },
      { sql: "UPDATE NX_DEMO_CLOCK SET ANCHOR = ''" },
    ]);
    const r = await alignDemoClock(addDaysStamp(expected, 0.5));
    expect(r.state).toBe("aligned");
    expect(await anchorNow()).toBe(expected);
    const rows = await select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM NX_DEMO_CLOCK",
    );
    expect(Number(rows[0].n)).toBe(1);
  });
});
