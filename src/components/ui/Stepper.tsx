import { cn } from "@/lib/cn";
import {
  MAIN_FLOW,
  PROGRESS,
  mainFlowIndex,
  progressLabel,
  type ProgressCode,
} from "@/lib/codes";

interface Step {
  code: string;
  label: string;
}

/**
 * 주 경로 5단계 + 넘겨받은 확장 단계만 그린다.
 * 실측: 5·6(테스트) 8건, 7·8(시스템이관) 3건 — 상시 렌더하지 않는다.
 *
 * ⚠️ 상세 화면은 고객사 플래그가 아니라 `extendedStagesOf(티켓)` 을 넘긴다 — 아래 참조.
 */
export function flowSteps(opts: {
  usesTestStage?: boolean;
  usesSystemStage?: boolean;
}): Step[] {
  const steps: Step[] = MAIN_FLOW.filter((c) => c !== "9").map((c) => ({
    code: c,
    label: PROGRESS[c as ProgressCode],
  }));
  if (opts.usesTestStage) {
    steps.push(
      { code: "5", label: PROGRESS["5"] },
      { code: "6", label: PROGRESS["6"] },
    );
  }
  if (opts.usesSystemStage) {
    steps.push(
      { code: "7", label: PROGRESS["7"] },
      { code: "8", label: PROGRESS["8"] },
    );
  }
  steps.push({ code: "9", label: PROGRESS["9"] });
  return steps;
}

/**
 * 이 티켓에 **실제로 그릴** 확장 단계.
 *
 * 🔴 고객사가 테스트·이관 단계를 '쓴다'는 플래그만으로 5~8 칸을 그리면 안 된다 —
 *    4→5(테스트 요청)·→7(이관 요청)로 가는 액션이 전이표에 없어서, 해결안제시(4) 건의
 *    스테퍼가 다음 단계로 '테스트요청'을 보여 주는데 담당자의 전진 버튼 '완료 처리'는 곧장
 *    완료(9)로 간다(실측 UX-10). 도달할 길이 없는 칸은 약속이 아니라 오해다.
 *    지금 그 단계에 있거나(5~8) 지나간 흔적(일시)이 있을 때만 그린다.
 */
export function extendedStagesOf(t: {
  progress: string;
  history: {
    testAt: string | null;
    testCompletedAt: string | null;
    systemAt: string | null;
  };
}): { usesTestStage: boolean; usesSystemStage: boolean } {
  const p = String(t.progress).trim();
  return {
    usesTestStage:
      p === "5" ||
      p === "6" ||
      !!t.history.testAt ||
      !!t.history.testCompletedAt,
    usesSystemStage: p === "7" || p === "8" || !!t.history.systemAt,
  };
}

export function Stepper({
  progress,
  usesTestStage,
  usesSystemStage,
  className,
}: {
  progress: string;
  usesTestStage?: boolean;
  usesSystemStage?: boolean;
  className?: string;
}) {
  const p = String(progress).trim();
  // 현재 단계는 언제나 그린다 — 칸이 없으면 첫 단계가 '현재'로 칠해진다
  const steps = flowSteps({
    usesTestStage: usesTestStage || p === "5" || p === "6",
    usesSystemStage: usesSystemStage || p === "7" || p === "8",
  });
  const terminatedEarly = p === "11" || p === "12";
  /**
   * 취소요청(10)은 주 경로에 없다. 그대로 두면 어느 단계에도 안 맞아
   * **첫 단계가 현재인 것처럼** 그려진다(대기로 보인다). 진행(3)에서 갈라져 나온
   * 곁가지이므로 자리는 진행에 두고, 갈라졌다는 사실을 앞에 붙인다.
   */
  const cancelPending = p === "10";
  const currentIdx = steps.findIndex(
    (s) => s.code === (cancelPending ? "3" : p),
  );

  return (
    <div className={cn("stp", className)} role="list" aria-label="진행 단계">
      {cancelPending ? (
        <div className="stp-i" data-state="cancelled" role="listitem">
          <span className="stp-n">?</span>
          <span className="stp-l">취소 요청됨</span>
        </div>
      ) : null}
      {terminatedEarly ? (
        <div className="stp-i" data-state="cancelled" role="listitem">
          <span className="stp-n">{p === "11" ? "—" : "✕"}</span>
          <span className="stp-l">{progressLabel(p)}로 종료됨</span>
        </div>
      ) : null}
      {steps.map((s, i) => {
        const state = terminatedEarly
          ? "todo"
          : currentIdx >= 0
            ? i < currentIdx
              ? "done"
              : i === currentIdx
                ? "current"
                : "todo"
            : i === 0
              ? "current"
              : "todo";
        return (
          <div key={s.code} className="flex items-center">
            {i > 0 || terminatedEarly ? (
              <span className="stp-bar" aria-hidden />
            ) : null}
            <div className="stp-i" data-state={state} role="listitem">
              <span className="stp-n" aria-hidden>
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="stp-l">
                {s.label}
                {state === "current" ? (
                  <span className="sr-only"> (현재 단계)</span>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 목록 컬럼용 5칸 게이지 — 텍스트 대신 형태로 진행도를 읽게 한다 */
export function MiniStepper({ progress }: { progress: string }) {
  const p = String(progress).trim();
  const idx = mainFlowIndex(p);
  const tone =
    p === "9" ? "success" : p === "11" || p === "12" ? "danger" : "accent";
  const filled = p === "9" ? 5 : idx < 0 ? 0 : idx + 1;

  return (
    <span
      className="mstp"
      // 역할 없는 span 의 aria-label 은 무시된다 — 뜻을 전하는 그림이므로 img 로 선언한다
      role="img"
      title={`${progressLabel(p)} (${filled}/5)`}
      aria-label={`${progressLabel(p)} — 5단계 중 ${filled}단계`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="mstp-s"
          data-on={i < filled}
          data-tone={tone}
          aria-hidden
        />
      ))}
    </span>
  );
}
