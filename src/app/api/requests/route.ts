import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AttachmentError,
  decodeUploads,
  validateUploads,
  type IncomingFile,
} from "@/lib/data/attachments";
import { createTicket } from "@/lib/data/mutations";
import { getTicket } from "@/lib/data/tickets";
import { devWritesAllowed, select } from "@/lib/db";
import { attachmentsInputSchema, requestFormSchema } from "@/lib/schemas";
import { currentUser, loadCustomerConfig } from "@/lib/session";

/**
 * 신청 저장. 폼과 **같은 zod 스키마**로 검증한다 (컨벤션 — 한 스키마를 폼·BFF 가 공유).
 *
 * 🔒 클라이언트가 보낸 목록을 믿지 않는다. 고객사·신청자·운영시스템이 실제로 이어져 있는지
 *    서버가 다시 조회해 확인하고, 하나라도 어긋나면 거부한다 (fail-closed).
 *    Combobox 목록은 편의일 뿐 권한 경계가 아니다.
 */
const bodySchema = requestFormSchema.extend({
  /** 재신청 원본 접수번호 */
  from: z.string().optional().default(""),
  attachments: attachmentsInputSchema,
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  // 외부업체는 배정받아 처리하는 쪽이지 신청 주체가 아니다
  if (user.role === "VENDOR") {
    return NextResponse.json(
      {
        code: "FORBIDDEN",
        message: "외부업체 계정은 신청을 등록할 수 없습니다.",
      },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { code: "BAD_REQUEST", detail: parsed.error.issues },
      { status: 400 },
    );
  }
  const form = parsed.data;

  // 고객사 사용자는 폼 값과 무관하게 **본인 회사**로 고정된다
  const custCode =
    user.role === "INTERNAL" ? form.custCode.trim() : user.custCode;
  if (!custCode) {
    return NextResponse.json({ code: "NO_CUSTOMER" }, { status: 400 });
  }

  const requester = await select<{ MBER_ID: string }>(
    `SELECT MBER_ID FROM MEMBER_MST
      WHERE MBER_ID = @id AND COMPANY_CODE = @cc
        AND USER_TYPE = 'B0001_02' AND COALESCE(ACTIVE,'Y') = 'Y'`,
    [
      { name: "id", value: form.requesterId },
      { name: "cc", value: custCode },
    ],
  );
  if (requester.length === 0) {
    return NextResponse.json(
      {
        code: "INVALID_REQUESTER",
        message: "신청자가 해당 고객사 소속이 아닙니다.",
      },
      { status: 403 },
    );
  }

  const system = await select<{ OPER_SYS_ID: number }>(
    `SELECT OPER_SYS_ID FROM COMPANY_OPER_SYSTEM
      WHERE OPER_SYS_ID = @id AND COMPANY_CODE = @cc
        AND COALESCE(USE_YN,'Y') = 'Y' AND COALESCE(DEL_YN,'N') <> 'Y'`,
    [
      { name: "id", value: Number(form.systemId) },
      { name: "cc", value: custCode },
    ],
  );
  if (system.length === 0) {
    return NextResponse.json(
      {
        code: "INVALID_SYSTEM",
        message: "선택한 운영시스템이 해당 고객사의 것이 아닙니다.",
      },
      { status: 400 },
    );
  }

  // 재신청 원본은 **내가 볼 수 있는 건**이어야 한다 (getTicket 이 가시성 게이트를 지난다)
  let parentEchoNum: string | null = null;
  if (form.from.trim()) {
    const parent = await getTicket(form.from.trim(), user);
    if (!parent || parent.custCode !== custCode) {
      return NextResponse.json(
        {
          code: "INVALID_PARENT",
          message: "재신청 원본을 찾을 수 없습니다.",
        },
        { status: 400 },
      );
    }
    parentEchoNum = parent.echoNum;
  }

  let files: IncomingFile[] = [];
  try {
    files = decodeUploads(form.attachments);
    // 크기·형식 판정은 저장 직전에도 한 번 더 돈다(attachmentStatements) — 여기서는
    // **쓰기가 꺼져 있어도** 사용자가 잘못된 첨부를 미리 알 수 있게 먼저 던져 본다
    validateUploads(files);
  } catch (e) {
    if (e instanceof AttachmentError) {
      return NextResponse.json(
        { code: "INVALID_ATTACHMENT", message: e.message },
        { status: 400 },
      );
    }
    throw e;
  }

  if (!devWritesAllowed()) {
    return NextResponse.json(
      {
        code: "WRITE_DISABLED",
        message:
          "입력 검증과 권한 판정은 통과했지만, 데모 DB 쓰기가 잠겨 있어(ALLOW_DEV_WRITES=false) 저장되지 않았습니다.",
      },
      { status: 202 },
    );
  }

  const config = await loadCustomerConfig(custCode);
  const created = await createTicket(
    {
      custCode,
      requesterId: form.requesterId,
      systemId: form.systemId,
      title: form.title,
      symptom: form.symptom,
      content: form.content,
      moduleCode: form.moduleCode,
      priority: form.priority,
      scheDate: form.scheDate,
      isPublic: form.isPublic,
      refEmails: form.refEmails,
      files,
      parentEchoNum,
      // 미등록 고객사는 승인 단계를 쓰지 않는 것으로 본다 (loadCustomerConfig 가 null)
      usesApproval: config?.usesApproval ?? false,
    },
    user,
  );

  return NextResponse.json({ code: "CREATED", ...created }, { status: 201 });
}
