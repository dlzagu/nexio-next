"use client";

import { useEffect } from "react";
import Link from "next/link";
import { InlineError } from "@/components/ui/EmptyState";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Next 16.2+ — 서버에서 다시 받아 그린다. 없는 환경이면 reset 으로 떨어진다 */
  unstable_retry?: () => void;
};

/**
 * 페이지 본문이 던진 예외의 경계. 루트 레이아웃 **안쪽**이라 사이드바·상단바가 남아
 * 다른 메뉴로 나갈 수 있다 (루트 레이아웃 자체의 실패는 global-error.tsx 가 받는다).
 * 🔴 내장 화면은 영어("This page couldn’t load")였고, 서버 오류면 Back 버튼까지 숨겨
 *    브라우저 뒤로가기 말고는 나갈 길이 없었다 (예: 공유 DB 에 새 표가 없는 채 배포 → /board).
 *
 * 원인을 감추지 않는다 — AppShell 의 DB 오류 화면과 같은 원칙:
 *  · 프로덕션의 서버 오류 message 는 Next 가 일반 문구로 바꿔 보낸다 → 대신 **digest** 를 보인다.
 *    서버 로그의 같은 digest 줄이 실제 원인이다.
 *  · 화면만 바꾸고 삼키지 않는다 — 콘솔에도 그대로 남긴다.
 */
export default function RouteError({
  error,
  reset,
  unstable_retry,
}: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // ⚠️ reset() 은 경계 상태만 지운다. 서버 컴포넌트가 실패했다면 이미 받은(실패한) 결과를
  //    다시 그려 **같은 오류가 또 난다.** unstable_retry 는 서버에서 새로 받아 그린다.
  const retry = unstable_retry ?? reset;

  // 프로덕션 서버 오류의 message 는 "An error occurred in the Server Components render…" 뿐이라
  // 보여 줘도 원인이 아니다. 개발 중이거나 클라이언트 오류면 원문이 곧 원인이다.
  const showMessage = !error.digest || process.env.NODE_ENV !== "production";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-14">
      <header>
        <h1 className="text-18 text-fg-strong font-semibold tracking-tight">
          화면을 불러오지 못했습니다
        </h1>
        <p className="text-12 text-fg-muted mt-1 leading-relaxed">
          일시적인 연결 문제라면 다시 시도하면 열립니다. 같은 오류가 반복되면
          아래 오류 코드로 서버 로그에서 원인을 찾을 수 있습니다.
        </p>
      </header>

      <InlineError
        title={
          showMessage
            ? "처리 중 오류가 발생했습니다"
            : "서버 오류 — 상세 내용은 서버 로그에만 남습니다"
        }
        detail={showMessage ? error.message : undefined}
      />

      {error.digest ? (
        <p className="text-12 text-fg-muted">
          오류 코드{" "}
          <code className="mono text-fg-default break-all">{error.digest}</code>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => retry()}
        >
          다시 시도
        </button>
        <Link href="/dashboard" className="btn btn-outline btn-sm">
          대시보드로
        </Link>
      </div>

      <p className="text-11 text-fg-subtle leading-relaxed">
        배포 환경에서 반복된다면 <code className="mono">/api/diag</code> 에서
        어느 조회가 실패하는지 먼저 확인합니다.
      </p>
    </div>
  );
}
