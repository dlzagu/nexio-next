import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { listNotices } from "@/lib/data/notices";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "공지사항 · 넥시오" };

/**
 * 공지 목록. 원본은 게시판 테이블(제목·작성자·등록일 3열)이었는데,
 * 제목만으로는 열어야 할 글인지 판단이 안 돼 전부 눌러 보게 된다 →
 * **본문 미리보기 한 줄**을 함께 보여 클릭 전에 거르게 한다.
 */
export default async function NoticesPage() {
  const notices = await listNotices();

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 p-5">
      <header>
        <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
          공지사항
        </h1>
        <p className="text-12 text-fg-muted mt-1">
          점검·일정·기능 변경 안내 {notices.length}건
        </p>
      </header>

      {notices.length === 0 ? (
        <div className="card">
          <EmptyState
            title="등록된 공지가 없습니다"
            reason="새 공지가 등록되면 대시보드에도 함께 표시됩니다."
          />
        </div>
      ) : (
        <ul className="card divide-line-subtle divide-y">
          {notices.map((n) => (
            <li key={n.id}>
              <Link
                href={`/notices/${n.id}`}
                className="hover:bg-hover flex flex-col gap-1 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-14 text-fg-strong ell font-medium">
                    {n.title}
                  </span>
                  <span className="num text-11 text-fg-subtle shrink-0">
                    {fmtDate(n.at)}
                  </span>
                </div>
                {n.preview ? (
                  <p className="text-12 text-fg-muted ell">{n.preview}</p>
                ) : null}
                <p className="text-11 text-fg-subtle">{n.author}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
