/**
 * "읽음선이 움직였다"는 신호 (브라우저 전용).
 *
 * 🔴 서버 데이터는 `router.refresh()` 로 다시 그려지지만, **자기 데이터를 직접 fetch 하는
 *    클라이언트 위젯**(상단 알림 종)은 그 갱신을 보지 못한다 — 목록의 점은 사라졌는데
 *    배지 숫자만 옛날 값으로 남는다. 같은 사실을 두 경로가 보고 있으므로 신호로 맞춘다.
 */
export const READ_STATE_CHANGED = "nx:read-state-changed";

export function announceReadStateChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(READ_STATE_CHANGED));
  }
}
