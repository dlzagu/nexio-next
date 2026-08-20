import { redirect } from "next/navigation";

/**
 * 🔴 쿼리를 **들고** 리다이렉트한다. 버리면 루트로 들어온 스위치가 조용히 무효가 된다 —
 *    실측: `/?analytics=off` 가 `/dashboard` 로 넘어가며 파라미터를 잃어, 클라이언트가
 *    표시를 저장하기 전에 사라졌다 (본인 제외가 안 된 채 "됐다"고 믿는 상태).
 *    utm_source 같은 유입 꼬리표도 같은 이유로 여기서 살아남아야 집계된다.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    for (const one of Array.isArray(v) ? v : v != null ? [v] : []) {
      qs.append(k, one);
    }
  }
  redirect(qs.size ? `/dashboard?${qs.toString()}` : "/dashboard");
}
