import { redirect } from "next/navigation";
import { RequestsView } from "@/components/requests/RequestsView";
import { DEFAULT_LIST_VIEW, DEFAULT_RANGE_DAYS } from "@/lib/codes";
import { getMeta } from "@/lib/data/meta";
import { ARCHIVE_PAGE_SIZE, listTickets } from "@/lib/data/tickets";
import { todaySeoul } from "@/lib/format";
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
  const sp = await searchParams;

  /**
   * 첫 진입이면 기본 조건을 **URL 에 실어** 되돌린다 (내 담당 · 최근 15일).
   *
   * 화면에서 몰래 적용하지 않고 주소로 만드는 이유:
   *  · 필터 칸에 그 값이 그대로 보인다 — 왜 이만큼만 나오는지 알 수 있다
   *  · 지우면 지워진 채로 남는다 (기본값이 다시 끼어들지 않는다)
   *  · 공유·새로고침·뒤로가기가 그대로 동작한다
   *  · 날짜를 서버에서 정하므로 서버(UTC)·브라우저(KST) 차이로 하루 어긋날 일이 없다
   *
   * ⚠️ **파라미터가 하나도 없을 때만** 이다. 대시보드 카드처럼 조건을 갖고 들어오는
   *    링크까지 기간으로 자르면 카드 숫자와 목록 건수가 어긋난다.
   */
  if (Object.keys(sp).length === 0) {
    const params = new URLSearchParams({
      view: DEFAULT_LIST_VIEW,
      from: todaySeoul(DEFAULT_RANGE_DAYS),
      to: todaySeoul(),
    });
    redirect(`/requests?${params.toString()}`);
  }

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
    unreadOnly: one(sp.unread) === "1",
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
    unreadOnly: false,
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
