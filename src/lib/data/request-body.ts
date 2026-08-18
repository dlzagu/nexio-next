import { htmlToPlain } from "../format";

/**
 * 신청 본문의 저장 형식. 폼은 증상/요청내용 두 칸이지만 저장 컬럼(CONTENT)은 하나다 —
 * 담당자가 둘을 나눠 읽어야 의미가 있으므로 **본문 안에 구획을 남긴다.**
 *
 * 🔴 REMARKS 에 증상을 따로 넣되 화면에서 함께 렌더하지는 않는다.
 *    (분리 필드와 요약 필드를 같이 그리면 같은 내용이 두 번 나온다 — OKREMARKS 와 같은 함정)
 */
const SYMPTOM_LABEL = "증상";
const CONTENT_LABEL = "요청내용";

/** 줄바꿈을 문단으로. 저장 포맷이 HTML 이라 평문을 그대로 넣으면 한 줄로 붙는다 */
export function toParagraphs(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${l}</p>`)
    .join("");
}

export function composeBody(symptom: string, content: string): string {
  return (
    `<p><strong>${SYMPTOM_LABEL}</strong></p>${toParagraphs(symptom)}` +
    `<p><strong>${CONTENT_LABEL}</strong></p>${toParagraphs(content)}`
  );
}

/**
 * 저장 본문 → 폼 두 칸. 재신청 프리필용.
 * 구획이 없는 레코드(시드·구시스템 이관분)는 나눌 근거가 없으므로 통째로 요청내용에 넣는다.
 * 평문으로 바꾼 뒤 판별하기 때문에 이스케이프 저장된 행에서도 똑같이 동작한다.
 */
export function splitBody(
  contentHtml: string,
  remarksHtml: string,
): { symptom: string; content: string } {
  const lines = htmlToPlain(contentHtml).split("\n");
  const at = lines.indexOf(CONTENT_LABEL);
  // 첫 줄이 '증상' 일 때만 우리가 쓴 구획으로 본다 — 본문 중간의 같은 낱말에 속지 않는다
  if (lines[0] === SYMPTOM_LABEL && at > 0) {
    return {
      symptom: lines.slice(1, at).join("\n").trim(),
      content: lines
        .slice(at + 1)
        .join("\n")
        .trim(),
    };
  }
  return {
    symptom: htmlToPlain(remarksHtml),
    content: htmlToPlain(contentHtml),
  };
}
