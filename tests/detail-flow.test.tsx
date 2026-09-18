import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * 상세 시트·댓글 흐름 — 화면이 **스스로를 반박하거나 막다른 길을 만들지 않는가.**
 *
 * 판정은 순수 함수(DetailFlow·ConfirmActionModal·Stepper)로 빼 두었고 여기서 고정한다.
 * 권유 카드는 서버가 실제로 남기는 본문으로도 한 번 확인한다(문구가 갈라지면 카드가 조용히 죽는다).
 *
 * ⚠️ 환경변수는 db() 최초 호출 "전"에 세팅해야 한다 (dbPath 가 지연 평가).
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

import { Composer, INTERNAL_NO_FILES } from "@/components/requests/Composer";
import {
  CONFIRM_SPEC,
  ConfirmActionModal,
  confirmPayload,
  needsConfirm,
  reasonProblem,
} from "@/components/requests/ConfirmActionModal";
import {
  SUGGEST_CANCEL_LEAD,
  cancelSuggestionFor,
  customerNextStep,
  hiddenStageNotice,
  historyItems,
  initialTab,
  parseCancelSuggestion,
} from "@/components/requests/DetailFlow";
import { RichEditor } from "@/components/ui/RichEditor";
import { Modal, Sheet } from "@/components/ui/Sheet";
import { Stepper, extendedStagesOf, flowSteps } from "@/components/ui/Stepper";
import { applyAction } from "@/lib/data/mutations";
import { getTicket } from "@/lib/data/tickets";
import { select } from "@/lib/db";
import { availableActions } from "@/lib/permissions";
import type { Comment, CustomerConfig, TicketDetail, User } from "@/lib/types";

// globals 를 켜지 않아 자동 정리가 돌지 않는다 — 앞 테스트의 DOM 이 다음 테스트에 남지 않게
afterEach(cleanup);

/* ── 공용 픽스처 ─────────────────────────────────────────── */

const config = (over: Partial<CustomerConfig> = {}): CustomerConfig => ({
  custCode: "HB001",
  custName: "한빛제약",
  showsContractTime: false,
  usesApproval: true,
  usesTestStage: false,
  usesSystemStage: false,
  defaultPrivate: false,
  ...over,
});

const emptyHistory = (): TicketDetail["history"] => ({
  approver: null,
  approvedAt: null,
  canceler: null,
  canceledAt: null,
  cancelReqAt: null,
  cancelReqBy: null,
  testAt: null,
  testCompletedAt: null,
  systemAt: null,
  finalAssignee: null,
  finalSuccDate: null,
  memos: [],
});

let seq = 0;
const cmt = (over: Partial<Comment> = {}): Comment => ({
  id: ++seq,
  userId: "sy.kim",
  userName: "김서연",
  userRole: "INTERNAL",
  body: "<p>확인 중입니다.</p>",
  at: "2026-09-18T10:00:00",
  adminOnly: false,
  isLog: false,
  progressAt: null,
  ...over,
});

/** 서버(mutations.ts suggestCancel)가 남기는 본문 모양 */
const suggestionBody = (reason = "") =>
  `<p>${SUGGEST_CANCEL_LEAD}${reason ? ` ${reason}` : ""}</p>` +
  `<p>취소 실행은 신청자 본인만 할 수 있습니다.</p>`;
/** 사유를 별도 문단(여러 줄)으로 두고 끝에 단계별 안내를 붙이는 모양 */
const suggestionBodySplit = (reasonLines: string[]) =>
  `<p>${SUGGEST_CANCEL_LEAD}</p>` +
  reasonLines.map((l) => `<p>${l}</p>`).join("") +
  `<p>취소 실행은 신청자 본인만 할 수 있습니다 — 상단의 '취소 요청'을 누르면 담당자 확인 후 취소됩니다.</p>`;

/* ── 1) 이력 탭 — 그리면서 "표시하지 않습니다"라고 쓰지 않는다 ──────────── */

describe("이력 탭 행 필터", () => {
  const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

  it("테스트·이관 단계를 안 쓰는 고객사 — 그 행을 그리지 않고, 할 말도 없다", () => {
    const { rows, hiddenStages } = historyItems(
      { history: emptyHistory(), succDate: null, progress: "4" },
      config(),
    );
    expect(labels(rows)).toEqual(["승인", "최종 처리", "완료"]);
    expect(hiddenStages).toEqual([]);
    expect(hiddenStageNotice(hiddenStages)).toBeNull();
  });

  it("쓰는 고객사라도 이 건이 거치지 않았으면 그리지 않는다 — 스테퍼와 같은 판정", () => {
    // 들어가는 전이(4→5·→7)가 없는 앱이라, 플래그만 보고 그리면 영원히 '미진행'인 행이 된다
    const c = config({ usesTestStage: true, usesSystemStage: true });
    const { rows, hiddenStages } = historyItems(
      { history: emptyHistory(), succDate: null, progress: "4" },
      c,
    );
    expect(labels(rows)).toEqual(["승인", "최종 처리", "완료"]);
    expect(hiddenStageNotice(hiddenStages)).toBe(
      "이 요청이 거치지 않은 테스트·시스템 이관 단계는 이력에 표시하지 않습니다.",
    );
  });

  it("그 단계에 있거나 지나갔으면 그린다", () => {
    const c = config({ usesTestStage: true });
    const now = historyItems(
      { history: emptyHistory(), succDate: null, progress: "5" },
      c,
    );
    expect(labels(now.rows)).toEqual(
      expect.arrayContaining(["테스트 요청", "테스트 완료"]),
    );
    expect(now.hiddenStages).toEqual([]);
  });

  it("설정을 꺼도 실제로 지나간 기록은 보인다", () => {
    const { rows, hiddenStages } = historyItems(
      {
        history: { ...emptyHistory(), testAt: "2026-01-02T09:00:00" },
        succDate: null,
        progress: "9",
      },
      config(),
    );
    expect(labels(rows)).toContain("테스트 요청");
    expect(hiddenStages).toEqual([]);
  });

  it("취소 요청·취소는 일어났을 때만 그린다", () => {
    const none = historyItems(
      { history: emptyHistory(), succDate: null, progress: "3" },
      config(),
    );
    expect(labels(none.rows)).not.toContain("취소 요청");
    expect(labels(none.rows)).not.toContain("취소");

    const happened = historyItems(
      {
        history: {
          ...emptyHistory(),
          cancelReqAt: "2026-09-01T09:00:00",
          cancelReqBy: "hb.yoon",
          canceledAt: "2026-09-02T09:00:00",
          canceler: "sy.kim",
        },
        succDate: null,
        progress: "11",
      },
      config(),
    );
    expect(labels(happened.rows)).toEqual(
      expect.arrayContaining(["취소 요청", "취소"]),
    );
  });

  it("고객사 설정을 모르면 '안 쓴다'고 단정하지 않는다", () => {
    const { hiddenStages } = historyItems(
      { history: emptyHistory(), succDate: null, progress: "4" },
      null,
    );
    const notice = hiddenStageNotice(hiddenStages);
    expect(notice).not.toContain("이 고객사는");
    expect(notice).toContain("거치지 않은");
  });
});

/* ── 2) 해결안제시(4) 고객 — 막다른 길 대신 다음 행동 ─────────────────── */

describe("고객의 다음 행동 (상태 4)", () => {
  const base = {
    progress: "4",
    viewerRole: "CUSTOMER" as const,
    canComment: true,
    actionCount: 0,
  };

  it("고객·댓글 가능·액션 없음이면 확인 안내를 띄운다", () => {
    expect(customerNextStep(base)).toBe("confirmSolution");
  });

  it("다른 상태·다른 역할·보는 사람을 모르면 기존 문구 그대로", () => {
    expect(customerNextStep({ ...base, progress: "3" })).toBeNull();
    expect(customerNextStep({ ...base, viewerRole: "INTERNAL" })).toBeNull();
    expect(customerNextStep({ ...base, viewerRole: "VENDOR" })).toBeNull();
    // 🔒 라우트가 viewer 를 안 내려 주면 안내하지 않는다 (fail-closed)
    expect(customerNextStep({ ...base, viewerRole: undefined })).toBeNull();
  });

  it("댓글을 못 남기면 댓글로 알리라고 하지 않는다", () => {
    expect(customerNextStep({ ...base, canComment: false })).toBeNull();
  });

  it("실행할 액션이 있으면 그 버튼이 자리를 쓴다", () => {
    expect(customerNextStep({ ...base, actionCount: 1 })).toBeNull();
  });
});

/* ── 3) 되돌릴 수 없는 액션 — 확인 모달과 사유 ─────────────────────────── */

describe("확인 모달 규칙", () => {
  it("되돌릴 수 없는 액션과 취소 권유는 바로 실행하지 않는다", () => {
    for (const a of [
      "reject",
      "cancel",
      "cancelApprove",
      "cancelDeny",
      "suggestCancel",
      "cancelRequest",
    ]) {
      expect(needsConfirm(a)).toBe(true);
    }
    for (const a of ["approve", "receive", "propose", "complete", "save"]) {
      expect(needsConfirm(a)).toBe(false);
    }
    // 프로토타입 키에 속지 않는다
    expect(needsConfirm("toString")).toBe(false);
  });

  it("사유 필수 = 반려·계속 진행·취소 권유, 선택 = 취소·취소 승인", () => {
    for (const a of ["reject", "cancelDeny", "suggestCancel"] as const) {
      expect(reasonProblem(a, "  ")).toBeTruthy();
      expect(reasonProblem(a, "이유")).toBeNull();
    }
    for (const a of ["cancel", "cancelApprove"] as const) {
      expect(reasonProblem(a, "")).toBeNull();
    }
  });

  it("종료로 가는 액션은 되돌릴 수 없다고 말한다", () => {
    expect(CONFIRM_SPEC.reject.irreversible).toBe(true);
    expect(CONFIRM_SPEC.cancel.irreversible).toBe(true);
    expect(CONFIRM_SPEC.cancelApprove.irreversible).toBe(true);
  });

  it("사유는 다듬어서 보내고, 받을 곳이 없는 액션에는 싣지 않는다", () => {
    expect(confirmPayload("reject", "  중복 요청  ")).toEqual({
      reason: "중복 요청",
    });
    expect(confirmPayload("cancel", "   ")).toBeUndefined();
    // cancelRequest 전이에는 사유 컬럼이 없다 — 적게 해 놓고 버리지 않는다
    expect(CONFIRM_SPEC.cancelRequest.reason).toBe("none");
    expect(confirmPayload("cancelRequest", "이유")).toBeUndefined();
  });

  it("필수 사유가 비면 버튼을 잠그고 이유를 보여 준다", () => {
    function Harness() {
      const [reason, setReason] = useState("");
      return (
        <ConfirmActionModal
          action="reject"
          reason={reason}
          onReasonChange={setReason}
          onConfirm={() => {}}
          onClose={() => {}}
          busy={false}
        />
      );
    }
    render(<Harness />);
    const confirm = screen.getByRole("button", { name: "반려" });
    expect(confirm).toBeDisabled();
    expect(
      screen.getByText("반려 사유를 입력해야 반려할 수 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("되돌릴 수 없습니다.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "첨부가 빠졌습니다" },
    });
    expect(confirm).toBeEnabled();
  });
});

/* ── 4) 신청자에게 온 취소 권유 카드 ───────────────────────────────────── */

describe("취소 권유 카드 판별", () => {
  const cancelable = [{ action: "cancelRequest" as const }];

  it("권유 본문에서 사유를 꺼낸다 — 뒤의 안내 문장은 사유가 아니다", () => {
    expect(parseCancelSuggestion(suggestionBody("중복 요청입니다"))).toEqual({
      reason: "중복 요청입니다",
    });
    expect(parseCancelSuggestion(suggestionBody())).toEqual({ reason: null });
    // 서버가 '사유:' 를 붙여도 같은 결과
    expect(
      parseCancelSuggestion(suggestionBody("사유: 중복 요청입니다")),
    ).toEqual({ reason: "중복 요청입니다" });
    // 이스케이프된 저장값도 평문으로 읽는다
    expect(
      parseCancelSuggestion(
        suggestionBody("A").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      ),
    ).toEqual({ reason: "A" });
    expect(parseCancelSuggestion("<p>확인 부탁드립니다.</p>")).toBeNull();
  });

  it("사유가 별도 문단·여러 줄이어도 끝의 안내 문단은 사유에 섞지 않는다", () => {
    expect(
      parseCancelSuggestion(
        suggestionBodySplit(["같은 내용이 HB-2 에서 처리됨", "확인 부탁"]),
      ),
    ).toEqual({ reason: "같은 내용이 HB-2 에서 처리됨\n확인 부탁" });
    expect(parseCancelSuggestion(suggestionBodySplit([]))).toEqual({
      reason: null,
    });
  });

  it("가장 최근의 사람 댓글이 권유이고 신청자가 취소할 수 있으면 카드를 띄운다", () => {
    const s = cancelSuggestionFor(
      [
        cmt({ body: "<p>확인했습니다.</p>", userRole: "CUSTOMER" }),
        cmt({ body: suggestionBody("다른 건에서 처리됨") }),
        // 시스템 기록은 대화가 아니다 — 권유 뒤에 쌓여도 카드를 가리지 않는다
        cmt({ body: "<p>상태 변경</p>", isLog: true }),
      ],
      cancelable,
    );
    expect(s).toMatchObject({
      reason: "다른 건에서 처리됨",
      by: "김서연",
      exec: "cancelRequest",
    });
  });

  it("권유 뒤에 대화가 이어졌으면 지난 이야기다", () => {
    expect(
      cancelSuggestionFor(
        [
          cmt({ body: suggestionBody("x") }),
          cmt({
            body: "<p>계속 진행해 주세요.</p>",
            userRole: "CUSTOMER",
          }),
        ],
        cancelable,
      ),
    ).toBeNull();
  });

  it("취소 수단이 없는 사람(담당자·다른 고객)에게는 띄우지 않는다", () => {
    const comments = [cmt({ body: suggestionBody("x") })];
    expect(cancelSuggestionFor(comments, [])).toBeNull();
    expect(
      cancelSuggestionFor(comments, [{ action: "suggestCancel" }]),
    ).toBeNull();
  });

  it("고객이 같은 문장을 적었다고 카드가 뜨지 않는다", () => {
    expect(
      cancelSuggestionFor(
        [cmt({ body: suggestionBody("x"), userRole: "CUSTOMER" })],
        cancelable,
      ),
    ).toBeNull();
  });
});

describe("취소 권유 카드 — 서버가 남긴 실제 본문으로", () => {
  const internal: User = {
    id: "sy.kim",
    name: "김서연",
    role: "INTERNAL",
    custCode: "NX000",
    custName: "(주)넥시오솔루션",
    dept: "서비스운영팀",
    email: "sy.kim@nexio-ops.example",
    isApprover: false,
  };

  beforeAll(async () => {
    await select("SELECT 1 AS ok"); // 첫 쿼리가 시드를 만든다
  });

  it("진행(3) 건에 권유를 보내면 신청자 상세에 카드 판정이 선다", async () => {
    // 신청자가 있는 진행 건 하나 (정기 업무처럼 신청자 없는 대리 등록 건은 제외)
    const [row] = await select<{ ECHONUM: string }>(
      `SELECT ECHONUM FROM NX_OPTREPORTD
        WHERE TRIM(PROGRESS) = '3' AND COALESCE(TRIM(CUSTPERSON), '') <> ''
        ORDER BY ECHONUM LIMIT 1`,
    );
    expect(row).toBeTruthy();
    const ticket = await getTicket(row.ECHONUM, internal);
    expect(ticket).toBeTruthy();
    const requester: User = {
      ...internal,
      id: ticket!.requesterId!,
      name: ticket!.requesterName,
      role: "CUSTOMER",
      custCode: ticket!.custCode,
      custName: ticket!.custName,
    };

    await applyAction({
      ticket: ticket!,
      user: internal,
      action: "suggestCancel",
      reason: "같은 내용이 다른 요청에서 처리되었습니다",
    });

    const seen = await getTicket(row.ECHONUM, requester);
    expect(seen).toBeTruthy();
    const card = cancelSuggestionFor(
      seen!.comments,
      availableActions(seen!, requester, null),
    );
    expect(card).toMatchObject({
      reason: "같은 내용이 다른 요청에서 처리되었습니다",
      exec: "cancelRequest",
    });
  });
});

/* ── 6) 최초 탭 — URL 의 tab 을 존중한다 ────────────────────────────────── */

describe("최초 탭", () => {
  it("URL 의 tab 이 있으면 그 탭으로 연다 (보드의 '해결안 제시' → 처리결과)", () => {
    expect(
      initialTab({ progress: "3", urlTab: "solution", hasFiles: false }),
    ).toBe("solution");
    expect(
      initialTab({ progress: "4", urlTab: "history", hasFiles: false }),
    ).toBe("history");
  });

  it("모르는 탭·그 건에 없는 탭은 무시하고 기본 규칙을 따른다", () => {
    expect(initialTab({ progress: "3", urlTab: "hack", hasFiles: false })).toBe(
      "request",
    );
    expect(
      initialTab({ progress: "3", urlTab: "files", hasFiles: false }),
    ).toBe("request");
    expect(initialTab({ progress: "3", urlTab: "files", hasFiles: true })).toBe(
      "files",
    );
  });

  it("기본 규칙 — 상태 4 이상은 처리결과, 취소요청(10)은 요청내용", () => {
    expect(initialTab({ progress: "2", hasFiles: false })).toBe("request");
    expect(initialTab({ progress: "4", hasFiles: false })).toBe("solution");
    expect(initialTab({ progress: "9", hasFiles: false })).toBe("solution");
    expect(initialTab({ progress: "10", hasFiles: false })).toBe("request");
  });
});

/* ── 10) 스테퍼 — 도달할 길이 없는 칸은 그리지 않는다 ───────────────────── */

describe("스테퍼 칸 계산", () => {
  const codes = (o: Parameters<typeof flowSteps>[0]) =>
    flowSteps(o).map((s) => s.code);

  it("흔적이 없으면 주 경로 5칸만 — 고객사가 테스트 단계를 '쓴다'는 것만으로는 늘리지 않는다", () => {
    const stages = extendedStagesOf({
      progress: "4",
      history: { testAt: null, testCompletedAt: null, systemAt: null },
    });
    expect(stages).toEqual({ usesTestStage: false, usesSystemStage: false });
    expect(codes(stages)).toEqual(["1", "2", "3", "4", "9"]);
  });

  it("지금 그 단계에 있거나 지나간 흔적이 있으면 그린다", () => {
    expect(
      extendedStagesOf({
        progress: "5",
        history: { testAt: null, testCompletedAt: null, systemAt: null },
      }).usesTestStage,
    ).toBe(true);
    expect(
      codes(
        extendedStagesOf({
          progress: "9",
          history: {
            testAt: "2026-01-01T09:00:00",
            testCompletedAt: null,
            systemAt: "2026-01-03T09:00:00",
          },
        }),
      ),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("해결안제시(4) 건의 다음 칸이 '테스트요청'으로 보이지 않는다", () => {
    render(
      <Stepper
        progress="4"
        {...extendedStagesOf({
          progress: "4",
          history: { testAt: null, testCompletedAt: null, systemAt: null },
        })}
      />,
    );
    expect(screen.queryByText("테스트요청")).toBeNull();
  });

  it("플래그 없이도 현재 단계(5~8)는 그린다 — 첫 칸이 '현재'로 칠해지지 않게", () => {
    render(<Stepper progress="7" />);
    expect(screen.getByText("시스템이관요청")).toBeInTheDocument();
    expect(screen.getByText("(현재 단계)").parentElement).toHaveTextContent(
      "시스템이관요청",
    );
  });
});

/* ── 9) 내부 전용 댓글에는 파일을 붙이지 못한다 (SEC-1 화면 쪽) ─────────── */

describe("댓글 입력창 — 내부 전용 × 첨부", () => {
  const file = () => new File(["x"], "로그.txt", { type: "text/plain" });
  const baseProps = {
    value: "",
    onChange: () => {},
    onFilesChange: () => {},
    onSubmit: () => {},
    sending: false,
    canPostInternal: true,
    onInternalOnlyChange: () => {},
  };

  it("내부 전용을 켜면 파일 첨부가 잠기고 이유를 보여 준다", () => {
    render(<Composer {...baseProps} files={[]} internalOnly />);
    expect(screen.getByRole("button", { name: /파일 첨부/ })).toBeDisabled();
    expect(screen.getByText(INTERNAL_NO_FILES)).toBeInTheDocument();
  });

  it("파일을 붙였으면 내부 전용 체크를 막고 이유를 말한다 — 파일을 조용히 버리지 않는다", () => {
    render(<Composer {...baseProps} files={[file()]} internalOnly={false} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(
      screen.getByText(/파일을 붙인 댓글은 내부 전용으로 남길 수 없습니다/),
    ).toBeInTheDocument();
    // 파일 칩은 그대로 남아 있다
    expect(screen.getByText("로그.txt")).toBeInTheDocument();
  });

  it("둘이 함께 켜진 상태로 들어오면 등록을 막는다", () => {
    render(
      <Composer
        {...baseProps}
        value="<p>내부 메모</p>"
        files={[file()]}
        internalOnly
      />,
    );
    expect(screen.getByRole("button", { name: /등록/ })).toBeDisabled();
  });
});

/* ── RichEditor — 부모 값 동기화 (FE-1, 메인 반영분 확인) + 포커스 요청 ─── */

describe("RichEditor 값 동기화", () => {
  beforeAll(() => {
    // jsdom 에는 레이아웃이 없다 — ProseMirror 가 커서 위치를 잴 때 쓰는 API 만 채운다
    const rect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    Range.prototype.getBoundingClientRect = rect as never;
    Range.prototype.getClientRects = (() => []) as never;
    Element.prototype.scrollIntoView = () => {};
  });

  function Harness() {
    const [value, setValue] = useState("<p>방금 쓴 댓글</p>");
    const [focusKey, setFocusKey] = useState(0);
    return (
      <>
        <RichEditor
          ariaLabel="댓글 입력"
          value={value}
          onChange={setValue}
          focusKey={focusKey}
        />
        <button type="button" onClick={() => setValue("")}>
          비우기
        </button>
        <button
          type="button"
          onClick={() => {
            setValue("<p>처리결과를 확인했습니다.</p>");
            setFocusKey((n) => n + 1);
          }}
        >
          채우고 포커스
        </button>
      </>
    );
  }

  it("부모가 값을 비우면 입력창도 비고, 채우면 따라 채운 뒤 포커스한다", async () => {
    render(<Harness />);
    const box = await screen.findByLabelText("댓글 입력");
    await waitFor(() => expect(box).toHaveTextContent("방금 쓴 댓글"));

    fireEvent.click(screen.getByRole("button", { name: "비우기" }));
    await waitFor(() => expect(box).not.toHaveTextContent("방금 쓴 댓글"));

    fireEvent.click(screen.getByRole("button", { name: "채우고 포커스" }));
    await waitFor(() =>
      expect(box).toHaveTextContent("처리결과를 확인했습니다."),
    );
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it("바깥에서 비운 값은 '실행 취소'로 되살아나지 않는다 (등록한 댓글의 재등록 방지)", async () => {
    render(<Harness />);
    const box = await screen.findByLabelText("댓글 입력");
    fireEvent.click(screen.getByRole("button", { name: "채우고 포커스" }));
    await waitFor(() =>
      expect(box).toHaveTextContent("처리결과를 확인했습니다."),
    );
    fireEvent.click(screen.getByRole("button", { name: "비우기" }));
    await waitFor(() =>
      expect(box).not.toHaveTextContent("처리결과를 확인했습니다."),
    );
    // 바깥 동기화는 실행 취소 이력에 없다 → 되돌릴 것이 없어 버튼이 잠겨 있다
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeDisabled();
  });
});

/* ── FE-7 시트·모달을 닫으면 포커스가 연 요소로 돌아간다 ─────────────────── */

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Modal open={open} onOpenChange={setOpen} title="확인">
        <p>본문</p>
      </Modal>
    </>
  );
}

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        role="row"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      >
        40번째 행
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="상세">
        <p>본문</p>
      </Sheet>
    </>
  );
}

describe("FE-7 닫으면 포커스가 연 요소로 돌아간다", () => {
  it("모달 — Dialog.Trigger 없이 open prop 으로 열어도", async () => {
    render(<ModalHarness />);
    const opener = screen.getByRole("button", { name: "열기" });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("시트 — 키보드로 연 목록 행으로 돌아간다 (Tab 이 상단바부터 다시 시작하지 않게)", async () => {
    render(<SheetHarness />);
    const row = screen.getByRole("row");
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("시트 위 모달 — 연 버튼이 사라졌으면(액션 뒤 버튼 목록이 바뀜) 아래 시트로", async () => {
    function Nested() {
      const [modal, setModal] = useState(false);
      const [done, setDone] = useState(false);
      return (
        <Sheet open onOpenChange={() => {}} title="상세">
          {done ? (
            <p>반려됨</p>
          ) : (
            <button type="button" onClick={() => setModal(true)}>
              반려
            </button>
          )}
          <Modal
            open={modal}
            onOpenChange={setModal}
            title="요청 반려"
            footer={
              <button
                type="button"
                onClick={() => {
                  setDone(true); // 실행 뒤 버튼 목록이 바뀐다
                  setModal(false);
                }}
              >
                확인
              </button>
            }
          />
        </Sheet>
      );
    }
    render(<Nested />);
    const opener = await screen.findByRole("button", { name: "반려" });
    act(() => opener.focus());
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "확인" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    const sheet = screen.getByRole("dialog");
    await waitFor(() =>
      expect(sheet.contains(document.activeElement)).toBe(true),
    );
  });
});
