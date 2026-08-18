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
 * 주 경로 5단계 + 고객사 플래그가 켜진 확장 단계만 그린다.
 * 실측: 5·6(테스트) 8건, 7·8(시스템이관) 3건 — 상시 렌더하지 않는다.
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
  const steps = flowSteps({ usesTestStage, usesSystemStage });
  const p = String(progress).trim();
  const terminatedEarly = p === "11" || p === "12";
  const currentIdx = steps.findIndex((s) => s.code === p);

  return (
    <div className={cn("stp", className)} role="list" aria-label="진행 단계">
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
