import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Charts } from "./ChartsSection";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/Card";
import { Notice } from "@/components/ui/EmptyState";
import {
  RankList,
  TicketMiniList,
} from "@/components/dashboard/TicketMiniList";
import {
  StatCardFailed,
  WidgetError,
} from "@/components/dashboard/WidgetError";
import { NewRequestButton } from "@/components/layout/NewRequestButton";
import {
  getDashboard,
  myPendingHref,
  type DashboardWidget,
} from "@/lib/data/dashboard";
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
  /** 조회 실패한 위젯 — 값이 비어 있어도 '0건'이 아니다 (getDashboard 의 failed) */
  const failed = (w: DashboardWidget) => d.failed.includes(w);
  // 카드 숫자와 [전체] 링크가 **같은 주소**를 쓴다 — 따로 적으면 한쪽만 고쳐진다
  const myHref = myPendingHref(user);

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
        <NewRequestButton user={user} />
      </header>

      {/* ① 지금 할 일 */}
      <section className="flex flex-col gap-3">
        <SectionTitle n="①" title="지금 할 일" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {failed("cards") ? (
            <>
              <StatCardFailed
                label={isCustomer ? "내가 낸 미완료" : "내 미처리"}
              />
              <StatCardFailed label="진행 중" />
              <StatCardFailed label="해결안 확인 대기" />
              <StatCardFailed label="미읽음 댓글" />
            </>
          ) : (
            <>
              <StatCard
                label={isCustomer ? "내가 낸 미완료" : "내 미처리"}
                value={d.cards.myPending}
                tone="accent"
                // 🔴 카드는 **미완료 + 내 건**을 센다. view=mine 은 종료건까지 포함하므로
                //    그대로 링크하면 숫자와 목록이 갈라진다 (실측 25 vs 167)
                href={myHref}
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
                href="/requests?view=open&unread=1"
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={isCustomer ? "내가 낸 요청" : "내가 담당한 미처리"}
              hint={
                failed("myPending")
                  ? "불러오지 못함"
                  : `${d.myPending.length}건 표시`
              }
              action={
                // 위젯이 보여 준 조건(미완료 + 내 건) 그대로 — view=mine 은 종료건까지 담는다
                <Link href={myHref} className="btn btn-ghost btn-xs">
                  전체 <ArrowRight size={11} aria-hidden />
                </Link>
              }
            />
            {failed("myPending") ? (
              <WidgetError
                what={isCustomer ? "내가 낸 요청" : "담당한 미처리 목록"}
              />
            ) : (
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
            )}
          </Card>

          <Card>
            <CardHeader
              title={isInternal ? "전체 미해결" : "우리 회사 미해결"}
              hint={
                failed("companyUnresolved")
                  ? "불러오지 못함"
                  : `${d.companyUnresolved.length}건 표시`
              }
              action={
                <Link
                  href="/requests?view=open"
                  className="btn btn-ghost btn-xs"
                >
                  전체 <ArrowRight size={11} aria-hidden />
                </Link>
              }
            />
            {failed("companyUnresolved") ? (
              <WidgetError what="미해결 목록" />
            ) : (
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
            )}
          </Card>
        </div>
      </section>

      {/* ② 현황 */}
      <section className="flex flex-col gap-3">
        <SectionTitle n="②" title="현황" />
        <Charts data={d} failed={d.failed} />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader title="미해결 상위 고객사" hint="진행 중 기준" />
            {failed("topCustomers") ? (
              <WidgetError what="고객사별 미해결" />
            ) : (
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
            )}
          </Card>
          {isInternal ? (
            <Card>
              <CardHeader
                title="담당자별 부하"
                hint="미처리 / 최근 3개월 완료"
              />
              {failed("assigneePerf") ? (
                <WidgetError what="담당자별 부하" />
              ) : (
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
              )}
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
            <CardHeader
              title="공지"
              action={
                <Link href="/notices" className="btn btn-ghost btn-xs">
                  전체 <ArrowRight size={11} aria-hidden />
                </Link>
              }
            />
            {failed("notices") ? (
              <WidgetError what="공지" />
            ) : d.notices.length ? (
              <ul className="divide-line-subtle divide-y">
                {d.notices.map((n) => (
                  <li key={n.id}>
                    {/* 막다른 위젯을 만들지 않는다 — 공지도 열어볼 곳이 있어야 한다 */}
                    <Link
                      href={`/notices/${n.id}`}
                      className="hover:bg-hover text-13 flex items-center gap-2.5 px-4 py-2.5"
                    >
                      <span className="ell min-w-0 flex-1">{n.title}</span>
                      <span className="text-11 text-fg-subtle shrink-0">
                        {n.author}
                      </span>
                      <span className="num text-11 text-fg-subtle shrink-0">
                        {fmtDate(n.at)}
                      </span>
                    </Link>
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
            {failed("recent") ? (
              <WidgetError what="최근 접수" />
            ) : (
              <TicketMiniList
                rows={d.recent}
                emptyTitle="최근 접수된 요청이 없습니다"
              />
            )}
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
