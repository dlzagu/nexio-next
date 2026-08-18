# nexio-next — 유지보수 서비스데스크 포털 (사이드 프로젝트)

> 사내 벤더포털 3화면을 Next.js 로 재설계·재구축한 **포트폴리오 사이드 프로젝트** (ADR-0004).
> 데이터는 자체 SQLite + **전부 가상 시드**다. 회사 DB·Spring 백엔드와의 연결은 폐기됐다.

## 절대 규칙 (위반 금지)

- **실데이터·실명 반입 금지** — 실고객사명·실계정·회사 DB 데이터를 코드·시드·문서에 넣지 않는다. 시드는 `src/lib/dev-seed/corpus.ts` 의 가상 말뭉치에서만 나온다. 공개 배포되는 저장소다.
- **원본 repo 는 읽기 전용** — 원본(사내 SVN, 로컬에만 존재. 경로는 AI 메모리 `nexio-original-repo-path` 참조)은 **커밋 금지** 정책이 걸려 있다. 참조만 하고, 내용·경로·사명을 이 저장소로 복사하지 않는다.
- **취소 액션은 신청자 본인만** — 회사 정책. 담당자에게 취소 권한을 주는 설계 금지. `docs/design/permissions-spec.md` §4-1
- **권한 게이트는 fail-closed** — 기본 차단, 조건 충족 시에만 허용. `canDo()` 는 규칙에 없는 조합을 전부 `false` 로 떨군다.
- **기존 HTML 은 반드시 새니타이즈** — 2.3만 건이 HTML 로 저장돼 있다. `dangerouslySetInnerHTML` 날것 사용 금지, `SafeHtml` 타입 경유. `docs/design/types-spec.md` §5
- **시크릿 커밋 금지** — 필수 환경변수는 없다(선택 변수는 `docs/ARCHITECTURE.md` §3). `.env*` 는 커밋 차단
- **다국어 금지** — MVP 는 한국어 전용. i18n 라이브러리 도입하지 않는다.
- 근본 원인을 해결하고 오류를 억제하지 마라 (try-catch 로 덮기 금지).

## 명령어 (검증 = 완료 판정 기준)

```bash
npm run verify      # lint → typecheck → test. 이거 하나로 완료 판정한다
npm run dev         # 개발 서버 (포트 3000) — 첫 실행 때 SQLite 시드 자동 생성
npm run db:reset    # 데모 DB 삭제 → 다음 실행 때 재시드
npm run test:watch  # 테스트 watch
npm run format      # prettier (코드만 — 문서·docs/ 는 대상 아님)
npm run build       # 프로덕션 빌드 (CI 가 push/PR 마다 실행)
```

쓰기(신청 저장·액션·댓글)를 켜려면 `.env.local` 에 `ALLOW_DEV_WRITES=true`.
기본은 꺼짐이고, 꺼져 있으면 화면이 권한 판정까지만 하고 202 로 "여기까지 통과"를 알려준다.

작업 완료 = **`npm run verify` 통과 후 보고.** "된 것 같다"는 완료가 아니다.

## 시작하기 — 세션 진입 시 반드시

1. **`docs/progress/nexio-mvp.json` 을 먼저 Read** → `session_continuation.next_step` 부터 진행
2. 해당 단계의 `ref_files` 문서를 Read
3. ⚠️ SAP B1 애드온 작업이 **아니다** — b1-cookbook 불필요. 훅이 SAP 힌트를 띄워도 무시한다.
4. 환경변수 없이 바로 돈다. 데이터가 안 나오면 `/api/diag` → `npm run db:reset` 순으로 확인한다.

**DB = 자체 SQLite + 가상 시드** (`ADR-0004`). 시드 생성기는 `src/lib/dev-seed/`,
DB 교체 시 수정 대상은 `src/lib/db.ts` 하나다. 쓰기는 `ALLOW_DEV_WRITES` 로 차단돼 있다.

## 아키텍처 (WHERE — 어디에 무엇이)

| 위치 | 역할 |
|---|---|
| `src/app/` | App Router — 페이지(대시보드·조회·신청·업무현황·공지·스타일가이드) |
| `src/app/api/` | route handler (`.claude/rules/bff.md` 가 자동 로드됨) |
| `src/lib/data/mutations.ts` | 🔴 쓰기 정본 — 상태 전이표·이력 규약. 권한 판정은 여기가 아니라 라우트에서 |
| `src/lib/board.ts` | 칸반 컬럼·이동 규칙 (`canDo()` 재사용) |
| `src/lib/data/read-state.ts` | 🔴 미읽음 축 정본 — 목록 뱃지·대시보드·알림이 같은 기준을 본다 |
| `src/lib/attachments.ts` | 첨부 한도·허용 형식 정본 (화면·서버 공용) |
| `src/lib/data/attachments.ts` | 첨부 저장/조회 — INSERT 문을 **돌려주고** 호출자 트랜잭션에 얹힌다 |
| `src/app/globals.css` | LAYER 2 — 컴포넌트 클래스. 수치는 전부 `var(--*)` 참조 |
| `src/app/tokens.css` | 토큰 **복사본**. 정본은 `docs/design/tokens.css` — 손대지 않는다 |
| `src/components/ui/` | 프리미티브 (Radix + 토큰). ADR-0003 |
| `src/components/{requests,dashboard,layout}/` | 화면 컴포넌트 |
| `src/lib/data/` | 🔴 원본 테이블·컬럼명이 갇히는 경계. 밖으로 새면 되돌릴 수 없다 |
| `src/lib/dev-seed/` | 데모 스키마 + 가상 시드 생성기 — 시드 내용은 전부 여기의 창작 말뭉치 |
| `src/lib/` | 코드표·타입·zod·`canDo()`·새니타이즈·포맷 |
| `tests/` | 테스트 — 권한 fail-closed 와 데이터 위생이 핵심 |
| `docs/PRD.md` · `docs/ARCHITECTURE.md` | 요구사항 · 구조 |
| `docs/inventory/` | 원본 분석 — API 맵 · VO 스키마 · 화면별 인벤토리 · **실데이터 프로파일** |
| `docs/design/` | 설계 — UX 원칙 · 화면 재설계 · 라이브러리 · 권한 · 타입 · BFF · 디자인 시스템 |
| `docs/decisions/` | ADR — 설계 결정과 이유 |
| `docs/progress/` | 작업 진행 상태 (세션 재개 지점) |
| `.dev/` | AI 스크래치 (진실 아님, 참조 금지) |

**MVP 3화면** — 구현 순서 = 대시보드 → 조회 → 신청

| 화면 | 원본 | 규모 | 성격 |
|---|---|---|---|
| 대시보드 | `views/ndashboard.jsp` | 3,104줄 · GET 14 | 읽기 전용, 난이도 최저 |
| 조회 | `c4web/ST001.jsp` | 6,611줄 · 상태 12 · 버튼 25 | **최난도, 프로젝트의 핵심 목표** |
| 신청 | `c4web/ST002.jsp` | 2,599줄 · 입력 20 | 가장 가벼움 |

**이식 3종** (ADR-0007 — 선정·제외 근거가 거기 있다)

| 화면 | 원본 | 왜 |
|---|---|---|
| 업무 현황 `/board` | 칸반 보드(STB01) | 조회와 같은 데이터의 다른 시점. 카드 이동이 액션 라우트를 그대로 쓴다 |
| 공지사항 `/notices` | 상단 상시 메뉴 | 시드·테이블은 있는데 열어볼 화면이 없어 대시보드 위젯이 막다른 길이었다 |
| 알림센터 (상단 종) | `/api/notifications` | 담당자의 '취소 권유'가 신청자에게 닿는 통로. 새 테이블 없이 읽음선에서 파생 |

## 컨벤션 (HOW)

- **원본 필드명을 코드에 들이지 않는다** — `CONTENT`·`echonum`·`testYn` 같은 함정은 **BFF 경계 한 곳**에서만 변환. 컴포넌트는 정규화된 이름만 본다.
- **zod 스키마 하나를 폼 검증과 BFF 응답 검증에 함께 쓴다.**
- **서버가 이미 강제하는 권한을 프론트에서 재구현하지 않는다** — 테넌트 격리·비공개 제한은 Spring 이 fail-closed 로 처리 중. 이중화하면 어긋나는 순간 구멍.
- 안 쓰는 기능은 **삭제가 아니라 접는다** — 고객사 플래그(`testYn`/`systemYn`)로 조건부 렌더.
- `docs/design/tokens.css` 는 **손으로 고치지 않는다** — 디자인 시스템 아티팩트에서 재추출.
- 새 기능은 테스트 동반, 버그 수정은 **재현 테스트 먼저**. 테스트는 `tests/` 에 소스와 1:1.
- 되돌릴 수 없는 결정(백엔드 계약·인증·데이터 형식)은 `docs/decisions/` 에 ADR 로 남긴다.

## HOW NOT (안티패턴 — 실수 확정 시 한 줄씩 추가)

| 하지 마라 | 대신 | 왜 |
|---|---|---|
| BFF 가 자체 세션 생성 | 사용자 쿠키만 릴레이 | 원본이 `max-sessions=1` — 사용자 브라우저 세션이 만료된다 (`decisions/ADR-0001`) |
| `fetch` 로 Spring 호출 시 리다이렉트 자동 추종 | `redirect: 'manual'` | 세션 만료가 `401` 이 아니라 `302 → /login` 으로 온다. 따라가면 로그인 HTML 을 200 으로 받는다 |
| 원본의 CSRF·permitAll 설정을 그대로 이식 | 새 앱은 정상 적용 | 원본은 CSRF 가 사실상 꺼져 있고 `/c4web/**` 가 permitAll 이다 |
| `prettier --write .` 로 문서까지 포맷 | 코드만 포맷 (`.prettierignore` 가 막는다) | 한글 표시폭이 2라 prettier 의 문자 수 정렬이 표를 오히려 어긋내고, 산출물 diff 가 오염된다 |
| 저장된 HTML 을 곧바로 `sanitize()` | 이스케이프를 **먼저 풀고** 새니타이즈 | DB 가 `&lt;div&gt;` 형태로 저장한다(`CAUSE`·`ANSWER`·`OKREMARKS`·`REMARKS`·`TITLE`). 그대로 두면 태그가 글자로 보인다. ⚠️ 순서를 뒤집으면 필터를 통과한 마크업이 살아난다 |
| `B1GUBUN` 을 분야(B1GUBUN1) 코드로 매핑 | `COMPANY_OPER_SYSTEM.OPER_SYS_ID` = 운영시스템 | 실측값이 14·29·67 처럼 9를 넘는다. 문서 추정이 틀렸다 |
| `SUM(CASE WHEN (SELECT …))` | 파생 테이블로 먼저 평탄화 | SQL Server 가 거부한다("aggregate function on an expression containing … a subquery"). 위젯이 조용히 0 으로 보인다 |
| "내 건"을 항상 `SUCCERSON` 으로 조회 | 고객사=`CUSTPERSON` / 처리자=`SUCCERSON` | 역할을 구분하지 않으면 고객사 대시보드 카드가 늘 0 이다 |
| `OKREMARKS` 를 분리 필드와 함께 렌더 | 분리 필드가 있으면 감춘다 | `OKREMARKS` 는 원인·답변·결과를 이어 붙인 레거시 요약이라 내용이 두 번 나온다 |
| `useEffect` 안에서 동기 `setState` 로 상태 초기화 | 키를 함께 담아 **파생값으로 읽기** | 연쇄 렌더를 만든다. eslint `react-hooks/set-state-in-effect` 가 잡는다 |
| 의존성 추가·제거 후 lock 을 그대로 커밋 | 훅이 자동 보정한 lock 을 **커밋에 포함**한다 (수동은 `npm run lock:fix`) | Windows npm 이 wasm32-wasi optional 하위 의존성(`@emnapi/*`)을 lock 에 안 적어 Linux CI 의 `npm ci` 가 멈춘다. `npm install` 이 매번 다시 지우므로 PostToolUse 훅(`sync-lock-after-npm.sh`)이 npm 명령 직후 되살린다 |
| 서버에서 도는 코드에 DOM 의존 라이브러리(DOMPurify+jsdom 등) | DOM 없는 순수 파서 (`xss`) | jsdom 의 동적 require 가 서버리스 번들에 안 담겨 SSR 이 통째로 500. 클라이언트 컴포넌트의 SSR 번들이라 `serverExternalPackages` 로도 못 뺀다 |
| 저장된 날짜를 `toISOString()` 으로 절대시각화 | `toWallClockIso()` — 타임존 표기 없이 | 저장값이 타임존 없는 벽시계라, 서버(UTC)와 브라우저(KST)가 하루 다른 날짜를 그려 하이드레이션이 깨진다 (React #418) |
| 쓰기를 위해 `select()` 의 구문 검사를 넓힌다 | `write()` 로 따로 들어간다 | 관문이 하나면 언젠가 "조회인 줄 알았는데 쓰는" 코드가 생긴다. `write()` 는 INSERT/UPDATE 만·한 트랜잭션·플래그를 안쪽에서 재확인 (`ADR-0006`) |
| 상태 변경과 이력 로그를 각각 커밋 | 한 `write()` 호출에 함께 넘긴다 | 중간에 실패하면 **이력 없는 티켓**이 남는다. 어디서 온 상태인지 영원히 모른다 |
| 저장은 그냥 하고 렌더할 때만 새니타이즈 | 저장 시점에도 `sanitize()` | 읽기 경로가 하나라도 새면 그때 터진다. 저장된 마크업은 지우기 전까지 계속 남는다 |
| 알림을 위해 알림 테이블을 새로 만든다 | 읽음선(`READ_STATE`)에서 파생한다 | 두 곳을 각각 갱신해야 하므로 반드시 어긋난다. 뱃지와 알림이 다른 숫자를 말하기 시작한다 |
| '최근 완료'를 신청일(`REQDATE`) 기준으로 자른다 | 완료일(`SUCCDATE`) 기준 (`listRecentlyDone`) | 오래전에 신청돼 어제 끝난 건이 통째로 빠진다. 목록 필터의 기간은 신청일 기준이라 그대로 쓰면 안 된다 |
| 쓰기 응답의 성공을 `res.ok` 로 판정 | `res.status === 200` 으로 좁힌다 | 쓰기 비활성(기본값)이 **202** 를 주는데 `res.ok` 에 포함된다. 저장 안 됐는데 성공으로 알고 사용자가 쓰던 초안을 지운다 |
| 내부 전용 댓글을 쓰기·읽기에서 다른 기준으로 거른다 | 두 축을 `INTERNAL` 하나로 맞춘다 | 축이 어긋나면 "썼는데 본인에게도 안 보이는 댓글"이 생긴다. 판정은 `insertComment` 안쪽에 둬 호출자가 잊을 수 없게 한다 |
| 시드 스키마 컬럼만 추가하고 끝 | `SCHEMA_VERSION` 을 올린다 | 로컬 `.data/nexio.db` 는 파일로 남아 옛 스키마가 그대로 열린다 → `no such column` 500. ⚠️ 개발 서버는 커넥션을 전역 캐시하므로 **재시작**해야 재생성이 돈다 |
| 디버그용 `try/catch` 로 화면을 통째로 감싸 커밋 | 원인이 확정되면 **그 커밋에서** 걷어낸다 | 삼킨 오류가 200 이 되어 스택트레이스가 사용자 화면에 그려진다. 배포는 green 이고 모니터링은 조용한데 화면만 깨져 있다 (`app/requests/page.tsx`, 12커밋 방치) |
| 설정을 못 읽었을 때 권한 검사를 건너뛴다(`config && !config.x`) | `!config?.x` — 모르면 차단 | `config` 가 null 인 미등록 고객사에서 **오히려 전부 통과**한다. 같은 파일의 다른 축은 fail-closed 라 한 줄만 문법이 다른 게 단서였다 |
| 미읽음을 화면마다 각자 센다 | `data/read-state.ts` 한 곳에서 정의 | 알림은 내부 전용 댓글을 거르는데 목록 뱃지가 안 거르면, 고객사에 **열어도 지울 수 없는 빨간 점**이 남는다 (보이지 않는 글은 읽을 수도 없다) |
| 읽음 처리를 신청자·담당자로 좁힌다 | 볼 수 있으면 읽을 수 있다 (`scopeClause`) | 뱃지는 **볼 수 있는 모든 건**에 뜨는데 읽음선은 내 건에만 그어지면, 운영팀 목록의 점이 영원히 안 지워진다 |
| 첨부를 본문과 **다른 요청**으로 올린다 | 같은 요청·같은 트랜잭션 (`ADR-0008`) | "신청은 저장됐는데 첨부만 실패"가 생긴다. 사용자는 저장됐다고 믿고 창을 닫는다 |
| 업로드 크기·형식을 클라이언트가 보낸 값으로 판정 | 서버가 **디코드한 실제 바이트**로 다시 잰다 | `size`·`mime` 은 요청 본문이라 얼마든지 바꿔 보낼 수 있다. 확장자와 MIME 이 **함께** 맞아야 통과 |
| 첨부 허용 목록에 SVG·HTML 을 넣는다 | 뺀다 (이미지·PDF·문서·zip·텍스트만) | 브라우저가 실행하는 마크업이라 저장형 XSS 통로가 된다. 다운로드도 `attachment`+`nosniff` 로 강제 |
| 카드 숫자와 링크의 조건이 다르다 | 카드가 센 조건을 그대로 URL 로 넘긴다 | 25 를 누르면 167 이 나온다. 필터로 표현할 수 없는 카드라면 **필터를 먼저 만든다**(미읽음) |

## 참고 문서 (필요할 때만 로드)

- **진행 상태**: `docs/progress/nexio-mvp.json` ← 세션 시작 시 필수
- **전환 결정**: `docs/decisions/ADR-0004`(사이드 프로젝트·SQLite·가상 시드) ← 현행 정본
- **배포·CI/CD**: `docs/decisions/ADR-0005` — 라이브 https://nexio-next.vercel.app ·
  배포 환경에서만 드러난 함정 3종(lock·jsdom·타임존)의 원인과 대응
- **쓰기 경로**: `docs/decisions/ADR-0006` — 관문 분리 · 상태 전이 정본 · 이력 규약
- **첨부파일**: `docs/decisions/ADR-0008` — DB BLOB · 본문과 한 트랜잭션 · 허용 목록 · 한도
- **메뉴 이식**: `docs/decisions/ADR-0007` — 원본 38메뉴(서비스 6 + 내부관리 27 + 상단 상시 5)
  중 3종을 고른 기준과 버린 근거
- 요구사항: `docs/PRD.md` · 구조·환경변수: `docs/ARCHITECTURE.md`
- API 계약: `docs/inventory/api-map.md` · 타입: `docs/design/types-spec.md`
- 실데이터 근거: `docs/inventory/data-profile.md` ← "무엇을 안 만들어도 되는가"의 출처
- 권한: `docs/design/permissions-spec.md` · BFF: `docs/design/bff-spec.md`
- UX 원칙: `docs/design/ux-principles.md` · 화면별: `docs/design/redesign-*.md`
- 디자인 시스템: `docs/design/styleguide.html`(브라우저로 열기) · `tokens.css` · `design-system-review.md`
- 라이브러리 선정: `docs/design/tech-stack.md`
- 경로 조건부 규칙: `.claude/rules/` — 해당 경로를 만질 때만 로드된다 (이 파일이 길어지면 여기로 분리)
