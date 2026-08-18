"use client";

import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtRelative } from "@/lib/format";
import {
  READ_STATE_CHANGED,
  announceReadStateChanged,
} from "@/lib/read-signal";
import type { NotificationItem } from "@/lib/data/notifications";

/**
 * 알림센터. 원본은 헤더의 종 아이콘 드롭다운이다.
 *
 * 여기서는 **"취소 권유 → 신청자가 본다"** 를 성립시키는 마지막 조각이다 —
 * 담당자가 남긴 권유가 목록의 작은 뱃지에만 뜨면 코멘트 왕복이 그대로 남는다.
 * 알림에서 바로 그 건으로 들어가게 해 '알림 1 + 클릭 1' 로 줄인다 (재설계 §3).
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{
    items: NotificationItem[];
    total: number;
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** 다시 읽어야 할 이유가 생겼다는 표시 (다른 화면에서 읽음 처리가 일어난 경우) */
  const [tick, setTick] = useState(0);

  /**
   * 마운트 시 한 번, 그리고 열 때마다 읽는다.
   * 🔴 열어야 건수를 아는 알림은 알림이 아니다 — 배지가 먼저 보여야 눌러볼 이유가 생긴다.
   * 폴링은 하지 않는다 (데모에서 백그라운드 요청이 계속 도는 편이 더 나쁘다).
   */
  useEffect(() => {
    let alive = true;
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : { items: [], total: 0 }))
      .then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [open, tick]);

  /**
   * 상세를 열어 읽은 건은 여기서도 사라져야 한다.
   * 이 위젯은 자기 데이터를 직접 fetch 하므로 서버 리렌더(router.refresh)로는 안 바뀐다 —
   * 배지만 옛 숫자로 남으면 "지워지지 않는 알림"으로 보인다.
   */
  useEffect(() => {
    const onChanged = () => setTick((n) => n + 1);
    window.addEventListener(READ_STATE_CHANGED, onChanged);
    return () => window.removeEventListener(READ_STATE_CHANGED, onChanged);
  }, []);

  const go = (echoNum: string) => {
    setOpen(false);
    router.push(`/requests?view=mine&open=${encodeURIComponent(echoNum)}`);
  };

  const readAll = async () => {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // 🔴 202(WRITE_DISABLED)는 저장이 안 된 것이다. res.ok 에 포함되므로 따로 걸러야 한다 —
    //    안 그러면 쓰기가 꺼진 기본 설정에서 "읽음 처리했다"고 뱃지만 지우고 안내는 삼킨다.
    if (res.status === 200) {
      setData({ items: [], total: 0 });
      setNote(null);
      router.refresh();
      announceReadStateChanged();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    setNote(body.message ?? `읽음 처리를 하지 못했습니다 (${res.status}).`);
  };

  const count = data?.total ?? 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="btn btn-ghost btn-sm relative"
        aria-label={count > 0 ? `알림 ${count}건` : "알림"}
        title="알림"
      >
        <Bell size={15} aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            className="bg-danger text-fg-on-solid absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="border-line bg-surface shadow-3 z-[var(--z-dropdown)] flex max-h-[70vh] w-[min(380px,calc(100vw-16px))] flex-col rounded-md border"
        >
          <div className="border-line-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-12 text-fg-strong font-medium">
              확인할 요청 {count > 0 ? `${count}건` : ""}
            </span>
            {count > 0 ? (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={readAll}
              >
                <CheckCheck size={12} aria-hidden />
                모두 읽음
              </button>
            ) : null}
          </div>

          {note ? (
            <p className="text-11 text-warning-text border-warning-border bg-warning-subtle border-b px-3 py-2 leading-relaxed">
              {note}
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            {!data ? (
              <p className="text-12 text-fg-subtle px-3 py-6 text-center">
                불러오는 중…
              </p>
            ) : data.items.length === 0 ? (
              <p className="text-12 text-fg-subtle px-3 py-6 text-center leading-relaxed">
                새 알림이 없습니다.
                <br />
                최근 30일 안에 올라온 글만 알림으로 표시합니다.
              </p>
            ) : (
              <ul className="divide-line-subtle divide-y">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="hover:bg-hover flex w-full flex-col gap-1 px-3 py-2.5 text-left"
                      onClick={() => go(n.echoNum)}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "badge",
                            n.mine === "requester"
                              ? "badge-accent"
                              : "badge-neutral",
                          )}
                        >
                          {n.mine === "requester" ? "내 요청" : "내 담당"}
                        </span>
                        {n.isLog ? (
                          <span className="badge badge-neutral">상태 변경</span>
                        ) : null}
                        {n.unread > 1 ? (
                          <span className="text-11 text-fg-subtle">
                            새 글 {n.unread}
                          </span>
                        ) : null}
                        <span className="text-11 text-fg-subtle ml-auto shrink-0">
                          {fmtRelative(n.at)}
                        </span>
                      </span>
                      <span className="text-12 text-fg-strong ell">
                        {n.title}
                      </span>
                      <span className="text-11 text-fg-muted line-clamp-2">
                        {n.authorName} · {n.body || "(내용 없음)"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data && data.total > data.items.length ? (
            <p className="text-11 text-fg-subtle border-line-subtle border-t px-3 py-2">
              최근 {data.items.length}건만 표시합니다. 나머지는 요청 조회의
              &lsquo;내 요청&rsquo; 뷰에서 확인하세요.
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
