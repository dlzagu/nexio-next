import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Charts } from "./ChartsSection";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/Card";
import { Notice } from "@/components/ui/EmptyState";
import {
  RankList,
  TicketMiniList,
} from "@/components/dashboard/TicketMiniList";
import { getDashboard } from "@/lib/data/dashboard";
import { USER_ROLE_LABEL } from "@/lib/codes";
import { fmtDate } from "@/lib/format";
import { currentUser } from "@/lib/session";

export const metadata = { title: "대시보드 · 넥시오" };

/**
 * 이 화면의 주된 결정: **"오늘 내가 손대야 할 건이 무엇인가."**
 * 감상용 지표판이 아니라 조회 화면으로 들어가는 관문이다 —
 * 모든 위젯이 조건이 걸린 조회로 이동한다. 막다른 위젯을 만들지 않는다.
 */
export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) return null;
  const d = await getDashboard(user);

  const isInternal = user.role === "INTERNAL";
  const isCustomer = user.role === "CUSTOMER";

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-7 p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
            대시보드
          </h1>
          <p className="text-12 text-fg-muted mt-1">
            {user.name} · {USER_ROLE_LABEL[user.role]}
            {user.custName ? ` · ${user.custName}` : ""}
            {isInternal ? " — 전체 고객사 기준" : " — 우리 회사 요청 기준"}
          </p>
        </div>
        <Link href="/requests/new" className="btn btn-primary">
          <Plus size={14} aria-hidden />
          서비스 신청
        </Link>
      </header>

      {/* ① 지금 할 일 */}
      <section className="flex flex-col gap-3">
        <SectionTitle n="①" title="지금 할 일" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={isCustomer ? "내가 낸 미완료" : "내 미처리"}
            value={d.cards.myPending}
            tone="accent"
            href={`/requests?view=mine`}
          />
          <StatCard
            label="진행 중"
            value={d.cards.inProgress}
            href="/requests?view=open&progress=3"
          />
          <StatCard
            label="해결안 확인 대기"
            value={d.cards.awaitingSolution}
            tone="warning"
            sub="고객 확인 필요"
            href="/requests?view=open&progress=4"
          />
          <StatCard
            label="미읽음 댓글"
            value={d.cards.unreadComments}
            tone="danger"
            href="/requests?view=open"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={isCustomer ? "내가 낸 요청" : "내가 담당한 미처리"}
              hint={`${d.myPending.length}건 표시`}
              action={
                <Link
                  href="/requests?view=mine"
                  className="btn btn-ghost btn-xs"
                >
                  전체 <ArrowRight size={11} aria-hidden />
                </Link>
              }
            />
            <TicketMiniList
              rows={d.myPending}
              emptyTitle={
                isCustomer
                  ? "진행 중인 내 요청이 없습니다"
                  : "담당한 미처리 건이 없습니다"
              }
              emptyReason={
                isCustomer
                  ? "완료된 요청은 '전체 검색' 뷰에서 볼 수 있습니다."
                  : "새로 배정되면 여기에 표시됩니다."
              }
            />
          </Card>

          <Card>
            <CardHeader
              title={isInternal ? "전체 미해결" : "우리 회사 미해결"}
              hint={`${d.companyUnresolved.length}건 표시`}
              action={
                <Link
                  href="/requests?view=open"
                  className="btn btn-ghost btn-xs"
                >
                  전체 <ArrowRight size={11} aria-hidden />
                </Link>
              }
            />
            <TicketMiniList
              rows={d.companyUnresolved}
              emptyTitle="미해결 요청이 없습니다"
              emptyReason={
                isCustomer ? (
                  <>
                    비공개로 등록된 요청은 작성자와 승인자에게만 보입니다.
                    <br />
                    전체 요청의 약 79%가 비공개입니다.
                  </>
                ) : undefined
              }
            />
          </Card>
        </div>
      </section>

      {/* ② 현황 */}
      <section className="flex flex-col gap-3">
        <SectionTitle n="②" title="현황" />
        <Charts data={d} />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader title="미해결 상위 고객사" hint="진행 중 기준" />
            <RankList
              items={d.topCustomers.map((c) => ({
                key: c.custCode,
                label: c.custName || c.custCode,
                value: c.n,
              }))}
              hrefOf={(k) =>
                `/requests?view=open&custCode=${encodeURIComponent(k)}`
              }
            />
          </Card>
          {isInternal ? (
            <Card>
              <CardHeader
                title="담당자별 부하"
                hint="미처리 / 최근 3개월 완료"
              />
              <RankList
                items={d.assigneePerf.map((a) => ({
                  key: a.id,
                  label: a.name || a.id,
                  value: a.open,
                  sub: `+${a.done}`,
                }))}
                hrefOf={(k) =>
                  `/requests?view=open&assignee=${encodeURIComponent(k)}`
                }
              />
            </Card>
          ) : (
            <Card>
              <CardHeader title="안내" />
              <CardBody>
                <Notice tone="info">
                  담당자별 실적은 운영팀에게만 표시됩니다. 요청 처리 현황은 각
                  요청의 상세에서 확인할 수 있습니다.
                </Notice>
              </CardBody>
            </Card>
          )}
        </div>
      </section>

      {/* ③ 소식 */}
      <section className="flex flex-col gap-3">
        <SectionTitle n="③" title="소식" />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader title="공지" />
            {d.notices.length ? (
              <ul className="divide-line-subtle divide-y">
                {d.notices.map((n) => (
                  <li
                    key={n.id}
                    className="text-13 flex items-center gap-2.5 px-4 py-2.5"
                  >
                    <span className="ell min-w-0 flex-1">{n.title}</span>
                    <span className="text-11 text-fg-subtle shrink-0">
                      {n.author}
                    </span>
                    <span className="num text-11 text-fg-subtle shrink-0">
                      {fmtDate(n.at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-12 text-fg-subtle">
                  등록된 공지가 없습니다.
                </p>
              </CardBody>
            )}
          </Card>
          <Card>
            <CardHeader title="최근 접수" hint="완료 포함" />
            <TicketMiniList
              rows={d.recent}
              emptyTitle="최근 접수된 요청이 없습니다"
            />
          </Card>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <h2 className="text-13 text-fg-strong flex items-center gap-2 font-semibold">
      <span aria-hidden className="text-fg-subtle">
        {n}
      </span>
      {title}
    </h2>
  );
}
