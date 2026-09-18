import { InlineError } from "@/components/ui/EmptyState";
import { josa } from "@/lib/format";

/**
 * 대시보드 위젯의 **조회 실패** 표시.
 *
 * 🔴 실패를 빈 목록·0 으로 그리지 않는다 — 사용자에게 '0건'과 '못 읽음'은 같은 모양이라
 *    할 일이 없다고 믿고, 화면으로 하는 배포 검증도 드리프트를 놓친다.
 *    (사이드바 카운트가 null/0 을 구분하는 것과 같은 축 — AppShell)
 */
export function WidgetError({ what }: { what: string }) {
  return (
    <div className="p-4" role="alert">
      <InlineError
        title={`${josa(what, "을/를")} 불러오지 못했습니다`}
        detail="0건이 아니라 조회 실패입니다 — 서버 로그의 [dashboard widget] 항목을 확인해 주세요."
      />
    </div>
  );
}

/** 요약 카드의 실패 자리. 숫자를 모르므로 링크도 걸지 않는다(가서 볼 숫자가 없다) */
export function StatCardFailed({ label }: { label: string }) {
  return (
    <div className="card flex flex-col justify-between gap-3 p-4" role="alert">
      <span className="text-12 text-fg-muted font-medium">{label}</span>
      <span
        className="num text-30 text-fg-subtle font-semibold tracking-tight"
        aria-hidden
      >
        —
      </span>
      <span className="text-11 text-danger-text">불러오지 못했습니다</span>
    </div>
  );
}
