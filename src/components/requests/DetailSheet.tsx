"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { InlineError, Notice } from "@/components/ui/EmptyState";
import { RichTextBlock } from "@/components/ui/RichText";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stepper } from "@/components/ui/Stepper";
import { TabPanel, Tabs, type TabDef } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { USER_ROLE_LABEL, isTerminal } from "@/lib/codes";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import type { ActionSpec } from "@/lib/permissions";
import type { CustomerConfig, TicketDetail } from "@/lib/types";
import { Composer } from "./Composer";
import { SolutionPanel, toDraft, type SolutionDraft } from "./SolutionPanel";

interface Payload {
  ticket: TicketDetail;
  config: CustomerConfig | null;
  actions: ActionSpec[];
  cancelHint: string | null;
  can: {
    editSolution: boolean;
    comment: boolean;
    editSolutionReason: string | null;
  };
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
      .then((p) => alive && setLoaded({ echoNum, data: p }))
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
  }, [echoNum]);

  // 현재 열린 티켓의 응답만 유효하다 — 이전 티켓의 응답이 남아 보이지 않는다
  const fresh = echoNum && loaded?.echoNum === echoNum ? loaded : null;
  const data = fresh?.data ?? null;
  const error = fresh?.error ?? null;
  const t = data?.ticket;
  const actionMsg =
    echoNum && actionState?.echoNum === echoNum ? actionState.msg : null;

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
  } | null>(null);
  const comment =
    echoNum && commentState?.echoNum === echoNum
      ? commentState
      : { echoNum: echoNum ?? "", html: "", internalOnly: false };

  const [busy, setBusy] = useState<null | "save" | "comment">(null);

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
    return res.ok || res.status === 202;
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
      comment: { body: comment.html, adminOnly: comment.internalOnly },
    });
    setBusy(null);
  };

  return (
    <Sheet
      open={!!echoNum}
      onOpenChange={(v) => !v && onClose()}
      resizable
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
                <span className="badge badge-neutral">비공개</span>
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
                  data.actions.map((a) => (
                    <button
                      key={a.action}
                      type="button"
                      className={cn("btn", VARIANT[a.variant])}
                      onClick={() => runAction(a.action)}
                    >
                      {a.label}
                    </button>
                  ))
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
            onSubmit={postComment}
            sending={busy === "comment"}
            disabled={!data?.can.comment}
            disabledReason={
              isTerminal(t.progress)
                ? "종료된 요청에는 댓글을 남길 수 없습니다."
                : "이 요청에 댓글을 남길 권한이 없습니다."
            }
            canPostInternal={data?.can.editSolution ?? false}
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
    </Sheet>
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

export function OpenInNewTab({ echoNum }: { echoNum: string }) {
  return (
    <a
      href={`/requests?view=all&open=${encodeURIComponent(echoNum)}`}
      target="_blank"
      rel="noreferrer"
      className="btn btn-ghost btn-xs"
    >
      <ExternalLink size={11} aria-hidden />새 탭
    </a>
  );
}
