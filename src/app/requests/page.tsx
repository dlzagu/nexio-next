import { getMeta } from "@/lib/data/meta";
import { ARCHIVE_PAGE_SIZE, listTickets } from "@/lib/data/tickets";
import { currentUser } from "@/lib/session";
import type { ListView, TicketFilters } from "@/lib/types";

export const metadata = { title: "요청 조회 · 넥시오" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  // ⚠️ NX-DEBUG: Vercel SSR 500 원인 추적용 임시 계측 — 원인 확정 즉시 제거한다
  try {
    return await renderRequests(await searchParams);
  } catch (e) {
    const err = e as Error;
    return (
      <pre style={{ whiteSpace: "pre-wrap", padding: 16 }}>
        NX-DEBUG SSR ERROR{"\n"}
        {String(err?.stack || err?.message || err)}
      </pre>
    );
  }
}

async function renderRequests(sp: SP) {
  // 모듈 로드 시점 실패까지 잡기 위해 동적 import (NX-DEBUG)
  const { RequestsView } = await import("@/components/requests/RequestsView");
  const user = await currentUser();
  if (!user) return null;

  const view = (
    ["open", "mine", "all"].includes(one(sp.view)) ? one(sp.view) : "open"
  ) as ListView;
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const filters: TicketFilters = {
    view,
    keyword: one(sp.q),
    custCode: one(sp.custCode),
    progress: one(sp.progress),
    from: one(sp.from),
    to: one(sp.to),
    assignee: one(sp.assignee),
    requester: one(sp.requester),
    module: one(sp.module),
    priority: one(sp.priority),
    includeMigration: one(sp.migration) === "1",
  };

  const bare = (v: ListView): TicketFilters => ({
    ...filters,
    view: v,
    keyword: "",
    custCode: "",
    progress: "",
    from: "",
    to: "",
    assignee: "",
    requester: "",
    module: "",
    priority: "",
  });

  // 뷰 탭의 건수는 필터와 무관한 "큐의 크기"다
  const [result, meta, openCount, mineCount, allCount] = await Promise.all([
    listTickets(filters, user, page),
    getMeta(user),
    listTickets(bare("open"), user).then((r) => r.total),
    listTickets(bare("mine"), user).then((r) => r.total),
    listTickets(bare("all"), user).then((r) => r.total),
  ]);

  return (
    <RequestsView
      result={result}
      user={user}
      companies={meta.companies}
      assignees={meta.assignees}
      requesters={meta.requesters}
      counts={{ open: openCount, mine: mineCount, all: allCount }}
      page={page}
      pageSize={ARCHIVE_PAGE_SIZE}
    />
  );
}
