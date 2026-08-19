"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  FilePlus2,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Megaphone,
} from "lucide-react";
import { USER_ROLE_LABEL } from "@/lib/codes";
import type { User } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/requests", label: "요청 조회", icon: ListChecks },
  { href: "/board", label: "업무 현황", icon: KanbanSquare },
  { href: "/requests/new", label: "서비스 신청", icon: FilePlus2 },
  { href: "/notices", label: "공지사항", icon: Megaphone },
] as const;

/** 운영팀만 보이는 메뉴 — 고객사에게는 다른 회사의 존재 자체를 노출하지 않는다 */
const INTERNAL_NAV = [
  { href: "/customers", label: "고객사 관리", icon: Building2 },
] as const;

/**
 * 사이드바 알맹이. 데스크톱의 고정 사이드바와 좁은 화면의 서랍이 **같은 것**을 쓴다 —
 * 메뉴를 두 벌로 두면 하나에만 항목이 추가되는 날이 온다.
 */
export function SidebarBody({
  user,
  openCount,
  onNavigate,
}: {
  user: User;
  /** null = 카운트를 못 읽었다 (0 건과 구분한다) */
  openCount: number | null;
  /** 서랍에서 눌렀을 때 닫기 — 데스크톱에서는 없다 */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* 로고는 홈으로 가는 문이다 — 어느 화면에서 헤매도 여기를 누르면 처음으로 돌아온다 */}
      <div className="border-line-subtle flex h-[52px] items-center border-b px-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="hover:bg-hover -mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1"
        >
          <span
            aria-hidden
            className="bg-accent text-11 text-fg-on-solid flex h-6 w-6 items-center justify-center rounded-md font-bold"
          >
            N
          </span>
          <span className="text-14 text-fg-strong font-semibold tracking-tight">
            넥시오
          </span>
        </Link>
      </div>

      <nav className="flex flex-col gap-0.5 p-2" aria-label="주 메뉴">
        {[...NAV, ...(user.role === "INTERNAL" ? INTERNAL_NAV : [])].map(
          ({ href, label, icon: Icon }) => {
            const active =
              href === "/requests"
                ? pathname === "/requests"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="nav-i"
                data-active={active}
                onClick={onNavigate}
              >
                <Icon size={15} aria-hidden />
                <span className="flex-1">{label}</span>
                {href === "/requests" && (openCount ?? 0) > 0 ? (
                  <span className="num text-11 text-fg-subtle">
                    {openCount}
                  </span>
                ) : null}
              </Link>
            );
          },
        )}
      </nav>

      <div className="border-line-subtle mt-auto border-t p-2">
        <div className="bg-subtle rounded-md px-2.5 py-2">
          <p className="ell text-12 text-fg-strong font-medium">{user.name}</p>
          <p className="ell text-11 text-fg-subtle mt-0.5">
            {USER_ROLE_LABEL[user.role]} · {user.custName || user.custCode}
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * 데스크톱 사이드바. 좁은 화면에서는 **감춘다** — 216px 를 고정으로 차지하면
 * 375px 화면에서 본문이 159px 만 남아 아무것도 읽을 수 없다(실측).
 * 그 폭에서는 상단바의 메뉴 버튼이 같은 내용을 서랍으로 연다.
 */
export function Sidebar({
  user,
  openCount,
}: {
  user: User;
  openCount: number | null;
}) {
  return (
    <aside
      className="border-line bg-surface hidden shrink-0 flex-col border-r md:flex"
      style={{ width: "var(--sidebar-w)" }}
    >
      <SidebarBody user={user} openCount={openCount} />
    </aside>
  );
}
