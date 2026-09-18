import { z } from "zod";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "./attachments";
import { josa, todaySeoul } from "./format";
import type { TicketAction } from "./types";

/** 오늘(벽시계). UTC 로 재면 밤에 하루가 밀려 어제 끝낸 일이 "미래"가 된다 */
const todayWallClock = () => todaySeoul();

/**
 * 쓰기 본문의 길이 상한 — 화면과 라우트가 **같은 값**을 본다.
 *
 * 🔴 상한이 없으면 한 요청에 수 MB 짜리 글이 그대로 쌓이고, 목록·알림 미리보기가 그 행을
 *    읽을 때마다 느려진다(공유 DB 는 무료 티어 한도에 먼저 닿는다). 예전엔 댓글 한도(4000)를
 *    정의만 해 두고 실제 전송 스키마에는 걸지 않아 **죽은 규칙**이었다.
 *
 * 서식 편집기에서 오는 칸(댓글·처리내역)은 **보이는 글자** 기준으로 센다 — 문단마다
 * `<p></p>` 가 붙어 원문 길이로 세면 로그 몇십 줄만 붙여도 한도에 걸린다. 대신 태그까지 포함한
 * 원문도 RICH_MARKUP_RATIO 배까지만 받는다(태그로 부풀린 본문을 막는 바깥 울타리).
 */
export const TEXT_LIMITS = {
  /** 댓글 — 보이는 글자 */
  comment: 4000,
  /** 처리내역 각 항목(원인·답변 …) — 보이는 글자 */
  solution: 20000,
  /** 신청 증상·요청내용, 업무 내용·처리 내용 — 평문 */
  body: 20000,
  /** 반려·계속 진행·취소 권유 사유 — 평문 */
  reason: 1000,
} as const;
const RICH_MARKUP_RATIO = 4;

/** 서식 태그를 걷어낸 글자 수 — 사용자가 화면에서 보는 길이 */
const visibleLength = (html: string) => html.replace(/<[^>]*>/g, "").length;

const limitMessage = (label: string, limit: number) =>
  `${josa(label, "은/는")} ${limit.toLocaleString("ko-KR")}자까지 입력할 수 있습니다`;

/** 서식 편집기에서 오는 HTML 칸 */
const richText = (label: string, limit: number) =>
  z
    .string()
    .max(
      limit * RICH_MARKUP_RATIO,
      `${label}의 서식이 너무 깁니다 — 붙여 넣은 서식을 줄여 주세요`,
    )
    .refine((v) => visibleLength(v) <= limit, limitMessage(label, limit));

/** 평문 칸 */
const plainText = (label: string, limit: number) =>
  z.string().max(limit, limitMessage(label, limit));

/**
 * 날짜 칸의 형식. 🔴 정규식 없이 문자열 비교만 하면 `2026-08-01T00:00:00Z` 같은 값이
 * 그대로 통과해 DB 에 `"2026-08-01T00:00:00Z 00:00:00"` 이 저장된다 — 날짜 칸이
 * 영원히 '-' 로 보이고 되돌릴 방법이 없다. 폼은 <input type="date"> 라 안전하지만
 * **신뢰 경계는 스키마**다 (API 를 직접 부르면 무엇이든 올 수 있다).
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 화면이 그릴 수 있는 하한 (format.ts MIN_DATE) — 이보다 옛날은 표시가 '-' 가 된다 */
const MIN_DATE_STR = "2015-01-01";

/**
 * 폼 검증과 BFF 응답 검증에 **같은 스키마**를 쓴다.
 * 원본은 순차 alert 8단계였다 — 순서를 보존해야 제출 시 첫 오류 필드로
 * 스크롤하는 동작이 기존과 같아진다.
 */

const MAX_SCHE = new Date(new Date().getFullYear() + 2, 11, 31);

/**
 * 희망 완료일. 신청 폼과 업무 등록이 **같은 규칙**을 본다 —
 * 한쪽만 열어 두면 그쪽으로 이상치가 들어온다.
 */
const scheDateField = z
  .string()
  .optional()
  .default("")
  // 형식을 먼저 고정한다 — `2026-08-01T00:00:00Z` 는 아래 범위 비교를 통과해 버린다
  .refine((v) => !v || DATE_ONLY.test(v), "날짜 형식이 올바르지 않습니다")
  .refine(
    (v) => !v || new Date(v) <= MAX_SCHE,
    // 실측 미래 이상치 3건(최대 2105-07-22) 재발 방지
    "희망 완료일이 너무 멉니다 (2년 이내로 선택해 주세요)",
  );

export const requestFormSchema = z.object({
  custCode: z.string().min(1, "고객사를 선택해 주세요"),
  requesterId: z.string().min(1, "신청자를 선택해 주세요"),
  // 이 화면에서 고칠 수 없는 값이라 UI 는 인라인 오류가 아니라 차단 배너로 렌더한다
  requesterEmail: z.string().email("신청자 이메일을 먼저 등록해 주세요"),
  systemId: z.string().min(1, "운영시스템을 선택해 주세요"),
  title: z
    .string()
    .min(1, "제목을 입력해 주세요")
    .max(150, "제목은 150자까지 입력할 수 있습니다"),
  symptom: plainText("증상", TEXT_LIMITS.body).min(1, "증상을 입력해 주세요"),
  content: plainText("요청내용", TEXT_LIMITS.body).min(
    1,
    "요청내용을 입력해 주세요",
  ),

  moduleCode: z.string().optional().default(""),
  priority: z.string().optional().default("3"),
  scheDate: scheDateField,
  isPublic: z.boolean().default(false),
  refEmails: z
    .array(z.string().email("이메일 형식이 올바르지 않습니다"))
    .default([]),
});

export type RequestForm = z.input<typeof requestFormSchema>;
export type RequestFormParsed = z.output<typeof requestFormSchema>;

/** 필수 필드 검사 순서 — 제출 시 첫 오류로 스크롤하는 기준 */
export const REQUIRED_ORDER: (keyof RequestFormParsed)[] = [
  "custCode",
  "requesterId",
  "requesterEmail",
  "systemId",
  "title",
  "symptom",
  "content",
];

/**
 * 첨부 전송 형태 — 파일 바이트를 base64 로 실어 **본문과 한 요청에** 보낸다.
 * multipart 로 나누면 "신청은 저장됐는데 첨부만 실패"가 생긴다 (ADR-0008).
 * 크기·형식의 최종 판정은 서버가 디코드한 실제 바이트로 다시 한다.
 */
export const attachmentInputSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  // base64 는 원본의 약 4/3 — 여유를 두고 자른다 (여기서 막히면 페이로드 자체를 안 읽는다)
  data: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_FILE_BYTES * 1.4)),
});

export const attachmentsInputSchema = z
  .array(attachmentInputSchema)
  .max(MAX_FILES)
  // 합계도 인코딩된 길이로 먼저 자른다 — 디코드해서 재기 전에 본문을 통째로 올리지 않게
  // (최종 판정은 서버가 디코드한 실제 바이트로 다시 한다: validateUploads)
  .refine(
    (files) =>
      files.reduce((n, f) => n + f.data.length, 0) <=
      Math.ceil(MAX_TOTAL_BYTES * 1.4),
    "첨부 합계가 너무 큽니다",
  )
  .optional()
  .default([]);

export type AttachmentInput = z.output<typeof attachmentInputSchema>;

/** 처리결과 편집 폼의 전송 형태. 시간은 빈 문자열 허용(미입력) */
export const solutionPatchSchema = z.object({
  cause: richText("원인", TEXT_LIMITS.solution).default(""),
  process: richText("해결 과정", TEXT_LIMITS.solution).default(""),
  improvement: richText("개선 사항", TEXT_LIMITS.solution).default(""),
  answer: richText("답변", TEXT_LIMITS.solution).default(""),
  result: richText("결과", TEXT_LIMITS.solution).default(""),
  devReason: richText("개발 사유", TEXT_LIMITS.solution).default(""),
  devContent: richText("개발 내용", TEXT_LIMITS.solution).default(""),
  expeTime: z.string().max(20).default(""),
  workTime: z.string().max(20).default(""),
  rWorkTime: z.string().max(20).default(""),
  surTime: z.string().max(20).default(""),
});

export type SolutionPatch = z.output<typeof solutionPatchSchema>;

/**
 * 접수(receive) 시 담당자가 확정하는 분류.
 *
 * 고객은 운영시스템·모듈을 모르는 경우가 많아 **빈 값이나 잘못된 값으로 들어온다** —
 * 접수하는 담당자가 그 자리에서 바로잡는다. 예상 시간·예상 처리일도 여기서 잡는다.
 * 빈 문자열은 "안 건드림"이다 (지우기가 아니라 유지).
 */
export const triageSchema = z.object({
  systemId: z.string().optional().default(""),
  moduleCode: z.string().optional().default(""),
  /** 예상 처리 시간(h). 소수 허용 */
  expeTime: z.string().optional().default(""),
  /** 예상 처리일 (YYYY-MM-DD). 형식을 안 막으면 그대로 이어 붙여 저장된다 */
  scheDate: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || DATE_ONLY.test(v), "날짜 형식이 올바르지 않습니다"),
});

export type Triage = z.output<typeof triageSchema>;

export const actionSchema = z.object({
  triage: triageSchema.optional(),
  echoNum: z.string().min(1),
  solution: solutionPatchSchema.optional(),
  comment: z
    .object({
      body: richText("댓글", TEXT_LIMITS.comment).default(""),
      adminOnly: z.boolean().default(false),
      attachments: attachmentsInputSchema,
    })
    .optional(),
  /**
   * 🔴 TicketAction 과 **같은 목록**이어야 한다. 취소요청(10)의 두 출구(cancelApprove·
   *    cancelDeny)가 빠져 있어, 전이표·canDo·보드는 다 준비돼 있는데 라우트만 400 을 돌려
   *    '취소 승인'·'계속 진행' 버튼이 눌러도 안 되는 버튼이었다.
   */
  action: z.enum([
    "approve",
    "reject",
    "cancel",
    "cancelRequest",
    "cancelApprove",
    "cancelDeny",
    "suggestCancel",
    "receive",
    "save",
    "propose",
    "complete",
    "testComplete",
    "reapply",
    "comment",
  ]),
  reason: plainText("사유", TEXT_LIMITS.reason).optional().default(""),
});

/** 🔒 액션 목록이 TicketAction 과 어긋나면 **컴파일이 깨진다** — 위 누락의 재발 방지 */
const actionListCoversAll: [
  Exclude<TicketAction, z.output<typeof actionSchema>["action"]>,
] extends [never]
  ? true
  : never = true;
void actionListCoversAll;

/** 알림 읽음 처리. 본문이 없으면 '모두 읽음'이다 */
export const notificationReadSchema = z
  .object({ echoNum: z.string().trim().min(1).max(40).optional() })
  .nullable()
  .transform((v): { echoNum?: string } => v ?? {});

/** 고객사 등록 폼 — 화면과 라우트가 같은 스키마를 본다 */
export const newCustomerSchema = z.object({
  custCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{3,10}$/, "고객사 코드는 영문·숫자 3~10자입니다"),
  custName: z.string().trim().min(1, "고객사명을 입력해 주세요").max(60),
  systemName: z.string().trim().max(40).optional().default(""),
  usesApproval: z.boolean().optional().default(false),
  usesTestStage: z.boolean().optional().default(false),
  usesSystemStage: z.boolean().optional().default(false),
  defaultPrivate: z.boolean().optional().default(true),
  showsContractTime: z.boolean().optional().default(false),
});

export type NewCustomerForm = z.input<typeof newCustomerSchema>;

/* ── 업무 등록(대리 등록) ─────────────────────────────────── */

/**
 * 운영팀이 고객사 대신 넣는 건. 신청 폼과 **다른 스키마**인 이유는 두 가지다.
 *   · 신청자가 없을 수 있다 — 정기 백업·패치는 고객사가 발의하지 않는다
 *   · 출처(전화·메일·내부)를 반드시 남긴다 — 포털로 들어온 것처럼 보이면 안 된다
 * 화면과 라우트가 이 하나를 공유한다(컨벤션).
 */
export const taskIntakeSchema = z
  .object({
    kind: z.enum(["phone", "email", "routine", "patch", "other"]),
    custCode: z.string().min(1, "고객사를 선택해 주세요"),
    systemId: z.string().min(1, "운영시스템을 선택해 주세요"),
    title: z
      .string()
      .min(1, "제목을 입력해 주세요")
      .max(150, "제목은 150자까지 입력할 수 있습니다"),
    content: plainText("업무 내용", TEXT_LIMITS.body).min(
      1,
      "업무 내용을 입력해 주세요",
    ),
    /** 비우면 등록한 사람이 신청자가 된다 (고객사가 발의하지 않은 업무) */
    requesterId: z.string().optional().default(""),
    moduleCode: z.string().optional().default(""),
    priority: z.string().optional().default("3"),
    scheDate: scheDateField,
    /**
     * 등록 시점의 처리 단계. 현업은 **끝난 뒤에 적기도 한다** —
     * 전화로 받아 그 자리에서 처리하고 나중에 기록하는 경우가 흔하다.
     *   2 신청(접수 전, 담당 없음) · 3 진행(내 담당) · 4 해결안 제시 · 9 완료
     * 값은 상태 코드 그대로 쓴다 — 화면·DB·전이표가 같은 어휘를 보게 한다.
     */
    stage: z.enum(["2", "3", "4", "9"]).default("3"),
    /**
     * 처리 내용(답변). 해결안 제시·완료로 등록할 때 **필수**다.
     * 그 단계부터 고객 화면은 '처리결과' 탭이 기본으로 열리는데, 비어 있으면 빈 화면이 뜬다
     * (전이표의 requires 와 같은 규칙 — 상태만 바꾸는 전이는 허용하지 않는다).
     */
    answer: plainText("처리 내용", TEXT_LIMITS.body).optional().default(""),
    /** 완료일. 비우면 오늘. 이미 끝난 건을 나중에 적는 경우가 있어 과거를 받는다 */
    doneDate: z.string().optional().default(""),
    /** 실제 작업 시간(h). 선택 */
    workTime: z.string().optional().default(""),
    /** 매월 반복 업무로도 저장할지 */
    repeatMonthly: z.boolean().default(false),
    /**
     * 매월 며칠 기준인가.
     * ⚠️ 28일까지만 받는다 — 29~31 을 허용하면 2월이 없는 달이 되어
     *    "이번 달에는 안 생기는 정기 업무"가 조용히 만들어진다.
     */
    repeatDay: z.coerce
      .number({ message: "반복 기준일을 숫자로 적어 주세요" })
      .int("반복 기준일은 하루 단위로 적어 주세요")
      .min(1, "반복 기준일은 1일부터 고를 수 있습니다")
      // 영어 기본 문구가 새어 나가지 않게 직접 적는다 — 이 앱은 한국어 전용이다
      .max(28, "반복 기준일은 28일까지입니다 (29~31일은 없는 달이 생깁니다)")
      .default(1),
  })
  /**
   * 단계에 따라 **필요한 입력이 달라진다.** 전이표(mutations.ts TRANSITIONS)가
   * 액션마다 requires 를 쥐고 있는 것과 같은 축이다 — 여기서 막지 않으면
   * 처리결과 탭이 기본으로 열리는 단계인데 내용이 없는 티켓이 만들어진다.
   */
  .superRefine((v, ctx) => {
    if ((v.stage === "4" || v.stage === "9") && !v.answer.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["answer"],
        message:
          v.stage === "9"
            ? "완료로 등록하려면 처리 내용을 적어야 합니다"
            : "해결안 제시로 등록하려면 답변을 적어야 합니다",
      });
    }
    if (v.stage === "9" && v.doneDate) {
      if (!DATE_ONLY.test(v.doneDate)) {
        ctx.addIssue({
          code: "custom",
          path: ["doneDate"],
          message: "완료일은 YYYY-MM-DD 형식이어야 합니다",
        });
      } else if (v.doneDate < MIN_DATE_STR) {
        // 화면이 '-' 로 그리는 날짜를 저장하면 사용자는 완료일이 사라진 것으로 본다
        ctx.addIssue({
          code: "custom",
          path: ["doneDate"],
          message: "완료일이 너무 과거입니다 (2015-01-01 이후)",
        });
      } else if (v.doneDate > todayWallClock()) {
        // 미래 완료일은 사실이 아니다 — 아직 끝나지 않은 일을 끝났다고 적는 것
        ctx.addIssue({
          code: "custom",
          path: ["doneDate"],
          message: "완료일이 오늘보다 뒤일 수 없습니다",
        });
      }
    }
    if (v.workTime.trim() && !/^\d{1,3}(\.\d{1,2})?$/.test(v.workTime.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["workTime"],
        message: "작업 시간은 숫자로 적어 주세요 (예: 1.5)",
      });
    }
  });

export type TaskIntakeForm = z.input<typeof taskIntakeSchema>;
export type TaskIntakeParsed = z.output<typeof taskIntakeSchema>;

/** 업무 등록 폼의 필수 검사 순서 — 제출 시 첫 오류로 스크롤하는 기준 */
export const TASK_REQUIRED_ORDER: (keyof TaskIntakeParsed)[] = [
  "custCode",
  "systemId",
  "title",
  "content",
  // 단계에 따라 필수가 되는 것들 — 요약 배너가 이유를 함께 보여준다
  "answer",
  "doneDate",
  "workTime",
  "repeatDay",
];

/** 정기 업무 템플릿 비활성 — 목록에서 내리는 것만 한다(행은 남긴다) */
export const templatePatchSchema = z.object({
  id: z.coerce.number().int().positive(),
  active: z.boolean(),
});
