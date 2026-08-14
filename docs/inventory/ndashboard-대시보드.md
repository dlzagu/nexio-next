# 대시보드 (ndashboard) 인벤토리

> 원본: `views/ndashboard.jsp` (3,104줄) · 진입 `GET /ndashboard` · API `DashController`
> 조사일: 2026-07-30

## 1. 요약 — MVP 3화면 중 이식 난이도가 가장 낮다

| 항목        | 값                                                                           |
| ----------- | ---------------------------------------------------------------------------- |
| 줄수        | 3,104                                                                        |
| 입력 컨트롤 | **6개** (필터뿐)                                                             |
| API         | **GET 14개 · 전부 JSON**                                                     |
| 차트        | **Chart.js** · 캔버스 3개 (`ndTrendChart` `ndStatusChart` `ndDurationChart`) |
| 쓰기 동작   | **없음 — 완전 읽기 전용**                                                    |

읽기 전용 + 깔끔한 REST + 필터 6개.
→ **디자인 시스템을 처음 검증할 무대로 최적.** 여기서 컴포넌트를 확정하고 조회로 넘어간다.

---

## 2. 위젯 14종 ↔ API 대응

| #   | API                                   | 위젯 성격                             | 필터 파라미터             |
| --- | ------------------------------------- | ------------------------------------- | ------------------------- |
| 1   | `/api/dashboard/stats`                | 요약 카드 (전체·진행중·완료·평균처리) | period · custCode · dept  |
| 2   | `/api/dashboard/trend`                | 추이 라인차트                         | period · custCode · dept  |
| 3   | `/api/dashboard/status-distribution`  | 상태 분포 (도넛/파이)                 | period · custCode · dept  |
| 4   | `/api/dashboard/top-customers`        | 상위 고객사 랭킹                      | period · **topN**(기본 5) |
| 5   | `/api/dashboard/assignee-performance` | 담당자별 실적                         | period                    |
| 6   | `/api/dashboard/processing-duration`  | 처리 소요시간 차트                    | period                    |
| 7   | `/api/dashboard/recent-requests`      | 최근 요청 목록                        | (3곳에서 호출)            |
| 8   | `/api/dashboard/my-status-counts`     | 내 상태별 건수                        |                           |
| 9   | `/api/dashboard/my-activity`          | 내 활동                               | (2곳)                     |
| 10  | `/api/dashboard/my-pending`           | 내 미처리                             |                           |
| 11  | `/api/dashboard/company-unresolved`   | 고객사 미해결                         | custCode · dept · limit 5 |
| 12  | `/api/dashboard/notices`              | 공지                                  | limit                     |
| 13  | `/api/dashboard/youtube-videos`       | 교육 영상                             | limit 3                   |
| 14  | `/api/dashboard/hub-memory`         | 사내 허브 메모리                          | (파라미터 없음)           |

> `recent-requests` 는 **3곳**, `my-activity` `notices` `youtube-videos` 는 **2곳**에서 각각 호출된다.
> 같은 데이터를 화면 여러 위치에서 중복 요청 중 → Next.js 에서는 한 번 fetch 해 공유한다.

### 위젯 성격 3분류 (재설계 시 그룹핑 축)

- **조직 전체 지표** — 1·2·3·4·5·6 (운영팀 관점)
- **나의 업무** — 8·9·10 (개인 관점)
- **소식·참고** — 7·11·12·13·14

---

## 3. 필터 (6개)

`period` · `custCode` · `dept` · `topN` · `limit` — 위젯별로 다르게 조합된다.
기간 미지정 시 서버 기본값 = **이번 달** (`DashController` L124 주석).

---

## 4. 권한 — 서버가 강제한다 (중요)

`DashController` 에 테넌트 격리가 **서버측으로** 구현돼 있다. BFF 가 다시 구현할 필요 없다.

```java
// L104 — 외부사용자는 어떤 custCode 를 보내도 본인 회사로 강제 override
private String effectiveCustCode(LoginUser u, String requested) {
    if (isExternalUser(u)) return u.getCompanyCode();
    return requested;
}

// L116 — 비공개(PUBLICYN='N') 문서 조회 제한
private boolean restrictPrivate(LoginUser u) {
    if (u == null) return true;              // ← fail-closed ✅
    if (UserType.INTERNAL.equals(...)) return false;
    if (m != null && "Y".equals(m.getAPPROVER())) return false;
    return true;
}
```

- 클라이언트가 `custCode` 를 조작해도 서버가 덮어쓴다 → **파라미터 위조 무효**
- `u == null` 일 때 **제한(true)** 이 기본 → fail-closed. 전역 룰과 일치
- 비공개 문서: 내부사용자·고객사 승인자는 전부 조회, 일반 고객사 사용자는 공개분 + 본인 작성분만

> ✅ **Next.js BFF 설계 결론**: 대시보드 API 는 그대로 프록시만 하면 된다.
> 권한을 프론트에서 재구현하지 말 것 — 이중화하면 두 곳이 어긋나는 순간 구멍이 난다.

---

## 5. 사용자 유형 (정본) — `Const.java:58~62`

| 상수                 | 코드       | 의미                                   |
| -------------------- | ---------- | -------------------------------------- |
| `UserType.INTERNAL`  | `B0001_01` | **내부사용자** (운영사/RPA) — 운영팀 |
| `UserType.EXTERNAL`  | `B0001_02` | **고객사용자** (구 "외부사용자")       |
| `UserType.EXTVENDOR` | `B0001_03` | **외부업체**                           |

> ⚠️ 용어 함정: `EXTERNAL`(B0001_02)이 "외부"라는 이름이지만 실제로는 **고객사 직원**이다.
> 진짜 외부 협력업체는 `EXTVENDOR`(B0001_03). 주석에도 "구 외부사용자"라고 남아 있다.
> → TS 타입으로 옮길 때 **이름을 바로잡을 것**: `INTERNAL` / `CUSTOMER` / `VENDOR`.
>
> 🔴 **역할은 3종이 아니라 2종이다** (`ST001.jsp:2222` `isOperatorUser()`):
> `B0001_01`(내부) 과 **`B0001_03`(외부업체) 이 함께 "처리자"** 이고, `B0001_02`(고객사)만 "신청자"다.
> 즉 외부 협력업체 엔지니어가 티켓을 **처리하는** 쪽이다. 별도 화면이 아니라 처리자 권한.
> 격리는 `operCompany`(운영시스템 담당 회사)로 이뤄진다 — 상세: `../design/permissions-spec.md` §1
>
> 회사 판별 규칙 (`CompanyService` L142~144): `OPER=Y,EXT=N`→내부 · `OPER=N,EXT=N`→고객사 · `OPER=Y,EXT=Y`→외부업체

---

## 6. UX 재설계 입력 (P2)

1. **위젯 14개를 3그룹으로 재편** — 조직지표 / 나의업무 / 소식. 지금은 평면 나열
2. **중복 호출 제거** — `recent-requests` 3회, `my-activity`·`notices`·`youtube` 각 2회
3. **역할별 기본 뷰 분리** — 운영팀은 조직지표 우선, 고객사 사용자는 "나의 업무" 우선
   (서버가 이미 데이터를 격리하므로 **화면 구성만** 바꾸면 된다)
4. **차트는 dataviz 규격으로** — Chart.js 3종을 디자인 시스템 팔레트와 한 몸으로
5. `hub-memory` · `youtube-videos` 는 성격이 이질적 → MVP 포함 여부 확인 필요

---

## 7. 미해결 (P1.s6)

- [ ] `hub-memory` 위젯의 용도 — MVP 범위 포함 여부
- [ ] `dept`(부서) 코드 목록 출처
- [ ] `period` 허용값 (이번달/분기/연도?)
