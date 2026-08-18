import { describe, expect, it } from "vitest";

/**
 * 역할 전환(데모 세션).
 *
 * 여기서 고정하는 것은 **코드와 데모 데이터가 어긋나지 않는가** 하나다:
 * 페르소나 목록은 코드(`PERSONAS`)에 있고 사람은 DB(`MEMBER_MST`)에 있는데,
 * 둘은 따로 배포된다 — 코드는 git push, 데모 데이터는 시드.
 * 어긋나면 역할 전환이 404 로 거절되고, 화면에서는 **눌러도 아무 일이 없는** 고장으로 보인다.
 * (실측: 새 페르소나를 추가한 뒤 공유 DB 를 안 맞춰 라이브에서 재현)
 */
process.env.SQLITE_PATH = ":memory:";

import {
  DEFAULT_USER_ID,
  listPersonas,
  loadUser,
  missingPersonaIds,
  PERSONAS,
} from "@/lib/session";

describe("페르소나 ↔ 시드 정합성", () => {
  it("목록의 계정이 전부 DB 에 실재한다", async () => {
    expect(await missingPersonaIds()).toEqual([]);
  });

  it("각 페르소나가 실제로 로드되고, 힌트대로의 역할을 가진다", async () => {
    const rows = await listPersonas();
    expect(rows).toHaveLength(PERSONAS.length);
    for (const p of rows) expect(p.available).toBe(true);

    const users = await Promise.all(PERSONAS.map((p) => loadUser(p.id)));
    expect(users.every((u) => u !== null)).toBe(true);

    const by = (id: string) => users.find((u) => u?.id === id)!;
    expect(by("sy.kim").role).toBe("INTERNAL");
    // 관리자 페르소나 — 운영팀이면서 승인권자여야 고객사 비활성이 열린다 (ADR-0010)
    expect(by("th.oh").role).toBe("INTERNAL");
    expect(by("th.oh").isApprover).toBe(true);
    expect(by("hb.yoon").role).toBe("CUSTOMER");
    expect(by("vd.kang").role).toBe("VENDOR");
  });

  it("기본 계정은 언제나 로드된다 — 쿠키가 비었을 때 돌아갈 자리다", async () => {
    expect((await loadUser(DEFAULT_USER_ID))?.id).toBe(DEFAULT_USER_ID);
  });

  it("없는 계정은 null — 이것이 전환 404 의 근거다", async () => {
    expect(await loadUser("없는사람")).toBeNull();
    expect(await loadUser("")).toBeNull();
  });
});
