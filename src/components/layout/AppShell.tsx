import { listTickets } from "@/lib/data/tickets";
import { currentUser, PERSONAS } from "@/lib/session";
import type { TicketFilters, User } from "@/lib/types";
import { InlineError } from "@/components/ui/EmptyState";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const OPEN_FILTERS: TicketFilters = {
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

async function openCountFor(user: User): Promise<number> {
  try {
    return (await listTickets(OPEN_FILTERS, user)).total;
  } catch {
    return 0;
  }
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  let user: User | null = null;
  let error: string | null = null;
  try {
    user = await currentUser();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // 원인을 감추지 않는다 — 무엇이 왜 실패했는지 화면에 그대로 보여준다
  if (!user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
        <h1 className="text-18 text-fg-strong font-semibold">
          데모 DB 를 열 수 없습니다
        </h1>
        <InlineError
          title={
            error
              ? "연결 또는 조회 중 오류가 발생했습니다"
              : "세션 사용자를 찾지 못했습니다"
          }
          detail={error ?? undefined}
        />
        <div className="text-12 text-fg-muted leading-relaxed">
          <p>확인 순서:</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5">
            <li>
              <code className="mono">/api/diag</code> 로 각 조회의 개별 실패
              지점 확인
            </li>
            <li>
              <code className="mono">npm run db:reset</code> 후 재시작 — 시드가
              처음부터 다시 생성됩니다 (<code className="mono">.data/</code>{" "}
              폴더 쓰기 권한 필요)
            </li>
          </ol>
        </div>
      </main>
    );
  }

  const openCount = await openCountFor(user);

  return (
    <div className="flex min-h-dvh">
      <Sidebar user={user} openCount={openCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} personas={PERSONAS} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
