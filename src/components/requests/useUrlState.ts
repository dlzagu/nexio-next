"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { UserRole } from "@/lib/codes";
import type { ListView } from "@/lib/types";

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

/* ── 목록 필터 키 — 정본 ─────────────────────────────────── */

/**
 * 🔴 필터로 쓰는 URL 키는 **이 목록 하나**다. 상세 필터 배지·초기화 버튼·빈 상태의
 *    이유·초기화가 모두 여기를 본다. 화면마다 따로 적어 두면 한쪽만 늘어난다 —
 *    '미읽음'이 배지에는 세지는데 빈 상태에서는 빠져, 대시보드 '미읽음 0' 카드로
 *    들어온 사람에게 "미완료 요청이 없습니다"라는 사실과 다른 이유를 댔다.
 */
export const BASIC_FILTER_KEYS = [
  "q",
  "custCode",
  "progress",
  "from",
  "to",
] as const;
export const ADVANCED_FILTER_KEYS = [
  "assignee",
  "requester",
  "module",
  "priority",
  "migration",
  "unread",
] as const;
export const LIST_FILTER_KEYS = [
  ...BASIC_FILTER_KEYS,
  ...ADVANCED_FILTER_KEYS,
] as const;

type ParamReader = { get(key: string): string | null };

export const hasListFilters = (p: ParamReader) =>
  LIST_FILTER_KEYS.some((k) => !!p.get(k));

export const countAdvancedFilters = (p: ParamReader) =>
  ADVANCED_FILTER_KEYS.filter((k) => !!p.get(k)).length;

/** 필터만 지운다 — 뷰·열린 상세는 필터가 아니다 */
export const listFilterResetPatch = (): Record<string, null> =>
  Object.fromEntries(LIST_FILTER_KEYS.map((k) => [k, null]));

/**
 * 목록이 비었을 때 **무엇 때문인지** (P7 — 빈 상태는 이유와 다음 행동을 말한다).
 * 가장 좁히는 조건부터 댄다: 미읽음 → 걸린 필터 → 고객사 비공개 → 뷰 자체.
 * '이관 데이터 포함'(migration)은 넓히는 스위치라 좁힌 이유로 치지 않는다.
 */
export type EmptyListReason =
  "unread" | "filtered" | "customerPrivate" | "noOpen" | "widen";

export function emptyListReason(
  p: ParamReader,
  role: UserRole,
  view: ListView,
): EmptyListReason {
  if (p.get("unread") === "1") return "unread";
  if (LIST_FILTER_KEYS.some((k) => k !== "migration" && !!p.get(k))) {
    return "filtered";
  }
  if (role === "CUSTOMER") return "customerPrivate";
  return view === "open" ? "noOpen" : "widen";
}
