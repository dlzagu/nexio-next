/**
 * 평문 입력의 꺾쇠가 저장 → 미리보기 → 재신청 프리필 왕복에서 살아남는가.
 *
 * 재현한 증상: 신청 폼의 평문을 이스케이프해 `<p>` 로 감싸 저장하게 바꾼 뒤(SEC-4),
 * 미리보기·프리필이 **무조건 먼저 디코드**하는 바람에 `&lt;select&gt;` 가 다시 태그가 되어
 * 지워졌다 — 코드·SQL 을 붙여 문의한 고객의 본문이 재신청 때 사라진다.
 * 옛 레코드(태그째 이스케이프된 `&lt;div&gt;`)는 여전히 풀려야 한다.
 */
import { describe, expect, it } from "vitest";
import { composeBody, splitBody, toParagraphs } from "@/lib/data/request-body";
import { htmlToPlain, plainPreview } from "@/lib/format";
import { sanitize } from "@/lib/sanitize";

const CODE = "<select> 에서 a<b 이고 List<string> 을 씁니다";

describe("평문 꺾쇠 왕복", () => {
  it("저장 형식 → 평문으로 되돌리면 원문 그대로다", () => {
    const stored = toParagraphs(CODE);
    expect(stored).not.toContain("<select>");
    expect(htmlToPlain(stored)).toBe(CODE);
    expect(plainPreview(stored)).toBe(CODE);
  });

  it("증상·요청내용 구획으로 저장한 본문이 재신청 프리필에서 그대로 돌아온다", () => {
    const stored = composeBody(CODE, `WHERE qty < 10 AND a <> b`);
    const back = splitBody(stored, "");
    expect(back.symptom).toBe(CODE);
    expect(back.content).toBe("WHERE qty < 10 AND a <> b");
  });

  it("새니타이즈한 렌더에도 꺾쇠가 글자로 남는다(태그로 해석되지 않는다)", () => {
    const html = sanitize(toParagraphs(CODE));
    expect(html).toContain("&lt;select&gt;");
    expect(html).not.toMatch(/<select/i);
  });

  it("옛 레코드(태그째 이스케이프)는 여전히 풀어서 태그를 걷는다", () => {
    const legacy = "&lt;div&gt;전표 &amp;#39;마감&amp;#39; 오류&lt;/div&gt;";
    expect(plainPreview(legacy)).not.toContain("div");
    expect(
      htmlToPlain("&lt;p&gt;첫 줄&lt;/p&gt;&lt;p&gt;둘째 줄&lt;/p&gt;"),
    ).toBe("첫 줄\n둘째 줄");
  });
});
