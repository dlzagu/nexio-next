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

/** 평문 한 줄을 HTML 글자로. 꺾쇠·앰퍼샌드·따옴표가 **태그가 아니라 글자**가 되게 한다 */
function escapeText(line: string): string {
  return line
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 평문 → 문단 HTML. **평문 입력칸(textarea)·사유의 유일한 변환 경로**다.
 * 줄바꿈을 문단으로 바꾼다 — 저장 포맷이 HTML 이라 평문을 그대로 넣으면 한 줄로 붙는다.
 *
 * 🔴 먼저 이스케이프한다. 그대로 감싸면 새니타이저가 평문을 HTML 로 읽어서
 *    `List<string>` → `List`, `DocTotal<>0` → `DocTotal0` 처럼 **코드·SQL 이 조용히 잘리고**,
 *    반대로 평문 칸에 적은 `<img src=…>` 는 살아서 렌더된다.
 *    ⚠️ 이미 HTML 인 값(서식 편집기·정기 업무 템플릿 본문)을 여기 넣으면 태그가 글자로 보인다.
 */
export function toParagraphs(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeText(l)}</p>`)
    .join("");
}

/**
 * 두 칸을 한 본문으로. **증상이 비면 그 구획을 아예 만들지 않는다** —
 * 업무 등록(대리 등록)은 증상을 따로 받지 않아서, 그대로 두면 상세 화면에
 * 내용 없는 '증상' 제목만 덩그러니 남는다(빈 칸은 고장으로 읽힌다).
 */
export function composeBody(symptom: string, content: string): string {
  const body = toParagraphs(content);
  const head = symptom.trim()
    ? `<p><strong>${SYMPTOM_LABEL}</strong></p>${toParagraphs(symptom)}`
    : "";
  // 구획이 하나뿐이면 제목도 붙이지 않는다 — 나눌 것이 없는데 나눈 척하지 않는다
  return head ? `${head}<p><strong>${CONTENT_LABEL}</strong></p>${body}` : body;
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
