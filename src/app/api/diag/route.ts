import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/data/dashboard";
import { getMeta } from "@/lib/data/meta";
import { getTicket, listTickets } from "@/lib/data/tickets";
import { dbHealth, devWritesAllowed } from "@/lib/db";
import { currentUser } from "@/lib/session";
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

  // 쓰기가 되는 상태인가 — 화면이 202 를 돌려줄 때 "왜"를 여기서 확인한다
  out.writes = devWritesAllowed()
    ? { ok: true, note: "저장·액션·댓글·첨부가 실제로 기록된다" }
    : {
        ok: false,
        note: "ALLOW_DEV_WRITES=false 로 잠겨 있다 (.env.local 또는 배포 환경변수를 확인)",
      };

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
