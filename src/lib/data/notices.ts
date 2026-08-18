import { select } from "../db";
import { plainPreview, toWallClockIso } from "../format";

/**
 * 공지사항 (BOARD_DETAIL). 원본에서는 상단 헤더의 상시 메뉴다.
 *
 * 대시보드에 공지 위젯은 있었지만 **열어볼 화면이 없어 막다른 위젯**이었다.
 * (UX 원칙 — 모든 위젯은 클릭해서 갈 곳이 있어야 한다)
 *
 * 삭제·미사용 플래그는 조회에서 항상 거른다 (fail-closed: 값이 없으면 노출).
 */

const LIVE = `COALESCE(DELETE_FG,'N') <> 'Y' AND COALESCE(USE_FG,'Y') = 'Y'`;

export interface NoticeRow {
  id: string;
  title: string;
  author: string;
  at: string | null;
  preview: string;
}

export interface NoticeDetail extends NoticeRow {
  body: string;
  /** 앞뒤 글. '이전/다음'은 방향이 헷갈려 최신/오래된으로 이름 붙였다 */
  newer: { id: string; title: string } | null;
  older: { id: string; title: string } | null;
}

interface RawNotice {
  NTT_ID: number;
  NTT_SJ: string | null;
  NTT_CN: string | null;
  NTCR_NM: string | null;
  REG_DT: string | null;
}

const toRow = (r: RawNotice): NoticeRow => ({
  id: String(r.NTT_ID),
  title: (r.NTT_SJ ?? "").trim() || "(제목 없음)",
  author: (r.NTCR_NM ?? "").trim() || "-",
  at: toWallClockIso(r.REG_DT),
  preview: plainPreview(r.NTT_CN, 120),
});

export async function listNotices(limit = 50): Promise<NoticeRow[]> {
  const rows = await select<RawNotice>(
    `SELECT NTT_ID, NTT_SJ, NTT_CN, NTCR_NM, REG_DT
       FROM BOARD_DETAIL
      WHERE ${LIVE}
      ORDER BY REG_DT DESC, NTT_ID DESC
      LIMIT ${Math.max(1, Math.min(limit, 200))}`,
  );
  return rows.map(toRow);
}

export async function getNotice(id: string): Promise<NoticeDetail | null> {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;

  const rows = await select<RawNotice>(
    `SELECT NTT_ID, NTT_SJ, NTT_CN, NTCR_NM, REG_DT
       FROM BOARD_DETAIL WHERE NTT_ID = @id AND ${LIVE}`,
    [{ name: "id", value: n }],
  );
  const r = rows[0];
  if (!r) return null;

  // 앞뒤 글 — 목록으로 돌아갔다 다시 들어오는 왕복을 없앤다.
  // ⚠️ 기준 축은 **목록과 같은 REG_DT** 다. NTT_ID 로 이웃을 찾으면 안 된다 —
  //    채번 순서와 등록일 순서가 일치한다는 보장이 없다(시드는 최신이 1번이다).
  const neighbor = async (dir: "newer" | "older") => {
    const cmp = dir === "newer" ? ">" : "<";
    const order = dir === "newer" ? "ASC" : "DESC";
    const rows = await select<{ NTT_ID: number; NTT_SJ: string | null }>(
      `SELECT NTT_ID, NTT_SJ FROM BOARD_DETAIL
        WHERE ${LIVE}
          AND (REG_DT ${cmp} @at OR (REG_DT = @at AND NTT_ID ${cmp} @id))
        ORDER BY REG_DT ${order}, NTT_ID ${order}
        LIMIT 1`,
      [
        { name: "at", value: r.REG_DT ?? "" },
        { name: "id", value: n },
      ],
    );
    const hit = rows[0];
    return hit
      ? { id: String(hit.NTT_ID), title: (hit.NTT_SJ ?? "").trim() }
      : null;
  };
  const [newer, older] = await Promise.all([
    neighbor("newer"),
    neighbor("older"),
  ]);

  return { ...toRow(r), body: r.NTT_CN ?? "", newer, older };
}
