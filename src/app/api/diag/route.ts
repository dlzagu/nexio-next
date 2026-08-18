import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/data/dashboard";
import { getMeta } from "@/lib/data/meta";
import { getTicket, listTickets } from "@/lib/data/tickets";
import {
  dbHealth,
  devWritesAllowed,
  isSharedDb,
  writeDisabledReason,
} from "@/lib/db";
import { currentUser, missingPersonaIds, PERSONAS } from "@/lib/session";
import type { TicketFilters } from "@/lib/types";

/** 데이터 레이어 자기진단. 각 조회가 실제로 도는지 한 번에 확인한다 */
export async function GET() {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      out[name] = { ok: true, ms: 0, ...((await fn()) as object) };
      (out[name] as { ms: number }).ms = Date.now() - t0;
    } catch (e) {
      out[name] = {
        ok: false,
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  await step("db", async () => await dbHealth());

  // 쓰기가 되는 상태인가 — 화면이 202 를 돌려줄 때 "왜"를 여기서 확인한다.
  // ⚠️ `ok` 키를 쓰지 않는다. 아래 allOk 가 그걸 **장애로 읽어** 진단이 500 이 된다
  //    (잠긴 건 정상 상태다 — 배포 검증이 HTTP 상태로 이뤄지므로 특히 조심).
  out.writes = devWritesAllowed()
    ? { allowed: true, note: "저장·액션·댓글·첨부가 실제로 기록된다" }
    : { allowed: false, note: writeDisabledReason() };

  // 공유 DB 좌표가 **반쪽만** 들어오면 런타임에 401 이 난다 (URL 만 있고 토큰이 없는 경우).
  // 값은 절대 찍지 않는다 — 존재 여부만.
  if (isSharedDb()) {
    out.shared = {
      url: true,
      token: !!process.env.TURSO_AUTH_TOKEN,
      note: process.env.TURSO_AUTH_TOKEN
        ? "공유 DB 좌표가 갖춰졌다"
        : "TURSO_AUTH_TOKEN 이 없다 — 원격이 401 로 거절한다",
    };
  }

  // 코드가 제시하는 페르소나가 DB 에 **실재하는가**. 공유 DB 는 코드와 따로 배포되므로
  // 시드가 앞서가면 역할 전환이 404 로 거절된다 — 화면에서는 "눌러도 아무 일이 없는" 고장이다.
  // 장애로 취급한다(진단이 500 이 된다): 배포 검증은 화면이 아니라 HTTP 상태로 한다.
  await step("personas", async () => {
    const missing = await missingPersonaIds();
    if (missing.length) {
      throw new Error(
        `데모 DB 에 없는 계정: ${missing.join(", ")} — npm run db:sync:remote 로 맞추세요`,
      );
    }
    return { total: PERSONAS.length };
  });

  const user = await currentUser();
  out.user = user
    ? {
        ok: true,
        id: user.id,
        name: user.name,
        role: user.role,
        cust: user.custName,
      }
    : { ok: false, error: "세션 사용자를 찾을 수 없습니다" };
  if (!user) return NextResponse.json(out, { status: 500 });

  const filters: TicketFilters = {
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
  };

  let firstEchoNum: string | null = null;

  await step("list.open", async () => {
    const r = await listTickets(filters, user);
    firstEchoNum = r.rows[0]?.echoNum ?? null;
    return {
      total: r.total,
      returned: r.rows.length,
      truncated: r.truncated,
      sample: r.rows[0]
        ? {
            echoNum: r.rows[0].echoNum,
            title: r.rows[0].title,
            custName: r.rows[0].custName,
            progress: r.rows[0].progress,
            systemName: r.rows[0].systemName,
            moduleLabel: r.rows[0].moduleLabel,
            priority: r.rows[0].priority,
            assigneeName: r.rows[0].assigneeName,
            comments: r.rows[0].commentCount,
          }
        : null,
    };
  });

  await step("list.all", async () => {
    const r = await listTickets(
      { ...filters, view: "all", includeMigration: true },
      user,
    );
    return { total: r.total, returned: r.rows.length };
  });

  await step("detail", async () => {
    if (!firstEchoNum) return { skipped: true };
    const t = await getTicket(firstEchoNum, user);
    return {
      echoNum: t?.echoNum ?? null,
      comments: t?.comments.length ?? 0,
      hasAnswer: !!t?.solution.answer,
      contentLen: t?.request.content.length ?? 0,
      memos: t?.history.memos.length ?? 0,
    };
  });

  await step("meta", async () => {
    const m = await getMeta(user);
    return {
      companies: m.companies.length,
      assignees: m.assignees.length,
      requesters: m.requesters.length,
      systems: m.systems.length,
    };
  });

  await step("dashboard", async () => {
    const d = await getDashboard(user);
    return {
      cards: d.cards,
      myPending: d.myPending.length,
      unresolved: d.companyUnresolved.length,
      trendMonths: d.trend.length,
      openStatuses: d.openByStatus.length,
      completedTotal: d.completedTotal,
      duration: d.duration.length,
      topCustomers: d.topCustomers.length,
      assigneePerf: d.assigneePerf.length,
      notices: d.notices.length,
    };
  });

  const allOk = Object.values(out).every(
    (v) => (v as { ok?: boolean }).ok !== false,
  );
  return NextResponse.json(out, { status: allOk ? 200 : 500 });
}
