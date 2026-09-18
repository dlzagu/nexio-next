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
import { devWritesAllowed, select, writeDisabledReason } from "@/lib/db";
import { canDo, newRequestBlockedReason } from "@/lib/permissions";
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
  from: z.string().max(40).optional().default(""),
  attachments: attachmentsInputSchema,
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  // 외부업체는 배정받아 처리하는 쪽이지 신청 주체가 아니다 — 화면과 같은 허용 목록(fail-closed)
  const blocked = newRequestBlockedReason(user);
  if (blocked) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: blocked },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "BAD_REQUEST",
        message: parsed.error.issues[0]?.message,
        detail: parsed.error.issues,
      },
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

  /**
   * 🔒 비활성(거래 종료) 고객사는 신청을 받지 않는다 — 업무 등록 라우트와 **같은 기준**이다.
   *    비활성은 COMPANY_MST 만 바꾸므로 소속 계정·운영시스템은 그대로 살아 있다. 여기서 안 막으면
   *    화면 어디에도 없는 고객사(필터 목록에서 빠진다)로 티켓이 계속 쌓인다 (ADR-0010).
   */
  const company = await select<{ COMPANY_CODE: string }>(
    `SELECT COMPANY_CODE FROM COMPANY_MST
      WHERE COMPANY_CODE = @cc AND COALESCE(ACTIVE,'Y') = 'Y'`,
    [{ name: "cc", value: custCode }],
  );
  if (company.length === 0) {
    return NextResponse.json(
      {
        code: "INVALID_CUSTOMER",
        message: "거래가 종료된(비활성) 고객사라 신청을 받을 수 없습니다.",
      },
      { status: 400 },
    );
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
    /**
     * 🔒 볼 수 있다고 재신청할 수 있는 것은 아니다 — 재신청 규칙(canDo 'reapply': 종료건 ·
     *    고객사 · 신청자 본인)을 **서버가 다시** 판정한다. 화면만 이 규칙으로 버튼을 그리면
     *    진행 중인 건이나 동료의 건이 재신청 원본으로 연결돼 이력 링크가 틀어진다.
     *    운영팀의 대리 재신청은 규칙에 없으므로 거부다(fail-closed).
     */
    if (!canDo("reapply", parent, user)) {
      return NextResponse.json(
        {
          code: "INVALID_PARENT",
          message: "재신청은 종료된 요청의 신청자 본인만 할 수 있습니다.",
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
        message: `입력 검증과 권한 판정은 통과했습니다. ${writeDisabledReason()}`,
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
