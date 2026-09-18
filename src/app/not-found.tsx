import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다 · 넥시오",
};

/**
 * 없는 경로 + `notFound()`(없는 공지 등) 공용 404.
 * 🔴 내장 404 는 영어("This page could not be found.")라 한국어 전용 앱 한가운데서 튀었고,
 *    탭 제목까지 영어가 됐다.
 * 루트 레이아웃 **안쪽**에서 그려지므로 사이드바·상단바는 그대로 남는다 —
 * 여기서는 무엇이 없는지와 **어디로 갈 수 있는지**만 말한다 (빈 상태 원칙, EmptyState 주석).
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 p-5">
      <header>
        <p className="text-11 text-fg-subtle num">404</p>
        <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="text-12 text-fg-muted mt-1">
          요청한 주소에 해당하는 화면이나 글이 없습니다.
        </p>
      </header>

      <div className="card">
        <EmptyState
          title="주소가 바뀌었거나 삭제된 글일 수 있습니다"
          reason="북마크나 공유받은 링크라면 그사이 글이 내려갔을 수 있습니다. 아래에서 다시 찾아 주세요."
          actions={
            <>
              <Link href="/dashboard" className="btn btn-primary btn-sm">
                대시보드
              </Link>
              <Link href="/requests" className="btn btn-outline btn-sm">
                요청 조회
              </Link>
              <Link href="/notices" className="btn btn-ghost btn-sm">
                공지사항
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
