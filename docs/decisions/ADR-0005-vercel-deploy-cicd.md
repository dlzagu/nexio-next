# ADR-0005: Vercel Git 연동 배포 + GitHub Actions CI

- 날짜: 2026-08-14
- 상태: 채택 (ADR-0004 의 "공개 배포·자동 CI/CD 필요"를 실제로 구현한 기록)

## 맥락

ADR-0004 로 데이터가 자체 SQLite + 가상 시드가 되어 공개 배포가 가능해졌다.
남은 결정은 **어디에, 어떻게 자동 배포하는가**였다.

## 결정

- **호스팅 = Vercel, 연결 방식 = Git 연동** (배포 토큰을 CI 에 두는 방식은 채택하지 않음)
  - `main` push → 프로덕션 배포, PR → 프리뷰 URL 자동 발급
  - 배포 토큰·시크릿을 저장소나 Actions 에 보관하지 않는다 (관리 대상이 0개)
- **품질 게이트 = GitHub Actions** (`.github/workflows/ci.yml`)
  - `npm ci` → `verify`(lint·typecheck·test) → `format:check` → `build`
  - 배포와 병렬로 돌아 문제를 알린다. 배포 차단 게이트는 아니다 — 포트폴리오
    프로젝트라 "배포는 항상 최신, 품질 신호는 별도"가 더 실용적이다
- **환경변수 0개** — 서버리스에서는 `:memory:` DB 에 콜드스타트마다 시드 (ADR-0004)
- **브랜치** — 공개 `main` 은 익명화된 스쿼시 커밋만 담는다. 익명화 전 개발 이력은
  로컬 `private-history` 브랜치에 남기고 **원격에 push 하지 않는다**

## 실제로 밟은 함정 (배포 후 실측)

셋 다 **로컬에서는 재현되지 않고 배포 환경에서만** 드러났다. 기록해 두는 이유는
"로컬 통과 = 배포 정상"이 아니라는 것이 이 프로젝트의 교훈이기 때문이다.

| 증상 | 원인 | 대응 |
|---|---|---|
| CI 가 `npm ci` 에서 즉사 (`Missing: @emnapi/*`) | Windows npm 이 wasm32-wasi optional 의존성의 **하위 의존성**을 lock 에 적지 않는다. Linux 러너의 npm 은 그 항목을 요구 | `npm run lock:fix` (`scripts/sync-lock-wasm-deps.mjs`) — 멱등 보정. `npm install` 이 매번 지우므로 의존성 변경 후 재실행 |
| `/requests`·`/styleguide` 만 SSR 500 (화면은 브라우저가 다시 그려 정상으로 보였다) | `isomorphic-dompurify` → 서버에서 jsdom 필요 → jsdom 의 동적 require 가 서버리스 번들에 안 담긴다. **클라이언트 컴포넌트의 SSR 번들이라 `serverExternalPackages` 로도 못 뺀다** | 새니타이저를 DOM 비의존 순수 파서(`xss`)로 교체. 새니타이즈는 브라우저·SSR 양쪽에서 도는 코드라 DOM 의존이 애초에 설계 오류였다 |
| 같은 티켓의 신청일이 서버 08-12 / 브라우저 08-13 (React #418 하이드레이션 깨짐) | 저장값은 타임존 없는 벽시계 시각인데 데이터 경계에서 `toISOString()` 으로 절대시각화 → 서버(UTC)와 브라우저(KST)가 다른 날짜를 그린다 | `toWallClockIso()` — 타임존 표기 없이 넘겨 양쪽이 같은 숫자를 읽게 한다. 회귀 테스트 4개 (`tests/data-hygiene.test.ts`) |

## 결과

- 라이브: https://nexio-next.vercel.app — 12개 경로 전수 200, 콘솔 에러 0
- 배포 상태 확인용 진단 엔드포인트: `/api/diag`

## 대안과 기각 이유

- **GitHub Actions + Vercel CLI 로 배포 제어**: `VERCEL_TOKEN` 을 발급·보관해야 하고
  프리뷰 배포를 직접 구성해야 한다. Git 연동이 주는 것을 수작업으로 재구현하는 셈이라 기각.
- **CI 를 배포 차단 게이트로 두기**: 배포가 CI 완료까지 지연된다. 1인 포트폴리오
  프로젝트에서는 이득이 비용보다 작다고 판단. 팀 프로젝트라면 반대로 가는 게 맞다.
