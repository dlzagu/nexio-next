import { BoardView } from "@/components/board/BoardView";
import { getMeta } from "@/lib/data/meta";
import { currentYm, listTemplates } from "@/lib/data/tasks";
import { listRecentlyDone, listTickets } from "@/lib/data/tickets";
import { todaySeoul } from "@/lib/format";
import { canCreateTask } from "@/lib/permissions";
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

  /**
   * 업무 등록은 운영팀만 쓴다 — 고객사·외부업체에게는 선택지 목록(다른 회사 사람·시스템)을
   * **내려보내지도 않는다.** 화면에서 감추는 것과 서버가 안 주는 것은 다르다.
   */
  const canIntake = canCreateTask(user);
  const ym = currentYm();

  const [open, done, meta, templates] = await Promise.all([
    listTickets(OPEN, user),
    listRecentlyDone(user),
    canIntake ? getMeta(user) : Promise.resolve(null),
    canIntake ? listTemplates(ym) : Promise.resolve([]),
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
      /**
       * D-day 를 클라이언트가 직접 계산하면 서버와 하루가 어긋난다 → 기준일을 내려준다.
       * 🔴 **한국 벽시계**여야 한다 — 배포처(UTC)의 날짜를 내리면 KST 새벽에 하루 전이라,
       *    완료일 달력의 상한(max)이 '오늘'을 못 고르게 막고 D-day 도 하루 밀린다.
       */
      today={todaySeoul()}
      intake={
        meta
          ? {
              companies: meta.companies,
              requesters: meta.requesters,
              systems: meta.systems,
              templates,
              ym,
            }
          : null
      }
    />
  );
}
