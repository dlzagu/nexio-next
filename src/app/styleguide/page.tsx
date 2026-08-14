import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/Card";
import { EmptyState, InlineError, Notice } from "@/components/ui/EmptyState";
import { RichTextBlock } from "@/components/ui/RichText";
import { Skeleton } from "@/components/ui/Skeleton";
import { MiniStepper, Stepper } from "@/components/ui/Stepper";
import { PROGRESS } from "@/lib/codes";
import { Playground } from "./Playground";

export const metadata = { title: "디자인 시스템 · 넥시오" };

/**
 * 살아있는 스타일가이드. docs/design/styleguide.html(정적 아티팩트)과 달리
 * **실제 코드가 그리는 결과**를 보여준다 — 토큰이 반영됐는지 여기서 확인한다.
 */
export default function StyleguidePage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-7 p-5">
      <header>
        <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
          디자인 시스템
        </h1>
        <p className="text-12 text-fg-muted mt-1 leading-relaxed">
          토큰 168개는 <code className="mono">docs/design/tokens.css</code> 가
          정본이고,
          <code className="mono">src/app/tokens.css</code> 는 그 복사본입니다.
          손으로 고치지 말고 디자인 시스템에서 다시 추출하세요. 우측 상단에서
          테마·밀도를 바꿔 보면 전 요소가 함께 변합니다.
        </p>
      </header>

      <Section title="색 — 의미 기반 토큰">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["bg-canvas", "캔버스"],
            ["bg-surface", "표면"],
            ["bg-sunken", "가라앉음"],
            ["bg-muted", "약함"],
            ["bg-selected", "선택됨"],
            ["accent-solid", "강조"],
            ["success-solid", "성공"],
            ["warning-solid", "주의"],
            ["danger-solid", "위험"],
            ["info-solid", "정보"],
            ["border-default", "테두리"],
            ["border-input", "입력 테두리"],
          ].map(([token, label]) => (
            <div key={token} className="border-line rounded-md border p-2">
              <div
                className="border-line-subtle h-9 w-full rounded-sm border"
                style={{ background: `var(--${token})` }}
              />
              <p className="text-11 text-fg-default mt-1.5 font-medium">
                {label}
              </p>
              <p className="mono text-fg-subtle text-[10px]">--{token}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="타이포 — 한글 보정된 스케일">
        <div className="flex flex-col gap-1.5">
          {(
            [
              "11",
              "12",
              "13",
              "14",
              "15",
              "16",
              "18",
              "20",
              "24",
              "30",
            ] as const
          ).map((s) => (
            <div key={s} className="flex items-baseline gap-3">
              <span className="mono text-11 text-fg-subtle w-[52px] shrink-0">
                {s}px
              </span>
              <span
                style={{
                  fontSize: `var(--fs-${s})`,
                  lineHeight: `var(--lh-${s})`,
                }}
              >
                유지보수 요청이 지금 어디까지 왔는가 · Nexio 12,345
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="상태 — 색만으로 구분하지 않는다"
        desc="상태군마다 글리프가 다릅니다(◇ 대기 · ● 진행 · ✓ 완료 · — 취소 · ✕ 반려). 색약 사용자와 흑백 인쇄에서도 구분됩니다."
      >
        <div className="flex flex-wrap gap-2">
          {Object.keys(PROGRESS).map((code) => (
            <StatusBadge key={code} progress={code} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {["1", "2", "3", "4", "9", "11"].map((p) => (
            <span key={p} className="flex items-center gap-2">
              <MiniStepper progress={p} />
              <span className="text-11 text-fg-subtle">
                {PROGRESS[p as "1"]}
              </span>
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <PriorityBadge code="1" label="긴급" />
          <PriorityBadge code="2" label="높음" />
          <PriorityBadge code="3" label="중간" />
          <PriorityBadge code="4" label="낮음" />
          <Badge tone="neutral">중립</Badge>
          <Badge tone="info" glyph="●">
            정보
          </Badge>
        </div>
      </Section>

      <Section title="Stepper — 진행 단계를 형태로">
        <div className="flex flex-col gap-4">
          <LabeledRow label="주 경로 (기본)">
            <Stepper progress="3" />
          </LabeledRow>
          <LabeledRow label="테스트 단계 사용 고객사">
            <Stepper progress="5" usesTestStage />
          </LabeledRow>
          <LabeledRow label="취소로 종료">
            <Stepper progress="11" />
          </LabeledRow>
        </div>
      </Section>

      <Section title="버튼 · 입력">
        <Playground />
      </Section>

      <Section title="테이블 밀도">
        <div className="card overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 128 }}>요청번호</th>
                <th>제목</th>
                <th style={{ width: 110 }}>고객사</th>
                <th style={{ width: 96 }}>신청일</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "HB-202607-089",
                  "MES 인터페이스 동기화 주기 조정 검토 요청의 건",
                  "한빛제약",
                ],
                [
                  "SJ-202606-001",
                  "판매오더 저장 시 여신 한도 체크 문의",
                  "세진식품",
                ],
                ["DN-202607-014", "출고요청 절차 관련 문의", "다온물류"],
              ].map(([id, title, cust]) => (
                <tr key={id}>
                  <td className="mono text-12">{id}</td>
                  <td className="ell max-w-0 font-medium">{title}</td>
                  <td className="text-fg-muted">{cust}</td>
                  <td className="num">2026-07-22</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="카드 · 요약">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="내 미처리"
            value={5}
            tone="accent"
            href="/requests?view=mine"
          />
          <StatCard
            label="진행 중"
            value={88}
            href="/requests?view=open&progress=3"
          />
          <StatCard
            label="해결안 확인 대기"
            value={46}
            tone="warning"
            sub="고객 확인 필요"
            href="/requests?view=open&progress=4"
          />
          <StatCard
            label="미읽음 댓글"
            value={152}
            tone="danger"
            href="/requests?view=open"
          />
        </div>
      </Section>

      <Section title="알림 · 빈 상태">
        <div className="flex flex-col gap-2">
          <Notice tone="info">
            서버 페이징이라 정렬이 현재 페이지 안에서만 적용됩니다.
          </Notice>
          <Notice tone="warning">
            결과가 1,000건을 넘어 일부만 불러왔습니다.
          </Notice>
          <Notice tone="danger">신청자 이메일이 등록되지 않았습니다.</Notice>
          <Notice tone="accent">↻ 이전 요청의 재신청 건입니다.</Notice>
          <InlineError
            title="상세를 불러오지 못했습니다"
            detail="404 NOT_FOUND"
          />
        </div>
        <Card className="mt-3">
          <EmptyState
            title="조건에 맞는 요청이 없습니다"
            reason={
              <>
                비공개로 등록된 요청은 <strong>작성자와 승인자에게만</strong>{" "}
                보입니다. 전체 요청의 약 79%가 비공개입니다.
              </>
            }
            actions={
              <>
                <button type="button" className="btn btn-outline">
                  필터 초기화
                </button>
                <button type="button" className="btn btn-outline">
                  기간 넓히기
                </button>
              </>
            }
          />
        </Card>
      </Section>

      <Section title="리치 텍스트 — 기존 HTML 은 반드시 새니타이즈">
        <Card>
          <CardHeader
            title="sanitize() 통과 결과"
            hint="script·onclick 이 제거된다"
          />
          <CardBody>
            <RichTextBlock
              raw={
                '<p><strong>원인</strong>: 계정 결정 설정이 누락돼 있었습니다.</p><ul><li>확인: G/L 계정결정</li><li>조치: 창고별 매핑 추가</li></ul><script>alert(1)</script><p onclick="alert(2)">이벤트 핸들러도 제거됩니다.</p>'
              }
            />
          </CardBody>
        </Card>
      </Section>

      <Section title="로딩">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-14 text-fg-strong font-semibold">{title}</h2>
        {desc ? (
          <p className="text-12 text-fg-muted mt-1 leading-relaxed">{desc}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function LabeledRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-line-subtle bg-subtle flex flex-col gap-2 rounded-md border p-3">
      <span className="text-11 text-fg-subtle">{label}</span>
      {children}
    </div>
  );
}
