# Nexio — 유지보수 서비스데스크 포털 (Next.js 재구축)

**라이브 데모 → https://nexio-next.vercel.app**
[![CI](https://github.com/dlzagu/nexio-next/actions/workflows/ci.yml/badge.svg)](https://github.com/dlzagu/nexio-next/actions/workflows/ci.yml)

> 사내에서 운영하던 **벤더포털(고객사 유지보수 요청 시스템)** 을 Next.js 로 재설계·재구축한
> 사이드 프로젝트입니다. 원본은 화면 하나가 6,600줄에 달하는 JSP 시스템이었고,
> 이 프로젝트는 그중 핵심 3화면(대시보드·조회·신청)을 실측 데이터 분석에 근거해
> 다시 설계한 뒤, 매일 쓰이는 3종(업무 현황 칸반·공지사항·알림센터)을 더한 결과물입니다.
>
> **모든 데이터는 가상입니다.** 고객사·인물·티켓 내용 전부 시드 생성기가 만든
> 창작 데이터이며, 실제 회사·고객사 데이터는 포함되어 있지 않습니다.

![대시보드](docs/screenshots/01-dashboard.png)

## 화면

원본에서 **한 화면에 눌려 있던 것**을 목적별로 나눈 결과입니다. 데이터는 전부 가상입니다.

<table>
<tr>
<td width="50%"><a href="docs/screenshots/02-requests-list.png"><img src="docs/screenshots/02-requests-list.png" alt="요청 조회"></a></td>
<td width="50%"><a href="docs/screenshots/03-request-detail.png"><img src="docs/screenshots/03-request-detail.png" alt="요청 상세"></a></td>
</tr>
<tr>
<td><b>요청 조회</b> — 원본 6,611줄·버튼 25종의 화면. 필터 13개 중 상시 4개만 펴 두고, 정렬 한계·절단은 숨기지 않고 화면에 적는다</td>
<td><b>요청 상세</b> — 102필드를 5탭으로 수납. 상태·권한으로 계산된 액션만 최대 3개 노출하고, 막힌 이유는 문장으로 설명한다</td>
</tr>
<tr>
<td width="50%"><a href="docs/screenshots/04-board.png"><img src="docs/screenshots/04-board.png" alt="업무 현황 보드"></a></td>
<td width="50%"><a href="docs/screenshots/05-request-new.png"><img src="docs/screenshots/05-request-new.png" alt="서비스 신청"></a></td>
</tr>
<tr>
<td><b>업무 현황</b> — 같은 데이터의 다른 시점. 카드를 끌면 조회 화면과 <b>같은 액션 라우트</b>를 호출한다. 드래그 못 하는 환경을 위해 '다음 단계' 버튼을 함께 둔다</td>
<td><b>서비스 신청</b> — 원본의 순차 alert 8단계를 인라인 검증으로. 첨부는 고르는 즉시 형식·용량을 판정한다</td>
</tr>
<tr>
<td colspan="2"><a href="docs/screenshots/06-dashboard-dark.png"><img src="docs/screenshots/06-dashboard-dark.png" alt="다크 모드"></a></td>
</tr>
<tr>
<td colspan="2"><b>다크 모드 · 밀도 3단</b> — 토큰 168개로 직접 만든 디자인 시스템(<code>/styleguide</code>). 색만으로 상태를 구분하지 않는다 — 상태군마다 글리프가 다르다</td>
</tr>
</table>

## 실행

```bash
npm install
npm run dev        # http://localhost:3000
```

그게 전부입니다. 외부 DB·환경변수·계정이 필요 없습니다 — 첫 실행 때 SQLite 데모 DB
(`.data/nexio.db`)가 자동 생성되고, 가상 티켓 약 2,200건이 시드됩니다.
상단 바의 **역할 전환**으로 운영팀·고객사(승인권자/일반)·외부업체 페르소나를 오가며
권한별 UX 차이를 직접 볼 수 있습니다.

```bash
npm run verify     # lint → typecheck → test (완료 판정 기준)
npm run db:reset   # 데모 DB 삭제 — 다음 실행 때 재시드
```

저장(신청 등록·상태 변경·댓글·첨부)은 **로컬에서 바로 됩니다** — 환경변수 없이.

라이브 데모는 서버리스라 인스턴스마다 DB 가 따로여서, 그대로 두면 저장한 건이 다음 조회에서
사라집니다. 그래서 **공유 DB(libSQL)를 붙였을 때만 쓰기가 열립니다** (`docs/decisions/ADR-0009`).
붙이는 법은 그 문서의 마지막 절에 3단계로 적어 두었습니다.

## 무엇을 보여주는 프로젝트인가

| 주제 | 내용 | 코드 |
|---|---|---|
| **레거시 재설계** | 한 화면에 눌려 있던 102필드·버튼 25종을 실사용 데이터 분석으로 분해 — 실제로는 5단계 워크플로만 쓰이고 있었다 | `docs/design/` |
| **권한 fail-closed** | 모든 액션이 `canDo()` 단일 게이트를 지나고, 규칙에 없는 조합은 전부 거부. 가시성 제한(테넌트 격리·비공개 티켓)도 동일 원칙 | `src/lib/permissions.ts` · `tests/` |
| **데이터 위생** | 저장값이 이스케이프된 HTML 인 레거시 데이터를 안전하게 렌더 (디코드 → 새니타이즈, 순서 보장) | `src/lib/sanitize.ts` |
| **데이터 경계** | 원본 스키마의 컬럼명은 `src/lib/data/` 밖으로 나가지 않는다 — 화면은 정규화된 타입만 본다 | `src/lib/data/` |
| **디자인 시스템** | 토큰 168개 + Radix 프리미티브로 직접 구축, 다크모드·밀도 3단 | `src/app/tokens.css` · `/styleguide` |
| **현실적인 시드** | 원본 실측 분포(이관분 과반·비공개 78%·미사용 상태코드)를 재현하는 결정적 생성기 | `src/lib/dev-seed/` |
| **첨부파일** | 신청·댓글에서 올린 파일이 본문과 **한 트랜잭션**으로 저장되고, 다운로드는 가시성 게이트를 다시 지난다. 형식은 허용 목록(SVG·HTML 제외) | `src/lib/attachments.ts` · `docs/decisions/ADR-0008` |
| **쓰기 경로** | 읽기와 다른 좁은 관문(INSERT/UPDATE만·한 트랜잭션) + 상태 전이 정본표 + 이력 로그. 칸반의 카드 이동도 같은 액션을 소비한다 | `src/lib/data/mutations.ts` · `docs/decisions/ADR-0006` |

## 아키텍처

```
브라우저 (Next.js App Router · React 19)
    │  Server Component 가 데이터 계층을 직접 호출
    ▼
src/lib/data/*        ← 원본 컬럼명이 갇히는 경계 (정규화는 여기서만)
    │  select() 는 SELECT/WITH 만 허용 (read-only 강제)
    ▼
SQLite (better-sqlite3)
    · 로컬: .data/nexio.db — 없으면 자동 시드
    · 서버리스(Vercel): :memory: — 콜드스타트마다 즉석 시드
```

원본 시스템은 Spring MVC + MSSQL 이었습니다. 재구축 당시의 분석 문서(API 맵·VO 스키마·
데이터 프로파일)와 설계 결정 기록(ADR)은 `docs/` 에 있습니다.

## 스택

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind 4 + 자체 토큰 ·
Radix UI · TanStack Table · react-hook-form + zod · recharts · xss(새니타이즈) ·
better-sqlite3 · vitest (127 tests) · GitHub Actions CI

## 배포 · CI/CD

- **CI** (GitHub Actions): push/PR 마다 `verify`(lint·typecheck·테스트 127개) → `format:check` → `build`
- **CD** (Vercel Git 연동): `main` push → 프로덕션 배포, PR → 프리뷰 URL 자동 발급
- **환경변수 설정이 필요 없다** — 서버리스에서는 콜드스타트 때 메모리 DB 에 시드를
  즉석 생성한다 (`src/lib/db.ts`). 배포 상태는 `/api/diag` 로 확인한다

서버리스 배포에서 실제로 밟은 함정과 대응은 `docs/decisions/ADR-0005` 에 정리해 두었다.
