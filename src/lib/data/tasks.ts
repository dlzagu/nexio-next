import { labelOf, MODULE, PRIORITY } from "../codes";
import { select, type Param, type WriteStatement } from "../db";
import { toDbStamp, todaySeoul } from "../format";
import { sanitize } from "../sanitize";
import { toParagraphs } from "./request-body";
import type { TaskIntakeParsed } from "../schemas";

/**
 * 정기 업무 템플릿. 원본에 없는 표라 컬럼명도 우리가 정했지만,
 * 🔴 다른 데이터와 같은 규칙을 따른다 — 원본/DB 컬럼명(`CUSTCODE`·`LAST_RUN_YM`)은
 *    이 파일 밖으로 나가지 않는다. 화면은 정규화된 이름만 본다.
 *
 * 왜 표가 따로 필요한가: "매달 첫 주 백업 확인"은 **고객사가 신청하지 않는 업무**다.
 * 티켓으로만 남기면 다음 달에 아무도 기억하지 못하고, 티켓 자체에 반복 플래그를 달면
 * 종료된 티켓이 계속 살아 있는 셈이 된다. 그래서 '틀'과 '이번 달 실체'를 나눈다.
 */

export interface TaskTemplate {
  id: number;
  custCode: string;
  custName: string;
  title: string;
  content: string;
  systemId: string;
  systemName: string | null;
  moduleCode: string;
  moduleLabel: string;
  priority: string;
  priorityCode: string;
  ownerId: string | null;
  ownerName: string | null;
  /** 매월 며칠 기준 (1~28) */
  day: number;
  /** 마지막으로 티켓을 만든 달 'YYYY-MM' */
  lastRunYm: string | null;
  /** 이번 달 것이 아직 없다 = 지금 누르면 생긴다 */
  pending: boolean;
}

interface Row {
  ID: number;
  CUSTCODE: string;
  custName: string | null;
  TITLE: string;
  CONTENT: string | null;
  B1GUBUN: number | null;
  systemName: string | null;
  MODULE: string | null;
  REQLEVEL: string | null;
  OWNER: string | null;
  ownerName: string | null;
  DAY_OF_MONTH: number | null;
  LAST_RUN_YM: string | null;
}

const trim = (v: string | null | undefined) => (v ?? "").trim();

/**
 * 'YYYY-MM' — **한국 벽시계** 기준.
 *
 * 서버 로컬(배포처는 UTC)로 재면 매월 1일 KST 00~09시에 아직 지난달을 보고 있어,
 * 그 시간에 '이번 달 정기 업무'를 누르면 **지난달 회차**가 만들어진다.
 */
export function currentYm(today = todaySeoul()): string {
  return today.slice(0, 7);
}

function toTemplate(r: Row, ym: string): TaskTemplate {
  return {
    id: Number(r.ID),
    custCode: trim(r.CUSTCODE),
    custName: trim(r.custName) || trim(r.CUSTCODE),
    title: trim(r.TITLE),
    content: r.CONTENT ?? "",
    systemId: r.B1GUBUN === null ? "" : String(r.B1GUBUN),
    systemName: trim(r.systemName) || null,
    moduleCode: trim(r.MODULE),
    moduleLabel: labelOf(MODULE, r.MODULE),
    priority: labelOf(PRIORITY, r.REQLEVEL ?? "3"),
    priorityCode: trim(r.REQLEVEL) || "3",
    ownerId: trim(r.OWNER) || null,
    ownerName: trim(r.ownerName) || null,
    day: Number(r.DAY_OF_MONTH ?? 1),
    lastRunYm: trim(r.LAST_RUN_YM) || null,
    pending: trim(r.LAST_RUN_YM) !== ym,
  };
}

const BASE_SQL = `
SELECT t.ID, t.CUSTCODE, c.COMPANY_NAME_LOC AS custName, t.TITLE, t.CONTENT,
       t.B1GUBUN, os.SYSTEM_NAME AS systemName, t.MODULE, t.REQLEVEL,
       t.OWNER, m.MBER_NM AS ownerName, t.DAY_OF_MONTH, t.LAST_RUN_YM
  FROM NX_TASK_TEMPLATE t
  LEFT JOIN COMPANY_MST c ON c.COMPANY_CODE = t.CUSTCODE
  LEFT JOIN COMPANY_OPER_SYSTEM os ON os.OPER_SYS_ID = t.B1GUBUN
  LEFT JOIN MEMBER_MST m ON m.MBER_ID = t.OWNER`;

/**
 * 살아 있는 것만 — 목록·생성 대상은 여기를 지난다.
 *
 * 🔴 **고객사가 비활성(ACTIVE='N')이면 템플릿도 죽은 것으로 본다.** 안 그러면
 *    거래가 끝난 고객사에 매달 티켓이 계속 생기고, 그 고객사는 화면 어디에도 없어
 *    아무도 눈치채지 못한다 (고객사 '삭제'는 비활성이다 — ADR-0010).
 */
const ACTIVE_ONLY = `WHERE COALESCE(t.ACTIVE,'Y') = 'Y'
   AND COALESCE(c.ACTIVE,'Y') = 'Y'`;

/**
 * 살아 있는 템플릿 전부.
 *
 * 🔒 가시성 게이트를 두지 않는다 — 이 목록은 **운영팀만** 읽는다(라우트·화면이 막는다).
 *    고객사에게 열 일이 생기면 그때 `scopeClause` 와 같은 축을 여기에도 세워야 한다.
 */
export async function listTemplates(ym = currentYm()): Promise<TaskTemplate[]> {
  const rows = await select<Row>(
    `${BASE_SQL} ${ACTIVE_ONLY}
     ORDER BY t.DAY_OF_MONTH, c.COMPANY_NAME_LOC, t.TITLE`,
  );
  return rows.map((r) => toTemplate(r, ym));
}

/** 이번 달 것이 아직 없는 템플릿 (버튼 하나로 만들 대상) */
export async function listPendingTemplates(
  ym = currentYm(),
): Promise<TaskTemplate[]> {
  const rows = await select<Row>(
    `${BASE_SQL} ${ACTIVE_ONLY} AND COALESCE(t.LAST_RUN_YM,'') <> @ym
     ORDER BY t.DAY_OF_MONTH, t.TITLE`,
    [{ name: "ym", value: ym }],
  );
  return rows.map((r) => toTemplate(r, ym));
}

/**
 * 한 건 조회. **비활성도 찾는다** — 내려둔 템플릿을 되살리려는데 "없다"고 답하면
 * 화면은 성공했다고 표시하고 목록은 그대로인 상태가 된다.
 */
export async function getTemplate(id: number): Promise<TaskTemplate | null> {
  const rows = await select<Row>(`${BASE_SQL} WHERE t.ID = @id`, [
    { name: "id", value: id },
  ]);
  return rows[0] ? toTemplate(rows[0], currentYm()) : null;
}

/**
 * 템플릿 저장 문장. **INSERT 문을 돌려주고 호출자의 트랜잭션에 얹는다** —
 * 첨부(ADR-0008)와 같은 방식이다. 티켓만 생기고 반복 등록이 빠지면
 * 사용자는 "다음 달에도 알아서 뜬다"고 믿은 채 다음 달을 통째로 놓친다.
 *
 * @param ranYm 이 템플릿으로 **지금 티켓을 함께 만들었다면** 그 달('YYYY-MM').
 *              같은 달에 버튼을 눌러도 두 번 생기지 않게 하는 유일한 장치다.
 */
export function insertTemplate(opts: {
  form: TaskIntakeParsed;
  media: string;
  ownerId: string | null;
  ranYm: string | null;
  at: string;
}): WriteStatement {
  const { form, media, ownerId, ranYm, at } = opts;
  return {
    sql: `INSERT INTO NX_TASK_TEMPLATE
            (CUSTCODE, TITLE, CONTENT, B1GUBUN, MODULE, REQLEVEL, MEDIA,
             OWNER, DAY_OF_MONTH, ACTIVE, LAST_RUN_YM, REG_DT)
          VALUES (@cc, @title, @content, @sys, @module, @level, @media,
                  @owner, @day, 'Y', @ran, @at)`,
    params: [
      { name: "cc", value: form.custCode },
      { name: "title", value: form.title.trim() },
      // 저장 형식이 HTML 이라 평문을 그대로 넣으면 한 줄로 붙는다 (본문 저장과 같은 축)
      { name: "content", value: sanitize(toParagraphs(form.content)) },
      { name: "sys", value: Number(form.systemId) },
      { name: "module", value: form.moduleCode || null },
      { name: "level", value: form.priority || "3" },
      { name: "media", value: media },
      { name: "owner", value: ownerId },
      { name: "day", value: form.repeatDay },
      { name: "ran", value: ranYm },
      { name: "at", value: at },
    ] satisfies Param[],
  };
}

/** 이번 달 티켓을 만들었다고 표시 — 티켓 INSERT 와 **같은 트랜잭션**에 얹힌다 */
export function markTemplateRan(id: number, ym: string): WriteStatement {
  return {
    sql: `UPDATE NX_TASK_TEMPLATE SET LAST_RUN_YM = @ym WHERE ID = @id`,
    params: [
      { name: "ym", value: ym },
      { name: "id", value: id },
    ],
  };
}

/**
 * 템플릿 내리기. 행은 지우지 않는다 — 고객사 비활성(ADR-0010)과 같은 판단이고,
 * 쓰기 관문이 DELETE 를 아예 거부한다.
 */
export function deactivateTemplate(
  id: number,
  active: boolean,
): WriteStatement {
  return {
    sql: `UPDATE NX_TASK_TEMPLATE SET ACTIVE = @a WHERE ID = @id`,
    params: [
      { name: "a", value: active ? "Y" : "N" },
      { name: "id", value: id },
    ],
  };
}

/** 정기 업무로 만든 티켓의 본문 — 어디서 왔는지 본문만 봐도 알 수 있게 */
export function templateBody(t: TaskTemplate, ym: string): string {
  // 템플릿 CONTENT 는 이미 문단 HTML 이다 — 다시 감싸면 <p> 가 중첩된다
  const base = t.content?.trim() ? t.content : `<p>${t.title} (정기 업무)</p>`;
  return `${base}<p>매월 ${t.day}일 기준 정기 업무입니다. (${ym} 회차)</p>`;
}
