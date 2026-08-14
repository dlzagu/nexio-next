"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 사용자 표시 설정(테마·밀도·시트 폭)은 React 상태가 아니라 localStorage 에 있다.
 * useSyncExternalStore 로 읽으면 effect 안에서 동기 setState 를 하지 않고도
 * SSR 스냅샷과 클라이언트 스냅샷이 어긋나지 않는다.
 * (eslint react-hooks/set-state-in-effect 를 우회가 아니라 설계로 피한다)
 */
const PREF_EVENT = "nx-pref-change";

function subscribe(onChange: () => void) {
  window.addEventListener(PREF_EVENT, onChange);
  return () => window.removeEventListener(PREF_EVENT, onChange);
}

export function notifyPrefChange() {
  window.dispatchEvent(new Event(PREF_EVENT));
}

export function usePref<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const raw = localStorage.getItem(key) as T | null;
      if (!raw) return fallback;
      // 저장값이 허용 목록 밖이면 기본값으로 떨어뜨린다 (손상된 값에 화면이 끌려가지 않게)
      if (allowed && !allowed.includes(raw)) return fallback;
      return raw;
    },
    () => fallback, // 서버 스냅샷
  );

  const set = useCallback(
    (v: T) => {
      localStorage.setItem(key, v);
      notifyPrefChange();
    },
    [key],
  );

  return [value, set];
}
