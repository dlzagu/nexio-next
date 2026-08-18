# ADR-0001: BFF 는 사용자 세션 쿠키를 릴레이한다 (자체 세션 생성 금지)

- 날짜: 2026-07-30
- 상태: **대체됨 (ADR-0004)** — Spring 백엔드 연동 자체가 폐기됐다.
  아래 내용은 원본 시스템을 분석해 얻은 사실이라 **역사 기록으로** 남긴다.
  현행 라우트 규칙은 `.claude/rules/bff.md` 다.

## 맥락 (왜 이 결정이 필요했나)

전환 초기에는 인증이 **JWT 기반**이라고 가정했다. 소스를 확인해 보니 틀렸다
(`config/security-context.xml`). 실제는 **form-login + 세션 쿠키(`PORTALSESSIONID`)** 이고,
JWT 는 `MobileController`·`MemberService` 두 곳뿐인 모바일 전용 경로다.

여기에 결정을 강제하는 제약이 하나 더 있다 — `security-context.xml:49` 의
**`max-sessions="1"`**. 한 사용자에게 세션이 하나만 허용된다.

## 결정

BFF(route handler)는 **요청마다 그 사용자의 세션 쿠키를 그대로 상위 Spring 에 전달**한다.
자체 로그인·서비스 계정·세션 풀링·커넥션 재사용을 **하지 않는다.**
로그인 폼도 자체 구현하지 않고 기존 `/login` 을 태우고 `Set-Cookie` 를 브라우저로 넘긴다.

부수 결정 — 상위 `fetch` 에는 항상 `redirect: "manual"` 을 붙인다.

## 결과 (트레이드오프)

- **얻는 것**: 권한·테넌트 격리를 Spring 이 계속 판정한다(fail-closed 유지). 브라우저 JS 가
  세션 쿠키를 만지지 않는다. 인증 로직을 두 곳에서 관리하지 않는다.
- **포기하는 것**: BFF 가 사용자 없이 독자적으로 상위 API 를 부를 수 없다(배치·프리페치 불가).
  세션 만료를 BFF 가 대신 갱신해 줄 수도 없다 — 사용자가 다시 로그인해야 한다.

## 왜 이 규칙을 어기면 조용히 망가지는가

- **자체 세션을 만들면** `max-sessions=1` 때문에 **사용자의 브라우저 세션이 밀려 만료된다.**
  BFF 는 정상 동작하는데 사용자만 튕기므로 원인 추적이 어렵다.
- **`redirect: "manual"` 을 빼면** 세션 만료가 `401` 이 아니라 `302 → /login` 으로 오기 때문에
  fetch 가 따라가 **로그인 HTML 을 `200` 으로** 받는다. zod 파싱이 엉뚱한 곳에서 깨진다.
  → `401 { code: "SESSION_EXPIRED" }` 로 정규화해 내린다.

## 검토한 대안

- **JWT 발급 후 BFF 가 무상태 호출** — 탈락: 대상 엔드포인트가 `HttpSession` 을 직접 읽는다
  (`getEcoLineList(search, session)`). Spring 을 수정해야 하므로 비목표 위반.
- **BFF 가 서비스 계정으로 로그인해 프록시** — 탈락: `max-sessions=1` 위반 + 사용자별
  권한 판정이 무너진다(모든 요청이 서비스 계정 권한으로 수행됨).

## 관련

- `docs/design/bff-spec.md` §1·§2 · `docs/inventory/api-map.md` §5
- 미해결: 세션 쿠키만 릴레이하면 `/eco/request/list` 가 200 을 주는지 실호출 검증 (P1.s7)
