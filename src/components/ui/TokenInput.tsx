"use client";

import { X } from "lucide-react";
import { useState } from "react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 참조자 입력. 원본은 refGroupSelect + ccInput + refEmail 3중 UI 가 따로 놀았다
 * → 토큰 입력 하나로 통합. 검증은 **토큰 추가 시점**에 한다 (제출까지 미루지 않는다).
 */
export function TokenInput({
  values,
  onChange,
  placeholder = "이메일 입력 후 Enter",
  id,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string) => {
    const v = raw.trim().replace(/[,;]$/, "");
    if (!v) return;
    if (!EMAIL.test(v)) {
      setError(`"${v}" 는 이메일 형식이 아닙니다`);
      return;
    }
    if (values.includes(v)) {
      setError("이미 추가된 주소입니다");
      setDraft("");
      return;
    }
    setError(null);
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div>
      <div className="tokenbox">
        {values.map((v) => (
          <span key={v} className="chip">
            {v}
            <button
              type="button"
              className="chip-x"
              aria-label={`${v} 제거`}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          // 값이 하나라도 있으면 placeholder 를 지운다(칩과 겹쳐 보인다).
          // 그런데 이 입력의 이름은 placeholder 뿐이라, 그때 **이름이 통째로 사라진다** —
          // 스크린리더에는 "편집" 만 읽힌다. 보이는 글자와 무관하게 이름은 유지한다.
          aria-label={placeholder}
          placeholder={values.length ? "" : placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          aria-invalid={error ? "true" : undefined}
        />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
