"use client";

import { useRouter } from "next/navigation";
import { Monitor, Moon, Rows2, Rows3, Rows4, Sun, UserCog } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useCallback, useState, useTransition } from "react";
import { Notice } from "@/components/ui/EmptyState";
import { MobileNav } from "./MobileNav";
import { cn } from "@/lib/cn";
import { USER_ROLE_LABEL } from "@/lib/codes";
import type { Persona } from "@/lib/session";
import type { User } from "@/lib/types";
import { notifyPrefChange, usePref } from "@/lib/usePref";
import { NotificationBell } from "./NotificationBell";

type Theme = "light" | "dark" | "system";
type Density = "compact" | "default" | "relaxed";

function applyTheme(t: Theme) {
  const resolved =
    t === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : t;
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem("nx-theme", t);
}

function applyDensity(d: Density) {
  if (d === "default") document.documentElement.removeAttribute("data-density");
  else document.documentElement.setAttribute("data-density", d);
  localStorage.setItem("nx-density", d);
}

/** 전환이 왜 안 됐는지 — 코드를 그대로 보여주지 않고 사람이 읽을 문장으로 */
const SWITCH_ERROR: Record<string, string> = {
  USER_NOT_FOUND:
    "이 계정이 데모 DB 에 없습니다. 공유 DB 가 코드보다 뒤처졌습니다 (npm run db:sync:remote).",
  BAD_REQUEST: "전환할 계정이 지정되지 않았습니다.",
};

export function Topbar({
  user,
  personas,
  openCount,
}: {
  user: User;
  personas: Persona[];
  /** 좁은 화면의 서랍 메뉴가 사이드바와 같은 뱃지를 보여준다 */
  openCount: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [theme] = usePref<Theme>("nx-theme", "system", [
    "light",
    "dark",
    "system",
  ]);
  const [density] = usePref<Density>("nx-density", "default", [
    "compact",
    "default",
    "relaxed",
  ]);
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // 테마·밀도는 localStorage 뿐 아니라 html 속성도 바꿔야 하므로 전용 적용 함수를 쓴다
  const setTheme = useCallback((v: Theme) => {
    applyTheme(v);
    notifyPrefChange();
  }, []);
  const setDensity = useCallback((v: Density) => {
    applyDensity(v);
    notifyPrefChange();
  }, []);

  /**
   * 🔴 응답 상태를 **반드시 본다.** 예전엔 결과를 버리고 무조건 refresh 만 해서,
   *    전환이 404 로 거절돼도 화면이 아무 말도 하지 않았다 — 눌러도 그대로인 버튼은
   *    "선택이 안 되는" 고장으로 보인다 (실측: 라이브에서 새 페르소나가 404).
   */
  const switchUser = async (userId: string) => {
    setSwitching(true);
    setFailed(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.status !== 200) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setFailed(
          (body.code && SWITCH_ERROR[body.code]) ??
            `전환하지 못했습니다 (HTTP ${res.status}).`,
        );
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setSwitching(false);
    }
  };

  return (
    <header className="border-line bg-surface/85 sticky top-0 z-[var(--z-sticky)] flex h-[52px] shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      {/* 좁은 화면에서는 사이드바가 감춰지므로 여기가 유일한 주 메뉴 통로다 */}
      <MobileNav user={user} openCount={openCount} />

      <div className="flex-1" />

      <NotificationBell />

      {/* 밀도 — 하루 8시간 켜놓는 도구라 사용자가 고를 수 있어야 한다 (P8) */}
      {/* ⚠️ .seg 의 display:flex 는 레이어 밖 CSS 라 Tailwind 의 `hidden` 을 이긴다 —
          클래스를 같이 붙이면 안 숨는다. 감싸는 요소에서 접는다(contents 라 배치는 그대로). */}
      <div className="hidden sm:contents">
        <div className="seg" role="group" aria-label="표시 밀도">
          {(
            [
              ["compact", Rows4, "촘촘히"],
              ["default", Rows3, "기본"],
              ["relaxed", Rows2, "넉넉히"],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={density === v}
              data-state={density === v ? "active" : "inactive"}
              className="seg-i px-2"
              onClick={() => {
                setDensity(v);
              }}
            >
              <Icon size={13} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div className="seg" role="group" aria-label="테마">
        {(
          [
            ["light", Sun, "밝게"],
            ["dark", Moon, "어둡게"],
            ["system", Monitor, "시스템"],
          ] as const
        ).map(([v, Icon, label]) => (
          <button
            key={v}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={theme === v}
            data-state={theme === v ? "active" : "inactive"}
            className="seg-i px-2"
            onClick={() => {
              setTheme(v);
            }}
          >
            <Icon size={13} aria-hidden />
          </button>
        ))}
      </div>

      {/* 데모 역할 전환 — 역할별 UX(권한·가시성)를 직접 체험하는 장치 */}
      <Popover.Root>
        <Popover.Trigger
          className="btn btn-outline btn-sm"
          disabled={switching || pending}
          title="역할 전환 (데모)"
        >
          <UserCog size={14} aria-hidden />
          <span className="hidden sm:inline">{user.name}</span>
          <span className="badge badge-neutral">
            {USER_ROLE_LABEL[user.role]}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="border-line bg-surface shadow-3 z-[var(--z-dropdown)] w-[min(280px,calc(100vw-16px))] rounded-md border p-2"
          >
            <p className="text-11 text-fg-subtle px-2 pt-1 pb-2 leading-relaxed">
              역할 전환 데모입니다. 페르소나는 전부 시드 데이터의 가상 인물이며,
              역할에 따라 보이는 범위와 가능한 액션이 달라집니다.
            </p>
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.available || switching}
                title={
                  p.available
                    ? undefined
                    : "이 계정이 데모 DB 에 없습니다 — 공유 DB 가 코드보다 뒤처졌습니다"
                }
                onClick={() => switchUser(p.id)}
                className={cn(
                  "text-13 hover:bg-hover flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left",
                  "disabled:opacity-45 disabled:hover:bg-transparent",
                  p.id === user.id && "bg-selected text-accent-text",
                )}
              >
                <span className="ell">{p.hint}</span>
                <span className="mono text-11 text-fg-subtle shrink-0">
                  {p.available ? p.id : "없음"}
                </span>
              </button>
            ))}
            {failed ? (
              <div role="alert" className="mt-1.5">
                <Notice tone="danger">{failed}</Notice>
              </div>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </header>
  );
}

/** 첫 페인트 전에 테마를 적용해 깜빡임을 막는다 */
export const themeBootScript = `
(function(){try{
  var t=localStorage.getItem('nx-theme')||'system';
  var d=localStorage.getItem('nx-density')||'default';
  var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;
  document.documentElement.setAttribute('data-theme',r);
  if(d!=='default')document.documentElement.setAttribute('data-density',d);
}catch(e){}})();
`;
