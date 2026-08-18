import { RequestForm } from "@/components/requests/RequestForm";
import { getMeta } from "@/lib/data/meta";
import { getReRequestSeed } from "@/lib/data/tickets";
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

  const from = one(sp.from) || null;
  const [meta, config, initial] = await Promise.all([
    getMeta(user),
    loadCustomerConfig(user.custCode),
    // 볼 수 없는 건은 프리필도 없다 — getReRequestSeed 가 가시성 게이트를 지난다
    from ? getReRequestSeed(from, user) : Promise.resolve(null),
  ]);

  return (
    <RequestForm
      user={user}
      config={config}
      companies={meta.companies}
      requesters={meta.requesters}
      systems={meta.systems}
      contractTime={meta.contractTime}
      reRequestFrom={from}
      initial={initial}
    />
  );
}
