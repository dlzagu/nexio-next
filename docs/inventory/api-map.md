# API 맵 — MVP 3화면 (조회 / 신청 / 대시보드)

> Spring 을 API 로 유지하기로 확정했으므로 **이 문서가 프론트-백엔드 계약서**다.
> Next.js BFF(route handler)는 여기 적힌 경로만 호출한다. 원본 Spring 은 수정하지 않는다.
>
> 원본: `<원본repo>` (SVN · **읽기 전용 · 커밋 금지**)
> 조사일: 2026-07-30

## 0. 화면 ID 확정 (⚠️ 혼동 주의)

화면 ID 가 직관과 어긋난다. 컨트롤러의 logger 문구가 정본이다
(`GetData20Controller.java` L93/L168/L190/L199).

| 화면           | ID           | JSP                    | 줄수  | 컨트롤러 진입      | MVP        |
| -------------- | ------------ | ---------------------- | ----- | ------------------ | ---------- |
| **서비스조회** | `ST001`      | `c4web/ST001.jsp`      | 6,611 | `GET /c4web/ST001` | ✅         |
| **서비스신청** | `ST002`      | `c4web/ST002.jsp`      | 2,599 | `GET /c4web/ST002` | ✅         |
| **대시보드**   | `ndashboard` | `views/ndashboard.jsp` | 3,104 | `GET /ndashboard`  | ✅         |
| 선급금 정산    | ST003        | `c4web/ST003.jsp`      | 5,819 | `GET /c4web/ST003` | ❌ 범위 밖 |
| Cross charge   | ST004        | `c4web/ST004.jsp`      | —     | `GET /c4web/ST004` | ❌ 범위 밖 |

> ST003/ST004 는 SAP B1 테이블 연동 화면(`getData20()` 경유)이라 데이터 통로가 **완전히 다르다**.
> MVP 3화면은 전부 일반 REST JSON 이라 BFF 구조가 단순하다 — 범위를 넘기지 말 것.

## 1. 데이터 통로 — 두 갈래 (MVP 는 한쪽만)

| 통로            | 방식                                                 | 쓰는 화면                  | MVP 관련           |
| --------------- | ---------------------------------------------------- | -------------------------- | ------------------ |
| **REST JSON**   | 엔드포인트별 `$.ajax` / `$.getJSON`                  | ST001 · ST002 · ndashboard | ✅ **이것만 쓴다** |
| 범용 게이트웨이 | `POST /c4web/GetData20` 단일 창구 (`footer.js:1025`) | ST003 · ST004              | ❌ 범위 밖         |

> 참고 — `getData20()` 은 `async: false` **동기 XHR** 이다. 호출 1건마다 브라우저 UI 가 멈춘다.
> MVP 3화면은 이 경로를 안 타지만, 나중에 ST003/ST004 를 옮길 때는 이 동기 호출 제거가
> 체감 성능 개선의 핵심이 된다.

## 2. 조회 (ST001) — `EcoLineController` (`@RequestMapping("/eco")`)

가장 많이 쓰는 화면. 고객과 소통하는 접점.

| 메서드 | 경로                                          | 용도                | 비고                                           |
| ------ | --------------------------------------------- | ------------------- | ---------------------------------------------- |
| POST   | `/eco/request/list`                           | 요청 목록 조회      | 검색 조건 = `EcoLineSearchVO`                  |
| POST   | `/eco/request/detail`                         | 요청 상세           | `custCode` 등 파라미터                         |
| POST   | `/eco/request/update`                         | 요청 수정           | `EcoLineUpdateVO` · 화면에서 **4회** 호출      |
| POST   | `/eco/request/process`                        | 처리(진행상태 변경) | `EcoLineProcessVO`                             |
| POST   | `/eco/request/comment-read-state`             | 댓글 읽음 처리      | `echoNum`                                      |
| GET    | `/eco/request/add-info`                       | 부가정보            | 세션 기반                                      |
| GET    | `/eco/request/projects`                       | 프로젝트 목록       | `echoNum`                                      |
| GET    | `/eco/request/time-echonum`                   | 잔여시간 조회       | `echoNum`                                      |
| GET    | `/eco/request/company-oper-system`            | 고객사 운영시스템   |                                                |
| GET    | `/eco/request/excel`                          | 엑셀 다운로드       | `ModelAndView` — **JSON 아님**, 별도 처리      |
| GET    | `/eco/api/referrer/groups/active`             | 참조자 그룹         |                                                |
| GET    | `/eco/api/referrer/groups/{groupId}/emails`   | 그룹 이메일         |                                                |
| GET    | `/api/admin/company/{custCode}/rpa-processes` | RPA 프로세스        | ⚠️ `/eco` 밖 — 별도 컨트롤러                   |
| POST   | `/mail/send-notification`                     | 알림메일 발송       | ⚠️ `CTX` 접두 **없이** 호출됨 (원본 버그 의심) |
| POST   | `OK_UPLOAD_URL` (변수)                        | 첨부 업로드         | multipart · 실제 값 확인 필요                  |
| GET    | `/eco/attach/list`                            | 첨부 목록           | `atchmnflId`                                   |

## 3. 신청 (ST002) — 같은 `EcoLineController`

| 메서드 | 경로                                                    | 용도                                        |
| ------ | ------------------------------------------------------- | ------------------------------------------- |
| GET    | `/eco/api/request/init`                                 | **폼 초기 데이터** (`EcoLineReqFormInitVO`) |
| POST   | `/eco/request/save`                                     | 신청 저장 (`EcoLineRequestVO`)              |
| POST   | `/eco/request/detail`                                   | 상세 (수정 진입 시)                         |
| GET    | `/eco/request/month-time`                               | 월 계약시간                                 |
| GET    | `/eco/request/mber-info`                                | 담당자 정보 (`custPerson`)                  |
| GET    | `/eco/request/add-info`                                 | 부가정보                                    |
| GET    | `/eco/request/company-oper-system`                      | 고객사 운영시스템                           |
| GET    | `/eco/api/referrer/groups/active` · `/{groupId}/emails` | 참조자                                      |
| POST   | `/Mobile/uploadFile` · `/Mobile/saveFiledata`           | 첨부 (2단계)                                |
| POST   | `/mail/send-notification`                               | 알림메일                                    |

> 조회와 **공유하는 엔드포인트가 5개** (`detail`·`add-info`·`company-oper-system`·참조자 2개).
> → BFF 에서 공용 모듈로 뽑는다.

## 4. 대시보드 (ndashboard) — `DashController`

전부 `GET` + JSON. **MVP 3화면 중 가장 깨끗한 API** — 여기부터 붙이면 리스크가 가장 낮다.

| 경로                                  | 용도           |
| ------------------------------------- | -------------- |
| `/api/dashboard/stats`                | 요약 지표      |
| `/api/dashboard/trend`                | 추이           |
| `/api/dashboard/status-distribution`  | 상태 분포      |
| `/api/dashboard/top-customers`        | 상위 고객사    |
| `/api/dashboard/assignee-performance` | 담당자별 실적  |
| `/api/dashboard/processing-duration`  | 처리 소요시간  |
| `/api/dashboard/recent-requests`      | 최근 요청      |
| `/api/dashboard/my-status-counts`     | 내 상태별 건수 |
| `/api/dashboard/my-activity`          | 내 활동        |
| `/api/dashboard/my-pending`           | 내 미처리      |
| `/api/dashboard/company-unresolved`   | 고객사 미해결  |
| `/api/dashboard/notices`              | 공지           |
| `/api/dashboard/youtube-videos`       | 영상           |
| `/api/dashboard/hub-memory`         | 사내 허브 메모리   |

## 5. 인증 — ✅ 소스로 확정 (2026-07-30, `config/security-context.xml`)

> ⚠️ **당초 "JWT 기반"이라 가정했으나 틀렸다.** 웹 화면·API 는 **세션 쿠키 기반**이다.

### 실제 구조

| 항목      | 값                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------- |
| 인증 방식 | **form-login + 세션 쿠키** (`PORTALSESSIONID`)                                                   |
| JWT       | **웹 경로에 미사용.** `MobileController` · `MemberService` 두 곳뿐 = **모바일 전용**              |
| 동시 세션 | `max-sessions="1"` · `error-if-maximum-exceeded="false"` → **새 로그인이 기존 세션을 만료시킨다** |
| 세션 만료 | `invalid-session-url="/login?invalid"`                                                            |

### 경로별 접근 제어

```xml
/c4web/**   → permitAll     ← ST001·ST002 화면 진입이 인증 없이 열려 있다
/Mobile/**  → permitAll
/Chk/**     → permitAll
/**         → authenticated ← /eco/** 는 여기 걸림 = API 는 인증 필요
```

> ⚠️ 화면(`/c4web/ST001`)은 permitAll 인데 컨트롤러는 `@AuthenticationPrincipal LoginUser` 를 쓴다
> → 비로그인 접근 시 `loginUser` 가 null 이 될 수 있다. **이식 시 재현하지 말 것** —
> 새 앱에서는 화면도 인증 뒤에 둔다 (fail-closed).

### 🔴 Next.js BFF 설계 정정

**"JWT 를 httpOnly 쿠키에 보관"은 폐기.** 실제 방침:

1. BFF route handler 가 **사용자의 `PORTALSESSIONID` 쿠키를 그대로 전달**한다.
2. **BFF 가 자체 세션을 새로 만들면 안 된다** — `max-sessions=1` 이라 사용자의 브라우저 세션이 만료된다.
3. 로그인 자체는 기존 `/login` 폼 흐름을 태우고, Next.js 는 그 결과 쿠키를 받아 유지한다.

> 남은 확인 (P1.s7): 세션 쿠키만 전달하면 `/eco/request/list` 가 정상 응답하는지 — 개발서버 실호출 필요.
> 다만 **구조는 확정**됐으므로 BFF 설계를 진행하는 데는 지장이 없다.

### 🔴 CSRF 가 사실상 꺼져 있다 (원본 이슈)

`CsrfSecurityRequestMatcher.java:29`

```java
return !ALLOWED_METHODS.contains(request.getMethod()) && super.matches(request);
```

`ALLOWED_METHODS` 에 `GET·POST·PUT·PATCH·DELETE·HEAD·TRACE·OPTIONS` **전부**가 들어 있어
첫 조건이 **항상 false** → `matches()` 가 항상 false → **CSRF 검사가 한 번도 수행되지 않는다.**

바로 윗줄에 주석 처리된 원래 코드가 의도를 보여준다:

```java
//Arrays.asList("GET", "HEAD", "TRACE", "OPTIONS"));   ← 안전 메서드만 (정상)
```

> **원본은 수정하지 않는다**(읽기 전용 정책). 다만 **새 앱에서 이 구조를 재현하지 않는다** —
> Next.js BFF 는 상태 변경 요청에 CSRF 보호를 정상 적용한다.
> 원본 쪽 대응 여부는 사용자 판단 사항.

## 6. 다음 단계에서 확인할 것

- [ ] `EcoLineSearchVO` / `EcoLineRequestVO` / `EcoLineUpdateVO` 필드 정의 → 폼 스키마의 원본
- [ ] 세션 의존 여부 실측 (§5)
- [ ] `OK_UPLOAD_URL` / `UPLOAD_URL` 실제 값
- [ ] `/mail/send-notification` 의 `CTX` 누락이 실제 버그인지
- [ ] 권한 분기 — `userType`(`B0001_03` = 외부고객) 별 화면 차이
