import { z } from "zod";
import { MAX_FILES, MAX_FILE_BYTES } from "./attachments";

/**
 * 폼 검증과 BFF 응답 검증에 **같은 스키마**를 쓴다.
 * 원본은 순차 alert 8단계였다 — 순서를 보존해야 제출 시 첫 오류 필드로
 * 스크롤하는 동작이 기존과 같아진다.
 */

const MAX_SCHE = new Date(new Date().getFullYear() + 2, 11, 31);

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
  symptom: z.string().min(1, "증상을 입력해 주세요"),
  content: z.string().min(1, "요청내용을 입력해 주세요"),

  moduleCode: z.string().optional().default(""),
  priority: z.string().optional().default("3"),
  scheDate: z
    .string()
    .optional()
    .default("")
    .refine(
      (v) => !v || new Date(v) <= MAX_SCHE,
      // 실측 미래 이상치 3건(최대 2105-07-22) 재발 방지
      "희망 완료일이 너무 멉니다 (2년 이내로 선택해 주세요)",
    ),
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
  .optional()
  .default([]);

export type AttachmentInput = z.output<typeof attachmentInputSchema>;

export const commentSchema = z.object({
  echoNum: z.string().min(1),
  body: z.string().min(1, "댓글 내용을 입력해 주세요").max(4000),
  adminOnly: z.boolean().default(false),
});

/** 처리결과 편집 폼의 전송 형태. 시간은 빈 문자열 허용(미입력) */
export const solutionPatchSchema = z.object({
  cause: z.string().default(""),
  process: z.string().default(""),
  improvement: z.string().default(""),
  answer: z.string().default(""),
  result: z.string().default(""),
  devReason: z.string().default(""),
  devContent: z.string().default(""),
  expeTime: z.string().default(""),
  workTime: z.string().default(""),
  rWorkTime: z.string().default(""),
  surTime: z.string().default(""),
});

export type SolutionPatch = z.output<typeof solutionPatchSchema>;

export const actionSchema = z.object({
  echoNum: z.string().min(1),
  solution: solutionPatchSchema.optional(),
  comment: z
    .object({
      body: z.string().default(""),
      adminOnly: z.boolean().default(false),
      attachments: attachmentsInputSchema,
    })
    .optional(),
  action: z.enum([
    "approve",
    "reject",
    "cancel",
    "cancelRequest",
    "suggestCancel",
    "receive",
    "save",
    "propose",
    "complete",
    "testComplete",
    "reapply",
    "comment",
  ]),
  reason: z.string().optional().default(""),
});
