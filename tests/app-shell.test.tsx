import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RouteError from "@/app/error";
import GlobalError from "@/app/global-error";
import NotFound, { metadata as notFoundMetadata } from "@/app/not-found";
import { metadata as rootMetadata } from "@/app/layout";

/**
 * 앱 셸의 경계 화면 — 없는 주소·서버 예외가 영어 내장 화면으로 떨어지지 않는지,
 * 떨어진 자리에서 **나갈 길**과 **원인 단서(digest)** 가 남는지를 고정한다.
 */

// vitest globals 가 꺼져 있어 RTL 자동 정리가 돌지 않는다 — 앞 테스트의 화면이 쌓인다
afterEach(cleanup);

describe("404 (not-found)", () => {
  it("한국어로 무엇이 없는지 말한다 — 내장 영어 문구가 아니다", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: "페이지를 찾을 수 없습니다" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not be found/i)).toBeNull();
  });

  it("어디로 갈 수 있는지 링크로 준다 — 대시보드·요청 조회", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: "대시보드" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "요청 조회" })).toHaveAttribute(
      "href",
      "/requests",
    );
  });

  it("탭 제목도 한국어다", () => {
    expect(String(notFoundMetadata.title)).toContain("찾을 수 없습니다");
  });
});

describe("오류 경계 (error)", () => {
  afterEach(() => vi.restoreAllMocks());

  const serverError = () =>
    Object.assign(new Error("boom"), { digest: "1234567890" });

  it("digest 를 보여 준다 — 서버 로그와 맞춰 볼 유일한 단서", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError error={serverError()} reset={() => {}} />);
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "화면을 불러오지 못했습니다" }),
    ).toBeInTheDocument();
  });

  it("오류를 삼키지 않는다 — 콘솔에 원본 오류를 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = serverError();
    render(<RouteError error={err} reset={() => {}} />);
    expect(spy).toHaveBeenCalledWith(err);
  });

  it("'다시 시도' 가 reset 을 호출한다 (retry 가 없는 계약)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<RouteError error={serverError()} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("retry 가 있으면 그쪽을 쓴다 — reset 만으로는 실패한 서버 결과를 다시 그린다", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const retry = vi.fn();
    render(
      <RouteError error={serverError()} reset={reset} unstable_retry={retry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("막다른 길이 아니다 — 대시보드로 나가는 링크가 있다", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError error={serverError()} reset={() => {}} />);
    expect(screen.getByRole("link", { name: "대시보드로" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

describe("루트 경계 (global-error)", () => {
  it("레이아웃 대신 문서 전체를 그린다 — html(lang=ko)·body 를 직접 가진다", () => {
    // html 을 div 안에 렌더할 수 없어 요소 트리만 본다
    const el = GlobalError({ error: new Error("x"), reset: () => {} });
    expect(el.type).toBe("html");
    expect(el.props.lang).toBe("ko");
    expect(el.props.children.type).toBe("body");
  });
});

describe("링크 미리보기 메타데이터", () => {
  it("공유 카드가 절대 URL 의 이미지를 가진다 (metadataBase + og 이미지)", () => {
    expect(String(rootMetadata.metadataBase)).toBe(
      "https://nexio-next.vercel.app/",
    );
    const images = rootMetadata.openGraph?.images;
    expect(JSON.stringify(images)).toContain("/og.png");
    expect(rootMetadata.twitter).toMatchObject({
      card: "summary_large_image",
    });
  });

  it("가상 데이터 데모임을 설명에 밝힌다", () => {
    expect(rootMetadata.description).toContain("가상 데이터");
  });
});
