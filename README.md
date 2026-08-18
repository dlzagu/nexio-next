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

저장(신청 등록·상태 변경·댓글)까지 눌러보려면 `.env.local` 에 `ALLOW_DEV_WRITES=true` 를
넣고 재시작하세요. 기본은 꺼져 있고, 꺼진 상태에서는 권한·검증 판정까지만 수행한 뒤
"여기까지 통과했다"를 화면에 알려줍니다.

## 무엇을 보여주는 프로젝트인가

| 주제 | 내용 | 코드 |
|---|---|---|
| **레거시 재설계** | 한 화면에 눌려 있던 102필드·버튼 25종을 실사용 데이터 분석으로 분해 — 실제로는 5단계 워크플로만 쓰이고 있었다 | `docs/design/` |
| **권한 fail-closed** | 모든 액션이 `canDo()` 단일 게이트를 지나고, 규칙에 없는 조합은 전부 거부. 가시성 제한(테넌트 격리·비공개 티켓)도 동일 원칙 | `src/lib/permissions.ts` · `tests/` |
| **데이터 위생** | 저장값이 이스케이프된 HTML 인 레거시 데이터를 안전하게 렌더 (디코드 → 새니타이즈, 순서 보장) | `src/lib/sanitize.ts` |
| **데이터 경계** | 원본 스키마의 컬럼명은 `src/lib/data/` 밖으로 나가지 않는다 — 화면은 정규화된 타입만 본다 | `src/lib/data/` |
| **디자인 시스템** | 토큰 168개 + Radix 프리미티브로 직접 구축, 다크모드·밀도 3단 | `src/app/tokens.css` · `/styleguide` |
| **현실적인 시드** | 원본 실측 분포(이관분 과반·비공개 78%·미사용 상태코드)를 재현하는 결정적 생성기 | `src/lib/dev-seed/` |
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
better-sqlite3 · vitest (106 tests) · GitHub Actions CI

## 배포 · CI/CD

- **CI** (GitHub Actions): push/PR 마다 `verify`(lint·typecheck·테스트 106개) → `format:check` → `build`
- **CD** (Vercel Git 연동): `main` push → 프로덕션 배포, PR → 프리뷰 URL 자동 발급
- **환경변수 설정이 필요 없다** — 서버리스에서는 콜드스타트 때 메모리 DB 에 시드를
  즉석 생성한다 (`src/lib/db.ts`). 배포 상태는 `/api/diag` 로 확인한다

서버리스 배포에서 실제로 밟은 함정과 대응은 `docs/decisions/ADR-0005` 에 정리해 두었다.
