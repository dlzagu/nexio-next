import Database from "better-sqlite3";
import {
  ADMIN_COMMENTS,
  CANCEL_REASONS,
  COMPANIES,
  ENGINEER_COMMENTS,
  INTERNAL_COMPANY,
  INTERNAL_MEMBERS,
  ATTACH_FILES,
  MEDIA_TYPES,
  MIGRATION_OKREMARKS,
  MIGRATION_REMARKS,
  MIGRATION_TITLES,
  NOTICES,
  REJECT_REASONS,
  REQUESTER_COMMENTS,
  TEMPLATES,
  VENDOR_COMPANY,
  VENDOR_MEMBERS,
  type SeedCompany,
  type SeedMember,
} from "./corpus";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

type DB = InstanceType<typeof Database>;

/**
 * 결정적(deterministic) 시드 생성기.
 *
 * - RNG 시드가 고정이라 같은 날 실행하면 같은 데이터가 나온다 (날짜만 실행일 기준).
 * - 원본 실측 프로파일의 "모양"을 재현한다:
 *   이관(MIGRATION) 건이 과반 · 완료가 대부분(미완료 ~7%) · 비공개(PUBLICYN='N') 다수 ·
 *   상태 7/8/10 은 0건(도입 후 한 번도 안 쓰인 워크플로) · 빈 제목(REMARKS 로 대체) ·
 *   이스케이프된 HTML 저장 · 1900-01-01 날짜 이상치 · 코드 대신 한글 원문이 든 MODULE.
 * - 전 데이터 가상 — 실존 고객사·인물·사건 없음.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtDT(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** 저장 시 HTML 이스케이프 — 원본 시스템이 이 형태로 저장했다 */
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;");

const paras = (lines: string[]) => lines.map((l) => `<p>${l}</p>`).join("");

interface TicketRow {
  [col: string]: string | number | null;
}

interface CommentRow {
  PECHONUM: string;
  USERID: string;
  COMMENT: string;
  COMMDATE: string;
  ADMIN_ONLY_YN: string;
  IS_LOG_YN: string;
  PPROGRESS: string | null;
}

const TICKET_COLS = [
  "ECHONUM",
  "CUSTCODE",
  "TITLE",
  "CONTENT",
  "REMARKS",
  "REQREMARKS",
  "PROGRESS",
  "B1GUBUN",
  "MODULE",
  "REQLEVEL",
  "REQTYPE",
  "CUSTPERSON",
  "SUCCERSON",
  "REQDATE",
  "SCHEDATE",
  "SUCCDATE",
  "PUBLICYN",
  "WORKTIME",
  "MEDIA",
  "REFMAIL",
  "REREQYN",
  "P_ECHONUM",
  "CAUSE",
  "PROCESS",
  "IMPROVEMENT",
  "ANSWER",
  "RESULT",
  "OKREMARKS",
  "EXPETIME",
  "RWORKTIME",
  "APPROVER",
  "CONFIRMDT",
  "CANCELER",
  "CANCELDT",
  "TESTDT",
  "TESTCOMDT",
  "FINALSUCCER",
  "FINALSUCCDATE",
  "CMEMO",
  "AMEMO",
  "TMEMO",
] as const;

const tableCount = (db: DB, name: string) =>
  (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=@n",
      )
      .get({ n: name }) as { n: number }
  ).n;

/** 없으면 null, 버전 테이블 이전에 만들어진 DB 면 0 */
function schemaVersion(db: DB): number | null {
  if (tableCount(db, "NX_SCHEMA") === 0) {
    return tableCount(db, "NX_OPTREPORTD") > 0 ? 0 : null;
  }
  const row = db.prepare("SELECT VERSION AS v FROM NX_SCHEMA").get() as
    { v: number } | undefined;
  return Number(row?.v ?? 0);
}

function dropAll(db: DB): void {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  for (const { name } of rows) db.exec(`DROP TABLE IF EXISTS "${name}"`);
}

export function ensureSeed(db: DB): void {
  const version = schemaVersion(db);
  if (version === SCHEMA_VERSION) return;

  const t0 = Date.now();
  if (version !== null) {
    // 스키마가 바뀌었다 — 마이그레이션 대신 통째로 다시 만든다 (전부 가상 시드다)
    console.info(
      `[dev-seed] 스키마 버전 ${version} → ${SCHEMA_VERSION}, 데모 DB 를 다시 만든다`,
    );
    dropAll(db);
  }
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT INTO NX_SCHEMA (VERSION) VALUES (?)").run(SCHEMA_VERSION);
  seed(db);
  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM NX_OPTREPORTD").get() as {
      n: number;
    }
  ).n;
  console.info(
    `[dev-seed] 데모 데이터 생성 완료 — 티켓 ${total}건, ${Date.now() - t0}ms`,
  );
}

function seed(db: DB): void {
  const rnd = mulberry32(0x20260814);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (min: number, max: number) =>
    min + Math.floor(rnd() * (max - min + 1));
  const chance = (p: number) => rnd() < p;
  const now = new Date();

  /** n일 전, 업무시간대의 시각 */
  const daysAgo = (n: number): Date => {
    const d = new Date(now.getTime() - n * 86_400_000);
    d.setHours(int(9, 18), int(0, 59), int(0, 59), 0);
    return d;
  };
  const addDays = (d: Date, n: number): Date => {
    const r = new Date(d.getTime() + n * 86_400_000);
    r.setHours(int(9, 18), int(0, 59), int(0, 59), 0);
    return r;
  };

  // ── 마스터 ──────────────────────────────────────────────
  const insCompany = db.prepare(
    `INSERT INTO COMPANY_MST
       (COMPANY_CODE, COMPANY_NAME_LOC, ACTIVE, SHOWYN, CONFYN, TESTYN, SYSTEMYN, DEF_PRIVATE_YN)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  const insSystem = db.prepare(
    `INSERT INTO COMPANY_OPER_SYSTEM
       (OPER_SYS_ID, COMPANY_CODE, SYSTEM_NAME, USE_YN, DEL_YN, SORT_ORD)
     VALUES (?,?,?,'Y','N',?)`,
  );
  const insMember = db.prepare(
    `INSERT INTO MEMBER_MST
       (MBER_ID, MBER_NM, USER_TYPE, COMPANY_CODE, DEPT, EMAIL, APPROVER, ACTIVE)
     VALUES (?,?,?,?,?,?,?,'Y')`,
  );

  // 운영사·외주사는 고객사 필터에 안 나오도록 ACTIVE='N'
  insCompany.run(
    INTERNAL_COMPANY.code,
    INTERNAL_COMPANY.name,
    "N",
    "N",
    "N",
    "N",
    "N",
    "N",
  );
  insCompany.run(
    VENDOR_COMPANY.code,
    VENDOR_COMPANY.name,
    "N",
    "N",
    "N",
    "N",
    "N",
    "N",
  );
  for (const m of INTERNAL_MEMBERS) {
    insMember.run(
      m.id,
      m.name,
      "B0001_01",
      INTERNAL_COMPANY.code,
      m.dept,
      `${m.id}@${INTERNAL_COMPANY.domain}.example`,
      m.approver ? "Y" : "N",
    );
  }
  for (const m of VENDOR_MEMBERS) {
    insMember.run(
      m.id,
      m.name,
      "B0001_03",
      VENDOR_COMPANY.code,
      m.dept,
      `${m.id}@${VENDOR_COMPANY.domain}.example`,
      "N",
    );
  }
  for (const c of COMPANIES) {
    insCompany.run(
      c.code,
      c.name,
      "Y",
      c.showYn,
      c.confYn,
      c.testYn,
      c.systemYn,
      c.defPrivateYn,
    );
    for (const s of c.systems) insSystem.run(s.id, c.code, s.name, s.sort);
    for (const m of c.members) {
      insMember.run(
        m.id,
        m.name,
        "B0001_02",
        c.code,
        m.dept,
        `${m.id.replace(/\./g, "")}@${c.domain}.example`,
        m.approver ? "Y" : "N",
      );
    }
  }

  const insNotice = db.prepare(
    `INSERT INTO BOARD_DETAIL (NTT_ID, NTT_SJ, NTT_CN, NTCR_NM, REG_DT, DELETE_FG, USE_FG)
     VALUES (?,?,?,?,?,'N','Y')`,
  );
  NOTICES.forEach((n, i) =>
    insNotice.run(
      i + 1,
      n.title,
      paras(n.body),
      n.author,
      fmtDT(daysAgo(n.daysAgo)),
    ),
  );

  // ── 티켓 ──────────────────────────────────────────────
  const totalWeight = COMPANIES.reduce((a, c) => a + c.weight, 0);
  const pickCompany = (): SeedCompany => {
    let r = rnd() * totalWeight;
    for (const c of COMPANIES) {
      r -= c.weight;
      if (r < 0) return c;
    }
    return COMPANIES[COMPANIES.length - 1];
  };

  const seqMap = new Map<string, number>();
  const echoNumOf = (prefix: string, d: Date): string => {
    const key = `${prefix}-${d.getFullYear()}${pad2(d.getMonth() + 1)}`;
    const n = (seqMap.get(key) ?? 0) + 1;
    seqMap.set(key, n);
    return `${key}-${String(n).padStart(3, "0")}`;
  };

  const pickAssignee = (c: SeedCompany): SeedMember =>
    (c.code === "DN001" || c.code === "PC001") && chance(0.2)
      ? VENDOR_MEMBERS[0]
      : pick(INTERNAL_MEMBERS);

  const tickets: TicketRow[] = [];
  const prevByCompany = new Map<string, string[]>();

  const blank = (): TicketRow => {
    const r: TicketRow = {};
    for (const col of TICKET_COLS) r[col] = null;
    return r;
  };

  /** 완료(9) 처리 소요일 — 대시보드 처리기간 버킷이 전부 채워지도록 분포를 섞는다 */
  const pickDuration = (): number => {
    const r = rnd();
    if (r < 0.2) return 0;
    if (r < 0.38) return 1;
    if (r < 0.58) return int(2, 3);
    if (r < 0.78) return int(4, 7);
    if (r < 0.95) return int(8, 30);
    return int(31, 55);
  };

  function makeService(
    company: SeedCompany,
    reqDate: Date,
    progress: string,
    reqType: "SERVICE" | "WORK",
  ): void {
    const tpl = pick(TEMPLATES);
    const requester = pick(company.members);
    const t = blank();
    const echo = echoNumOf(company.prefix, reqDate);

    t.ECHONUM = echo;
    t.CUSTCODE = company.code;
    t.TITLE = esc(tpl.title);
    const html = paras(tpl.content);
    t.CONTENT = chance(0.7) ? html : esc(html); // 원문/이스케이프 저장 혼재 재현
    t.REMARKS = esc(tpl.content[0]);
    if (chance(0.25))
      t.REQREMARKS = esc(
        pick([
          "가능하면 이번 주 내 처리 부탁드립니다.",
          "유선 협의 가능합니다. 자료 필요 시 말씀해 주세요.",
          "월 마감 전까지 반영이 필요합니다.",
        ]),
      );
    t.PROGRESS = progress;
    t.B1GUBUN = pick(company.systems).id;
    t.MODULE = tpl.module;
    {
      const r = rnd();
      t.REQLEVEL = r < 0.03 ? "1" : r < 0.1 ? "2" : r < 0.97 ? "3" : "4";
    }
    t.REQTYPE = reqType;
    t.CUSTPERSON = requester.id;
    t.REQDATE = fmtDT(reqDate);
    t.PUBLICYN =
      company.defPrivateYn === "Y"
        ? chance(0.95)
          ? "N"
          : "Y"
        : chance(0.72)
          ? "N"
          : "Y";
    t.MEDIA = pick(MEDIA_TYPES);
    if (chance(0.2)) t.REFMAIL = `pm@${company.domain}.example`;
    t.EXPETIME = int(1, 8);

    const assignee =
      progress === "1" || (progress === "2" && chance(0.3))
        ? null
        : pickAssignee(company);
    if (assignee) t.SUCCERSON = assignee.id;
    if (progress !== "1" && chance(0.8))
      t.SCHEDATE = fmtDT(addDays(reqDate, int(3, 14)));

    // 재신청 연결 (조회 화면의 btnReapply 경로 재현)
    const prev = prevByCompany.get(company.code) ?? [];
    if (prev.length > 3 && chance(0.03)) {
      t.REREQYN = "Y";
      t.P_ECHONUM = pick(prev);
    } else {
      t.REREQYN = "N";
    }

    const solved = ["4", "5", "6", "9"].includes(progress);
    if (solved) {
      t.CAUSE = esc(tpl.cause);
      t.PROCESS = esc(tpl.process);
      t.ANSWER = esc(`<p>${tpl.answer}</p>`);
      if (tpl.improvement && chance(0.7)) t.IMPROVEMENT = esc(tpl.improvement);
      t.WORKTIME = int(1, 16) * 0.5;
      t.RWORKTIME = t.WORKTIME;
    }

    if (company.confYn === "Y" && Number(progress) >= 3) {
      const approver = company.members.find((m) => m.approver);
      if (approver) {
        t.APPROVER = approver.id;
        t.CONFIRMDT = fmtDT(addDays(reqDate, int(0, 2)));
        if (chance(0.3)) t.CMEMO = esc("예산 범위 내 진행 승인합니다.");
      }
    }

    if (progress === "9") {
      const succ = addDays(reqDate, pickDuration());
      const capped = succ.getTime() > now.getTime() ? daysAgo(1) : succ;
      t.SUCCDATE = fmtDT(capped);
      t.FINALSUCCER = assignee?.id ?? null;
      t.FINALSUCCDATE = t.SUCCDATE;
      if (chance(0.5)) t.RESULT = esc("고객 확인 완료");
      if (company.testYn === "Y" && chance(0.3)) {
        t.TESTDT = fmtDT(addDays(reqDate, 1));
        t.TESTCOMDT = t.SUCCDATE;
        if (chance(0.3)) t.TMEMO = esc("테스트 시나리오 통과 확인.");
      }
    } else if (progress === "11") {
      t.CANCELER = requester.id;
      t.CANCELDT = fmtDT(addDays(reqDate, int(1, 10)));
      t.AMEMO = esc(pick(CANCEL_REASONS));
    } else if (progress === "12") {
      t.AMEMO = esc(pick(REJECT_REASONS));
    } else if (progress === "5") {
      t.TESTDT = fmtDT(addDays(reqDate, int(1, 3)));
    } else if (progress === "6") {
      t.TESTDT = fmtDT(addDays(reqDate, int(1, 3)));
      t.TESTCOMDT = fmtDT(addDays(reqDate, int(4, 6)));
    }

    tickets.push(t);
    prev.push(echo);
    prevByCompany.set(company.code, prev);
  }

  function makeMigration(company: SeedCompany): void {
    const t = blank();
    // 2015~2021 사이 임의 시점. 일부는 날짜 누락(1900-01-01) 이상치 재현
    const base = new Date(2015, 0, 1).getTime();
    const span = new Date(2021, 11, 31).getTime() - base;
    const req = new Date(base + rnd() * span);
    req.setHours(int(9, 18), int(0, 59), 0, 0);
    const missingDate = chance(0.08);

    t.ECHONUM = echoNumOf(company.prefix, req);
    t.CUSTCODE = company.code;
    t.TITLE = esc(pick(MIGRATION_TITLES));
    t.REMARKS = esc(pick(MIGRATION_REMARKS));
    t.CONTENT = chance(0.7) ? esc(`<p>${pick(MIGRATION_REMARKS)}</p>`) : null;
    t.OKREMARKS = esc(pick(MIGRATION_OKREMARKS));
    t.PROGRESS = "9";
    t.REQTYPE = "MIGRATION";
    t.B1GUBUN = pick(company.systems).id;
    {
      const r = rnd();
      t.MODULE =
        r < 0.6
          ? pick(["1", "2", "7", "8", "11", "13"])
          : r < 0.85
            ? pick(["재무관리", "영업관리", "물류관리"]) // 코드 대신 한글 원문이 든 구형 데이터
            : null;
    }
    t.REQLEVEL = "3";
    t.CUSTPERSON = pick(company.members).id;
    t.SUCCERSON = pick(INTERNAL_MEMBERS).id;
    t.REQDATE = missingDate ? "1900-01-01 00:00:00" : fmtDT(req);
    t.SUCCDATE = missingDate ? null : fmtDT(addDays(req, int(0, 10)));
    t.FINALSUCCER = t.SUCCERSON;
    t.FINALSUCCDATE = t.SUCCDATE;
    t.PUBLICYN = chance(0.85) ? "N" : "Y";
    t.WORKTIME = chance(0.6) ? int(1, 12) * 0.5 : null;
    t.REREQYN = "N";
    tickets.push(t);
  }

  // 1) 이관분 — 전체의 과반
  const MIGRATION_TOTAL = 1300;
  for (let i = 0; i < MIGRATION_TOTAL; i++) makeMigration(pickCompany());

  // 2) 아카이브 (종결) — 최근 32개월, 최근일수록 많게
  for (let monthsBack = 32; monthsBack >= 1; monthsBack--) {
    const count = Math.round(10 + (32 - monthsBack) * 0.7 + rnd() * 8);
    for (let i = 0; i < count; i++) {
      const d = new Date(
        now.getFullYear(),
        now.getMonth() - monthsBack,
        int(1, 28),
        int(9, 18),
        int(0, 59),
        int(0, 59),
      );
      if (d.getTime() >= now.getTime()) continue;
      const r = rnd();
      const progress = r < 0.93 ? "9" : r < 0.97 ? "11" : "12";
      makeService(pickCompany(), d, progress, chance(0.9) ? "SERVICE" : "WORK");
    }
  }

  // 3) 진행 중 — 상태 7·8·10 은 실측 0건이라 만들지 않는다
  const openPlan: [string, number, () => Date][] = [
    ["1", 12, () => daysAgo(int(0, 7))],
    ["2", 26, () => daysAgo(int(0, 14))],
    ["3", 78, () => daysAgo(int(2, 35))],
    ["4", 44, () => daysAgo(int(5, 50))],
  ];
  for (const [progress, count, dateFn] of openPlan) {
    for (let i = 0; i < count; i++) {
      makeService(
        pickCompany(),
        dateFn(),
        progress,
        chance(0.92) ? "SERVICE" : "WORK",
      );
    }
  }
  // 테스트 단계(5·6)는 해당 플래그가 켜진 고객사에서만, 극소수 (실측 0.04%)
  const testCompanies = COMPANIES.filter((c) => c.testYn === "Y");
  for (let i = 0; i < 4; i++)
    makeService(pick(testCompanies), daysAgo(int(5, 30)), "5", "SERVICE");
  for (let i = 0; i < 2; i++)
    makeService(pick(testCompanies), daysAgo(int(10, 40)), "6", "SERVICE");

  const insTicket = db.prepare(
    `INSERT INTO NX_OPTREPORTD (${TICKET_COLS.join(",")})
     VALUES (${TICKET_COLS.map((c) => `@${c}`).join(",")})`,
  );
  for (const t of tickets) insTicket.run(t);

  // ── 댓글 + 읽음 상태 ──────────────────────────────────
  const insComment = db.prepare(
    `INSERT INTO NX_OPTREPORTR (PECHONUM, USERID, COMMENT, COMMDATE, ADMIN_ONLY_YN, IS_LOG_YN, PPROGRESS)
     VALUES (@PECHONUM, @USERID, @COMMENT, @COMMDATE, @ADMIN_ONLY_YN, @IS_LOG_YN, @PPROGRESS)`,
  );
  const insRead = db.prepare(
    `INSERT OR REPLACE INTO NX_OPTREPORT_READ_STATE (ECHONUM, USER_ID, LAST_SEEN_COMMENT_ID)
     VALUES (?,?,?)`,
  );

  const PROGRESS_LOG_LABEL: Record<string, string> = {
    "2": "신청이 접수되었습니다.",
    "3": "담당자가 배정되어 처리를 시작합니다.",
    "4": "해결안이 등록되었습니다. 처리결과를 확인해 주세요.",
    "5": "테스트를 요청했습니다.",
    "6": "테스트가 완료되었습니다.",
    "9": "처리가 완료되었습니다.",
    "11": "요청이 취소되었습니다.",
    "12": "요청이 반려되었습니다.",
  };

  for (const t of tickets) {
    if (t.REQTYPE === "MIGRATION") continue;
    const echo = t.ECHONUM as string;
    const requesterId = t.CUSTPERSON as string;
    const assigneeId = (t.SUCCERSON as string | null) ?? null;
    const progress = t.PROGRESS as string;
    const reqTime = new Date(String(t.REQDATE)).getTime();
    const endTime = t.SUCCDATE
      ? new Date(String(t.SUCCDATE)).getTime()
      : now.getTime();
    const span = Math.max(endTime - reqTime, 3_600_000);

    const rows: CommentRow[] = [];
    const at = (frac: number) =>
      fmtDT(new Date(reqTime + span * Math.min(frac, 1)));

    // 상태 전이 로그 (IS_LOG_YN='Y') — 취소·반려는 신청(2) 또는 진행(3)에서 끊긴다
    const passed =
      progress === "11" || progress === "12"
        ? chance(0.5)
          ? ["2", progress]
          : ["2", "3", progress]
        : ["2", "3", "4", "9"].filter((p) => Number(p) <= Number(progress));
    let frac = 0.05;
    for (const p of passed) {
      if (!chance(0.8)) continue;
      rows.push({
        PECHONUM: echo,
        USERID: p === "2" ? requesterId : (assigneeId ?? requesterId),
        COMMENT: PROGRESS_LOG_LABEL[p] ?? "상태가 변경되었습니다.",
        COMMDATE: at(frac),
        ADMIN_ONLY_YN: "N",
        IS_LOG_YN: "Y",
        PPROGRESS: p,
      });
      frac += 0.15;
    }

    // 사람 댓글 — 진행 중 건일수록 많다
    const isOpen = !["9", "11", "12"].includes(progress);
    const humanCount = isOpen ? int(1, 4) : int(0, 3);
    for (let i = 0; i < humanCount; i++) {
      const fromRequester = i % 2 === 0;
      const authorId = fromRequester
        ? requesterId
        : (assigneeId ?? pick(INTERNAL_MEMBERS).id);
      const adminOnly = !fromRequester && chance(0.15);
      rows.push({
        PECHONUM: echo,
        USERID: authorId,
        COMMENT: esc(
          `<p>${adminOnly ? pick(ADMIN_COMMENTS) : fromRequester ? pick(REQUESTER_COMMENTS) : pick(ENGINEER_COMMENTS)}</p>`,
        ),
        COMMDATE: at(frac),
        ADMIN_ONLY_YN: adminOnly ? "Y" : "N",
        IS_LOG_YN: "N",
        PPROGRESS: null,
      });
      frac += 0.12;
    }

    let lastId = 0;
    for (const row of rows) {
      const res = insComment.run(row);
      lastId = Number(res.lastInsertRowid);
    }
    if (lastId === 0) continue;

    // 읽음 상태 — 80% 는 끝까지 읽음, 나머지는 미읽음 뱃지 재현
    for (const uid of [requesterId, assigneeId]) {
      if (!uid) continue;
      if (chance(0.8)) insRead.run(echo, uid, lastId);
      else if (chance(0.5) && lastId > 1) insRead.run(echo, uid, lastId - 1);
      // else: 읽음 기록 없음 = 전부 미읽음
    }
  }

  // ── 첨부 ─────────────────────────────────────────────
  // 배포본은 쓰기가 꺼져 있어(ALLOW_DEV_WRITES) 업로드를 못 한다 → 첨부 화면이
  // 늘 비어 보이지 않도록 일부 요청에 미리 붙여 둔다. 내용은 전부 가상이다.
  const insFile = db.prepare(
    `INSERT INTO NX_OPTREPORT_FILE
       (PECHONUM, FILE_NM, MIME_TP, FILE_SZ, FILE_DATA, USERID, REG_DT)
     VALUES (?,?,?,?,?,?,?)`,
  );
  for (const t of tickets) {
    if (t.REQTYPE === "MIGRATION") continue;
    if (!chance(0.12)) continue;
    const count = chance(0.25) ? 2 : 1;
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const f = pick(ATTACH_FILES);
      if (used.has(f.name)) continue;
      used.add(f.name);
      const bytes = Buffer.from(f.body, "utf8");
      insFile.run(
        t.ECHONUM as string,
        f.name,
        f.mime,
        bytes.length,
        bytes,
        t.CUSTPERSON as string,
        t.REQDATE as string,
      );
    }
  }
}
