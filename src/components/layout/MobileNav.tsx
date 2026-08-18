"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu } from "lucide-react";
import { useState } from "react";
import type { User } from "@/lib/types";
import { SidebarBody } from "./Sidebar";

/**
 * 좁은 화면의 주 메뉴. 데스크톱 사이드바를 **그대로** 서랍에 담는다 (`SidebarBody`).
 *
 * 포커스 트랩·Esc·스크롤 락은 Radix 가 처리한다 — 직접 만들면 접근성이 깨진다.
 * 메뉴를 누르면 서랍이 닫힌다: 화면이 바뀌었는데 덮개가 남아 있으면 멈춘 것처럼 보인다.
 */
export function MobileNav({
  user,
  openCount,
}: {
  user: User;
  openCount: number | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/* ⚠️ .btn 의 display 는 레이어 밖 CSS 라 Tailwind 의 `md:hidden` 을 이긴다.
          버튼에 직접 붙이면 넓은 화면에서도 남는다 — 감싸는 요소에서 접는다. */}
      <span className="md:hidden">
        <Dialog.Trigger className="btn btn-ghost btn-sm" aria-label="메뉴 열기">
          <Menu size={16} aria-hidden />
        </Dialog.Trigger>
      </span>
      <Dialog.Portal>
        <Dialog.Overlay className="ovl ovl-nav" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">주 메뉴</Dialog.Title>
          <SidebarBody
            user={user}
            openCount={openCount}
            onNavigate={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
