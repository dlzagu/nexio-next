"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { InlineError, Notice } from "@/components/ui/EmptyState";
import { RichTextBlock } from "@/components/ui/RichText";
import { Modal, Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { Combobox } from "@/components/ui/Combobox";
import { Stepper } from "@/components/ui/Stepper";
import { TabPanel, Tabs, type TabDef } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { MODULE, USER_ROLE_LABEL, isTerminal } from "@/lib/codes";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { announceReadStateChanged } from "@/lib/read-signal";
import { fmtBytes } from "@/lib/attachments";
import type { ActionSpec } from "@/lib/permissions";
import type { Option } from "@/lib/data/meta";
import type { AttachmentMeta, CustomerConfig, TicketDetail } from "@/lib/types";
import { toAttachmentPayload } from "./AttachPicker";
import { Composer } from "./Composer";
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
}

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
  const [loaded, setLoaded] = useState<{
    echoNum: string;
    data?: Payload;
    error?: string;
  } | null>(null);
  const [tabPick, setTabPick] = useState<{
    echoNum: string;
    tab: string;
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

  // 상태 4(해결안제시) 이상이면 고객이 실제로 읽는 '처리결과'를 기본 탭으로
  const defaultTab = (() => {
    if (!t) return "request";
    const n = Number(t.progress);
    return n >= 4 && n !== 10 ? "solution" : "request";
  })();
  const tab =
    echoNum && tabPick?.echoNum === echoNum ? tabPick.tab : defaultTab;
  const setTab = (v: string) => echoNum && setTabPick({ echoNum, tab: v });
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

  const [busy, setBusy] = useState<null | "save" | "comment" | "receive">(null);

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
    setBusy("receive");
    const ok = await runAction("receive", {
      triage: {
        systemId: triage.systemId,
        moduleCode: triage.moduleCode,
        expeTime: triage.expeTime,
        scheDate: triage.scheDate,
      },
    });
    setBusy(null);
    if (ok) setTriage(null);
  };

  const runAction = async (
    action: string,
    payload?: Record<string, unknown>,
  ) => {
    if (!t) return;
    const target = t.echoNum;
    setActionState({ echoNum: target, msg: "처리 중…" });
    const res = await fetch(
      `/api/tickets/${encodeURIComponent(target)}/action`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
      detail?: unknown;
    };
    setActionState({
      echoNum: target,
      msg: body.message ?? body.code ?? `HTTP ${res.status}`,
    });

    // 🔴 202(WRITE_DISABLED)는 **저장되지 않았다**는 뜻이다. res.ok 는 202 를 포함하므로
    //    그걸로 성공을 판정하면 쓰기가 꺼진 기본 설정에서 사용자가 쓰던 초안을 지운다.
    const saved = res.status === 200;
    if (saved) {
      // 초안을 버리고 저장된 값을 다시 읽는다. 안 그러면 방금 저장한 내용이
      // '변경 있음' 으로 남아 두 번 저장하게 된다.
      setDraftState(null);
      setCommentState(null);
      const fresh = await fetch(`/api/tickets/${encodeURIComponent(target)}`);
      if (fresh.ok) {
        setLoaded({ echoNum: target, data: (await fresh.json()) as Payload });
      }
      // 목록·카운트·대시보드는 서버 컴포넌트라 별도로 갱신해야 한다
      router.refresh();
    }
    return saved || res.status === 202;
  };

  const saveSolution = async () => {
    if (!draft) return;
    setBusy("save");
    await runAction("save", { solution: draft });
    setBusy(null);
  };

  const postComment = async () => {
    setBusy("comment");
    await runAction("comment", {
      comment: {
        body: comment.html,
        adminOnly: comment.internalOnly,
        // 댓글과 첨부는 한 요청·한 트랜잭션이다 (ADR-0008)
        attachments: await toAttachmentPayload(comment.files),
      },
    });
    setBusy(null);
  };

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
                        onClick={() =>
                          // 접수는 분류를 확정하는 단계다 — 바로 실행하지 않고 폼을 연다
                          a.action === "receive"
                            ? openTriage()
                            : runAction(a.action)
                        }
                      >
                        {a.label}
                      </button>
                    ),
                  )
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
            <Stepper
              progress={t.progress}
              usesTestStage={data?.config?.usesTestStage}
              usesSystemStage={data?.config?.usesSystemStage}
            />
          </div>

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
              <div className="flex flex-col gap-2.5">
                <HistoryRow
                  label="승인"
                  who={t.history.approver}
                  at={t.history.approvedAt}
                />
                <HistoryRow
                  label="취소 요청"
                  who={t.history.cancelReqBy}
                  at={t.history.cancelReqAt}
                />
                <HistoryRow
                  label="취소"
                  who={t.history.canceler}
                  at={t.history.canceledAt}
                />
                <HistoryRow label="테스트 요청" at={t.history.testAt} />
                <HistoryRow
                  label="테스트 완료"
                  at={t.history.testCompletedAt}
                />
                <HistoryRow label="시스템 이관" at={t.history.systemAt} />
                <HistoryRow
                  label="최종 처리"
                  who={t.history.finalAssignee}
                  at={t.history.finalSuccDate}
                />
                <HistoryRow label="완료" at={t.succDate} />
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

              {/* 실측 5·6=8건, 7·8=3건. 이 고객사에서 안 쓰는 단계는 아예 그리지 않는다 */}
              {data?.config &&
              !data.config.usesTestStage &&
              !data.config.usesSystemStage ? (
                <p className="text-11 text-fg-subtle mt-4 flex items-start gap-1.5 leading-relaxed">
                  <Info size={12} className="mt-0.5 shrink-0" aria-hidden />이
                  고객사는 테스트· 시스템 이관 단계를 사용하지 않습니다. 해당
                  단계는 표시되지 않습니다.
                </p>
              ) : null}
            </TabPanel>
          </Tabs>

          {/* 탭과 무관하게 **항상 보이는** 입력창.
              상태 4 이상이면 기본 탭이 '처리결과'라, 댓글 탭 안에만 두면
              사용자가 "쓸 곳이 없다"고 느낀다 (재설계 §2). */}
          <Composer
            key={t.echoNum}
            value={comment.html}
            onChange={(html) =>
              setCommentState({ ...comment, echoNum: t.echoNum, html })
            }
            files={comment.files}
            onFilesChange={(files) =>
              setCommentState({ ...comment, echoNum: t.echoNum, files })
            }
            onSubmit={postComment}
            sending={busy === "comment"}
            disabled={!data?.can.comment}
            disabledReason={
              isTerminal(t.progress)
                ? "종료된 요청에는 댓글을 남길 수 없습니다."
                : "이 요청에 댓글을 남길 권한이 없습니다."
            }
            canPostInternal={data?.can.postInternalComment ?? false}
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
