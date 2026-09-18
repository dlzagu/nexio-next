/**
 * 시드 스레드가 **대화의 순서대로** 읽히는가.
 *
 * 재현한 증상(Aside 점검 9/18): 상세를 연 리뷰어가 "대화가 거꾸로 읽힌다"고 보고했다 —
 * 맨 위가 "안내주신 방법으로 처리했습니다. 종결해 주세요.", 그 아래가 "접수 확인했습니다."
 * 말뭉치 한 통에서 아무 자리에나 뽑아 붙였기 때문이다.
 */
process.env.SQLITE_PATH = ":memory:";

import { describe, expect, it } from "vitest";
import { ENGINEER_COMMENTS, REQUESTER_COMMENTS } from "@/lib/dev-seed/corpus";
import { select } from "@/lib/db";

interface Row {
  PECHONUM: string;
  PROGRESS: string;
  COMMENT: string;
  IS_LOG_YN: string;
  PPROGRESS: string | null;
}

const plain = (html: string) => html.replace(/&lt;\/?p&gt;|<\/?p>/g, "").trim();

async function threads(): Promise<Map<string, Row[]>> {
  const rows = await select<Row>(
    `SELECT r.PECHONUM, d.PROGRESS, r.COMMENT, r.IS_LOG_YN, r.PPROGRESS
       FROM NX_OPTREPORTR r JOIN NX_OPTREPORTD d ON d.ECHONUM = r.PECHONUM
      ORDER BY r.PECHONUM, r.COMMDATE, r.ID`,
  );
  const m = new Map<string, Row[]>();
  for (const r of rows) m.set(r.PECHONUM, [...(m.get(r.PECHONUM) ?? []), r]);
  return m;
}

describe("시드 스레드의 순서", () => {
  it("해결안이 나오기 전(대기·신청·진행·취소·반려)에는 확인·종결 인사가 없다", async () => {
    const closing = new Set<string>([
      ...REQUESTER_COMMENTS.closing,
      ...ENGINEER_COMMENTS.closing,
    ]);
    const bad: string[] = [];
    for (const [echo, rows] of await threads()) {
      if (!["1", "2", "3", "10", "11", "12"].includes(rows[0].PROGRESS))
        continue;
      if (
        rows.some((r) => r.IS_LOG_YN === "N" && closing.has(plain(r.COMMENT)))
      ) {
        bad.push(echo);
      }
    }
    expect(bad).toEqual([]);
  });

  it("종결 인사는 '해결안 등록' 로그 뒤에, '완료' 로그는 언제나 스레드의 마지막 줄이다", async () => {
    const bad: string[] = [];
    for (const [echo, rows] of await threads()) {
      const i4 = rows.findIndex(
        (r) => r.IS_LOG_YN === "Y" && r.PPROGRESS === "4",
      );
      const i9 = rows.findIndex(
        (r) => r.IS_LOG_YN === "Y" && r.PPROGRESS === "9",
      );
      const iClosing = rows.findIndex(
        (r) =>
          r.IS_LOG_YN === "N" &&
          (REQUESTER_COMMENTS.closing as string[]).includes(plain(r.COMMENT)),
      );
      if (i9 >= 0 && i9 !== rows.length - 1) bad.push(`${echo}: 완료 뒤에 글`);
      if (i4 >= 0 && iClosing >= 0 && iClosing < i4)
        bad.push(`${echo}: 해결안 전 종결`);
    }
    expect(bad).toEqual([]);
  });

  it("첫 응답(접수 확인)은 담당자의 다른 말보다 먼저 온다", async () => {
    const opening = new Set<string>(ENGINEER_COMMENTS.opening);
    const later = new Set<string>([...ENGINEER_COMMENTS.closing]);
    const bad: string[] = [];
    for (const [echo, rows] of await threads()) {
      const human = rows
        .filter((r) => r.IS_LOG_YN === "N")
        .map((r) => plain(r.COMMENT));
      const iOpen = human.findIndex((t) => opening.has(t));
      const iLater = human.findIndex((t) => later.has(t));
      if (iOpen >= 0 && iLater >= 0 && iLater < iOpen) bad.push(echo);
    }
    expect(bad).toEqual([]);
  });
});
