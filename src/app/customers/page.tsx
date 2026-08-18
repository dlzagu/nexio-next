import { CustomersView } from "@/components/customers/CustomersView";
import { EmptyState } from "@/components/ui/EmptyState";
import { listCustomers } from "@/lib/data/customers";
import {
  canDeactivateCustomer,
  canManageCustomers,
  customerAdminHint,
} from "@/lib/permissions";
import { currentUser } from "@/lib/session";

export const metadata = { title: "고객사 관리 · 넥시오" };

export default async function CustomersPage() {
  const user = await currentUser();
  if (!user) return null;

  // 🔒 고객사 사용자에게는 **다른 회사의 존재 자체**를 보이지 않는다 (목록을 만들지도 않는다)
  if (!canManageCustomers(user)) {
    return (
      <div className="mx-auto max-w-[860px] p-5">
        <EmptyState
          title="접근 권한이 없습니다"
          reason={customerAdminHint(user)}
        />
      </div>
    );
  }

  const rows = await listCustomers();

  return (
    <CustomersView
      rows={rows}
      canDeactivate={canDeactivateCustomer(user)}
      blockedReason={customerAdminHint(user)}
    />
  );
}
