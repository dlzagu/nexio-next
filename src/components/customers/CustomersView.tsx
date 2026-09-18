"use client";

import { Plus, Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { CustomerRow } from "@/lib/data/customers";
import { newCustomerSchema } from "@/lib/schemas";

type Msg = { text: string; tone: "danger" | "warning" | "info" };

type CustomerForm = {
  custCode: string;
  custName: string;
  systemName: string;
  usesApproval: boolean;
  usesTestStage: boolean;
  usesSystemStage: boolean;
  defaultPrivate: boolean;
  showsContractTime: boolean;
};

type FormIssues = Partial<Record<keyof CustomerForm, string>>;

/**
 * 등록 폼의 칸별 오류. 라우트와 **같은 스키마**로 먼저 거른다(컨벤션 — 폼·라우트 공유).
 * 🔒 운영시스템은 필수 — 라우트·createCustomer 도 같은 조건으로 막는다(fail-closed).
 *    없으면 신청 화면에서 고를 게 없는 고객사가 영구히 남는다(ADR-0010 §3).
 */
function formIssues(form: CustomerForm): FormIssues {
  const out: FormIssues = {};
  const parsed = newCustomerSchema.safeParse(form);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CustomerForm;
      out[key] ??= issue.message;
    }
  }
  if (!form.systemName.trim()) {
    out.systemName ??= "운영시스템 이름을 입력해 주세요";
  }
  return out;
}

/**
 * 아무 효과가 없는 설정을 효과 있는 것처럼 두지 않는다 — 막지는 않고(값은 저장된다)
 * **지금 이 데모에서 무엇을 하는지** 옆에 적는다.
 */
const STAGE_TOGGLES: readonly {
  key:
    | "usesApproval"
    | "usesTestStage"
    | "usesSystemStage"
    | "defaultPrivate"
    | "showsContractTime";
  label: string;
  note?: string;
}[] = [
  { key: "usesApproval", label: "승인 단계 사용 (신청 전 승인권자 결재)" },
  {
    key: "usesTestStage",
    label: "테스트 단계 사용",
    note: "표시용 — 이 데모에는 테스트 단계로 들어가는 전이가 없어 단계 표시에만 나타납니다",
  },
  {
    key: "usesSystemStage",
    label: "시스템 이관 단계 사용",
    note: "표시용 — 이 데모에는 이관 단계로 들어가는 전이가 없어 단계 표시에만 나타납니다",
  },
  { key: "defaultPrivate", label: "신청을 기본 비공개로" },
  {
    key: "showsContractTime",
    label: "계약시간 표시",
    note: "표시용 — 이 데모에는 계약시간 데이터가 없어 신청 화면에 나타나지 않습니다",
  },
];

/**
 * 고객사 관리. 원본 내부관리 27종 중 이것 하나만 이식했다 — 고객사가 없으면
 * 신청 자체가 시작되지 않기 때문이다 (ADR-0010).
 *
 * 🔴 "삭제"는 비활성이다. 티켓이 고객사 코드를 참조하므로 행을 지우면 이력이 끊긴다.
 *    화면도 그렇게 말한다 — 지운 척하고 남겨 두면 나중에 더 혼란스럽다.
 */
export function CustomersView({
  rows,
  canDeactivate,
  blockedReason,
}: {
  rows: CustomerRow[];
  canDeactivate: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** 페이지 안내 — 비활성 전환 결과 · 등록 성공 */
  const [msg, setMsg] = useState<Msg | null>(null);
  /**
   * 등록 모달 **안의** 안내 — 실패 · 쓰기 잠김.
   * 🔴 모달이 열린 동안 페이지는 오버레이 뒤(aria-hidden)라, 거기 그리면 버튼이
   *    '등록 중…' → '등록'으로 돌아올 뿐 아무 반응이 없는 것처럼 보인다.
   */
  const [formMsg, setFormMsg] = useState<Msg | null>(null);
  /** 손댄 칸만 오류를 보인다 — 열자마자 빨간 글씨가 깔리면 읽지 않는다 */
  const [touched, setTouched] = useState<
    Partial<Record<keyof CustomerForm, boolean>>
  >({});
  const [form, setForm] = useState<CustomerForm>({
    custCode: "",
    custName: "",
    systemName: "",
    usesApproval: false,
    usesTestStage: false,
    usesSystemStage: false,
    defaultPrivate: true,
    showsContractTime: false,
  });

  const issues = formIssues(form);
  const firstIssue = Object.values(issues)[0] ?? null;
  const shown = (k: keyof CustomerForm) => (touched[k] ? issues[k] : undefined);
  const touch = (k: keyof CustomerForm) =>
    setTouched((t) => ({ ...t, [k]: true }));

  /** 성공은 200/201 뿐 — 202(쓰기 잠김)는 "여기까지 통과"이고 저장된 게 아니다 */
  const readResult = async (
    res: Response,
  ): Promise<{ ok: boolean; msg: Msg }> => {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    const ok = res.status === 200 || res.status === 201;
    return {
      ok,
      msg: {
        text: body.message ?? body.code ?? `HTTP ${res.status}`,
        tone: ok ? "info" : res.status === 202 ? "warning" : "danger",
      },
    };
  };

  const create = async () => {
    setBusy("new");
    setFormMsg(null);
    // 🔴 네트워크 예외에서 busy 가 굳으면 버튼이 '등록 중…'에 멈춘다 → finally
    try {
      const { ok, msg: result } = await readResult(
        await fetch("/api/customers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        }),
      );
      if (!ok) {
        setFormMsg(result);
        return;
      }
      setOpen(false);
      setForm({ ...form, custCode: "", custName: "", systemName: "" });
      setTouched({});
      setMsg(result);
      router.refresh();
    } catch (e) {
      setFormMsg({
        text: `등록 요청을 보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`,
        tone: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (row: CustomerRow) => {
    setBusy(row.custCode);
    try {
      const { ok, msg: result } = await readResult(
        await fetch(`/api/customers/${encodeURIComponent(row.custCode)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active: !row.active }),
        }),
      );
      setMsg(result);
      if (ok) router.refresh();
    } catch (e) {
      setMsg({
        text: `요청을 보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`,
        tone: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const flags = (r: CustomerRow) =>
    [
      r.usesApproval ? "승인 단계" : null,
      r.usesTestStage ? "테스트 단계" : null,
      r.usesSystemStage ? "시스템 이관" : null,
      r.defaultPrivate ? "기본 비공개" : null,
      r.showsContractTime ? "계약시간 표시" : null,
    ].filter(Boolean) as string[];

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-20 text-fg-strong font-semibold tracking-tight">
            고객사 관리
          </h1>
          <p className="text-12 text-fg-muted mt-1">
            등록한 고객사는 신청 화면의 선택지가 됩니다. 비활성하면 목록에서
            사라지지만 <b>과거 티켓은 그대로 남습니다</b>.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOpen(true)}
        >
          <Plus size={14} aria-hidden />
          고객사 등록
        </button>
      </header>

      {blockedReason ? <Notice tone="info">{blockedReason}</Notice> : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card>
        <CardHeader title="고객사" hint={`${rows.length}곳`} />
        <CardBody className="scroll-x p-0">
          <table className="tbl">
            <thead>
              <tr>
                <th>고객사</th>
                <th>코드</th>
                {/* 보조 지표는 좁은 화면에서 접는다 — 고객사·코드·조작만 있으면 행을 알아본다 */}
                <th className="num hidden md:table-cell">티켓</th>
                <th className="num hidden md:table-cell">미완료</th>
                <th className="num hidden lg:table-cell">시스템</th>
                <th className="hidden lg:table-cell">설정</th>
                {/* 빈 헤더는 셀이 어느 열인지 알 수 없게 만든다 — 보이지 않게 이름만 붙인다 */}
                <th>
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* 🔴 비활성을 opacity 로 표현하지 않는다 — 행 전체 대비가 2.3~4.4:1 로
                  떨어져 AA 미달이었다(실측). 색을 낮추고 **배지로 말한다** */}
              {rows.map((r) => (
                <tr key={r.custCode}>
                  <td>
                    <span
                      className={cn(
                        "font-medium",
                        r.active ? "text-fg-strong" : "text-fg-muted",
                      )}
                    >
                      {r.custName}
                    </span>
                    {!r.active ? (
                      <span className="badge badge-neutral ml-1.5">비활성</span>
                    ) : null}
                  </td>
                  <td className="mono text-fg-muted">{r.custCode}</td>
                  <td className="num hidden md:table-cell">
                    {r.tickets.toLocaleString("ko-KR")}
                  </td>
                  <td className="num hidden md:table-cell">{r.openTickets}</td>
                  <td className="num hidden lg:table-cell">{r.systems}</td>
                  <td className="text-11 text-fg-muted hidden lg:table-cell">
                    {flags(r).join(" · ") || "-"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className={cn(
                        "btn btn-sm",
                        r.active ? "btn-danger-soft" : "btn-outline",
                      )}
                      disabled={!canDeactivate || busy === r.custCode}
                      title={canDeactivate ? undefined : (blockedReason ?? "")}
                      onClick={() => toggle(r)}
                    >
                      {r.active ? (
                        <PowerOff size={12} aria-hidden />
                      ) : (
                        <Power size={12} aria-hidden />
                      )}
                      {r.active ? "비활성" : "재활성"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Modal
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          // 다시 열었을 때 지난번 실패 문장이 남아 있지 않게
          if (!v) setFormMsg(null);
        }}
        title="고객사 등록"
        description="운영시스템을 함께 만들어야 신청 화면에서 고를 수 있습니다."
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={create}
              // 막힌 이유를 버튼에도 붙인다 — 비활성 버튼만 있으면 무엇을 채워야 하는지 모른다
              disabled={busy === "new" || !!firstIssue}
              title={firstIssue ?? undefined}
            >
              {busy === "new" ? "등록 중…" : "등록"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {formMsg ? (
            <div role="alert">
              <Notice tone={formMsg.tone}>{formMsg.text}</Notice>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="label label-req">고객사 코드</span>
              <input
                className="input mono"
                placeholder="HB002"
                maxLength={10}
                value={form.custCode}
                aria-invalid={shown("custCode") ? "true" : undefined}
                onBlur={() => touch("custCode")}
                onChange={(e) =>
                  setForm({ ...form, custCode: e.target.value.toUpperCase() })
                }
              />
              {shown("custCode") ? (
                <span className="field-error">{shown("custCode")}</span>
              ) : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="label label-req">고객사명</span>
              <input
                className="input"
                placeholder="새한물산"
                value={form.custName}
                aria-invalid={shown("custName") ? "true" : undefined}
                onBlur={() => touch("custName")}
                onChange={(e) => setForm({ ...form, custName: e.target.value })}
              />
              {shown("custName") ? (
                <span className="field-error">{shown("custName")}</span>
              ) : null}
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label label-req">운영시스템 (첫 1개)</span>
            <input
              className="input"
              placeholder="ERP 운영계"
              value={form.systemName}
              aria-invalid={shown("systemName") ? "true" : undefined}
              onBlur={() => touch("systemName")}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
            />
            {shown("systemName") ? (
              <span className="field-error">{shown("systemName")}</span>
            ) : (
              <span className="field-hint">
                시스템 추가 화면이 없어 나중에 채울 수 없습니다 — 등록할 때 함께
                만듭니다.
              </span>
            )}
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <span className="label">사용 단계 · 기본값</span>
            {STAGE_TOGGLES.map(({ key, label, note }) => (
              <label
                key={key}
                className="text-12 text-fg-muted flex cursor-pointer items-start gap-2"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form[key]}
                  onChange={(e) =>
                    setForm({ ...form, [key]: e.target.checked })
                  }
                />
                <span className="flex flex-col">
                  {label}
                  {note ? (
                    <span className="text-11 text-fg-subtle">{note}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </Modal>
    </div>
  );
}
