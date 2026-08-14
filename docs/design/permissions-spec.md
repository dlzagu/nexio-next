# 권한 명세 — `canDo()` 단일 함수

> 원본의 권한 판정이 `ST001.jsp` 전역에 흩어져 있다(축 13개, 버튼마다 조건식).
> 이 문서는 그것을 **순수 함수 하나**로 모은 스펙이다. P6 구현 시 이 표가 곧 테스트 케이스가 된다.
> 근거: `../inventory/ST001-조회.md` · `../inventory/data-profile.md` · 기준: `ux-principles.md` P6

## 0. 🔴 먼저 — 역할 구조를 잘못 알고 있었다

`ST001.jsp:2222`

```js
function isOperatorUser() {
  return userType === "B0001_01" || userType === "B0001_03";
}
```

**`B0001_03`(외부업체)은 "외부 고객"이 아니라 처리자(운영자) 쪽이다.**

| 코드       | 상수        | 실제 역할              | 이 시스템에서 |
| ---------- | ----------- | ---------------------- | ------------- |
| `B0001_01` | `INTERNAL`  | 운영사 직원 / RPA    | **처리자**    |
| `B0001_02` | `EXTERNAL`  | 고객사 직원            | **신청자**    |
| `B0001_03` | `EXTVENDOR` | 외부 협력업체 엔지니어 | **처리자**    |

→ 신규 타입은 `INTERNAL` / `CUSTOMER` / `VENDOR` 로 명명하고,
**파생 역할 2종**을 둔다: `isOperator = INTERNAL | VENDOR` · `isRequesterSide = CUSTOMER`

> 이로써 미해결이던 "외부업체 화면 차이 범위"가 해소됐다. 별도 화면이 아니라 **처리자 권한**이다.

---

## 1. 협력업체 격리 — `operCompany` (놓치면 안 되는 축)

`canOperateCurrentDetail()` (`ST001.jsp:5314`)

```js
if (!isOperatorUser()) return false; // ① 처리자 유형인가
var operCompany = getSelectedOperSystem()?.operCompany;
return !!operCompany && operCompany === loginCustCode; // ② 그 운영시스템 담당이 내 회사인가
```

요청마다 **운영시스템**이 붙고, 그 운영시스템에는 **담당 회사(`operCompany`)** 가 있다.
처리자는 **자기 회사가 맡은 운영시스템의 건만** 처리할 수 있다.
→ 협력업체 A 가 협력업체 B 의 건을 못 건드리게 하는 장치다.

✅ 이 함수는 **fail-closed 다** (`operCompany` 가 비면 `false`). 그대로 유지한다.

---

## 2. 함수 시그니처

```ts
type UserRole = "INTERNAL" | "CUSTOMER" | "VENDOR";

interface User {
  id: string; // loginUserId
  companyCode: string; // loginCustCode
  role: UserRole;
  // 전역 플래그 (서버가 세션에서 내려줌)
  systemAppYn: boolean; // 시스템이관 승인 권한
  systemSuccYn: boolean; // 시스템이관 완료 권한
  bcAdminYn: boolean; // BC 관리자
}

interface Ticket {
  echoNum: string;
  progress: ProgressCode; // '1'~'12'
  custPerson: string; // 신청자 ID
  succPerson: string | null; // 담당자 ID (null = 미배정)
  operCompany: string | null; // 운영시스템 담당 회사
  confYn: boolean; // 이 건이 고객승인 절차를 타는가
  canApproveRequest: boolean; // 서버가 계산해 내려주는 승인 가능 여부
  systemSelfYn: boolean;
  systemBy: string; // '1' | '2'
}

/** 고객사 단위 기능 토글 (EcoLineAddInfoVO) */
interface CompanyConfig {
  approver: boolean; // 현재 사용자가 이 고객사의 승인자인가
  testYn: boolean; // 테스트 이관 단계 사용
  systemYn: boolean; // 시스템 이관 단계 사용
  showYn: boolean; // 계약시간 노출
}

type TicketAction =
  | "approve"
  | "rejectCust" // 승인/반려 (고객)
  | "cancel"
  | "cancelRequest"
  | "reapply" // 취소/재신청 (신청자 전용)
  | "suggestCancel" // 🆕 취소 권유 (처리자 → 신청자)
  | "accept"
  | "save"
  | "suggest"
  | "complete" // 처리 (운영)
  | "testRequest"
  | "testComplete" // 테스트 (확장)
  | "systemRequest"
  | "systemApprove"
  | "completeCust"; // 시스템이관 (확장)

function canDo(
  action: TicketAction,
  ticket: Ticket,
  user: User,
  config: CompanyConfig,
): boolean;
```

---

## 3. 구현 골격 — **기본은 차단**

```ts
const TERMINAL: ProgressCode[] = ["9", "11", "12"]; // 완료·취소·반려

function canDo(action, ticket, user, config): boolean {
  // ── 게이트 0: 입력이 불완전하면 차단 (fail-closed)
  if (!user?.id || !ticket?.progress) return false;

  // ── 게이트 1: 종료 상태에서는 재신청만 허용
  if (TERMINAL.includes(ticket.progress)) {
    return (
      action === "reapply" && isRequester(ticket, user) && isCustomer(user)
    );
  }

  // ── 게이트 2: 확장 경로가 꺼진 고객사면 관련 액션 전면 차단
  if (TEST_ACTIONS.includes(action) && !config.testYn) return false;
  if (SYSTEM_ACTIONS.includes(action) && !config.systemYn) return false;

  // ── 게이트 3: 처리자 액션은 운영시스템 담당 회사가 일치해야 함
  if (OPERATOR_ACTIONS.includes(action) && !canOperate(ticket, user))
    return false;

  // ── 액션별 규칙 (§4). 어디에도 해당 없으면 false
  return RULES[action]?.(ticket, user, config) ?? false;
}

const isCustomer = (u: User) => u.role === "CUSTOMER";
const isOperator = (u: User) => u.role === "INTERNAL" || u.role === "VENDOR";
const isRequester = (t: Ticket, u: User) =>
  !!t.custPerson && t.custPerson === u.id;

/** §1 협력업체 격리 — operCompany 가 비면 차단 */
const canOperate = (t: Ticket, u: User) =>
  isOperator(u) && !!t.operCompany && t.operCompany === u.companyCode;
```

> 마지막 줄의 `?? false` 가 이 설계의 핵심이다. **규칙에 없는 조합은 전부 거부**된다.

---

## 4. 액션별 규칙표

### 4-1. 신청자 측 (`CUSTOMER` 전용)

| 액션                     | 허용 상태     | 추가 조건                           |
| ------------------------ | ------------- | ----------------------------------- |
| `approve` / `rejectCust` | `1`           | `confYn && canApproveRequest`       |
| `cancel`                 | `1`, `2`      | `isRequester` 🔒                    |
| `cancelRequest`          | `3`           | `isRequester` 🔒                    |
| `testComplete`           | `5`           | `isRequester` · `config.testYn`     |
| `systemApprove`          | `7`           | §4-3 참조                           |
| `completeCust`           | `8`           | `systemSelfYn && user.systemSuccYn` |
| `reapply`                | `9`,`11`,`12` | `isRequester`                       |

> 🔒 **취소는 신청자 본인만 — 회사 정책 (변경 불가).** 처리자에게 부여하지 않는다.

### 4-2. 처리자 측 (`INTERNAL` | `VENDOR`, §1 격리 통과 필수)

| 액션               | 허용 상태 | 추가 조건                                    |
| ------------------ | --------- | -------------------------------------------- |
| `accept`           | `2`       | — (운영담당자만 접수)                        |
| `save`             | `3`~`8`   | 담당자 가드 §5                               |
| `suggest`          | `3`       |                                              |
| `complete`         | `4`       | `!config.testYn && !config.systemYn`         |
|                    | `6`       | `!config.systemYn`                           |
|                    | `8`       | `!systemSelfYn`                              |
| `testRequest`      | `4`       | `config.testYn`                              |
| `systemRequest`    | `4`       | `config.systemYn && !config.testYn`          |
|                    | `6`       | `config.systemYn`                            |
| `suggestCancel` 🆕 | `2`~`8`   | 알림만 발송. **실행 버튼은 신청자 화면에만** |

### 4-3. `systemApprove` — 분기 3갈래 (원본 L5561~5573)

```ts
if (ticket.systemSelfYn) return isCustomer(user) && user.systemAppYn; // 자체처리
if (ticket.confYn) return ticket.canApproveRequest; // 승인절차 사용
return isRequester(ticket, user); // 그 외 = 작성자
```

---

## 5. ⚠️ 원본의 fail-open 지점 — 정책 결정 필요

`isCurrentAssigneeLoginUser()` (`ST001.jsp:5924`)

```js
var detailAssignee = String(
  (currentDetail && currentDetail.succPerson) || "",
).trim();
if (!detailAssignee) return true; // ← 담당자 미배정이면 "본인"으로 통과
return detailAssignee === loginId;
```

담당자가 배정되지 않은 건은 **아무 처리자나 편집 가능**하다.
전역 fail-closed 원칙과 어긋나지만, **"미배정 건은 먼저 잡는 사람이 처리한다"는 의도**일 수 있다.

| 선택지                             | 결과                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| **A. 현행 유지** (미배정 = 누구나) | 운영 흐름 그대로. 단 §1 격리는 여전히 적용되므로 아무나가 아니라 **같은 운영회사 처리자만** |
| **B. fail-closed** (미배정 = 차단) | 배정 전에는 아무도 편집 불가 → 배정 액션이 별도로 필요해짐                                  |

> 🔴 **사용자 결정 필요.** §1 격리가 이미 걸려 있어 A 도 무방비는 아니다 — **A 권장**.
> 다만 명시적으로 정하고 주석에 근거를 남긴다.

담당자 가드 자체(`shouldLimitToAssigneeSave`)는 유지한다:

> 상태 `3`~`8` && 편집권한 있음 && 담당자가 본인이 아님 → **저장 외 액션 제한**

---

## 6. 상태 전이표 (canDo 와 짝을 이루는 순수 함수)

```
1 대기 ──approve──→ 2 신청 ──accept──→ 3 진행 ──suggest──→ 4 해결안제시
  │                    │                  │                     │
  ├─rejectCust→ 12     ├─cancel→ 11       ├─cancelRequest→ 10    ├─complete──→ 9 완료
  └─cancel────→ 11                                               ├─testRequest→ 5
                                                                 └─systemRequest→ 7
5 테스트요청 ──testComplete──→ 6 테스트완료 ──complete──→ 9
                                    └─systemRequest──→ 7
7 시스템이관요청 ──systemApprove──→ 8 시스템이관승인 ──complete/completeCust──→ 9
```

**실사용 (data-profile.md)**: 굵은 경로 `1→2→3→4→9` 가 99.9%.
`5·6` 은 전 기간 10건, **`7·8·10` 은 전 기간 0건**.
→ 5~8 전이는 구현하되 **기본 UI 에 노출하지 않는다** (고객사 플래그로만).

---

## 7. 테스트 케이스 (P6 에서 그대로 사용)

| #   | 시나리오                                            | 기대                    |
| --- | --------------------------------------------------- | ----------------------- |
| 1   | 신청자 본인, 상태 1, `cancel`                       | ✅                      |
| 2   | **처리자**, 상태 1, `cancel`                        | ❌ **정책상 영구 거부** |
| 3   | 처리자, 상태 2, `accept`, `operCompany === 내 회사` | ✅                      |
| 4   | 처리자, 상태 2, `accept`, `operCompany !== 내 회사` | ❌ 격리                 |
| 5   | 처리자, 상태 2, `accept`, `operCompany = null`      | ❌ **fail-closed**      |
| 6   | 상태 9(완료)에서 `save`                             | ❌ 종료 상태            |
| 7   | 상태 9, 신청자 본인, `reapply`                      | ✅                      |
| 8   | `config.testYn = false` 인데 `testRequest`          | ❌ 확장 경로 꺼짐       |
| 9   | `user.id` 없음 (비로그인)                           | ❌ 모든 액션            |
| 10  | 정의되지 않은 액션 문자열                           | ❌ `?? false`           |
| 11  | 고객사용자, 상태 1, `confYn=false` 인데 `approve`   | ❌                      |
| 12  | 상태 4, `testYn=false`·`systemYn=false`, `complete` | ✅                      |
| 13  | 상태 4, `testYn=true`, `complete`                   | ❌ (테스트 먼저)        |

---

## 8. 열린 항목

- [ ] §5 담당자 미배정 정책 — **A(현행 유지) 권장, 사용자 확정 필요**
- [ ] `canApproveRequest` 를 서버가 어떤 규칙으로 계산하는지 (BFF 가 그대로 전달만 하면 되는지)
- [ ] `suggestCancel`(취소 권유) 알림 채널 — 상태 10 재활용 여부 (P5)
