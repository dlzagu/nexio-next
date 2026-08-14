"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * 필터·선택 상태를 URL 에 둔다.
 * 이유: 새로고침·공유·뒤로가기가 그대로 동작한다(재설계 §6 "URL 을 바꾼다").
 */
export function useUrlState() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = useCallback(
    (patch: Record<string, string | null>, opts?: { resetPage?: boolean }) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (opts?.resetPage) next.delete("page");
      startTransition(() => {
        router.push(`?${next.toString()}`, { scroll: false });
      });
    },
    [params, router],
  );

  return { params, set, pending };
}
