import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CustomerConfig, User } from "@/lib/types";

/**
 * 신청 폼 · 업무 등록 — **첫 제출 실패**에 화면이 반응하는가.
 *
 * 고객사·신청자·운영시스템은 register 없는 콤보박스라 RHF 기본 포커스가 닿지 않는다.
 * onInvalid 가 렌더 시점의 낡은 errors 를 읽으면 첫 클릭에 스크롤·포커스가 없고,
 * 오류 배너는 화면 위쪽에만 생겨 긴 폼에서는 **버튼이 무반응**으로 보인다.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { TaskSheet } from "@/components/board/TaskSheet";
import { RequestForm } from "@/components/requests/RequestForm";

beforeAll(() => {
  // jsdom 에는 스크롤이 없다 — 호출 여부만 본다
  Element.prototype.scrollIntoView = vi.fn();
});

// globals 를 켜지 않아 RTL 자동 정리가 돌지 않는다 — 앞 테스트의 폼이 남으면 엉뚱한 폼을 제출한다
afterEach(cleanup);

const customer: User = {
  id: "sj.moon",
  name: "문가영",
  role: "CUSTOMER",
  custCode: "SJ001",
  custName: "세진식품",
  dept: "재무팀",
  email: "sj.moon@sejin-food.example",
  isApprover: false,
};
const internal: User = {
  ...customer,
  id: "sy.kim",
  name: "김서연",
  role: "INTERNAL",
  custCode: "NX000",
  custName: "(주)넥시오솔루션",
  email: "sy.kim@nexio-ops.example",
};
const config: CustomerConfig = {
  custCode: "SJ001",
  custName: "세진식품",
  showsContractTime: false,
  usesApproval: false,
  usesTestStage: false,
  usesSystemStage: false,
  defaultPrivate: false,
};

describe("신청 폼 — 첫 제출 실패", () => {
  it("운영시스템만 비었으면 첫 클릭에 그 칸으로 포커스가 간다", async () => {
    const { container } = render(
      <RequestForm
        user={customer}
        config={config}
        companies={[{ value: "SJ001", label: "세진식품" }]}
        requesters={[{ value: "sj.moon", label: "문가영", group: "SJ001" }]}
        systems={[{ value: "23", label: "ERP 운영계", group: "SJ001" }]}
        contractTime={null}
        reRequestFrom={null}
        initial={null}
      />,
    );
    const type = (id: string, value: string) =>
      fireEvent.change(container.querySelector(`#${id}`)!, {
        target: { value },
      });
    type("f-title", "부가세 신고 메뉴 오류");
    type("f-symptom", "접속 시 오류");
    type("f-content", "확인 부탁드립니다");

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(document.activeElement?.id).toBe("f-systemId"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("위쪽 콤보박스와 아래 입력칸이 함께 비면 **위쪽**으로 간다 — RHF 기본 포커스가 덮어쓰지 않는다", async () => {
    const { container } = render(
      <RequestForm
        user={internal}
        config={null}
        companies={[{ value: "SJ001", label: "세진식품" }]}
        requesters={[{ value: "sj.moon", label: "문가영", group: "SJ001" }]}
        systems={[{ value: "23", label: "ERP 운영계", group: "SJ001" }]}
        contractTime={null}
        reRequestFrom={null}
        initial={null}
      />,
    );
    fireEvent.submit(container.querySelector("form")!);
    // 제목(register 된 칸)이 아니라 요약 배너 순서의 첫 칸 = 고객사
    await waitFor(() => expect(document.activeElement?.id).toBe("f-custCode"));
    // 한 틱 뒤에도 그대로다 (RHF 가 setTimeout 으로 다시 포커스를 옮기지 않는다)
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement?.id).toBe("f-custCode");
  });
});

describe("업무 등록 — 첫 제출 실패", () => {
  it("고객사를 안 골랐으면 첫 클릭에 고객사 칸으로 간다 (제목 칸이 아니라)", async () => {
    render(
      <TaskSheet
        open
        onOpenChange={() => {}}
        user={internal}
        companies={[{ value: "SJ001", label: "세진식품" }]}
        requesters={[]}
        systems={[{ value: "23", label: "ERP 운영계", group: "SJ001" }]}
        templates={[]}
        ym="2026-09"
        today="2026-09-18"
      />,
    );
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() =>
      expect(document.activeElement?.id).toBe("f-t-custCode"),
    );
  });
});
