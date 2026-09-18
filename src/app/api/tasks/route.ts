import { NextResponse } from "next/server";
import { INTAKE } from "@/lib/codes";
import { createTicket } from "@/lib/data/mutations";
import { currentYm, insertTemplate } from "@/lib/data/tasks";
import { devWritesAllowed, select, writeDisabledReason } from "@/lib/db";
import { toDbStamp, todaySeoul } from "@/lib/format";
import { canCreateTask, taskIntakeHint } from "@/lib/permissions";
import { taskIntakeSchema } from "@/lib/schemas";
import { currentUser } from "@/lib/session";

/**
 * 업무 등록 — 운영팀이 고객사 대신 넣는 건.
 *
 * 신청 라우트(`/api/requests`)와 나눈 이유: 신청자가 없을 수 있고(정기 백업·패치),
 * 출처(전화·메일·내부)를 반드시 남겨야 한다. 한 라우트에 두 폼을 섞으면
 * "신청자 없이도 통과하는 신청 경로"가 생겨 원래 규칙이 흐려진다.
 *
 * 🔒 검증은 신청 라우트와 **같은 축**이다 — 고객사·운영시스템·신청자가 실제로
 *    이어져 있는지 서버가 다시 조회해 확인하고, 어긋나면 거부한다(fail-closed).
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  if (!canCreateTask(user)) {
    return NextResponse.json(
      {
        code: "FORBIDDEN",
        message: taskIntakeHint(user) ?? "권한이 없습니다.",
      },
      { status: 403 },
    );
  }

  const parsed = taskIntakeSchema.safeParse(await req.json().catch(() => null));
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
  const kind = INTAKE[form.kind];
  const custCode = form.custCode.trim();

  const company = await select<{ COMPANY_CODE: string }>(
    `SELECT COMPANY_CODE FROM COMPANY_MST
      WHERE COMPANY_CODE = @cc AND COALESCE(ACTIVE,'Y') = 'Y'`,
    [{ name: "cc", value: custCode }],
  );
  if (company.length === 0) {
    return NextResponse.json(
      { code: "INVALID_CUSTOMER", message: "고객사를 찾을 수 없습니다." },
      { status: 400 },
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

  /**
   * 신청자는 **선택**이다. 전화·메일로 온 건은 문의한 사람을 지정하고,
   * 우리가 발의한 정기 작업은 비운다 — 그 경우 등록한 사람이 신청자가 된다.
   *
   * ⚠️ 비우면 고객사 화면에는 보이지 않는다(비공개 + CUSTPERSON 이 우리 쪽).
   *    화면이 그 사실을 미리 알려 준다 — 조용히 숨기면 "등록했는데 고객이 못 본다"가 된다.
   */
  const requesterId = form.requesterId.trim();
  if (requesterId) {
    const requester = await select<{ MBER_ID: string }>(
      `SELECT MBER_ID FROM MEMBER_MST
        WHERE MBER_ID = @id AND COMPANY_CODE = @cc
          AND USER_TYPE = 'B0001_02' AND COALESCE(ACTIVE,'Y') = 'Y'`,
      [
        { name: "id", value: requesterId },
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

  const ym = currentYm();
  /**
   * 접수 이후 단계(3·4·9)는 담당이 있어야 한다 — 없으면 다음 액션이 전부
   * '담당자만' 조건에 걸려 아무도 손댈 수 없는 티켓이 된다. 신청(2)만 무담당으로 둔다.
   */
  const assignTo = form.stage === "2" ? null : user.id;
  /**
   * 🔴 단계에 맞지 않는 입력은 **서버가 버린다.**
   *
   * 화면은 단계를 바꾸면 칸을 감출 뿐 값을 지우지 않는다 — 완료로 적다가 진행으로
   * 되돌리면 답변·완료일이 그대로 실려 온다. 그대로 저장하면 진행(3) 인데 처리결과가
   * 채워진 티켓이 생겨, 전이표가 지키던 "해결안 없이 다음 단계로 못 간다"가 무의미해진다.
   * 화면도 지우게 고쳤지만(TaskSheet), 신뢰 경계는 여기다.
   */
  const answer = form.stage === "4" || form.stage === "9" ? form.answer : "";
  const workTime =
    form.stage === "9" && form.workTime.trim() ? Number(form.workTime) : null;
  /**
   * 완료 시각은 **한 시계에서만** 만든다.
   * 날짜(KST)와 시각(서버 로컬=UTC)을 섞으면 KST 새벽에 완료일이 접수일보다 하루 뒤,
   * 심지어 미래로 찍힌다(실측). 날짜를 안 고르거나 **오늘**을 고르면 아예 넘기지 않아
   * createTicket 이 접수 시각(REQDATE)과 같은 값을 쓰게 한다 — 오늘 끝낸 일을 오늘 0시로
   * 끌어내리지 않는다.
   *
   * 지난 날짜면 그날 0시가 완료일이 되고, 신청일도 그날로 맞춰진다(createTicket —
   * 끝낸 날보다 늦게 받았다고 적으면 완료일 < 신청일 모순이 된다).
   */
  const doneAt =
    form.stage === "9" && form.doneDate && form.doneDate < todaySeoul()
      ? `${form.doneDate} 00:00:00`
      : undefined;

  const created = await createTicket(
    {
      custCode,
      requesterId: requesterId || user.id,
      systemId: form.systemId,
      title: form.title,
      // 업무 등록에는 '증상'을 따로 받지 않는다 — 받아 적는 사람이 이미 정리해서 쓴다
      symptom: "",
      content: form.content,
      moduleCode: form.moduleCode,
      priority: form.priority,
      scheDate: form.scheDate,
      isPublic: false,
      refEmails: [],
      files: [],
      parentEchoNum: null,
      // 대리 등록은 승인 줄에 세우지 않는다 (createTicket 의 intake 주석)
      usesApproval: false,
      intake: {
        media: kind.media,
        reqType: kind.reqType,
        stage: form.stage,
        assignTo,
        assignToName: assignTo ? user.name : null,
        sourceLabel: kind.label,
        answer,
        doneAt,
        // 빈 문자열은 "안 적었다"이지 0시간이 아니다
        workTime,
      },
      /**
       * 반복 등록은 티켓과 **한 트랜잭션**이다. 나눠 커밋하면 티켓만 생기고
       * 다음 달이 조용히 비는데, 등록한 사람은 등록됐다고 믿는다.
       * 방금 만든 건의 **신청일 달**을 `ranYm` 으로 찍어 같은 달 중복을 막는다.
       * ⚠️ 오늘의 달이 아니다 — 지난달 완료로 적으면 티켓은 지난달(신청일 = 완료일)로 가는데,
       *    '이번 달 생성됨'으로 찍으면 이번 달 회차가 조용히 빠진다(리뷰 재현).
       *    doneAt 은 오늘보다 과거일 때만 있고 그때 createTicket 의 신청일과 같다.
       */
      extra: form.repeatMonthly
        ? [
            insertTemplate({
              form,
              media: kind.media,
              ownerId: assignTo,
              ranYm: doneAt ? doneAt.slice(0, 7) : ym,
              at: toDbStamp(),
            }),
          ]
        : [],
    },
    user,
  );

  return NextResponse.json(
    { code: "CREATED", repeating: form.repeatMonthly, ...created },
    { status: 201 },
  );
}
