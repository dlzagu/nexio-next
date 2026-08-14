---
paths:
  - "src/app/api/**"
---

# BFF route handler 규칙

정본은 `docs/design/bff-spec.md`. 아래는 **틀리면 조용히 망가지는 4가지**만 뽑았다.

1. **사용자 세션 쿠키만 릴레이한다.** BFF 가 자체 로그인·세션 풀링·커넥션 재사용을 하면
   안 된다 — 원본이 `max-sessions=1` 이라 사용자의 브라우저 세션이 만료된다.
   쿠키 이름은 하드코딩하지 말고 `SESSION_COOKIE_NAME` 환경변수로.

2. **`fetch` 에 `redirect: "manual"` 을 반드시 붙인다.** 세션 만료가 `401` 이 아니라
   `302 → /login` 으로 온다. 따라가면 로그인 HTML 을 `200` 으로 받아 zod 파싱이 깨진다.
   → `401 { code: "SESSION_EXPIRED" }` 로 정규화해 내린다.

3. **응답은 zod 로 파싱한다.** 실패는 `502 { code: "CONTRACT_VIOLATION" }` + 서버 로그.
   조용히 넘기지 마라 — 원본 응답이 바뀐 신호다. 목록 조회는 **해당 행만 스킵**하고
   전체를 죽이지 않는다.

4. **액션 라우트는 클라이언트가 보낸 티켓을 믿지 않는다.** 서버에서 티켓을 다시 읽고
   `canDo()` 로 판정한다. 규칙에 없는 조합은 전부 거부(fail-closed).
   🔒 **취소 액션은 신청자 본인만** — 회사 정책이라 BFF 에서도 강제한다.

## 이름 변환은 이 경계에서만

원본 필드명(`CONTENT`·`echonum`·`testYn`)은 route handler 밖으로 나가지 않는다.
정규화 규칙: `docs/design/types-spec.md`
