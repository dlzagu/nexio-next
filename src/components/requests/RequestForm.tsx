"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ImageOff,
  Paperclip,
  RotateCcw,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AttachPicker, toAttachmentPayload } from "./AttachPicker";
import { Combobox } from "@/components/ui/Combobox";
import { Notice } from "@/components/ui/EmptyState";
import { TokenInput } from "@/components/ui/TokenInput";
import { cn } from "@/lib/cn";
import { MODULE, PRIORITY } from "@/lib/codes";
import type { Option } from "@/lib/data/meta";
import {
  REQUIRED_ORDER,
  requestFormSchema,
  type RequestForm as FormValues,
} from "@/lib/schemas";
import type { ReRequestSeed } from "@/lib/data/tickets";
import type { CustomerConfig, User } from "@/lib/types";

const toOptions = (m: Record<string, string>): Option[] =>
  Object.entries(m).map(([value, label]) => ({ value, label }));

/**
 * 이 화면의 주된 결정: **"내 문제를 담당자가 바로 이해할 수 있게 적었는가."**
 *
 * Step 분해는 하지 않는다 — 입력이 20개뿐이라 쪼개면 인지 비용만 늘어난다.
 * 원본의 순차 alert 8단계를 인라인 검증 + 제출 시 전체 요약으로 바꾼다.
 */
export function RequestForm({
  user,
  config,
  companies,
  requesters,
  systems,
  contractTime,
  reRequestFrom,
  initial,
}: {
  user: User;
  config: CustomerConfig | null;
  companies: Option[];
  requesters: Option[];
  systems: Option[];
  contractTime: { month: number; used: number; remain: number } | null;
  reRequestFrom: string | null;
  /** 재신청 프리필. null 이면 빈 양식 */
  initial: ReRequestSeed | null;
}) {
  const router = useRouter();
  const [advanced, setAdvanced] = useState(false);
  const [pasteWarning, setPasteWarning] = useState(false);
  const [submitState, setSubmitState] = useState<{
    text: string;
    failed: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const isCustomer = user.role === "CUSTOMER";
  const defaultRequester = isCustomer ? user.id : "";

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitted },
  } = useForm<FormValues>({
    resolver: zodResolver(requestFormSchema),
    mode: "onBlur",
    defaultValues: {
      custCode: initial?.custCode || (isCustomer ? user.custCode : ""),
      requesterId: defaultRequester,
      requesterEmail: user.email ?? "",
      systemId: initial?.systemId ?? "",
      title: initial?.title ?? "",
      symptom: initial?.symptom ?? "",
      content: initial?.content ?? "",
      moduleCode: initial?.moduleCode ?? "",
      priority: initial?.priority ?? "3",
      scheDate: "",
      isPublic: initial ? initial.isPublic : !(config?.defaultPrivate ?? true),
      refEmails: [],
    },
  });

  const v = watch();
  // 이메일은 이 화면에서 고칠 수 없다 → 인라인 오류가 아니라 차단 배너로 처리한다
  const emailMissing = !user.email;

  const errorList = REQUIRED_ORDER.filter(
    (k) => errors[k as keyof FormValues],
  ).map((k) => ({
    field: k,
    message: String(errors[k as keyof FormValues]?.message ?? ""),
  }));

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setSubmitState(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          from: reRequestFrom ?? "",
          // 첨부는 본문과 **한 요청**으로 간다 — 나눠 보내면 한쪽만 저장된다
          attachments: await toAttachmentPayload(files),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        echoNum?: string;
        message?: string;
        code?: string;
      };
      if (res.status === 201 && body.echoNum) {
        // 저장된 건을 바로 열어 준다 — "접수됐는지 모르겠다"가 남지 않게.
        // 이동이 끝날 때까지 submitting 을 풀지 않아 중복 제출을 막는다.
        router.push(
          `/requests?view=mine&open=${encodeURIComponent(body.echoNum)}`,
        );
        return;
      }
      setSubmitState({
        text:
          body.message ??
          `요청을 저장하지 못했습니다 (${body.code ?? `HTTP ${res.status}`}).`,
        // 202(쓰기 비활성)는 실패가 아니라 "여기까지는 통과" 라는 안내다
        failed: res.status !== 202,
      });
    } catch (e) {
      setSubmitState({
        text: `요청을 보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`,
        failed: true,
      });
    }
    setSubmitting(false);
  };

  const onInvalid = () => {
    // 제출 시 미충족 필드 전체를 한 번에 보여주고 첫 필드로 스크롤·포커스
    const first = REQUIRED_ORDER.find((k) => errors[k as keyof FormValues]);
    if (first) {
      const el = document.getElementById(`f-${first}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="mx-auto flex max-w-[860px] flex-col gap-4 p-5"
      noValidate
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
            서비스 신청
          </h1>
          <p className="text-12 text-fg-muted mt-1">
            되묻지 않아도 되는 요청이 되도록, 증상과 요청내용을 나눠 적어
            주세요.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            reset();
            setFiles([]);
          }}
        >
          <RotateCcw size={13} aria-hidden />
          초기화
        </button>
      </header>

      {reRequestFrom ? (
        initial ? (
          <Notice tone="accent">
            ↻ <span className="mono">{reRequestFrom}</span> 의 내용을
            불러왔습니다. 프리필된 값은 그대로 제출하거나 수정할 수 있습니다.{" "}
            <Link
              href={`/requests?view=all&open=${encodeURIComponent(reRequestFrom)}`}
            >
              원본 보기
            </Link>
          </Notice>
        ) : (
          <Notice tone="warning">
            ↻ <span className="mono">{reRequestFrom}</span> 을 찾을 수 없어 빈
            양식으로 시작합니다. 접수번호를 확인해 주세요.
          </Notice>
        )
      ) : null}

      {/* 이메일 누락은 이 화면에서 해결할 수 없다 → 인라인 오류 대신 차단 배너 */}
      {emailMissing ? (
        <Notice tone="danger">
          <strong>신청자 이메일이 등록되지 않았습니다.</strong> 이 화면에서는
          수정할 수 없습니다 — 회원정보에서 이메일을 먼저 등록해 주세요. 등록
          전에는 처리 알림을 받을 수 없습니다.
        </Notice>
      ) : null}

      {isSubmitted && errorList.length > 0 ? (
        <Notice tone="danger">
          <p className="mb-1 font-medium">
            입력을 확인해 주세요 ({errorList.length}건)
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {errorList.map((e) => (
              <li key={e.field}>{e.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Card>
        <CardHeader title="신청 정보" />
        <CardBody className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field
            id="f-custCode"
            label="고객사"
            required
            error={errors.custCode?.message as string | undefined}
          >
            <Combobox
              id="f-custCode"
              options={companies}
              value={v.custCode ?? ""}
              onChange={(x) =>
                setValue("custCode", x, { shouldValidate: true })
              }
              placeholder="고객사 선택"
              allowClear={false}
              invalid={!!errors.custCode}
            />
          </Field>

          <Field
            id="f-requesterId"
            label="신청자"
            required
            error={errors.requesterId?.message as string | undefined}
            hint={
              user.email
                ? `${user.email}${user.dept ? ` · ${user.dept}` : ""}`
                : undefined
            }
          >
            <Combobox
              id="f-requesterId"
              options={requesters}
              value={v.requesterId ?? ""}
              onChange={(x) =>
                setValue("requesterId", x, { shouldValidate: true })
              }
              placeholder="신청자 선택"
              allowClear={false}
              invalid={!!errors.requesterId}
            />
          </Field>

          <Field
            id="f-systemId"
            label="운영시스템"
            required
            error={errors.systemId?.message as string | undefined}
          >
            <Combobox
              id="f-systemId"
              options={systems}
              value={v.systemId ?? ""}
              onChange={(x) =>
                setValue("systemId", x, { shouldValidate: true })
              }
              placeholder="시스템 선택"
              allowClear={false}
              invalid={!!errors.systemId}
            />
          </Field>

          <Field id="f-moduleCode" label="모듈">
            <Combobox
              id="f-moduleCode"
              options={toOptions(MODULE)}
              value={v.moduleCode ?? ""}
              onChange={(x) => setValue("moduleCode", x)}
              placeholder="선택 (선택사항)"
              clearLabel="선택 없음"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="요청 내용" />
        <CardBody className="flex flex-col gap-4">
          <Field
            id="f-title"
            label="제목"
            required
            error={errors.title?.message as string | undefined}
            hint="무엇이 어떻게 안 되는지 한 줄로. 예: 부가세 신고 메뉴 접속 시 오류"
          >
            <input
              id="f-title"
              {...register("title")}
              className="input"
              aria-invalid={!!errors.title}
              maxLength={150}
            />
          </Field>

          <Field
            id="f-symptom"
            label="증상"
            required
            error={errors.symptom?.message as string | undefined}
            hint="언제·어디서·무엇을 했을 때 어떤 화면/메시지가 나오는지"
          >
            <textarea
              id="f-symptom"
              {...register("symptom")}
              className="input min-h-[88px]"
              aria-invalid={!!errors.symptom}
            />
          </Field>

          <Field
            id="f-content"
            label="요청내용"
            required
            error={errors.content?.message as string | undefined}
          >
            <textarea
              id="f-content"
              {...register("content")}
              className="input min-h-[132px]"
              aria-invalid={!!errors.content}
              onPaste={(e) => {
                // 외부(메일/웹)에서 복사한 이미지는 저장되지 않는다 — 원본의 실사용 제약.
                // 원본은 '저장 버튼을 누른 뒤'에 알려줬다 → 붙여넣기 시점에 즉시 경고한다.
                const hasImage = Array.from(e.clipboardData.items).some((it) =>
                  it.type.startsWith("image/"),
                );
                if (hasImage) setPasteWarning(true);
              }}
            />
          </Field>

          {pasteWarning ? (
            <div className="border-warning-border bg-warning-subtle flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <ImageOff size={13} aria-hidden className="text-warning-text" />
              <span className="text-12 text-warning-text flex-1">
                붙여넣은 이미지는 저장되지 않습니다. 파일로 첨부해 주세요.
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => document.getElementById("f-attach")?.click()}
              >
                <Paperclip size={12} aria-hidden />
                파일로 첨부
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPasteWarning(false)}
              >
                닫기
              </button>
            </div>
          ) : null}

          <div>
            <span className="label">첨부 파일</span>
            <AttachPicker
              files={files}
              onChange={setFiles}
              inputId="f-attach"
            />
          </div>
        </CardBody>
      </Card>

      {/* 안 쓰는 것은 접는다 — 기본 접힘 */}
      <Card>
        <button
          type="button"
          className="card-hd w-full text-left"
          aria-expanded={advanced}
          onClick={() => setAdvanced((x) => !x)}
        >
          <span className="card-ti">추가 설정</span>
          <span className="text-11 text-fg-subtle">
            희망 완료일 · 우선순위 · 공개 여부 · 참조자 {advanced ? "▲" : "▼"}
          </span>
        </button>
        {advanced ? (
          <CardBody className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field
              id="f-scheDate"
              label="희망 완료일"
              error={errors.scheDate?.message as string | undefined}
              hint="2년 이내로 선택해 주세요"
            >
              <input
                id="f-scheDate"
                type="date"
                {...register("scheDate")}
                className="input"
                aria-invalid={!!errors.scheDate}
              />
            </Field>

            <Field id="f-priority" label="우선순위">
              <Combobox
                id="f-priority"
                options={toOptions(PRIORITY)}
                value={v.priority ?? "3"}
                onChange={(x) => setValue("priority", x)}
                allowClear={false}
              />
            </Field>

            <Field id="f-isPublic" label="공개 여부">
              <label className="text-13 flex h-[var(--ctl-h-md)] cursor-pointer items-center gap-2">
                <input type="checkbox" {...register("isPublic")} />
                같은 회사 구성원에게 공개
              </label>
              <p className="field-hint">
                비공개로 두면 작성자와 승인자만 볼 수 있습니다
                {config?.defaultPrivate ? " (이 고객사 기본값: 비공개)" : ""}.
              </p>
            </Field>

            <Field id="f-refEmails" label="참조자">
              <TokenInput
                id="f-refEmails"
                values={v.refEmails ?? []}
                onChange={(x) => setValue("refEmails", x)}
              />
            </Field>
          </CardBody>
        ) : null}
      </Card>

      {/* showYn='N' 이면 영역 자체를 렌더하지 않는다 */}
      {config?.showsContractTime && contractTime ? (
        <div className="border-line-subtle bg-subtle text-12 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border px-4 py-3">
          <span className="text-fg-muted">
            이번 달 계약시간{" "}
            <strong className="num text-fg-strong">
              {contractTime.month}h
            </strong>
          </span>
          <span className="text-fg-muted">
            사용{" "}
            <strong className="num text-fg-strong">{contractTime.used}h</strong>
          </span>
          <span
            className={cn(
              contractTime.remain <= 0 ? "text-danger-text" : "text-fg-muted",
            )}
          >
            잔여 <strong className="num">{contractTime.remain}h</strong>
          </span>
        </div>
      ) : null}

      {submitState ? (
        <Notice tone={submitState.failed ? "danger" : "info"}>
          <span className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {submitState.text}
          </span>
        </Notice>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-11 text-fg-subtle">
          필수 항목 {REQUIRED_ORDER.length}개 · 제출 시 미충족 항목을 한 번에
          알려드립니다
        </p>
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={emailMissing || submitting}
        >
          <Send size={14} aria-hidden />
          {submitting ? "접수 중…" : "신청하기"}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={cn("label", required && "label-req")}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
