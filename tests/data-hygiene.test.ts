import { describe, expect, it } from "vitest";
import {
  labelOf,
  mainFlowIndex,
  MODULE,
  progressLabel,
  progressTone,
} from "@/lib/codes";
import {
  dateSortKey,
  decodeEntities,
  fmtDate,
  plainPreview,
  toValidDate,
} from "@/lib/format";
import { isBlankHtml, sanitize } from "@/lib/sanitize";

describe("labelOf — 매핑 실패 시 원문을 그대로 보여준다", () => {
  it("코드가 있으면 라벨로 바꾼다", () => {
    expect(labelOf(MODULE, "2")).toBe("재무관리");
  });

  it("구시스템 이관분처럼 한글 원문이 들어 있으면 그대로 돌려준다", () => {
    // 실측: MODULE 에 코드 대신 '재무관리' 가 값 자체로 들어 있는 행이 있다
    expect(labelOf(MODULE, "재무관리")).toBe("재무관리");
    expect(labelOf(MODULE, "999")).toBe("999");
  });

  it("빈 값은 빈 문자열 — 빈칸으로 두지 않기 위한 기준점", () => {
    expect(labelOf(MODULE, null)).toBe("");
    expect(labelOf(MODULE, "  ")).toBe("");
  });
});

describe("날짜 이상치", () => {
  it("1900-01-01 계열(이관분 날짜 누락)은 null 로 떨어진다", () => {
    expect(toValidDate("1900-01-01T00:00:00.000Z")).toBeNull();
    expect(fmtDate("1900-01-01T00:00:00.000Z")).toBe("-");
  });

  it("미래 이상치(2105-07-22)도 null 로 떨어진다", () => {
    expect(toValidDate("2105-07-22T00:00:00.000Z")).toBeNull();
  });

  it("정상 날짜는 통과한다", () => {
    expect(fmtDate("2026-07-22T00:00:00.000Z")).toBe("2026-07-22");
  });

  it("정렬 시 이상치·null 은 항상 최후위", () => {
    const normal = dateSortKey("2026-07-22T00:00:00.000Z");
    expect(dateSortKey(null)).toBe(-Infinity);
    expect(dateSortKey("1900-01-01T00:00:00.000Z")).toBe(-Infinity);
    expect(normal).toBeGreaterThan(dateSortKey("1900-01-01T00:00:00.000Z"));
  });
});

describe("decodeEntities — 저장값이 HTML 이스케이프돼 있다", () => {
  it("숫자·명명 엔티티를 모두 푼다", () => {
    expect(decodeEntities("&#39;26년 6월")).toBe("'26년 6월");
    expect(decodeEntities("[SAP &amp; ALL CAR PARTS]")).toBe(
      "[SAP & ALL CAR PARTS]",
    );
    expect(decodeEntities("a&lt;b&gt;c")).toBe("a<b>c");
  });

  it("모르는 엔티티는 건드리지 않는다", () => {
    expect(decodeEntities("&unknown;")).toBe("&unknown;");
  });
});

describe("sanitize — 기존 HTML 2.3만 건을 렌더하기 전에", () => {
  it("script 를 제거한다", () => {
    const out = sanitize("<p>안녕</p><script>alert(1)</script>");
    expect(out).toContain("안녕");
    expect(out).not.toContain("script");
  });

  it("이벤트 핸들러 속성을 제거한다", () => {
    const out = sanitize('<p onclick="alert(1)">x</p>');
    expect(out).not.toContain("onclick");
  });

  it("summernote 가 남긴 기본 서식은 살린다", () => {
    const out = sanitize("<p><strong>굵게</strong><br>줄바꿈</p>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<br>");
  });

  it("빈 HTML 을 판별한다", () => {
    expect(isBlankHtml("<p>&nbsp;</p>")).toBe(true);
    expect(isBlankHtml("<p>내용</p>")).toBe(false);
    expect(isBlankHtml(null)).toBe(true);
  });

  it("이스케이프 저장된 HTML 을 풀어서 렌더한다 (실측: CAUSE·ANSWER·OKREMARKS)", () => {
    // 그대로 두면 태그가 글자로 보인다
    const out = sanitize(
      "신청 건&lt;div&gt;&lt;b&gt;굵게&lt;/b&gt;&lt;/div&gt;",
    );
    expect(out).toContain("<div>");
    expect(out).toContain("<b>굵게</b>");
    expect(out).not.toContain("&lt;");
  });

  it("이스케이프를 풀고 나서 새니타이즈한다 — 순서가 뒤바뀌면 구멍이 된다", () => {
    const out = sanitize("&lt;script&gt;alert(1)&lt;/script&gt;가나");
    expect(out).not.toContain("script");
    expect(out).toContain("가나");
  });

  it("이스케이프 HTML 만 있는 경우도 빈 값 판별이 된다", () => {
    expect(isBlankHtml("&lt;div&gt;&lt;br&gt;&lt;/div&gt;")).toBe(true);
    expect(isBlankHtml("&lt;div&gt;내용&lt;/div&gt;")).toBe(false);
  });

  it("원본이 박아 둔 class·style 은 제거해 디자인 시스템을 지킨다", () => {
    const out = sanitize(
      "&lt;div class=&quot;ok-block&quot; style=&quot;color:#1d3057&quot;&gt;원인&lt;/div&gt;",
    );
    expect(out).toContain("원인");
    expect(out).not.toContain("ok-block");
    expect(out).not.toContain("1d3057");
  });
});

describe("plainPreview — 목록 미리보기", () => {
  it("태그를 걷고 공백을 정리한다", () => {
    expect(plainPreview("<p>가나</p><p>다라</p>")).toBe("가나 다라");
  });

  it("길면 잘라 말줄임을 붙인다", () => {
    expect(plainPreview("<p>" + "가".repeat(200) + "</p>", 10)).toBe(
      "가".repeat(10) + "…",
    );
  });
});

describe("상태 표현", () => {
  it("STEPSTAT 12개 라벨이 붙는다", () => {
    expect(progressLabel("4")).toBe("해결안제시");
    expect(progressLabel("9")).toBe("완료");
  });

  it("완료는 success, 반려는 danger 톤", () => {
    expect(progressTone("9")).toBe("success");
    expect(progressTone("12")).toBe("danger");
    expect(progressTone("없는코드")).toBe("neutral");
  });

  it("주 경로 5단계 위치를 계산한다", () => {
    expect(mainFlowIndex("1")).toBe(0);
    expect(mainFlowIndex("3")).toBe(2);
    expect(mainFlowIndex("9")).toBe(4);
  });

  it("확장 경로(5~8)는 해결안제시 위치에 머문다", () => {
    expect(mainFlowIndex("5")).toBe(3);
    expect(mainFlowIndex("8")).toBe(3);
  });

  it("취소·반려는 게이지를 채우지 않는다", () => {
    expect(mainFlowIndex("11")).toBe(-1);
    expect(mainFlowIndex("12")).toBe(-1);
  });
});
