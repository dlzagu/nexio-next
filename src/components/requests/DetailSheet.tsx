"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Info, MessageSquare } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { InlineError, Notice } from "@/components/ui/EmptyState";
import { RichTextBlock } from "@/components/ui/RichText";
import { Modal, Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { Combobox } from "@/components/ui/Combobox";
import { Stepper, extendedStagesOf } from "@/components/ui/Stepper";
import { TabPanel, Tabs, type TabDef } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import {
  MODULE,
  USER_ROLE_LABEL,
  isTerminal,
  type UserRole,
} from "@/lib/codes";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { announceReadStateChanged } from "@/lib/read-signal";
import { isBlankHtml } from "@/lib/sanitize";
import { fmtBytes, payloadTooLargeMessage } from "@/lib/attachments";
import type { ActionSpec } from "@/lib/permissions";
import type { Option } from "@/lib/data/meta";
import type {
  AttachmentMeta,
  CustomerConfig,
  TicketAction,
  TicketDetail,
} from "@/lib/types";
import { toAttachmentPayload } from "./AttachPicker";
import { Composer } from "./Composer";
import {
  ConfirmActionModal,
  confirmPayload,
  needsConfirm,
  reasonProblem,
  type ConfirmableAction,
} from "./ConfirmActionModal";
import {
  CONFIRM_SOLUTION_COMMENT,
  CancelSuggestionCard,
  DECLINE_CANCEL_COMMENT,
  cancelSuggestionFor,
  customerNextStep,
  hiddenStageNotice,
  historyItems,
  initialTab,
} from "./DetailFlow";
import { SolutionPanel, toDraft, type SolutionDraft } from "./SolutionPanel";

interface Payload {
  ticket: TicketDetail;
  config: CustomerConfig | null;
  attachments: AttachmentMeta[];
  systems: Option[];
  actions: ActionSpec[];
  cancelHint: string | null;
  can: {
    editSolution: boolean;
    comment: boolean;
    postInternalComment: boolean;
    editSolutionReason: string | null;
  };
  /**
   * 누가 보고 있는가 — 고객에게만 띄우는 안내(해결안 확인)를 가른다.
   * 라우트가 내려 주지 않으면 그 안내를 띄우지 않는다(모르면 기존 문구 — fail-closed).
   */
  viewer?: { id: string; role: UserRole };
}

/** fetch 가 응답 대신 예외를 던졌을 때(네트워크 끊김) 사용자에게 보이는 문장 */
const NETWORK_FAIL =
  "네트워크 오류로 요청을 보내지 못했습니다. 다시 시도해 주세요.";

type Busy =
  | "save"
  | "comment"
  | "receive"
  | "propose"
  | "complete"
  | "confirm"
  | "action";

/**
 * 상세를 열면 그 건의 미읽음을 내린다.
 *
 * 🔴 다 읽었는데 목록의 빨간 점·종 배지가 그대로면 사용자에게는 **지울 방법이 없다**.
 *    읽음선은 서버(NX_OPTREPORT_READ_STATE)에 있고 목록 뱃지·대시보드·알림이 모두
 *    같은 값을 보므로, 여기서 한 번 올리면 세 곳이 함께 내려간다.
 *
 * @returns 저장이 실제로 일어났는가 (202 = 쓰기 꺼짐이라 저장되지 않았다)
 */
async function markTicketRead(echoNum: string): Promise<boolean> {
  const res = await fetch("/api/notifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ echoNum }),
  });
  if (res.status === 200) return true;
  // 202(WRITE_DISABLED)는 기본 설정에서 늘 오는 정상 경로다 — 그 외는 삼키지 않는다
  if (res.status !== 202) {
    console.error("[읽음 처리 실패]", res.status, echoNum);
  }
  return false;
}

const VARIANT: Record<ActionSpec["variant"], string> = {
  primary: "btn-primary",
  outline: "btn-outline",
  ghost: "btn-ghost",
  danger: "btn-danger",
  "danger-soft": "btn-danger-soft",
};

export function DetailSheet({
  echoNum,
  onClose,
}: {
  echoNum: string | null;
  onClose: () => void;
}) {
  /**
   * 상태를 echoNum 과 함께 담아 두고, **파생값으로 읽는다.**
   * 이렇게 하면 티켓이 바뀔 때 effect 안에서 setState(null) 로 초기화할 필요가 없다
   * (동기 setState-in-effect 는 연쇄 렌더를 만든다).
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState<{
    echoNum: string;
    data?: Payload;
    error?: string;
  } | null>(null);
  const [tabPick, setTabPick] = useState<{
    echoNum: string;
    tab: string;
    /** 고를 때의 URL tab — URL 이 다른 탭을 지시하면 이 고름은 끝난 것이다 */
    urlTab: string | null;
  } | null>(null);
  const [actionState, setActionState] = useState<{
    echoNum: string;
    msg: string;
  } | null>(null);

  useEffect(() => {
    if (!echoNum) return;
    let alive = true;
    fetch(`/api/tickets/${encodeURIComponent(echoNum)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { code?: string };
          throw new Error(`${r.status} ${body.code ?? ""}`.trim());
        }
        return r.json() as Promise<Payload>;
      })
      .then((p) => {
        if (!alive) return;
        setLoaded({ echoNum, data: p });
        // 안 읽은 글이 있을 때만 쓴다 — 열 때마다 UPSERT 하지 않는다
        if (p.ticket.hasUnreadComment) {
          void markTicketRead(echoNum)
            .then((saved) => {
              if (!alive || !saved) return;
              router.refresh(); // 목록 뱃지·대시보드 카드 (서버 렌더)
              announceReadStateChanged(); // 상단 종 (직접 fetch 하는 위젯)
            })
            .catch((e: unknown) => console.error("[읽음 처리 실패]", e));
        }
      })
      .catch(
        (e: unknown) =>
          alive &&
          setLoaded({
            echoNum,
            error: e instanceof Error ? e.message : String(e),
          }),
      );
    return () => {
      alive = false;
    };
  }, [echoNum, router]);

  // 현재 열린 티켓의 응답만 유효하다 — 이전 티켓의 응답이 남아 보이지 않는다
  const fresh = echoNum && loaded?.echoNum === echoNum ? loaded : null;
  const data = fresh?.data ?? null;
  const error = fresh?.error ?? null;
  const t = data?.ticket;
  const actionMsg =
    echoNum && actionState?.echoNum === echoNum ? actionState.msg : null;

  const attachments = data?.attachments ?? [];

  // URL 의 tab(보드가 입력이 필요한 이동에서 넘긴다) → 없으면 상태 4 이상은 '처리결과'.
  // 파생값이다 — 사용자가 탭을 고르면 tabPick 이 이긴다. 단 **같은 URL 아래에서 고른 것만**:
  // 예전 고름(댓글 탭)이 남아 보드의 '해결안 쓰기'(?tab=solution)를 이기면, 답변을 쓸 곳으로
  // 데려간다는 약속이 깨진다(리뷰 재현 — 시트는 닫혀도 마운트된 채라 상태가 남는다).
  const urlTab = searchParams.get("tab");
  const defaultTab = t
    ? initialTab({
        progress: t.progress,
        urlTab,
        hasFiles: attachments.length > 0,
      })
    : "request";
  const tab =
    echoNum && tabPick?.echoNum === echoNum && tabPick.urlTab === urlTab
      ? tabPick.tab
      : defaultTab;
  const setTab = (v: string) =>
    echoNum && setTabPick({ echoNum, tab: v, urlTab });
  const tabs: TabDef[] = [
    { value: "request", label: "요청내용" },
    { value: "solution", label: "처리결과" },
    {
      value: "comments",
      label: "댓글",
      count: t?.comments.filter((c) => !c.isLog).length,
      dot: t?.hasUnreadComment,
    },
    ...(attachments.length
      ? [{ value: "files", label: "첨부", count: attachments.length }]
      : []),
    { value: "history", label: "이력" },
  ];

  /* ── 처리결과 편집 초안 — echoNum 을 함께 담아 파생값으로 읽는다 ── */
  const [draftState, setDraftState] = useState<{
    echoNum: string;
    draft: SolutionDraft;
  } | null>(null);
  const baseDraft = t ? toDraft(t) : null;
  const draft =
    t && draftState?.echoNum === t.echoNum ? draftState.draft : baseDraft;
  const dirty =
    !!draft &&
    !!baseDraft &&
    JSON.stringify(draft) !== JSON.stringify(baseDraft);
  const patchDraft = (patch: Partial<SolutionDraft>) => {
    if (!t || !draft) return;
    setDraftState({ echoNum: t.echoNum, draft: { ...draft, ...patch } });
  };

  /* ── 댓글 초안 ── */
  const [commentState, setCommentState] = useState<{
    echoNum: string;
    html: string;
    internalOnly: boolean;
    files: File[];
  } | null>(null);
  const comment =
    echoNum && commentState?.echoNum === echoNum
      ? commentState
      : {
          echoNum: echoNum ?? "",
          html: "",
          internalOnly: false,
          files: [] as File[],
        };

  /**
   * 진행 중 표시도 echoNum 과 함께 담는다. 다른 건으로 넘어가면 이전 건의 '처리 중'이
   * 따라오지 않는다(같은 시트 인스턴스로 여러 건을 연다).
   */
  const [busyState, setBusyState] = useState<{
    echoNum: string;
    what: Busy;
  } | null>(null);
  /** 액션 진행 중 — 댓글 전송은 따로 센다(아래 commentBusy) */
  const busy =
    echoNum && busyState?.echoNum === echoNum ? busyState.what : null;
  /**
   * 댓글 전송 중. 🔴 액션과 **칸을 나눈다** — 한 칸이면 첨부 업로드로 몇 초 걸리는 댓글 전송 중에
   *    액션을 누르는 순간 '등록 중…'이 풀려 같은 댓글을 두 번 보낼 수 있었다(리뷰 재현).
   *    댓글과 액션은 서로를 막지 않는다 — 각자 자기 버튼만 잠근다.
   */
  const [commentBusyFor, setCommentBusyFor] = useState<string | null>(null);
  const commentSending = !!echoNum && commentBusyFor === echoNum;
  /** 등록에 성공한 횟수 — 입력창을 새로 만들어 실행 취소 이력까지 비운다 */
  const [commentSent, setCommentSent] = useState(0);

  /**
   * 🔴 busy 는 **finally 에서** 푼다. 예전엔 `setBusy(x); await …; setBusy(null)` 이라
   *    예외가 나면 버튼이 '접수 중…'으로 굳었고, 새로고침 말고는 풀 방법이 없었다(FE-9).
   */
  const withBusy = async <T,>(
    what: Busy,
    fn: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (!t) return undefined;
    const target = t.echoNum;
    if (what === "comment") setCommentBusyFor(target);
    else setBusyState({ echoNum: target, what });
    try {
      return await fn();
    } finally {
      // 그 사이 다른 건에서 시작한 작업의 표시는 건드리지 않는다
      if (what === "comment") {
        setCommentBusyFor((cur) => (cur === target ? null : cur));
      } else {
        setBusyState((cur) =>
          cur?.echoNum === target && cur.what === what ? null : cur,
        );
      }
    }
  };

  /* ── 댓글 입력창으로 데려가기 — 초안을 채워 주되 전송은 사용자가 누른다 ── */
  const [composerFocus, setComposerFocus] = useState<{
    echoNum: string;
    n: number;
  } | null>(null);
  const focusKey =
    echoNum && composerFocus?.echoNum === echoNum ? composerFocus.n : 0;
  const askInComment = (html: string) => {
    if (!t) return;
    // 쓰던 글이 있으면 덮지 않는다 — 조용히 지우는 것이 더 큰 사고다
    if (isBlankHtml(comment.html)) {
      setCommentState({ ...comment, echoNum: t.echoNum, html });
    }
    setComposerFocus({ echoNum: t.echoNum, n: focusKey + 1 });
  };

  /* ── 되돌릴 수 없는 액션의 확인 모달 (UX-7) ── */
  const [confirmState, setConfirmState] = useState<{
    echoNum: string;
    action: ConfirmableAction;
    reason: string;
  } | null>(null);
  const confirm =
    echoNum && confirmState?.echoNum === echoNum ? confirmState : null;
  const openConfirm = (action: ConfirmableAction) => {
    if (!t) return;
    // 지난 액션의 문장이 모달 안에 딸려 들어가지 않게 비운다
    setActionState(null);
    setConfirmState({ echoNum: t.echoNum, action, reason: "" });
  };
  const submitConfirm = async () => {
    if (!confirm || reasonProblem(confirm.action, confirm.reason)) return;
    const ok = await withBusy("confirm", () =>
      runAction(confirm.action, confirmPayload(confirm.action, confirm.reason)),
    );
    if (ok) setConfirmState(null);
  };

  /**
   * 접수 폼. 고객은 운영시스템·모듈을 모르는 경우가 많아 **빈 값이나 잘못된 값**으로 들어온다 —
   * 접수하는 담당자가 그 자리에서 바로잡고, 예상 시간·예상 처리일까지 함께 잡는다.
   * 열 때 현재 값을 채워 두므로 그대로 두면 아무것도 바뀌지 않는다.
   */
  const [triage, setTriage] = useState<{
    echoNum: string;
    systemId: string;
    moduleCode: string;
    expeTime: string;
    scheDate: string;
  } | null>(null);
  const openTriage = () => {
    if (!t) return;
    setTriage({
      echoNum: t.echoNum,
      systemId: t.systemId,
      moduleCode: t.moduleCode,
      expeTime: t.solution.expeTime === null ? "" : String(t.solution.expeTime),
      scheDate: (t.scheDate ?? "").slice(0, 10),
    });
  };
  const submitTriage = async () => {
    if (!triage) return;
    const ok = await withBusy("receive", () =>
      runAction("receive", {
        triage: {
          systemId: triage.systemId,
          moduleCode: triage.moduleCode,
          expeTime: triage.expeTime,
          scheDate: triage.scheDate,
        },
      }),
    );
    if (ok) setTriage(null);
  };

  /**
   * @returns 서버가 받아들였는가 (200 저장 · 202 판정만 통과). 모달을 닫을지 정한다.
   */
  const runAction = async (
    action: TicketAction,
    payload?: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!t) return false;
    const target = t.echoNum;
    setActionState({ echoNum: target, msg: "처리 중…" });

    let res: Response;
    try {
      res = await fetch(`/api/tickets/${encodeURIComponent(target)}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (e) {
      // 🔴 네트워크가 끊기면 fetch 는 응답 대신 예외를 던진다. 삼키지 않는다 —
      //    '처리 중…'으로 굳히지 않고 사용자 문장으로 바꾸고, 원인은 콘솔에 남긴다.
      console.error("[액션 요청 실패]", action, e);
      setActionState({ echoNum: target, msg: NETWORK_FAIL });
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
      detail?: unknown;
    };
    const msg =
      res.status === 413
        ? payloadTooLargeMessage()
        : (body.message ?? body.code ?? `HTTP ${res.status}`);
    setActionState({ echoNum: target, msg });

    // 🔴 202(WRITE_DISABLED)는 **저장되지 않았다**는 뜻이다. res.ok 는 202 를 포함하므로
    //    그걸로 성공을 판정하면 쓰기가 꺼진 기본 설정에서 사용자가 쓰던 초안을 지운다.
    const saved = res.status === 200;
    if (saved) {
      // **이 요청이 실어 보낸 초안만** 버리고 저장된 값을 다시 읽는다. 안 그러면 방금 저장한
      // 내용이 '변경 있음'으로 남아 두 번 저장하게 된다.
      // ⚠️ 댓글을 달았다고 쓰던 처리내역까지 버리면 안 된다 — 에디터가 값을 따라가므로
      //    화면에서도 글이 사라진다(해결안을 쓰다가 댓글을 달면 해결안이 날아갔다).
      if (action === "comment") {
        setCommentState(null);
        setCommentSent((n) => n + 1);
      }
      let refreshed = false;
      try {
        const fresh = await fetch(`/api/tickets/${encodeURIComponent(target)}`);
        if (fresh.ok) {
          const next = (await fresh.json()) as Payload;
          // 🔴 처리내역 초안은 새 값과 **같은 순간에** 버린다. 먼저 버리면 재조회를 기다리는 동안
          //    한 번 그려지는 화면이 저장 전 값이라, 값을 따라가는 에디터가 방금 쓴 글을 지웠다가
          //    되살린다 — 그 사이 이어 쓰면 옛 글 위에 쌓인다(리뷰 재현)
          setLoaded({ echoNum: target, data: next });
          if (payload?.solution !== undefined) setDraftState(null);
          refreshed = true;
        }
      } catch (e) {
        console.error("[상세 다시 읽기 실패]", target, e);
      }
      if (!refreshed) {
        // 저장은 끝났다 — 다시 읽기만 실패했다. 초안은 남겨 둔다(저장한 그대로라 화면이 맞다)
        setActionState({
          echoNum: target,
          msg: `${msg} 화면을 새로 읽지 못했습니다 — 새로고침해 주세요.`,
        });
      }
      // 목록·카운트·대시보드는 서버 컴포넌트라 별도로 갱신해야 한다
      router.refresh();
    }
    return saved || res.status === 202;
  };

  /**
   * 해결안 제시. 지금 화면에 쓴 처리내역을 **함께** 보낸다 —
   * 따로 저장하고 다시 눌러야 하면 빈 해결안이 그대로 넘어간다.
   *
   * 비어 있으면 서버에 묻지 않고 처리결과 탭으로 데려간다. 400 을 받아 문장만 띄우면
   * 어디에 써야 하는지 모른 채 같은 버튼을 다시 누르게 된다.
   */
  const propose = async () => {
    if (isBlankHtml(draft?.answer)) {
      setTab("solution");
      setActionState({
        echoNum: t?.echoNum ?? "",
        msg: "‘답변’을 입력해야 해결안을 제시할 수 있습니다. 고객이 실제로 읽는 부분입니다.",
      });
      return;
    }
    await withBusy("propose", () => runAction("propose", { solution: draft }));
  };

  /**
   * 완료 처리도 해결안 제시처럼 **지금 쓴 처리내역을 함께** 보낸다 (DATA-2).
   * 서버는 완료에 답변을 요구한다 — 미저장 답변을 두고 저장값(빈 답변)으로 판정받으면
   * 방금 쓴 글이 있는데도 400 이 난다. 비어 있으면 서버에 묻지 않고 쓸 곳으로 데려간다.
   */
  const complete = async () => {
    if (isBlankHtml(draft?.answer)) {
      setTab("solution");
      setActionState({
        echoNum: t?.echoNum ?? "",
        msg: "‘답변’을 입력해야 완료 처리할 수 있습니다. 고객이 실제로 읽는 부분입니다.",
      });
      return;
    }
    await withBusy("complete", () =>
      runAction("complete", { solution: draft }),
    );
  };

  /**
   * 🔴 하단 액션바의 '저장'도 **이 함수**를 탄다. 예전엔 액션바가 초안 없이 `save` 만 보내
   *    서버가 아무것도 안 바꾸고 200 을 줬고, 화면은 그걸 성공으로 읽어 **쓰던 초안을 버렸다**
   *    ("처리내역을 저장했습니다" 후 새로고침하면 빈칸 — 실측).
   */
  const saveSolution = async () => {
    if (!draft) return;
    if (!dirty) {
      setTab("solution");
      setActionState({
        echoNum: t?.echoNum ?? "",
        msg: "바뀐 처리내역이 없습니다. 처리결과 탭에서 내용을 고친 뒤 저장하세요.",
      });
      return;
    }
    await withBusy("save", () => runAction("save", { solution: draft }));
  };

  const postComment = () =>
    withBusy("comment", async () => {
      if (!t) return;
      // 입력창이 이 조합을 잠그지만, 상태가 어긋나도 파일을 조용히 버리거나 새게 두지 않는다
      if (comment.internalOnly && comment.files.length) {
        setActionState({
          echoNum: t.echoNum,
          msg: "내부 전용 댓글에는 파일을 붙일 수 없습니다. 파일을 빼거나 내부 전용을 해제해 주세요.",
        });
        return;
      }
      let attachments: Awaited<ReturnType<typeof toAttachmentPayload>>;
      try {
        attachments = await toAttachmentPayload(comment.files);
      } catch (e) {
        // 고른 뒤 디스크에서 옮겨진 파일 등 — 읽지 못한 사실을 그대로 말한다
        console.error("[첨부 읽기 실패]", e);
        setActionState({
          echoNum: t.echoNum,
          msg: "첨부 파일을 읽지 못했습니다. 파일을 뺐다가 다시 골라 주세요.",
        });
        return;
      }
      await runAction("comment", {
        comment: {
          body: comment.html,
          adminOnly: comment.internalOnly,
          // 댓글과 첨부는 한 요청·한 트랜잭션이다 (ADR-0008)
          attachments,
        },
      });
    });

  /** 액션바 버튼 → 무엇을 할지. 입력이 필요한 액션은 바로 실행하지 않는다 */
  const onAction = (action: TicketAction) => {
    // 접수는 분류를 확정하는 단계다 — 바로 실행하지 않고 폼을 연다
    if (action === "receive") return openTriage();
    if (action === "propose") return void propose();
    if (action === "save") return void saveSolution();
    if (action === "complete") return void complete();
    if (needsConfirm(action)) return openConfirm(action);
    void withBusy("action", () => runAction(action));
  };

  /* ── 상단 안내 — 판정은 DetailFlow 의 순수 함수 ── */
  const suggestion = t
    ? cancelSuggestionFor(t.comments, data?.actions ?? [])
    : null;
  const nextStep = t
    ? customerNextStep({
        progress: t.progress,
        viewerRole: data?.viewer?.role,
        canComment: !!data?.can.comment,
        actionCount: data?.actions.length ?? 0,
      })
    : null;
  const history = t ? historyItems(t, data?.config) : null;
  const historyNotice = history
    ? hiddenStageNotice(history.hiddenStages)
    : null;

  return (
    <Sheet
      open={!!echoNum}
      onOpenChange={(v) => !v && onClose()}
      resizable
      // 스크롤은 탭 패널이 맡는다 — 탭 바와 댓글 입력창은 자리에 고정된다
      bodyScroll={false}
      title={t ? t.title : (echoNum ?? "요청 상세")}
      header={
        t ? (
          <div className="text-11 text-fg-muted mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="mono text-fg-subtle">{t.echoNum}</span>
            <Dot />
            <span>{t.custName}</span>
            {t.systemName ? (
              <>
                <Dot />
                <span>{t.systemName}</span>
              </>
            ) : null}
            {t.moduleLabel ? (
              <>
                <Dot />
                <span>{t.moduleLabel}</span>
              </>
            ) : null}
            <Dot />
            <span>신청 {t.requesterName}</span>
            <Dot />
            <span>담당 {t.assigneeName ?? "미배정"}</span>
            <Dot />
            <span className="num">{fmtDate(t.reqDate)}</span>
            {!t.isPublic ? (
              <>
                <Dot />
                <span
                  className="badge badge-neutral"
                  title="비공개 — 신청한 사람과 그 회사 승인권자만 볼 수 있습니다"
                >
                  비공개
                </span>
              </>
            ) : null}
          </div>
        ) : null
      }
      footer={
        t ? (
          <div className="flex flex-col gap-2">
            {actionMsg ? <Notice tone="info">{actionMsg}</Notice> : null}
            {data?.cancelHint ? (
              <p className="text-11 text-fg-subtle flex items-start gap-1.5 leading-relaxed">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                {data.cancelHint}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <StatusBadge progress={t.progress} />
              <div className="flex flex-wrap justify-end gap-2">
                {data?.actions.length ? (
                  data.actions.map((a) =>
                    // 재신청은 상태 전이가 아니라 **새 신청**이다 → 폼으로 보낸다
                    a.action === "reapply" ? (
                      <Link
                        key={a.action}
                        href={`/requests/new?from=${encodeURIComponent(t.echoNum)}`}
                        className={cn("btn", VARIANT[a.variant])}
                      >
                        {a.label}
                      </Link>
                    ) : (
                      <button
                        key={a.action}
                        type="button"
                        className={cn("btn", VARIANT[a.variant])}
                        onClick={() => onAction(a.action)}
                        // 처리 중에 두 번 누르지 않게 — 댓글 등록은 다른 칸이라 막지 않는다
                        disabled={!!busy}
                      >
                        {a.label}
                      </button>
                    ),
                  )
                ) : nextStep === "confirmSolution" ? (
                  // 고객에게 4단계 액션은 없다(완료는 담당자) — 대신 다음 행동을 알려 준다
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-11 text-fg-muted">
                      처리결과를 확인하셨다면 댓글로 알려 주세요 — 담당자가 완료
                      처리합니다.
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => askInComment(CONFIRM_SOLUTION_COMMENT)}
                    >
                      <MessageSquare size={12} aria-hidden />
                      확인 댓글 쓰기
                    </button>
                  </span>
                ) : (
                  <span className="text-11 text-fg-subtle">
                    {isTerminal(t.progress)
                      ? "종료된 요청입니다"
                      : "현재 단계에서 실행할 수 있는 액션이 없습니다"}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {error ? (
        <div className="p-5">
          <InlineError title="상세를 불러오지 못했습니다" detail={error} />
        </div>
      ) : !t ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-line-subtle border-b px-5 py-4">
            {/* 고객사 플래그가 아니라 이 건이 실제로 거친(또는 머문) 확장 단계만 (UX-10) */}
            <Stepper progress={t.progress} {...extendedStagesOf(t)} />
          </div>

          {suggestion ? (
            <div className="px-5 pt-4">
              <CancelSuggestionCard
                suggestion={suggestion}
                onCancel={() => openConfirm(suggestion.exec)}
                onReply={
                  data?.can.comment
                    ? () => askInComment(DECLINE_CANCEL_COMMENT)
                    : undefined
                }
                disabled={!!busy}
              />
            </div>
          ) : null}

          {t.request.isReRequest && t.request.parentEchoNum ? (
            <div className="px-5 pt-4">
              <Notice tone="accent">
                ↻ 이전 요청{" "}
                <span className="mono">{t.request.parentEchoNum}</span> 의
                재신청 건입니다.
              </Notice>
            </div>
          ) : null}

          <Tabs
            tabs={tabs}
            value={tab}
            onValueChange={setTab}
            className="min-h-0 flex-1"
          >
            <TabPanel value="request">
              <Field label="제목">
                <p className="text-14 text-fg-strong font-medium">{t.title}</p>
              </Field>
              <Field label="요청 내용">
                <RichTextBlock raw={t.request.content || t.request.remarks} />
              </Field>
              {t.request.reqRemarks ? (
                <Field label="요청 분류">
                  <RichTextBlock raw={t.request.reqRemarks} />
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Meta label="우선순위" value={t.priority || "-"} />
                <Meta label="희망 완료일" value={fmtDate(t.scheDate)} />
                <Meta label="접수 경로" value={t.request.media || "-"} />
                <Meta label="운영시스템" value={t.systemName ?? "-"} />
                <Meta label="모듈" value={t.moduleLabel || "-"} />
                <Meta
                  label="공개 여부"
                  value={t.isPublic ? "공개" : "비공개"}
                />
              </div>
              {t.request.refMail ? (
                <Field label="참조자">
                  <p className="text-12 text-fg-muted break-all">
                    {t.request.refMail}
                  </p>
                </Field>
              ) : null}
            </TabPanel>

            <TabPanel value="solution">
              {draft ? (
                <SolutionPanel
                  key={t.echoNum}
                  ticket={t}
                  canEdit={!!data?.can.editSolution}
                  readOnlyReason={data?.can.editSolutionReason}
                  draft={draft}
                  onChange={patchDraft}
                  onSave={saveSolution}
                  saving={busy === "save"}
                  dirty={dirty}
                />
              ) : null}
            </TabPanel>

            <TabPanel value="comments">
              <CommentThread ticket={t} />
            </TabPanel>

            <TabPanel value="files">
              <AttachmentList echoNum={t.echoNum} items={attachments} />
            </TabPanel>

            <TabPanel value="history">
              {/* 어떤 행을 그릴지는 historyItems 가 정한다 — 안 쓰는 단계를 그리고
                  "표시하지 않습니다"라고 쓰던 자기모순을 없앴다 */}
              <div className="flex flex-col gap-2.5">
                {history?.rows.map((r) => (
                  <HistoryRow
                    key={r.key}
                    label={r.label}
                    who={r.who}
                    at={r.at}
                  />
                ))}
              </div>

              {t.history.memos.length ? (
                <div className="border-line-subtle mt-4 border-t pt-4">
                  {t.history.memos.map((m) => (
                    <Field key={m.label} label={m.label}>
                      <RichTextBlock raw={m.value} />
                    </Field>
                  ))}
                </div>
              ) : null}

              {/* 실측 5·6=8건, 7·8=3건. 실제로 감춘 단계가 있을 때만 그 사실을 말한다 */}
              {historyNotice ? (
                <p className="text-11 text-fg-subtle mt-4 flex items-start gap-1.5 leading-relaxed">
                  <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                  {historyNotice}
                </p>
              ) : null}
            </TabPanel>
          </Tabs>

          {/* 탭과 무관하게 **항상 보이는** 입력창.
              상태 4 이상이면 기본 탭이 '처리결과'라, 댓글 탭 안에만 두면
              사용자가 "쓸 곳이 없다"고 느낀다 (재설계 §2). */}
          <Composer
            // 등록에 성공하면 새로 만든다 — 비운 입력창에서 '실행 취소'로 방금 보낸 글이
            // 되살아나 다시 등록되지 않게, 편집기의 실행 취소 이력까지 비운다(리뷰 재현)
            key={`${t.echoNum}:${commentSent}`}
            value={comment.html}
            onChange={(html) =>
              setCommentState({ ...comment, echoNum: t.echoNum, html })
            }
            files={comment.files}
            onFilesChange={(files) =>
              setCommentState({ ...comment, echoNum: t.echoNum, files })
            }
            onSubmit={postComment}
            sending={commentSending}
            disabled={!data?.can.comment}
            disabledReason={
              isTerminal(t.progress)
                ? "종료된 요청에는 댓글을 남길 수 없습니다."
                : "이 요청에 댓글을 남길 권한이 없습니다."
            }
            canPostInternal={data?.can.postInternalComment ?? false}
            focusKey={focusKey}
            internalOnly={comment.internalOnly}
            onInternalOnlyChange={(v) =>
              setCommentState({
                ...comment,
                echoNum: t.echoNum,
                internalOnly: v,
              })
            }
          />
        </div>
      )}

      <Modal
        open={!!triage}
        onOpenChange={(v) => !v && setTriage(null)}
        title="접수 — 분류 확정"
        description="고객이 비워 두거나 잘못 고른 값을 여기서 바로잡습니다. 그대로 두면 바뀌지 않습니다."
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTriage(null)}
            >
              취소
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitTriage}
              disabled={busy === "receive"}
            >
              {busy === "receive" ? "접수 중…" : "접수"}
            </button>
          </>
        }
      >
        {triage ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="label">운영시스템</span>
              <Combobox
                options={data?.systems ?? []}
                value={triage.systemId}
                onChange={(v) => setTriage({ ...triage, systemId: v })}
                placeholder="선택 안 함"
                clearLabel="비움"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">모듈</span>
              <Combobox
                options={Object.entries(MODULE).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={triage.moduleCode}
                onChange={(v) => setTriage({ ...triage, moduleCode: v })}
                placeholder="선택 안 함"
                clearLabel="비움"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="label">예상 시간 (h)</span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  step="0.5"
                  className="input"
                  value={triage.expeTime}
                  onChange={(e) =>
                    setTriage({ ...triage, expeTime: e.target.value })
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">예상 처리일</span>
                <input
                  type="date"
                  className="input"
                  value={triage.scheDate}
                  onChange={(e) =>
                    setTriage({ ...triage, scheDate: e.target.value })
                  }
                />
              </label>
            </div>
            {actionMsg ? (
              <p className="text-11 text-warning-text">{actionMsg}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmActionModal
        action={confirm?.action ?? null}
        reason={confirm?.reason ?? ""}
        onReasonChange={(v) =>
          confirm && setConfirmState({ ...confirm, reason: v })
        }
        onConfirm={submitConfirm}
        onClose={() => setConfirmState(null)}
        busy={busy === "confirm"}
        message={actionMsg}
      />
    </Sheet>
  );
}

/**
 * 첨부 목록. 바이트는 목록에 싣지 않고 **누를 때** 받아 간다 —
 * 상세 응답에 파일을 담으면 큰 첨부 하나가 화면 전체를 느리게 만든다.
 * 다운로드는 가시성 게이트를 다시 지난다(라우트).
 */
function AttachmentList({
  echoNum,
  items,
}: {
  echoNum: string;
  items: AttachmentMeta[];
}) {
  if (items.length === 0) {
    return <p className="text-12 text-fg-subtle">첨부된 파일이 없습니다.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((f) => (
        <li
          key={f.id}
          className="border-line-subtle flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-3 py-2"
        >
          <a
            className="text-13 text-fg-strong hover:text-accent-text font-medium underline-offset-2 hover:underline"
            href={`/api/tickets/${encodeURIComponent(echoNum)}/attachments/${f.id}`}
            download={f.name}
          >
            {f.name}
          </a>
          <span className="text-11 text-fg-subtle">{fmtBytes(f.size)}</span>
          <span className="text-11 text-fg-muted ml-auto">
            {f.uploaderName ?? f.uploaderId} · {fmtDate(f.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CommentThread({ ticket }: { ticket: TicketDetail }) {
  const real = ticket.comments.filter((c) => !c.isLog);
  const logs = ticket.comments.filter((c) => c.isLog);

  return (
    <div className="flex flex-col gap-3">
      {real.length === 0 ? (
        <p className="text-12 text-fg-subtle">아직 댓글이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {real.map((c) => (
            <li
              key={c.id}
              className={cn(
                "rounded-md border px-3 py-2.5",
                c.adminOnly
                  ? "border-warning-border bg-warning-subtle"
                  : "border-line-subtle bg-subtle",
              )}
            >
              <div className="text-11 mb-1.5 flex items-center gap-2">
                <span className="text-fg-strong font-medium">{c.userName}</span>
                {c.userRole ? (
                  <span className="badge badge-neutral">
                    {USER_ROLE_LABEL[c.userRole]}
                  </span>
                ) : null}
                {c.adminOnly ? (
                  <span
                    className="badge badge-warning"
                    title="고객사에는 보이지 않습니다"
                  >
                    내부 전용
                  </span>
                ) : null}
                <span
                  className="text-fg-subtle ml-auto"
                  title={fmtDateTime(c.at)}
                >
                  {fmtRelative(c.at)}
                </span>
              </div>
              <RichTextBlock raw={c.body} empty="(내용 없음)" />
            </li>
          ))}
        </ul>
      )}

      {logs.length ? (
        <details className="border-line-subtle rounded-md border px-3 py-2">
          <summary className="text-11 text-fg-subtle cursor-pointer">
            시스템 기록 {logs.length}건
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {logs.map((c) => (
              <li
                key={c.id}
                className="text-11 text-fg-muted flex items-center gap-2"
              >
                <span className="num text-fg-subtle shrink-0">
                  {fmtDateTime(c.at)}
                </span>
                <span className="ell">{c.body.replace(/<[^>]+>/g, "")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* 입력창은 탭 밖(시트 하단)으로 옮겼다 — Composer 참조 */}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="label">{label}</p>
      {children}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-11 text-fg-subtle">{label}</p>
      <p className="text-13 text-fg-default mt-0.5">{value}</p>
    </div>
  );
}

function HistoryRow({
  label,
  who,
  at,
}: {
  label: string;
  who?: string | null;
  at?: string | null;
}) {
  const done = !!at;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2",
        done
          ? "border-line-subtle bg-subtle"
          : "border-line-subtle border-dashed",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          done ? "bg-success" : "bg-line-strong",
        )}
      />
      <span className="text-12 text-fg-muted w-[92px] shrink-0">{label}</span>
      <span className="ell text-12 text-fg-default flex-1">
        {who ?? (done ? "-" : "미진행")}
      </span>
      <span className="num text-11 text-fg-subtle shrink-0">
        {fmtDateTime(at)}
      </span>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-fg-disabled">
      ·
    </span>
  );
}
