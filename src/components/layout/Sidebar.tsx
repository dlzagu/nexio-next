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

export function Sidebar({
  user,
  openCount,
}: {
  user: User;
  /** null = 카운트를 못 읽었다 (0 건과 구분한다) */
  openCount: number | null;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="border-line bg-surface flex shrink-0 flex-col border-r"
      style={{ width: "var(--sidebar-w)" }}
    >
      <div className="border-line-subtle flex h-[52px] items-center gap-2.5 border-b px-4">
        <span
          aria-hidden
          className="bg-accent text-11 text-fg-on-solid flex h-6 w-6 items-center justify-center rounded-md font-bold"
        >
          N
        </span>
        <span className="text-14 text-fg-strong font-semibold tracking-tight">
          넥시오
        </span>
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
    </aside>
  );
}
