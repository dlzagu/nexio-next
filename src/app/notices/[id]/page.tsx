import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { RichTextBlock } from "@/components/ui/RichText";
import { getNotice } from "@/lib/data/notices";
import { fmtDateTime } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const notice = await getNotice(id);
  return { title: `${notice?.title ?? "공지사항"} · 넥시오` };
}

export default async function NoticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const notice = await getNotice(id);
  if (!notice) notFound();

  return (
    <article className="mx-auto flex max-w-[860px] flex-col gap-4 p-5">
      <Link href="/notices" className="btn btn-ghost btn-sm self-start">
        <ArrowLeft size={13} aria-hidden />
        공지사항
      </Link>

      <header className="border-line-subtle border-b pb-3">
        <h1 className="text-18 text-fg-strong font-semibold tracking-tight">
          {notice.title}
        </h1>
        <p className="text-11 text-fg-subtle mt-1.5 flex flex-wrap items-center gap-x-2">
          <span>{notice.author}</span>
          <span aria-hidden className="text-fg-disabled">
            ·
          </span>
          <span className="num">{fmtDateTime(notice.at)}</span>
        </p>
      </header>

      <RichTextBlock raw={notice.body} empty="본문이 없습니다." />

      {/* 앞뒤 글 — 목록으로 나갔다 다시 들어오는 왕복을 없앤다 */}
      <nav
        className="border-line-subtle mt-2 flex flex-col border-t pt-2"
        aria-label="다른 공지"
      >
        {notice.newer ? (
          <Link
            href={`/notices/${notice.newer.id}`}
            className="hover:bg-hover text-12 flex items-center gap-2 rounded-sm px-2 py-2"
          >
            <ChevronUp size={13} aria-hidden className="text-fg-subtle" />
            <span className="text-fg-subtle shrink-0">최신</span>
            <span className="ell text-fg-default">{notice.newer.title}</span>
          </Link>
        ) : null}
        {notice.older ? (
          <Link
            href={`/notices/${notice.older.id}`}
            className="hover:bg-hover text-12 flex items-center gap-2 rounded-sm px-2 py-2"
          >
            <ChevronDown size={13} aria-hidden className="text-fg-subtle" />
            <span className="text-fg-subtle shrink-0">이전</span>
            <span className="ell text-fg-default">{notice.older.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
