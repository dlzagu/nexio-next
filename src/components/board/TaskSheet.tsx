"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, Plus, Repeat2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { Badge } from "@/components/ui/Badge";
import { Combobox } from "@/components/ui/Combobox";
import { Notice } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "@/components/ui/Tabs";
import { listViewForStage } from "@/lib/board";
import { INTAKE, INTAKE_KINDS, MODULE, PRIORITY } from "@/lib/codes";
import type { Option } from "@/lib/data/meta";
import type { TaskTemplate } from "@/lib/data/tasks";
import {
  TASK_REQUIRED_ORDER,
  TEXT_LIMITS,
  taskIntakeSchema,
  type TaskIntakeForm,
} from "@/lib/schemas";
import type { User } from "@/lib/types";

type Tab = "new" | "routine";

/**
 * 등록 시점에 고를 수 있는 단계.
 *
 * 왜 이 4개인가: 대기(1)는 **고객사 승인권자만** 풀 수 있어 우리가 세울 줄이 아니고,
 * 테스트 단계(5·6)는 그 고객사가 쓸 때만 존재하며, 취소·반려는 등록이 아니라 결과다.
 * 값은 상태 코드 그대로 — 화면·DB·전이표가 같은 어휘를 본다.
 */
const STAGES: {
  value: "2" | "3" | "4" | "9";
  label: string;
  hint: (me: string) => string;
}[] = [
  {
    value: "2",
    label: "접수 전",
    hint: () => "신청 단계에 둡니다 — 담당자 없이 누구나 접수할 수 있습니다.",
  },
  {
    value: "3",
    label: "진행 중",
    hint: (me) => `진행 단계에서 시작하고 담당은 ${me}입니다.`,
  },
  {
    value: "4",
    label: "해결안 제시",
    hint: () => "고객 확인을 기다리는 상태로 기록합니다. 답변이 필요합니다.",
  },
  {
    value: "9",
    label: "완료",
    hint: () => "이미 끝난 건을 그대로 기록합니다. 처리 내용이 필요합니다.",
  },
];

const toOptions = (m: Record<string, string>): Option[] =>
  Object.entries(m).map(([value, label]) => ({ value, label }));

/**
 * 업무 등록 — 고객사가 포털에 넣지 못하는 건을 운영팀이 대신 넣는 자리.
 *
 * 왜 신청 화면(`/requests/new`)이 아니라 여기인가: 이건 **신청이 아니라 접수**다.
 * 전화로 받은 건, 메일로 온 건, 우리가 발의한 정기 작업은 등록하는 순간 이미
 * 내 작업 큐에 들어가야 한다 — 그 큐를 보는 화면이 업무 현황이다.
 *
 * 두 번째 탭(정기 업무)이 같은 시트에 있는 이유: 반복 등록을 만들어 놓고
 * 목록을 어디서도 볼 수 없으면, 내려놓을 방법이 없는 **막다른 길**이 된다.
 */
export function TaskSheet({
  open,
  onOpenChange,
  user,
  companies,
  requesters,
  systems,
  templates,
  ym,
  today,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: User;
  companies: Option[];
  requesters: Option[];
  systems: Option[];
  templates: TaskTemplate[];
  /** 서버가 만든 기준 달 'YYYY-MM' — 브라우저 시계로 계산하면 월말에 어긋난다 */
  ym: string;
  /** 서버 기준일 'YYYY-MM-DD' — 완료일 상한. 같은 이유로 브라우저 시계를 쓰지 않는다 */
  today: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("new");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    text: string;
    failed: boolean;
    /** 방금 내린 정기 업무 — 안내 옆에 '되돌리기'를 붙인다 */
    undo?: TaskTemplate;
  } | null>(null);
  /** '내리기'를 한 번 더 확인 중인 템플릿. 1클릭으로 내리면 다음 달이 조용히 빈다 */
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitted },
  } = useForm<TaskIntakeForm>({
    resolver: zodResolver(taskIntakeSchema),
    mode: "onBlur",
    // 포커스는 onInvalid 한 곳이 정한다 — RHF 기본값은 onInvalid 뒤에 제목 칸으로 다시 옮긴다
    shouldFocusError: false,
    defaultValues: {
      kind: "phone",
      custCode: "",
      systemId: "",
      requesterId: "",
      title: "",
      content: "",
      moduleCode: "",
      priority: "3",
      scheDate: "",
      stage: "3",
      answer: "",
      doneDate: "",
      workTime: "",
      repeatMonthly: false,
      repeatDay: 1,
    },
  });

  const v = watch();
  const custCode = v.custCode ?? "";

  /**
   * 고른 고객사의 것만 남긴다. 목록을 좁히는 건 편의일 뿐이라 서버가 다시 확인하지만,
   * 좁히지 않으면 **다른 고객사의 시스템을 골라 400 을 맞는** 길이 열려 있다.
   */
  const systemsOf = systems.filter((o) => !custCode || o.group === custCode);
  const requestersOf = requesters.filter(
    (o) => !custCode || o.group === custCode,
  );

  const pending = templates.filter((t) => t.pending);
  const stage = STAGES.find((s) => s.value === v.stage) ?? STAGES[1];
  // 해결안 제시·완료는 처리결과 탭이 기본으로 열리는 단계라 내용 없이 만들 수 없다
  const needsAnswer = v.stage === "4" || v.stage === "9";

  const errorList = TASK_REQUIRED_ORDER.filter(
    (k) => errors[k as keyof TaskIntakeForm],
  ).map((k) => String(errors[k as keyof TaskIntakeForm]?.message ?? ""));

  const post = async (
    url: string,
    body?: unknown,
    method: "POST" | "PATCH" = "POST",
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        echoNum?: string;
      };
      setBusy(false);
      return { res, data };
    } catch (e) {
      setBusy(false);
      setMsg({
        text: `요청을 보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`,
        failed: true,
      });
      return null;
    }
  };

  const onSubmit = async (values: TaskIntakeForm) => {
    const out = await post("/api/tasks", values);
    if (!out) return;
    const { res, data } = out;

    // 🔴 성공은 201 뿐이다. 202(쓰기 잠금)를 성공으로 읽으면 저장 안 된 채 폼이 비워진다
    if (res.status === 201 && data.echoNum) {
      reset();
      onOpenChange(false);
      // 뒤에 깔린 목록이 0건이면 저장이 안 된 것처럼 보인다 — 단계별로 보이는 뷰를 고른다
      router.push(
        `/requests?view=${listViewForStage(values.stage ?? "3")}` +
          `&open=${encodeURIComponent(data.echoNum)}`,
      );
      router.refresh();
      return;
    }
    setMsg({
      text:
        data.message ??
        `등록하지 못했습니다 (${data.code ?? `HTTP ${res.status}`}).`,
      failed: res.status !== 202,
    });
  };

  /**
   * 첫 제출 실패에 첫 오류 칸으로 스크롤·포커스. 고객사·시스템은 register 없는 콤보박스라
   * RHF 기본 포커스는 그 아래 제목 칸으로 가 버린다 — 정작 비어 있는 칸은 화면 밖에 남는다.
   * 🔴 인자로 받은 오류를 쓴다 (바깥 errors 는 렌더 시점 스냅샷이라 첫 제출에 비어 있다).
   */
  const onInvalid = (errs: FieldErrors<TaskIntakeForm>) => {
    const first =
      TASK_REQUIRED_ORDER.find((k) => errs[k as keyof TaskIntakeForm]) ??
      Object.keys(errs)[0];
    if (!first) return;
    const el = document.getElementById(`f-t-${first}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  };

  const runTemplates = async () => {
    const out = await post("/api/tasks/templates/run");
    if (!out) return;
    const { res, data } = out;
    setMsg({
      text: data.message ?? `HTTP ${res.status}`,
      failed: !res.ok && res.status !== 202,
    });
    if (res.status === 200) router.refresh();
  };

  /**
   * 정기 업무 내리기(active=false) / 되돌리기(active=true).
   * 목록은 활성만 보여 주므로 내린 건 여기서 사라진다 → 성공 안내 옆에 되돌리기를 붙인다.
   * 🔴 성공은 200 뿐 — 202(쓰기 잠김)에 되돌리기를 붙이면 내리지도 않은 걸 되살리는 셈이다.
   */
  const setTemplateActive = async (t: TaskTemplate, active: boolean) => {
    setConfirmDrop(null);
    const out = await post(
      "/api/tasks/templates",
      { id: t.id, active },
      "PATCH",
    );
    if (!out) return;
    const { res, data } = out;
    const ok = res.status === 200;
    setMsg({
      text: data.message ?? `HTTP ${res.status}`,
      failed: !ok && res.status !== 202,
      undo: ok && !active ? t : undefined,
    });
    if (ok) router.refresh();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="업무 등록"
      header={
        <Segmented<Tab>
          ariaLabel="업무 등록 탭"
          value={tab}
          onChange={setTab}
          options={[
            { value: "new", label: "업무 등록" },
            {
              value: "routine",
              label: "정기 업무",
              count: templates.length,
            },
          ]}
        />
      }
    >
      {msg ? (
        <div className="px-5 pt-4">
          <Notice tone={msg.failed ? "danger" : "info"}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex-1">{msg.text}</span>
              {msg.undo ? (
                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  disabled={busy}
                  onClick={() => msg.undo && setTemplateActive(msg.undo, true)}
                >
                  되돌리기
                </button>
              ) : null}
            </span>
          </Notice>
        </div>
      ) : null}

      {tab === "new" ? (
        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          className="flex flex-col gap-4 p-5"
          noValidate
        >
          {isSubmitted && errorList.length > 0 ? (
            <Notice tone="danger">
              <p className="mb-1 font-medium">
                입력을 확인해 주세요 ({errorList.length}건)
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {errorList.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <Field id="f-kind" label="어떻게 들어온 건인가요" required group>
            <div className="flex flex-wrap gap-1.5">
              {INTAKE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={v.kind === k}
                  onClick={() => setValue("kind", k, { shouldValidate: true })}
                  className={
                    v.kind === k
                      ? "btn btn-primary btn-sm"
                      : "btn btn-outline btn-sm"
                  }
                >
                  {INTAKE[k].label}
                </button>
              ))}
            </div>
            <p className="field-hint">
              포털로 들어오지 않은 건이라 출처를 함께 남깁니다 — 나중에 &quot;이
              건은 어디서 왔나&quot;를 알 수 있습니다.
            </p>
          </Field>

          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field
              id="f-t-custCode"
              label="고객사"
              required
              error={errors.custCode?.message as string | undefined}
            >
              <Combobox
                id="f-t-custCode"
                options={companies}
                value={custCode}
                onChange={(x) => {
                  setValue("custCode", x, { shouldValidate: true });
                  // 고객사가 바뀌면 그 회사 것이 아닌 선택은 버린다 (남겨 두면 서버가 거부한다)
                  setValue("systemId", "");
                  setValue("requesterId", "");
                }}
                placeholder="고객사 선택"
                allowClear={false}
                invalid={!!errors.custCode}
              />
            </Field>

            <Field
              id="f-t-systemId"
              label="운영시스템"
              required
              error={errors.systemId?.message as string | undefined}
              hint={custCode ? undefined : "고객사를 먼저 고르면 좁혀집니다"}
            >
              <Combobox
                id="f-t-systemId"
                options={systemsOf}
                value={v.systemId ?? ""}
                onChange={(x) =>
                  setValue("systemId", x, { shouldValidate: true })
                }
                placeholder="시스템 선택"
                allowClear={false}
                invalid={!!errors.systemId}
              />
            </Field>

            <Field
              id="f-t-requesterId"
              label="문의한 사람"
              hint="비우면 우리 내부 기록으로 남습니다 — 고객사 담당자에게는 보이지 않고, 승인권자에게는 보입니다"
            >
              <Combobox
                id="f-t-requesterId"
                options={requestersOf}
                value={v.requesterId ?? ""}
                onChange={(x) => setValue("requesterId", x)}
                placeholder="지정 안 함"
                clearLabel="지정 안 함"
              />
            </Field>

            <Field id="f-t-priority" label="우선순위">
              <Combobox
                id="f-t-priority"
                options={toOptions(PRIORITY)}
                value={v.priority ?? "3"}
                onChange={(x) => setValue("priority", x || "3")}
                allowClear={false}
              />
            </Field>
          </div>

          <Field
            id="f-t-title"
            label="제목"
            required
            error={errors.title?.message as string | undefined}
          >
            <input
              id="f-t-title"
              className="input"
              aria-invalid={errors.title ? "true" : undefined}
              placeholder="예: 월 백업 정상 여부 확인"
              {...register("title")}
            />
          </Field>

          <Field
            id="f-t-content"
            label="업무 내용"
            required
            error={errors.content?.message as string | undefined}
          >
            <textarea
              id="f-t-content"
              maxLength={TEXT_LIMITS.body}
              className="input min-h-[120px]"
              aria-invalid={errors.content ? "true" : undefined}
              placeholder="무엇을 해야 하는지, 어디까지 확인했는지 적어 주세요."
              {...register("content")}
            />
          </Field>

          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field id="f-t-moduleCode" label="모듈">
              <Combobox
                id="f-t-moduleCode"
                options={toOptions(MODULE)}
                value={v.moduleCode ?? ""}
                onChange={(x) => setValue("moduleCode", x)}
                placeholder="선택"
              />
            </Field>

            <Field
              id="f-t-scheDate"
              label="기한"
              error={errors.scheDate?.message as string | undefined}
            >
              <input
                id="f-t-scheDate"
                type="date"
                className="input"
                aria-invalid={errors.scheDate ? "true" : undefined}
                {...register("scheDate")}
              />
            </Field>
          </div>

          {/* 처리 단계 — 전화로 받아 그 자리에서 끝내고 나중에 적는 경우가 흔하다 */}
          <div className="border-line-subtle flex flex-col gap-2 rounded-md border p-3">
            <Field id="f-t-stage" label="지금 어디까지 됐나요" required group>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map((st) => (
                  <button
                    key={st.value}
                    type="button"
                    aria-pressed={v.stage === st.value}
                    onClick={() => {
                      setValue("stage", st.value, { shouldValidate: true });
                      /**
                       * 감춘 칸의 값은 **지운다.** 남겨 두면 완료로 적다가 진행으로
                       * 되돌렸을 때 처리내용이 그대로 실려 가, 화면에 안 보이는 값이
                       * 저장되는 셈이 된다(서버도 버리지만 화면이 먼저 정직해야 한다).
                       */
                      if (st.value !== "4" && st.value !== "9") {
                        setValue("answer", "");
                      }
                      if (st.value !== "9") {
                        setValue("doneDate", "");
                        setValue("workTime", "");
                      }
                    }}
                    className={
                      v.stage === st.value
                        ? "btn btn-primary btn-sm"
                        : "btn btn-outline btn-sm"
                    }
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              <p className="field-hint">{stage.hint(user.name)}</p>
            </Field>

            {needsAnswer ? (
              <Field
                id="f-t-answer"
                label={v.stage === "9" ? "처리 내용" : "해결안 · 답변"}
                required
                error={errors.answer?.message as string | undefined}
                hint="이 단계부터 고객 화면은 '처리결과'가 기본으로 열립니다 — 비어 있으면 빈 화면이 보입니다"
              >
                <textarea
                  id="f-t-answer"
                  maxLength={TEXT_LIMITS.body}
                  className="input min-h-[96px]"
                  aria-invalid={errors.answer ? "true" : undefined}
                  placeholder="어떻게 처리했는지 · 고객에게 무엇을 안내했는지"
                  {...register("answer")}
                />
              </Field>
            ) : null}

            {v.stage === "9" ? (
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field
                  id="f-t-doneDate"
                  label="완료일"
                  error={errors.doneDate?.message as string | undefined}
                  hint="비우면 오늘. 지난 날짜로 적을 수 있습니다"
                >
                  <input
                    id="f-t-doneDate"
                    type="date"
                    max={today}
                    className="input"
                    aria-invalid={errors.doneDate ? "true" : undefined}
                    {...register("doneDate")}
                  />
                </Field>
                <Field
                  id="f-t-workTime"
                  label="작업 시간 (h)"
                  error={errors.workTime?.message as string | undefined}
                  hint="선택 — 예: 1.5"
                >
                  <input
                    id="f-t-workTime"
                    inputMode="decimal"
                    className="input"
                    aria-invalid={errors.workTime ? "true" : undefined}
                    placeholder="1.5"
                    {...register("workTime")}
                  />
                </Field>
              </div>
            ) : null}

            {v.stage === "9" ? (
              <Notice tone="warning">
                완료로 등록하면 <b>이후 댓글·처리내역 수정이 잠깁니다</b>(종료건
                규칙). 내용을 확인하고 등록해 주세요.
              </Notice>
            ) : null}

            <label className="text-13 mt-2 flex cursor-pointer items-center gap-2">
              <input type="checkbox" {...register("repeatMonthly")} />
              <Repeat2 size={13} aria-hidden />
              매월 반복되는 업무로 저장
            </label>
            {v.repeatMonthly ? (
              <div className="flex flex-wrap items-start gap-2">
                {/* 🔴 오류가 인라인에도 배너에도 안 뜨면 등록 버튼이 '무반응'으로 보인다 */}
                <Field
                  id="f-t-repeatDay"
                  label="매월"
                  error={errors.repeatDay?.message as string | undefined}
                  /* .input 이 width:100% 라 유틸리티 폭이 무시된다 → 감싸는 요소가 정한다 */
                  className="w-[92px]"
                >
                  <input
                    id="f-t-repeatDay"
                    type="number"
                    min={1}
                    max={28}
                    className="input"
                    aria-invalid={errors.repeatDay ? "true" : undefined}
                    {...register("repeatDay")}
                  />
                </Field>
                <span className="text-12 text-fg-muted pt-6">
                  일 기준 · 다음 달부터는 &apos;정기 업무&apos; 탭에서 한 번에
                  만듭니다 (29~31일은 없는 달이 생겨 받지 않습니다)
                  {needsAnswer
                    ? " · 다음 달 생성분은 '진행 중'에서 시작합니다"
                    : ""}
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pb-1">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Plus size={14} aria-hidden />
              {busy ? "등록 중…" : "등록"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 p-5">
          <div className="bg-subtle border-line-subtle flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
            <p className="text-12 text-fg-muted">
              {pending.length > 0
                ? `${ym} 아직 만들지 않은 정기 업무 ${pending.length}건`
                : `${ym} 정기 업무는 모두 만들어져 있습니다`}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || pending.length === 0}
              onClick={runTemplates}
            >
              <CalendarClock size={13} aria-hidden />
              이번 달 {pending.length}건 만들기
            </button>
          </div>

          {templates.length === 0 ? (
            <Notice tone="info">
              아직 정기 업무가 없습니다. &apos;업무 등록&apos; 탭에서{" "}
              <b>매월 반복되는 업무로 저장</b>을 켜면 여기에 쌓입니다.
            </Notice>
          ) : (
            <ul className="flex flex-col gap-2">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="border-line-subtle flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2"
                >
                  <span className="text-13 text-fg-strong font-medium">
                    {t.title}
                  </span>
                  <span className="text-11 text-fg-subtle">
                    {t.custName} · 매월 {t.day}일
                    {t.ownerName ? ` · ${t.ownerName}` : ""}
                  </span>
                  <Badge
                    tone={t.pending ? "warning" : "success"}
                    className="ml-auto"
                  >
                    {t.pending ? "이번 달 미생성" : "이번 달 생성됨"}
                  </Badge>
                  {confirmDrop === t.id ? (
                    // 한 번 더 묻는다 — 내리면 다음 달부터 이 업무가 만들어지지 않는다
                    <span className="flex w-full flex-wrap items-center justify-end gap-2">
                      <span className="text-12 text-warning-text flex-1">
                        내리면 다음 달부터 이 업무를 만들지 않습니다. 이미 만든
                        이번 달 건은 그대로 남습니다.
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setConfirmDrop(null)}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-soft btn-sm"
                        disabled={busy}
                        onClick={() => setTemplateActive(t, false)}
                      >
                        내리기
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setConfirmDrop(t.id)}
                    >
                      내리기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
