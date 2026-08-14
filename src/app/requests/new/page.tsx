import { RequestForm } from "@/components/requests/RequestForm";
import { getMeta } from "@/lib/data/meta";
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

  const [meta, config] = await Promise.all([
    getMeta(user),
    loadCustomerConfig(user.custCode),
  ]);

  return (
    <RequestForm
      user={user}
      config={config}
      companies={meta.companies}
      requesters={meta.requesters}
      systems={meta.systems}
      contractTime={meta.contractTime}
      reRequestFrom={one(sp.from) || null}
    />
  );
}
