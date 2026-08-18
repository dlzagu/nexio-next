import { BoardView } from "@/components/board/BoardView";
import { listRecentlyDone, listTickets } from "@/lib/data/tickets";
import { toDbStamp } from "@/lib/format";
import { currentUser, loadCustomerConfig } from "@/lib/session";
import type { CustomerConfig, TicketFilters } from "@/lib/types";

export const metadata = { title: "업무 현황 · 넥시오" };

const OPEN: TicketFilters = {
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

/**
 * 업무 현황 보드. 원본의 칸반(STB01)을 옮긴 것으로, 조회 화면과 **같은 데이터의 다른 시점**이다.
 *   · 조회 = "이 건이 어디까지 왔나" (한 건을 깊게)
 *   · 보드 = "지금 무엇이 어디에 쌓여 있나" (전체를 얕게)
 *
 * 미완료가 실측 200건 내외라 전량을 받아 클라이언트에서 나눈다 (컬럼 이동마다 재조회하지 않는다).
 */
export default async function BoardPage() {
  const user = await currentUser();
  if (!user) return null;

  const [open, done] = await Promise.all([
    listTickets(OPEN, user),
    listRecentlyDone(user),
  ]);

  // 드롭 가능 여부 판정에 고객사 플래그(승인·테스트 단계 사용)가 필요하다.
  // 보드에 실제로 등장하는 고객사만 읽는다.
  const codes = [...new Set([...open.rows, ...done].map((r) => r.custCode))];
  const loaded = await Promise.all(codes.map((c) => loadCustomerConfig(c)));
  const configs: Record<string, CustomerConfig | null> = Object.fromEntries(
    codes.map((c, i) => [c, loaded[i]]),
  );

  return (
    <BoardView
      user={user}
      rows={open.rows}
      done={done}
      configs={configs}
      truncated={open.truncated}
      // D-day 를 클라이언트가 직접 계산하면 서버(UTC)와 하루가 어긋난다 → 서버 기준일을 내린다
      today={toDbStamp().slice(0, 10)}
    />
  );
}
