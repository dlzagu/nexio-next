# BFF 설계 — Next.js route handler

> Spring 은 수정하지 않는다. Next.js route handler 가 **유일한 서버 통신 창구**다.
> 근거: `../inventory/api-map.md`(엔드포인트 41) · `types-spec.md`(이름 정규화) · `permissions-spec.md`

## 0. BFF 가 존재하는 이유 4가지

| 이유               | 내용                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **세션 쿠키 보호** | 브라우저 JS 가 `PORTALSESSIONID` 를 만지지 않게 한다                                                |
| **이름 정규화**    | 원본 필드명 함정(`CONTENT`·`echonum`·`testYn` 중복)을 **경계 한 곳**에서만 처리 (`types-spec.md` §0) |
| **응답 검증**      | zod 로 파싱 — 계약 위반을 화면이 아니라 여기서 잡는다                                                |
| **호출 통합**      | 대시보드 중복 호출(`recent-requests` 3회 등) 제거                                                    |

---

## 1. 🔴 인증 — 세션 쿠키 릴레이 (JWT 아님)

`api-map.md` §5 에서 확정: **form-login + 세션 쿠키** 기반이다.

```ts
// app/api/[...path]/route.ts (개념)
const upstream = await fetch(`${SPRING_BASE}${path}`, {
  method,
  body,
  headers: {
    // 사용자의 세션 쿠키를 그대로 전달
    cookie: `PORTALSESSIONID=${cookies().get("PORTALSESSIONID")?.value ?? ""}`,
    "content-type": req.headers.get("content-type") ?? "application/json",
  },
  redirect: "manual", // ← §2
});
```

### 🔴 반드시 지킬 것 — 자체 세션 금지

원본은 `max-sessions="1"` 이다 (`security-context.xml:49`).
**BFF 가 자체 로그인으로 세션을 새로 만들면 사용자의 브라우저 세션이 만료된다.**
→ 서비스 계정 로그인·세션 풀링·커넥션 재사용 **전부 금지**. 요청마다 그 사용자의 쿠키만 릴레이한다.

### 로그인 흐름

Next.js 는 로그인 폼을 자체 구현하지 않는다. 기존 `/login` 을 그대로 태우고
응답의 `Set-Cookie` 를 사용자 브라우저로 전달한다.

---

## 2. 세션 만료 감지 — 상태 코드가 아니라 **리다이렉트**로 온다

Spring Security 는 세션이 끊기면 **`302 → /login?invalid`** 를 준다. `401` 이 아니다.
`redirect: 'manual'` 로 잡지 않으면 fetch 가 따라가서 **로그인 HTML 을 200 으로** 받는다
→ zod 파싱이 깨지고 원인 추적이 어려워진다.

```ts
if (upstream.status >= 300 && upstream.status < 400) {
  const loc = upstream.headers.get("location") ?? "";
  if (loc.includes("/login")) {
    return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 }); // 정규화
  }
}
```

→ 클라이언트는 `401 SESSION_EXPIRED` 하나만 알면 된다. react-query 전역 핸들러가 로그인으로 보낸다.

---

## 3. CSRF

원본은 CSRF 가 **사실상 꺼져 있다**(`api-map.md` §5). 재현하지 않는다.

- Next.js 쪽: 상태 변경 route handler 에 **Origin/Referer 검증**을 건다 (동일 출처만 허용)
- `/c4web/**` 등 원본 permitAll 경로도 **BFF 에서는 인증 뒤에 둔다** (fail-closed)

---

## 4. 라우트 구조 — 3계층

원본 엔드포인트를 그대로 프록시하지 않고 **화면 단위로 묶는다.**

```
app/api/
├── auth/
│   ├── login/route.ts          → POST /login (Set-Cookie 릴레이)
│   └── logout/route.ts         → POST /logout
├── dashboard/route.ts          → GET  /api/dashboard/* 14개를 병렬 호출 후 1응답  ← §5
├── tickets/
│   ├── route.ts                → POST /eco/request/list       (목록)
│   ├── [echoNum]/route.ts      → POST /eco/request/detail      (상세)
│   ├── [echoNum]/action/route.ts → /eco/request/{update,process} (액션)  ← §6
│   └── new/route.ts            → POST /eco/request/save        (신청)
├── meta/route.ts               → 코드목록·참조자그룹·운영시스템 (묶어서 1회)
└── upload/route.ts             → /eco/upload/image · /Mobile/*
```

> `meta` 를 묶는 이유: 조회·신청 화면이 **엔드포인트 5개를 공유**한다(`api-map.md` §3).
> 화면마다 따로 부르면 같은 코드목록을 중복 요청하게 된다.

---

## 5. 대시보드 — 14 호출을 1 요청으로

원본은 페이지당 **19회+** 호출한다(중복 포함). BFF 가 서버측에서 병렬 호출해 한 번에 내린다.

```ts
const [stats, trend, ...rest] = await Promise.allSettled(
  DASHBOARD_ENDPOINTS.map((e) => proxyGet(e, searchParams, cookie)),
);
// ⚠️ allSettled — 위젯 하나가 죽어도 대시보드 전체가 죽지 않는다.
//    실패한 위젯은 { error: true } 로 내려 화면에서 개별 에러 상태로 표시.
```

| 항목                 |                             원본 |   BFF |
| -------------------- | -------------------------------: | ----: |
| 브라우저 → 서버 요청 |                              19+ | **1** |
| 중복 호출            | `recent-requests` 3 · 그 외 각 2 |     0 |

> 서버 → Spring 호출은 여전히 14회지만 **서버 내부 네트워크**라 왕복 비용이 다르다.

---

## 6. 액션 라우트 — 권한을 서버에서 한 번 더 본다

`permissions-spec.md` 의 `canDo()` 는 **UI 표시용**이다. 버튼을 숨긴다고 요청이 막히지 않는다.

```ts
// app/api/tickets/[echoNum]/action/route.ts
const ticket = await fetchTicket(echoNum, cookie); // 현재 상태를 서버에서 다시 읽는다
if (!canDo(action, ticket, user, config)) {
  return Response.json({ code: "FORBIDDEN" }, { status: 403 }); // fail-closed
}
return proxyPost(mapActionToUpstream(action), body, cookie);
```

- 🔒 **취소 액션은 신청자 본인만** — 회사 정책. BFF 에서도 강제한다
- 클라이언트가 보낸 `ticket` 을 믿지 않는다. **서버에서 다시 조회**한 상태로 판정
- 최종 방어선은 여전히 Spring 이다. BFF 검증은 **추가 방어**이지 대체가 아니다

---

## 7. react-query 키 규약

```ts
[
  "tickets",
  "list",
  filters,
] // 목록 — filters 는 nuqs URL 상태와 동일 객체
[("tickets", "detail", echoNum)][("dashboard", { period, custCode, dept })][
  "meta"
]; // staleTime: Infinity — 코드목록은 안 변한다
```

액션 성공 시 무효화:

```ts
queryClient.invalidateQueries({ queryKey: ["tickets"] }); // list + detail 동시
```

---

## 8. 정렬 — 서버 미지원 대응 (`tech-stack.md` §1)

| 뷰                | BFF 동작                                                     |
| ----------------- | ------------------------------------------------------------ |
| 진행 중 / 내 요청 | `size` 를 크게 잡아 **전량 반환**(270건) → 클라이언트가 정렬 |
| 전체 검색         | `page`/`size` 그대로 전달 → 페이지 내 정렬만                 |

```ts
const PROGRESS_VIEW_SIZE = 1000; // 실측 미완료 270건 대비 여유
```

> ⚠️ 미완료 건수가 이 값을 넘으면 조용히 잘린다. **응답에 `truncated: true` 를 실어**
> 화면에서 경고를 띄운다. 조용한 절단은 "정렬이 이상해요"로 돌아온다.

---

## 9. 에러 정규화

| 상황                     | BFF 응답                                                     |
| ------------------------ | ------------------------------------------------------------ |
| 세션 만료 (302 → /login) | `401 { code: 'SESSION_EXPIRED' }`                            |
| 권한 없음                | `403 { code: 'FORBIDDEN' }`                                  |
| zod 파싱 실패            | `502 { code: 'CONTRACT_VIOLATION', detail }` + **서버 로그** |
| Spring 5xx               | `502 { code: 'UPSTREAM_ERROR' }`                             |

> `CONTRACT_VIOLATION` 을 조용히 넘기지 않는다. 원본 응답이 바뀐 신호다.
> 목록 조회에서는 **해당 행만 스킵**하고 전체를 죽이지 않는다 (`types-spec.md` §4-3).

---

## 10. 환경 변수

```
SPRING_BASE_URL=http://<dev-server>:<port>
SESSION_COOKIE_NAME=PORTALSESSIONID
```

> 🔒 URL·포트는 `.env.local` 로. 커밋 금지 (하네스 `.gitignore` 가 `.env*` 를 막는다).

---

## 11. 열린 항목

- [ ] 세션 쿠키만 릴레이하면 `/eco/request/list` 가 200 을 주는지 실호출 검증 (P1.s7)
- [ ] `/mail/send-notification` 의 `CTX` 접두 누락이 원본 버그인지 — BFF 에서 정상 경로로 보정할지
- [ ] 파일 업로드 multipart 스트리밍 — route handler 통과 방식 확인 (P5)
