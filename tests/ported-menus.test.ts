import { beforeAll, describe, expect, it } from "vitest";
import type { TicketRow, User } from "@/lib/types";

/**
 * 원본 포털에서 이식한 메뉴 3종 — 공지사항 · 알림센터 · 업무 현황 보드.
 *
 * 검증 축은 이식 전과 같다:
 *  1. 가시성·권한이 fail-closed 인가 (알림에 내부 전용 댓글이 새지 않는가)
 *  2. 보드의 컬럼 이동이 canDo() 정본과 어긋나지 않는가
 *  3. 읽음 처리가 목록 뱃지와 **같은 값**을 움직이는가 (두 곳을 따로 관리하지 않는다)
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

import { canMove, daysLeft, moveAction } from "@/lib/board";
import { addComment } from "@/lib/data/mutations";
import { getDashboard } from "@/lib/data/dashboard";
import { getNotice, listNotices } from "@/lib/data/notices";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/data/notifications";
import { getTicket, listRecentlyDone, listTickets } from "@/lib/data/tickets";
import { select, write } from "@/lib/db";
import type { TicketFilters } from "@/lib/types";

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

beforeAll(async () => {
  await select("SELECT 1 AS ok");
});

describe("공지사항", () => {
  it("목록에 본문 미리보기가 함께 온다 (제목만으로는 열지 말지 못 고른다)", async () => {
    const rows = await listNotices();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].preview.length).toBeGreaterThan(10);
    expect(rows[0].preview).not.toContain("<");
    // 최신이 위
    expect((rows[0].at ?? "") >= (rows[1].at ?? "")).toBe(true);
  });

  it("상세의 앞뒤 글은 **등록일 축**을 따른다 (채번 순서가 아니다)", async () => {
    const rows = await listNotices(); // 최신순
    const i = Math.floor(rows.length / 2);
    const detail = await getNotice(rows[i].id);
    expect(detail?.body).toContain("<p>");
    // 목록에서 한 칸 위가 '최신', 한 칸 아래가 '이전' 이어야 한다.
    // 🔴 시드는 최신 공지가 NTT_ID=1 이라, ID 로 이웃을 찾으면 방향이 뒤집힌다
    expect(detail?.newer?.id).toBe(rows[i - 1].id);
    expect(detail?.older?.id).toBe(rows[i + 1].id);
    expect(
      new Date(detail!.newer!.id ? rows[i - 1].at! : 0).getTime(),
    ).toBeGreaterThan(new Date(rows[i].at!).getTime());
  });

  it("가장 최신 글엔 '최신'이, 가장 오래된 글엔 '이전'이 없다", async () => {
    const rows = await listNotices();
    const first = await getNotice(rows[0].id);
    const last = await getNotice(rows[rows.length - 1].id);
    expect(first?.newer).toBeNull();
    expect(first?.older?.id).toBe(rows[1].id);
    expect(last?.older).toBeNull();
    expect(last?.newer?.id).toBe(rows[rows.length - 2].id);
  });

  it("없는 글·숫자가 아닌 id 는 null (404 로 떨어진다)", async () => {
    expect(await getNotice("999999")).toBeNull();
    expect(await getNotice("../etc/passwd")).toBeNull();
  });
});

describe("알림센터", () => {
  /** 내부 담당자가 맡은 티켓 하나를 고객사 신청자 시점으로 본다 */
  async function ticketWithRequester(): Promise<TicketRow> {
    const { rows } = await listTickets(filters({ view: "open" }), internal);
    const row = rows.find((r) => r.requesterId && r.assigneeId);
    if (!row) throw new Error("신청자·담당자가 모두 있는 미완료 티켓이 없다");
    return row;
  }

  it("남이 쓴 새 글만 알림이 된다 — 내 글은 나에게 알림이 아니다", async () => {
    const row = await ticketWithRequester();
    const requester = {
      ...internal,
      id: row.requesterId!,
      role: "CUSTOMER" as const,
      custCode: row.custCode,
    };
    const assignee = { ...internal, id: row.assigneeId! };

    // 기준선을 지운다 (양쪽 다 읽은 상태로)
    await markNotificationsRead(requester);
    await markNotificationsRead(assignee);
    expect((await listNotifications(requester)).total).toBe(0);
    expect((await listNotifications(assignee)).total).toBe(0);

    await addComment({
      echoNum: row.echoNum,
      user: assignee,
      body: "<p>확인 중입니다.</p>",
      adminOnly: false,
    });

    const toRequester = await listNotifications(requester);
    expect(toRequester.total).toBe(1);
    expect(toRequester.items[0].echoNum).toBe(row.echoNum);
    expect(toRequester.items[0].mine).toBe("requester");
    expect(toRequester.items[0].body).toContain("확인 중입니다");
    // 쓴 사람 본인에게는 알림이 아니다
    expect((await listNotifications(assignee)).total).toBe(0);

    // 신청자가 답글을 달면 담당자에게 알림이 가고, **신청자 쪽은 읽은 것으로 정리된다**
    // (댓글을 쓰려면 그 스레드를 보고 있었다는 뜻 — addComment 가 읽음선을 끌어올린다)
    await addComment({
      echoNum: row.echoNum,
      user: requester,
      body: "<p>감사합니다.</p>",
      adminOnly: false,
    });
    expect((await listNotifications(requester)).total).toBe(0);
    const toAssignee = await listNotifications(assignee);
    expect(toAssignee.items[0].echoNum).toBe(row.echoNum);
    expect(toAssignee.items[0].mine).toBe("assignee");
  });

  it("내부 전용 댓글은 고객사 알림으로 새지 않는다 (fail-closed)", async () => {
    const row = await ticketWithRequester();
    const requester = {
      ...internal,
      id: row.requesterId!,
      role: "CUSTOMER" as const,
      custCode: row.custCode,
    };
    await markNotificationsRead(requester);

    await addComment({
      echoNum: row.echoNum,
      user: { ...internal, id: row.assigneeId! },
      body: "<p>내부 공유: 계약시간 초과 예상</p>",
      adminOnly: true,
    });

    const asCustomer = await listNotifications(requester);
    expect(asCustomer.total).toBe(0);
    // 같은 글이 내부 담당자에게는 보인다(자기 글이 아닌 경우) — 여기선 작성자 본인이라 0 이 맞다
    const asAuthor = await listNotifications({
      ...internal,
      id: row.assigneeId!,
    });
    expect(asAuthor.items.every((n) => n.echoNum !== row.echoNum)).toBe(true);
  });

  it("'모두 읽음'은 알림 창(30일) 밖의 미읽음까지 지우지 않는다", async () => {
    const row = await ticketWithRequester();
    const requester = {
      ...internal,
      id: row.requesterId!,
      role: "CUSTOMER" as const,
      custCode: row.custCode,
    };
    await markNotificationsRead(requester);

    // 같은 사용자의 **다른 티켓**에 90일 전 댓글을 심는다 (알림 창 밖)
    const others = (await listTickets(filters(), requester)).rows.filter(
      (r) => r.echoNum !== row.echoNum && r.requesterId === requester.id,
    );
    const old = others[0];
    expect(old).toBeDefined();
    const longAgo = new Date(Date.now() - 90 * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    await write([
      {
        sql: `INSERT INTO NX_OPTREPORTR
                (PECHONUM, USERID, COMMENT, COMMDATE, ADMIN_ONLY_YN, IS_LOG_YN, PPROGRESS)
              VALUES (@en, 'sy.kim', '<p>오래된 안내</p>', @at, 'N', 'N', NULL)`,
        params: [
          { name: "en", value: old.echoNum },
          { name: "at", value: longAgo },
        ],
      },
    ]);
    // 창 밖이라 알림에는 안 잡히지만 목록 뱃지에는 남는다
    expect(
      (await listNotifications(requester)).items.every(
        (n) => n.echoNum !== old.echoNum,
      ),
    ).toBe(true);
    expect((await getTicket(old.echoNum, requester))?.hasUnreadComment).toBe(
      true,
    );

    // 창 안의 알림을 하나 만들고 '모두 읽음'
    await addComment({
      echoNum: row.echoNum,
      user: { ...internal, id: row.assigneeId! },
      body: "<p>최근 안내</p>",
      adminOnly: false,
    });
    expect((await listNotifications(requester)).total).toBe(1);
    await markNotificationsRead(requester);

    expect((await listNotifications(requester)).total).toBe(0);
    // 🔴 창 밖 티켓의 미읽음은 그대로 살아 있어야 한다
    expect((await getTicket(old.echoNum, requester))?.hasUnreadComment).toBe(
      true,
    );
  });

  it("요청 단위로 묶고, 대표행은 그 요청의 최신 글이다", async () => {
    const row = await ticketWithRequester();
    const requester = {
      ...internal,
      id: row.requesterId!,
      role: "CUSTOMER" as const,
      custCode: row.custCode,
    };
    const assignee = { ...internal, id: row.assigneeId! };
    await markNotificationsRead(requester);

    for (const body of ["<p>첫 번째</p>", "<p>두 번째</p>", "<p>세 번째</p>"]) {
      await addComment({
        echoNum: row.echoNum,
        user: assignee,
        body,
        adminOnly: false,
      });
    }

    const n = await listNotifications(requester);
    const item = n.items.find((x) => x.echoNum === row.echoNum);
    // 글 3건이 줄 3개가 아니라 요청 1건으로 묶인다
    expect(n.total).toBe(1);
    expect(item?.unread).toBe(3);
    // 대표행은 최신 글 — GROUP BY 의 bare column 이 MAX(ID) 행을 따라가야 한다
    expect(item?.body).toContain("세 번째");
  });

  it("읽음 처리는 목록의 미읽음 뱃지와 같은 값을 움직인다", async () => {
    const row = await ticketWithRequester();
    const requester = {
      ...internal,
      id: row.requesterId!,
      role: "CUSTOMER" as const,
      custCode: row.custCode,
    };

    await addComment({
      echoNum: row.echoNum,
      user: { ...internal, id: row.assigneeId! },
      body: "<p>일정 안내드립니다.</p>",
      adminOnly: false,
    });
    expect((await listNotifications(requester)).total).toBeGreaterThan(0);
    expect((await getTicket(row.echoNum, requester))?.hasUnreadComment).toBe(
      true,
    );

    await markNotificationsRead(requester, row.echoNum);

    expect(
      (await listNotifications(requester)).items.every(
        (n) => n.echoNum !== row.echoNum,
      ),
    ).toBe(true);
    expect((await getTicket(row.echoNum, requester))?.hasUnreadComment).toBe(
      false,
    );
  });
});

describe("업무 현황 보드", () => {
  it("이동 규칙표에 없는 이동은 액션이 없다 (되돌리기·건너뛰기 차단)", () => {
    expect(moveAction("2", "3")).toBe("receive");
    expect(moveAction("3", "4")).toBe("propose");
    expect(moveAction("4", "9")).toBe("complete");
    // 되돌리기 · 단계 건너뛰기 · 종료건 이동
    expect(moveAction("3", "2")).toBeUndefined();
    expect(moveAction("2", "9")).toBeUndefined();
    expect(moveAction("9", "3")).toBeUndefined();
  });

  it("드롭 판정이 canDo() 정본을 따른다 — 고객사 사용자는 접수할 수 없다", async () => {
    const { rows } = await listTickets(filters({ progress: "2" }), internal);
    // 접수는 인계라 배정 여부와 무관하다 — 처리자면 누구나 끌어올 수 있다
    const row = rows[0];
    expect(row).toBeDefined();

    // 처리자 측: 접수 가능
    expect(canMove(row, "3", internal, null)).toBe("receive");
    // 고객사 측: 같은 이동이 막힌다
    const customer: User = {
      ...internal,
      id: row.requesterId ?? "someone",
      role: "CUSTOMER",
      custCode: row.custCode,
    };
    expect(canMove(row, "3", customer, null)).toBeNull();
  });

  it("승인 컬럼 이동(1→2)은 승인 단계를 쓰는 고객사의 승인권자만", async () => {
    const { rows } = await listTickets(
      filters({ progress: "1", custCode: "HB001" }),
      internal,
    );
    const row = rows[0];
    expect(row).toBeDefined();

    const approver: User = {
      ...internal,
      id: "hb.yoon",
      role: "CUSTOMER",
      custCode: "HB001",
      isApprover: true,
    };
    const usesApproval = {
      custCode: "HB001",
      custName: "한빛제약",
      showsContractTime: true,
      usesApproval: true,
      usesTestStage: true,
      usesSystemStage: false,
      defaultPrivate: false,
    };
    expect(canMove(row, "2", approver, usesApproval)).toBe("approve");
    // 승인 단계를 안 쓰는 고객사 설정이면 같은 사용자도 막힌다
    expect(
      canMove(row, "2", approver, { ...usesApproval, usesApproval: false }),
    ).toBeNull();
    // 승인권자가 아니면 막힌다
    expect(
      canMove(row, "2", { ...approver, isApprover: false }, usesApproval),
    ).toBeNull();
  });

  it("완료 컬럼은 **완료일** 기준 최근분만 담는다 (신청일 기준이 아니다)", async () => {
    const done = await listRecentlyDone(internal, 7);
    const cutoff = new Date(Date.now() - 8 * 86_400_000);
    for (const r of done) {
      expect(r.progress).toBe("9");
      expect(new Date(r.succDate ?? 0).getTime()).toBeGreaterThan(
        cutoff.getTime(),
      );
    }
    // 오래전에 신청돼 최근 끝난 건이 빠지지 않는다 = 신청일 필터와 결과가 다르다
    const byReqDate = await listTickets(
      filters({ progress: "9", from: cutoff.toISOString().slice(0, 10) }),
      internal,
    );
    expect(
      done.some((d) => !byReqDate.rows.find((x) => x.echoNum === d.echoNum)),
    ).toBe(true);
  });

  it("D-day 는 기준일을 받아 계산한다 — 렌더 시점의 시각을 읽지 않는다(하이드레이션)", () => {
    const today = "2026-08-14";
    expect(daysLeft(null, today)).toBeNull();
    expect(daysLeft("2026-08-14T09:30:00", today)).toBe(0);
    expect(daysLeft("2026-08-17 00:00:00", today)).toBe(3);
    expect(daysLeft("2026-08-12", today)).toBe(-2);
    // 서버(UTC)와 브라우저(KST)가 같은 인자를 받으면 반드시 같은 값이 나온다
    expect(daysLeft("2026-08-15T23:59:59", today)).toBe(
      daysLeft("2026-08-15T00:00:00", today),
    );
    // 날짜 이상치는 큰 음수로 나오고(그대로 D+ 로 보인다), 형식이 아니면 null
    expect(daysLeft("1900-01-01 00:00:00", today)).toBeLessThan(-40000);
    expect(daysLeft("어제", today)).toBeNull();
  });
});

/**
 * 미읽음은 세 곳(목록 뱃지 · 대시보드 카드 · 알림센터)에 동시에 나타난다.
 * 기준이 갈라지면 **사용자가 지울 수 없는 빨간 점**이 남는다 — 그게 이 블록의 검증 대상이다.
 */
describe("미읽음 축 — 기준은 한 곳에서만 정의한다", () => {
  it("내 건이 아니어도 열어보면 내려간다 (운영팀 목록에 남던 점)", async () => {
    const { rows } = await listTickets(filters({ view: "open" }), internal);
    const row = rows.find(
      (r) =>
        r.assigneeId &&
        r.assigneeId !== internal.id &&
        r.requesterId !== internal.id,
    );
    expect(row).toBeDefined();
    const other: User = { ...internal, id: row!.assigneeId! };

    await addComment({
      echoNum: row!.echoNum,
      user: other,
      body: "<p>담당자가 남긴 메모</p>",
      adminOnly: false,
    });
    expect((await getTicket(row!.echoNum, internal))?.hasUnreadComment).toBe(
      true,
    );
    // 알림에는 안 뜬다(내 건이 아니다) → '모두 읽음'으로는 못 지운다. 열어서 지울 수 있어야 한다
    expect(
      (await listNotifications(internal)).items.every(
        (n) => n.echoNum !== row!.echoNum,
      ),
    ).toBe(true);

    expect(await markNotificationsRead(internal, row!.echoNum)).toBeGreaterThan(
      0,
    );
    expect((await getTicket(row!.echoNum, internal))?.hasUnreadComment).toBe(
      false,
    );
  });

  it("못 보는 건은 읽음선도 만들지 못한다 (fail-closed)", async () => {
    const { rows } = await listTickets(filters(), internal);
    const row = rows.find((r) => r.custCode !== "HB001");
    expect(row).toBeDefined();
    const outsider: User = {
      ...internal,
      id: "hb.yoon",
      role: "CUSTOMER",
      custCode: "HB001",
      isApprover: true,
    };

    expect(await markNotificationsRead(outsider, row!.echoNum)).toBe(0);
    const line = await select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM NX_OPTREPORT_READ_STATE
        WHERE ECHONUM = @en AND USER_ID = 'hb.yoon'`,
      [{ name: "en", value: row!.echoNum }],
    );
    expect(Number(line[0].n)).toBe(0);
  });

  it("내부 전용 댓글은 뱃지·댓글 수에도 잡히지 않는다 (알림과 같은 축)", async () => {
    const { rows } = await listTickets(filters({ view: "open" }), internal);
    const row = rows.find((r) => r.requesterId && r.assigneeId);
    expect(row).toBeDefined();
    const requester: User = {
      ...internal,
      id: row!.requesterId!,
      role: "CUSTOMER",
      custCode: row!.custCode,
    };
    const assignee: User = { ...internal, id: row!.assigneeId! };

    await markNotificationsRead(requester, row!.echoNum);
    const before = await getTicket(row!.echoNum, requester);
    const beforeInternal = await getTicket(row!.echoNum, internal);
    expect(before?.hasUnreadComment).toBe(false);
    // 같은 티켓인데 세는 숫자가 이미 다르다 — 앞선 테스트가 남긴 내부 전용 글 때문이다
    expect(beforeInternal!.commentCount).toBeGreaterThan(before!.commentCount);

    await addComment({
      echoNum: row!.echoNum,
      user: assignee,
      body: "<p>내부 공유: 계약시간 초과 예상</p>",
      adminOnly: true,
    });

    const after = await getTicket(row!.echoNum, requester);
    // 🔴 고객사는 이 글을 열어도 볼 수 없다 → 점이 뜨면 지울 방법이 없다
    expect(after?.hasUnreadComment).toBe(false);
    expect(after?.commentCount).toBe(before?.commentCount);
    expect((await listNotifications(requester)).total).toBe(0);
    // 운영팀에게는 그대로 보인다 (숨기는 게 아니라 축이 다른 것)
    const asInternal = await getTicket(row!.echoNum, internal);
    expect(asInternal?.commentCount).toBe(beforeInternal!.commentCount + 1);
  });
});

/**
 * 카드의 숫자를 누르면 **그 숫자를 만든 목록**이 나와야 한다.
 * 조건을 URL 로 넘기지 못하면 25 를 누르고 167 을 보게 된다 (실측).
 */
describe("대시보드 카드 ↔ 링크", () => {
  it("'미읽음 댓글' 숫자 = unread=1 목록의 건수", async () => {
    const d = await getDashboard(internal);
    const list = await listTickets(
      filters({ view: "open", unreadOnly: true }),
      internal,
    );
    expect(list.total).toBe(d.cards.unreadComments);
  });

  it("'내 미처리' 숫자 = view=open + 내 담당 목록의 건수 (view=mine 이 아니다)", async () => {
    const d = await getDashboard(internal);
    const linked = await listTickets(
      filters({ view: "open", assignee: internal.id }),
      internal,
    );
    expect(linked.total).toBe(d.cards.myPending);

    // 종료건까지 포함하는 view=mine 은 다른 숫자다 — 그래서 링크를 바꿨다
    const mine = await listTickets(filters({ view: "mine" }), internal);
    expect(mine.total).toBeGreaterThan(linked.total);
  });
});
