# 타입 · zod 스키마 명세

> `../inventory/schema.md`(VO 102필드) + `../inventory/data-profile.md`(코드 정본)에서 도출.
> **zod 스키마 하나를 폼 검증과 BFF 응답 검증에 함께 쓴다** — 원본이 둘로 갈라지지 않게.
> P6 구현 시 이 문서를 `src/types/` 로 옮긴다.

## 0. 원본 필드명 함정 — 여기서 전부 흡수한다

새 코드에는 **정규화된 이름만** 쓰고, 변환은 BFF 경계 한 곳에서만 한다.

| 원본                                         | 문제                                     | 새 이름                              |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| `CONTENT`                                    | 유일하게 전부 대문자                     | `content`                            |
| `echonum` (RequestVO) / `echoNum` (SearchVO) | **서로 다른 키인데 같은 값**             | `echoNum` 으로 통일                  |
| `serviceNo`                                  | `echonum` 과 동일값 (주석에 "화면용")    | **삭제**                             |
| `testYn` (RequestVO)                         | "이 건의 테스트 이관 여부"               | `ticket.testTransfer`                |
| `testYn` (AddInfoVO)                         | "고객사가 테스트 단계를 쓰는가"          | `config.usesTestStage`               |
| `progress` / `progressName` / `vProgress`    | 3중 상태 표현                            | `progress` 하나 (코드) + 라벨은 파생 |
| `UserType.EXTERNAL` = `B0001_02`             | 이름은 "외부"인데 실제는 **고객사 직원** | `CUSTOMER`                           |
| `UserType.EXTVENDOR` = `B0001_03`            | 외부업체 = **처리자 쪽**                 | `VENDOR`                             |

> 🔴 변환은 **BFF route handler 안에서만**. 컴포넌트가 원본 필드명을 보게 하지 않는다.
> 새어 나가면 두 이름이 코드베이스에 공존하게 되고, 그때부터 되돌릴 수 없다.

---

## 1. 코드 enum — DB 정본 하드코딩

`COMMON_CODE` 조회로 확정된 값이다 (`../inventory/data-profile.md`).
자주 바뀌지 않으므로 상수로 두되, **출처와 조회일을 주석에 남긴다.**

```ts
/** COMMON_CODE UPPER_CD='STEPSTAT' · 2026-07-30 실측 (12개, 13은 DB에 없음) */
export const PROGRESS = {
  "1": "대기",
  "2": "신청",
  "3": "진행",
  "4": "해결안제시",
  "5": "테스트요청",
  "6": "테스트완료",
  "7": "시스템이관요청",
  "8": "시스템이관승인",
  "9": "완료",
  "10": "취소요청",
  "11": "취소",
  "12": "반려",
} as const;
export type ProgressCode = keyof typeof PROGRESS;

/** 종료 상태 — 전체 폼이 잠긴다 (ST001.jsp:3082) */
export const TERMINAL_PROGRESS = [
  "9",
  "11",
  "12",
] as const satisfies readonly ProgressCode[];

/** 주 경로 — 실사용 99.9% */
export const MAIN_FLOW = ["1", "2", "3", "4", "9"] as const;

/** 확장 경로 — 고객사 플래그가 켜졌을 때만 (5·6 = 0.04%, 7·8·10 = 전 기간 0건) */
export const TEST_FLOW = ["5", "6"] as const;
export const SYSTEM_FLOW = ["7", "8"] as const;

/** B1GUBUN1 — 분야 (9) */
export const FIELD = {
  "0": "기타",
  "1": "SAP",
  "2": "WEB",
  "3": "RPA",
  "4": "HR",
  "5": "MES",
  "6": "SFA",
  "7": "POP",
  "9": "내부요청",
} as const;

/** B1GUBUN3 — 요청유형 (8) */
export const REQUEST_TYPE = {
  "1": "분석/가이드",
  "2": "오류수정",
  "3": "기능보완",
  "4": "데이터처리",
  "5": "문의상담",
  "6": "추가개발",
  "7": "장애",
  "8": "기타",
} as const;

/** B1GUBUN2 — 모듈 (26). 개수가 많아 Combobox 로 검색 선택 */
export const MODULE = {
  "1": "운영관리",
  "2": "재무관리",
  "3": "관리회계",
  "4": "전자세금계산서",
  "5": "고정자산",
  "6": "예산관리",
  "7": "판매관리",
  "8": "구매관리",
  "9": "BP관리",
  "10": "자금관리",
  "11": "재고관리",
  "12": "품질관리",
  "13": "생산관리",
  "14": "서비스관리",
  "15": "인사관리",
  "16": "경영계획",
  "17": "세무관리",
  "18": "서버관리",
  "19": "시스템관리",
  "20": "경비관리",
  "21": "WMS",
  "22": "MES",
  "23": "GW",
  "24": "기타IF",
  "25": "HR",
  "26": "CMS",
} as const;
```

> ⚠️ **구시스템 이관분은 코드가 아니라 한글 원문**이 들어 있는 행이 있다
> (`'재무관리'` 가 `MODULE` 값 자체로). 매핑 실패 시 **원문을 그대로 표시**하고 빈칸으로 두지 않는다.
> → `labelOf(map, raw)` 헬퍼: `map[raw] ?? raw`

---

## 2. 날짜 — 이상치를 타입 레벨에서 다룬다

실측: `1900-01-01` 계열 **1,252건**(구시스템 이관분 날짜 누락), 미래 **3건**(최대 `2105-07-22`).

```ts
/** 원본 날짜는 전부 string (LocalDateTime 은 reqDateTime 하나뿐) */
export const zLooseDate = z.string().nullable().transform(toValidDate);

const MIN = new Date("2015-01-01");
const MAX = new Date(new Date().getFullYear() + 2, 11, 31);

/** 범위 밖이면 null — 화면에서 "-" 로 표시하고 정렬 시 최후위 */
function toValidDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime()) || d < MIN || d > MAX) return null;
  return d;
}
```

> 신청 화면의 희망완료일에는 **상한 검증**(오늘+2년)을 넣는다 — 2105년이 다시 들어오지 않게.

---

## 3. 도메인 타입

`schema.md` 의 17그룹을 **탭 구조와 같은 모양**으로 중첩한다.
102개를 평면으로 두면 원본과 똑같아진다.

```ts
export interface Ticket {
  // 식별 (그룹 A) — 화면에 안 보임
  echoNum: string;
  custCode: string;
  year: string;
  month: string;
  lineSeq: number;

  // 요약 — 목록 컬럼 7개가 여기서 나온다
  title: string;
  progress: ProgressCode;
  custName: string;
  succPersonName: string | null;
  reqDate: Date | null;
  priority: string; // reqLevel
  hasUnreadComment: boolean; // newCommentYn

  request: RequestDetail; // 그룹 B·C·D·E·F·L → "요청내용" 탭
  solution: SolutionDetail; // 그룹 H·K       → "처리결과" 탭
  history: HistoryDetail; // 그룹 G·M·I·J·O → "이력" 탭
  attachments: AttachFile[]; // 그룹 N

  // 권한 판정 입력 (permissions-spec.md §2)
  custPerson: string;
  succPerson: string | null;
  operCompany: string | null;
  confYn: boolean;
  canApproveRequest: boolean;
  systemSelfYn: boolean;
  systemBy: "1" | "2";
}

export interface SolutionDetail {
  // 고객이 실제 읽는 부분 — 상세의 주인공
  cause: string;
  process: string;
  improvement: string;
  answer: string;
  result: string;
  devReason: string;
  devContent: string;
  okRemarks: string;
  expeTime: number | null;
  workTime: number | null;
  rWorkTime: number | null;
  surTime: number | null;
  surCharge: string | null;
}
```

> `SolutionDetail` 의 텍스트 7종은 **전부 HTML** 이다 → 렌더 시 DOMPurify 필수 (§5).
> 원본 라벨은 `OK_SECTION_LABEL`(`ST001.jsp:2259`): 원인·해결과정·개선사항·답변·결과·개발사유·개발내용

---

## 4. zod — 폼과 응답에 같은 스키마

### 4-1. 신청 폼 (검증 8단계를 스키마로)

`ST002.jsp:2098~2144` 의 순차 alert 을 그대로 옮긴다. **순서까지 보존**해야 제출 시 첫 오류 필드로
스크롤하는 동작이 원본과 같아진다.

```ts
export const requestFormSchema = z.object({
  custCode: z.string().min(1, "고객사를 선택해 주세요"),
  custPerson: z.string().min(1, "신청자를 선택해 주세요"),
  custMberEmail: z.string().email("신청자 이메일을 먼저 등록해 주세요"), // ← §4-2
  field: z.string().min(1, "분야를 선택해 주세요"),
  title: z.string().min(1, "제목을 입력해 주세요").max(200),
  symptom: z.string().min(1, "증상을 입력해 주세요"),
  content: z.string().min(1, "요청내용을 입력해 주세요"),

  module: z.string().optional(),
  requestType: z.string().optional(),
  priority: z.string().optional(),
  scheDate: z
    .date()
    .max(addYears(new Date(), 2), "희망일이 너무 멉니다")
    .nullable(),
  publicYn: z.boolean().default(false),
  refEmails: z.array(z.string().email()).default([]),
});
export type RequestForm = z.infer<typeof requestFormSchema>;
```

### 4-2. ⚠️ 이메일은 인라인 오류로 처리하지 않는다

`custMberEmail` 은 **이 화면에서 사용자가 고칠 수 없다** (회원정보에 등록돼 있어야 함).
zod 에는 넣되, **UI 는 차단 배너 + 등록 화면 링크**로 렌더한다.
필드 아래 빨간 글씨를 띄우면 사용자가 그 칸을 고치려 들지만 입력칸 자체가 없다.

### 4-3. BFF 응답 검증

```ts
/** 원본 응답 → 정규화. 이름 변환은 여기 한 곳에서만 (§0) */
export const ticketResponseSchema = z
  .object({
    echonum: z.string(), // 원본 소문자 n
    CONTENT: z.string().nullable(), // 원본 대문자
    progress: z.enum(
      Object.keys(PROGRESS) as [ProgressCode, ...ProgressCode[]],
    ),
    reqDate: zLooseDate,
    // …
  })
  .transform(
    (raw) =>
      ({
        echoNum: raw.echonum,
        content: raw.CONTENT ?? "",
        progress: raw.progress,
        reqDate: raw.reqDate,
        // …
      }) satisfies Partial<Ticket>,
  );
```

> `z.enum(PROGRESS keys)` 라서 **DB 에 새 상태가 생기면 파싱이 실패**한다.
> 조용히 통과시키는 것보다 낫다 — 실패 시 로그를 남기고 해당 건만 스킵한다 (전체 목록을 죽이지 않는다).

---

## 5. 🔴 HTML 새니타이즈 — 타입으로 강제한다

기존 2.3만 건이 HTML 로 저장돼 있다 (`<p>…</p>`, 실측).
**`dangerouslySetInnerHTML` 을 날것으로 쓰지 못하게 타입으로 막는다.**

```ts
/** 새니타이즈를 통과한 HTML 만 이 타입이 된다 */
export type SafeHtml = string & { readonly __brand: 'SafeHtml' }

export function sanitize(raw: string | null | undefined): SafeHtml {
  return DOMPurify.sanitize(raw ?? '', {
    ALLOWED_TAGS: ['p','br','strong','em','u','s','ul','ol','li',
                   'a','img','table','thead','tbody','tr','td','th','code','pre','blockquote'],
    ALLOWED_ATTR: ['href','src','alt','title','target','rel'],
  }) as SafeHtml
}

// 렌더 컴포넌트는 SafeHtml 만 받는다 → 우회하려면 캐스팅이 필요해 코드리뷰에서 잡힌다
export function RichText({ html }: { html: SafeHtml }) { … }
```

적용 대상: `SolutionDetail` 텍스트 7종 · `request.content` · 댓글 본문.

---

## 6. 열린 항목

- [ ] `reqLevel`(우선순위) 코드 목록 — `COMMON_CODE` 에서 미확인. 넥시오 MCP 로 조회 가능
- [ ] `media` · `reqType` 의 코드 체계 (`B1GUBUN3` 와 별개인지)
- [ ] `dept`(부서) 코드 — 대시보드 필터용
- [ ] Tiptap 이 기존 summernote HTML 을 손실 없이 읽는지 실데이터 검증 (P5)
