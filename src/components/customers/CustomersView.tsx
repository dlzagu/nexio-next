"use client";

import { Plus, Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { CustomerRow } from "@/lib/data/customers";

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
  const [msg, setMsg] = useState<{ text: string; failed: boolean } | null>(
    null,
  );
  const [form, setForm] = useState({
    custCode: "",
    custName: "",
    systemName: "",
    usesApproval: false,
    usesTestStage: false,
    usesSystemStage: false,
    defaultPrivate: true,
    showsContractTime: false,
  });

  /** 202(쓰기 잠김)는 성공이 아니다 — 저장 안 된 것을 저장했다고 말하지 않는다 */
  const settle = async (res: Response) => {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    const ok = res.status === 200 || res.status === 201;
    setMsg({
      text: body.message ?? body.code ?? `HTTP ${res.status}`,
      failed: !ok && res.status !== 202,
    });
    if (ok) router.refresh();
    return ok;
  };

  const create = async () => {
    setBusy("new");
    const ok = await settle(
      await fetch("/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      }),
    );
    setBusy(null);
    if (ok) {
      setOpen(false);
      setForm({ ...form, custCode: "", custName: "", systemName: "" });
    }
  };

  const toggle = async (row: CustomerRow) => {
    setBusy(row.custCode);
    await settle(
      await fetch(`/api/customers/${encodeURIComponent(row.custCode)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      }),
    );
    setBusy(null);
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
      {msg ? (
        <Notice tone={msg.failed ? "danger" : "warning"}>{msg.text}</Notice>
      ) : null}

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
        onOpenChange={setOpen}
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
              disabled={busy === "new" || !form.custCode || !form.custName}
            >
              {busy === "new" ? "등록 중…" : "등록"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="label">고객사 코드</span>
              <input
                className="input mono"
                placeholder="HB002"
                maxLength={10}
                value={form.custCode}
                onChange={(e) =>
                  setForm({ ...form, custCode: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">고객사명</span>
              <input
                className="input"
                placeholder="새한물산"
                value={form.custName}
                onChange={(e) => setForm({ ...form, custName: e.target.value })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">운영시스템 (첫 1개)</span>
            <input
              className="input"
              placeholder="ERP 운영계"
              value={form.systemName}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
            />
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <span className="label">사용 단계 · 기본값</span>
            {(
              [
                ["usesApproval", "승인 단계 사용 (신청 전 승인권자 결재)"],
                ["usesTestStage", "테스트 단계 사용"],
                ["usesSystemStage", "시스템 이관 단계 사용"],
                ["defaultPrivate", "신청을 기본 비공개로"],
                ["showsContractTime", "계약시간 표시"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="text-12 text-fg-muted flex cursor-pointer items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) =>
                    setForm({ ...form, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      </Modal>
    </div>
  );
}
