import { cn } from "@/lib/cn";

/**
 * 폼 한 칸 — 라벨 + 컨트롤 + (오류 | 힌트).
 *
 * 오류와 힌트는 **같은 자리**를 쓴다. 둘을 동시에 그리면 줄 수가 달라져
 * 옆 칸과 높이가 어긋나고, 무엇을 고쳐야 하는지도 흐려진다 — 오류가 이긴다.
 */
export function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
  className,
  group,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  /**
   * 컨트롤이 **하나가 아닐 때**(버튼 묶음 등). `<label htmlFor>` 는 가리킬 컨트롤이
   * 있어야 의미가 있는데, 버튼 여러 개를 감싸면 가리킬 대상이 없어 라벨이 붕 뜬다.
   * 이 경우 묶음 자체에 이름을 붙인다(role="group" + aria-labelledby).
   */
  group?: boolean;
}) {
  const labelId = `${id}-label`;
  return (
    <div
      className={className}
      role={group ? "group" : undefined}
      aria-labelledby={group ? labelId : undefined}
    >
      {group ? (
        <p id={labelId} className={cn("label", required && "label-req")}>
          {label}
        </p>
      ) : (
        <label htmlFor={id} className={cn("label", required && "label-req")}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="field-error">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
