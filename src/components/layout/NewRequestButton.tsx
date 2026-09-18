import Link from "next/link";
import { Plus } from "lucide-react";
import type { User } from "@/lib/types";
import { newRequestBlockedReason } from "./request-gate";

/**
 * 화면 머리의 '서비스 신청' 버튼 — 대시보드·조회가 같은 것을 쓴다.
 *
 * 막힌 역할(외부업체)에게 **숨기지 않고** 비활성 + 이유를 보여 준다.
 * 숨기면 "메뉴가 왜 없지"가 남고, 열어 두면 폼을 다 채운 뒤에야 403 을 맞는다.
 * (훅이 없어 서버·클라이언트 컴포넌트 어디서든 그릴 수 있다)
 */
export function NewRequestButton({ user }: { user: Pick<User, "role"> }) {
  const blocked = newRequestBlockedReason(user);
  if (blocked) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        disabled
        title={blocked}
      >
        <Plus size={14} aria-hidden />
        서비스 신청
        <span className="sr-only"> — {blocked}</span>
      </button>
    );
  }
  return (
    <Link href="/requests/new" className="btn btn-primary">
      <Plus size={14} aria-hidden />
      서비스 신청
    </Link>
  );
}
