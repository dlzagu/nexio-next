import Link from "next/link";
import { newRequestBlockedReason } from "@/components/layout/request-gate";
import { RequestForm } from "@/components/requests/RequestForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMeta } from "@/lib/data/meta";
import { getReRequestSeed, getTicket } from "@/lib/data/tickets";
import { josa } from "@/lib/format";
import { canDo } from "@/lib/permissions";
import { currentUser, loadCustomerConfig } from "@/lib/session";

export const metadata = { title: "서비스 신청 · 넥시오" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) return null;

  /**
   * 🔒 신청할 수 없는 역할(외부업체)에게는 폼 대신 이유를 보여 준다.
   * 폼을 그리면 신청자·운영시스템 목록이 비어 있어 **절대 제출할 수 없는** 양식을 채우게 되고,
   * 채워도 라우트가 403 으로 막는다. 선택지 목록도 만들지 않는다(getMeta 를 부르지 않는다).
   */
  const blocked = newRequestBlockedReason(user);
  if (blocked) {
    return (
      <div className="mx-auto max-w-[860px] p-5">
        <EmptyState
          title="서비스 신청을 할 수 없습니다"
          reason={blocked}
          actions={
            <Link href="/requests?view=mine" className="btn btn-outline">
              내 담당 건 보기
            </Link>
          }
        />
      </div>
    );
  }

  /**
   * 재신청 원본. 🔒 서버(POST /api/requests)와 **같은 판정**(canDo reapply)을 여기서 먼저 한다 —
   * 볼 수만 있으면 프리필해 두면 다 채운 뒤 제출 순간에야 400(INVALID_PARENT)을 맞는다.
   * 판정을 못 넘으면 원본 번호를 폼에 싣지 않고, 왜 빈 양식인지 말한다.
   */
  const from = one(sp.from) || null;
  const parent = from ? await getTicket(from, user) : null;
  const parentOk =
    !!parent &&
    canDo("reapply", parent, user, await loadCustomerConfig(parent.custCode));
  const denied = !from
    ? null
    : !parent
      ? `${josa(from, "을/를")} 찾을 수 없어 빈 양식으로 시작합니다. 접수번호를 확인해 주세요.`
      : !parentOk
        ? `${josa(from, "은/는")} 재신청할 수 없어 새 신청으로 시작합니다 — 재신청은 종료된 요청의 신청자 본인만 할 수 있습니다.`
        : null;

  const [meta, config, initial] = await Promise.all([
    getMeta(user),
    loadCustomerConfig(user.custCode),
    // 볼 수 없는 건은 프리필도 없다 — getReRequestSeed 가 가시성 게이트를 지난다
    from && parentOk ? getReRequestSeed(from, user) : Promise.resolve(null),
  ]);

  return (
    <RequestForm
      user={user}
      config={config}
      companies={meta.companies}
      requesters={meta.requesters}
      systems={meta.systems}
      contractTime={meta.contractTime}
      reRequestFrom={parentOk ? from : null}
      reRequestDenied={denied}
      initial={initial}
    />
  );
}
