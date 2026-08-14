# ARCHITECTURE

> 골격 문서. 확정된 구조만 적는다. **코드가 아직 없는 부분은 `⬜ P5 예정`** 으로 표시.

## 1. 계층 (`decisions/ADR-0004` — 사이드 프로젝트 전환)

```
브라우저 (Next.js App Router, 한국어 전용)
    │  Server Component 는 데이터 레이어를 직접 호출한다 (fetch 왕복 없음)
    │  클라이언트 상호작용만 route handler 경유
    ▼
src/lib/data/*   ← 🔴 원본 테이블·컬럼명이 갇히는 경계
    │  select() 가 SELECT/WITH 이외 구문을 거부 (read-only 강제)
    ▼
SQLite (better-sqlite3) + 가상 시드 (src/lib/dev-seed/)
    · 로컬: .data/nexio.db — 첫 접속 때 자동 생성, npm run db:reset 로 재생성
    · 서버리스(Vercel): :memory: — 콜드스타트마다 즉석 시드, 환경변수 0개
```

**DB 를 갈아탈 때 교체 대상은 `src/lib/db.ts` 하나다.** 화면은 정규화된 타입만 보므로
그 아래가 SQLite 든 Postgres 든 알지 못한다.

> 역사: 원본은 Spring MVC + MSSQL 이었다. 운영 대체를 목표하던 시절의 설계는
> ADR-0001(세션 쿠키 릴레이)·ADR-0002(개발 스키마 직접 조회)에 남아 있고,
> 포트폴리오 전환(ADR-0004)으로 그 목표는 폐기됐다.

## 2. 디렉토리

| 위치 | 역할 | 상태 |
|---|---|---|
| `src/app/dashboard/` | 대시보드 — 3구역·위젯 10종 | 완료 |
| `src/app/requests/` | 조회(목록+상세 Sheet) · 신청(`new/`) | 읽기 완료 / 쓰기 미구현 |
| `src/app/styleguide/` | 살아있는 스타일가이드 | 완료 |
| `src/app/api/` | route handler — session · tickets · action · diag | 읽기 완료 |
| `src/app/{globals,tokens}.css` | 토큰 + LAYER 2 컴포넌트 클래스 | 완료 |
| `src/components/ui/` | 프리미티브 12종 (Radix + 토큰) | 완료 |
| `src/components/{requests,dashboard,layout}/` | 화면 컴포넌트 | 완료 |
| `src/lib/data/` | 🔴 원본 컬럼명이 갇히는 경계 (tickets·dashboard·meta) | 완료 |
| `src/lib/dev-seed/` | 데모 스키마 + 가상 시드 생성기 (전부 창작 데이터) | 완료 |
| `src/lib/` | 코드표·타입·zod·`canDo()`·새니타이즈·포맷·db·session | 완료 |
| `tests/` | 권한 fail-closed + 데이터 위생 + 렌더 스모크 + 데이터 계층 통합 | 71개 통과 |
| `docs/inventory/` | 원본 분석 (API 맵·VO 스키마·실데이터 프로파일) | 완료 |
| `docs/design/` | 설계 (UX·재설계·권한·타입·BFF·디자인시스템) | 완료 |
| `docs/decisions/` | ADR — "왜 이렇게 했나" | ADR-0001 |
| `docs/progress/` | 작업 진행 상태 = 세션 재개 지점 | 진행 중 |
| `.dev/` | AI 스크래치 (진실 아님, 참조 금지) | — |

## 3. 환경 변수

**필수 변수가 없다** — 클론 직후 `npm run dev` 로 바로 돈다 (ADR-0004).
선택 변수만 있고, 쓸 일이 있으면 `.env.local` 에 둔다 (`.gitignore` 가 `.env*` 를 막는다).

```
# 전부 선택 사항
SQLITE_PATH=<경로|:memory:>  # 기본 .data/nexio.db (Vercel 에서는 자동으로 :memory:)
ALLOW_DEV_WRITES=false       # 기본 차단. true 로 켜면 쓰기 경로가 열린다
```

> 데이터가 이상하면 `/api/diag` 로 각 조회의 개별 실패 지점을 먼저 확인하고,
> `npm run db:reset` 후 재시작하면 시드가 처음부터 다시 생성된다.

## 4. 스택

| 층 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 16 (App Router) · React 19 | |
| 언어 | TypeScript (strict) | |
| 스타일 | Tailwind 4 + 자체 토큰 + Radix 프리미티브 | shadcn/ui CLI 미사용 — `decisions/ADR-0003` |
| 테스트 | vitest 4 + jsdom + Testing Library | 60개 |
| 린트·포맷 | ESLint 9 (flat) + prettier | prettier 는 코드만 (문서 제외) |
| 표·정렬 | `@tanstack/react-table` | 클라이언트 정렬 |
| 폼 | `react-hook-form` + `zod` | 스키마를 폼·응답 검증에 공유 |
| 차트 | `recharts` | 색을 `var()` 로 넘겨 다크모드 대응 |
| XSS | `isomorphic-dompurify` | `SafeHtml` 브랜드 타입으로 강제 |
| DB | `better-sqlite3` | 자체 SQLite + 가상 시드 (ADR-0004) |
| CI | GitHub Actions | push/PR 마다 verify + build (`.github/workflows/ci.yml`) |

**아직 도입하지 않은 것**: `@tiptap/react`(리치 텍스트 편집 — 읽기는 완료), `nuqs`,
`sonner`, `cmdk`. 선정 근거는 `design/tech-stack.md` 에 있고, 실제 설치는 쓰는 시점에 한다 —
안 쓰는 의존성을 `package.json` 에 미리 쌓지 않는다.

## 5. 데이터 흐름에서 반드시 지킬 3가지

1. **원본 필드명은 BFF 경계를 넘지 않는다** — `CONTENT`·`echonum`·`testYn` 변환은 한 곳에서만
2. **zod 스키마 하나를 폼 검증과 BFF 응답 검증에 함께 쓴다**
3. **기존 HTML 은 `SafeHtml` 타입 경유로만 렌더** — `dangerouslySetInnerHTML` 날것 금지

## 6. 검증

```bash
npm run verify
```
= `lint` → `typecheck` → `test`. 이게 통과하지 않은 상태는 완료가 아니다.
