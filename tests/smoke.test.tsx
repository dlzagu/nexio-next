import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { MiniStepper, Stepper } from "@/components/ui/Stepper";

// 하네스 스모크 — 통과하면 vitest + jsdom + JSX 변환 + "@/*" 별칭이 모두 살아 있다는 뜻이다.
describe("상태 표시 컴포넌트", () => {
  it("상태 배지가 라벨을 렌더한다", () => {
    render(<StatusBadge progress="4" />);
    expect(screen.getByText("해결안제시")).toBeInTheDocument();
  });

  it("색만으로 구분하지 않는다 — 상태군마다 글리프가 다르다", () => {
    const { container: done } = render(<StatusBadge progress="9" />);
    const { container: rejected } = render(<StatusBadge progress="12" />);
    expect(done.textContent).toContain("✓");
    expect(rejected.textContent).toContain("✕");
  });

  it("중간 우선순위는 배지 없이 조용하게 표시한다 (실측 98%)", () => {
    const { container } = render(<PriorityBadge code="3" label="중간" />);
    expect(container.querySelector(".badge")).toBeNull();
    expect(screen.getByText("중간")).toBeInTheDocument();
  });

  it("긴급은 배지로 강조한다", () => {
    const { container } = render(<PriorityBadge code="1" label="긴급" />);
    expect(container.querySelector(".badge")).not.toBeNull();
  });
});

describe("Stepper", () => {
  it("주 경로 5단계만 그린다 (확장 단계는 플래그가 켜질 때만)", () => {
    render(<Stepper progress="3" />);
    expect(screen.getByText("진행")).toBeInTheDocument();
    expect(screen.queryByText("시스템이관요청")).toBeNull();
  });

  it("고객사가 테스트 단계를 쓰면 단계가 추가된다", () => {
    render(<Stepper progress="5" usesTestStage />);
    expect(screen.getByText("테스트요청")).toBeInTheDocument();
  });

  it("취소된 건은 종료 표시를 앞에 둔다", () => {
    render(<Stepper progress="11" />);
    expect(screen.getByText(/취소로 종료됨/)).toBeInTheDocument();
  });

  it("미니 스테퍼가 진행도를 스크린리더에 알린다", () => {
    render(<MiniStepper progress="9" />);
    expect(screen.getByLabelText("완료 — 5단계 중 5단계")).toBeInTheDocument();
  });
});
