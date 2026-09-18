"use client";

import RouteError, { type RouteErrorProps } from "./error";
import "./globals.css";

/**
 * 루트 레이아웃 **자체가** 실패했을 때의 마지막 경계 (예: AppShell 의 페르소나 조회,
 * 공유 DB 토큰 만료로 모든 메뉴가 실패). 이때는 레이아웃이 없으므로 문서 전체를 직접 그린다 —
 * html·body·전역 스타일을 여기서 다시 선언해야 한다 (Next 규약).
 *
 * 내용은 error.tsx 와 같은 컴포넌트를 쓴다 — 두 벌로 두면 한쪽 문구만 고쳐져 어긋난다.
 * ⚠️ 테마는 따라가지 않는다(항상 라이트). 테마 부트 스크립트는 레이아웃이 심는데
 *    그 레이아웃이 죽은 상황이라, 마지막 경계에 로직을 더 얹지 않는다.
 * `metadata` 를 export 할 수 없는 클라이언트 경계라 제목은 React `<title>` 로 준다.
 */
export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="ko">
      <body className="bg-canvas text-fg antialiased">
        <title>오류 · 넥시오</title>
        <main>
          <RouteError {...props} />
        </main>
      </body>
    </html>
  );
}
