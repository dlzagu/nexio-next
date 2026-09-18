/**
 * 공유 DB(libSQL/Turso)의 **마스터 데이터만** 로컬 시드에 맞춘다.
 *
 * 왜 따로 있나: 시드가 바뀌면 로컬 파일 DB 는 SCHEMA_VERSION 을 보고 통째로 다시 만들어지지만,
 * **공유 DB 에는 그런 장치가 없다.** 그래서 코드는 새 데이터를 전제로 도는데 라이브 DB 는
 * 옛날 그대로다 (실측: 새로 추가한 페르소나 계정이 라이브에서 404 → 역할 전환이 조용히 실패).
 *
 * 전체 재시드(`db:seed:remote`)는 이 문제를 해결하지만 **라이브에서 사람들이 만든 티켓·댓글·
 * 첨부를 통째로 지운다.** 쓰기를 열어 둔 데모(ADR-0009)에서 그건 너무 비싼 대가다.
 * 그래서 이 스크립트는 마스터 테이블만 INSERT OR REPLACE 로 얹는다 — 거래 데이터는 건드리지 않는다.
 *
 *   npm run db:sync:remote -- --dry   # 무엇이 바뀔지만 본다
 *   npm run db:sync:remote
 *
 * ⚠️ 컬럼이 늘어난 스키마 변경은 이 스크립트로 못 따라간다(행만 얹기 때문이다).
 *    그 경우엔 무엇이 어긋났는지 알려주고 멈춘다 — 조용히 반쪽만 맞추지 않는다.
 */
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import path from "node:path";
import { existsSync } from "node:fs";

/** 마스터 = 시드가 정본인 표. 나머지(티켓·댓글·읽음선·첨부·공지)는 라이브가 정본이다 */
const MASTER = [
  { table: "NX_SCHEMA", key: null },
  { table: "COMPANY_MST", key: "COMPANY_CODE" },
  { table: "COMPANY_OPER_SYSTEM", key: "OPER_SYS_ID" },
  { table: "MEMBER_MST", key: "MBER_ID" },
];

/**
 * 문구만 시드를 따르는 행. **보이는 공지만** 시드 소유다 — 같은 표에 고객사 관리가 숨김 이력 행
 * (DELETE_FG='Y')을 쓰는데, 그 행은 라이브가 정본이고 번호(MAX+1)가 로컬과 겹친다. 번호만 보고
 * 맞추면 라이브의 관리 이력이 로컬 문구로 **덮인다**(리뷰 재현). 양쪽 모두 보이는 행만 읽는다.
 * **등록일(REG_DT)은 건드리지 않는다** — 데모 시계(ADR-0012)가 기준 시각을 역산하는 증인이고,
 * 라이브에서는 시계가 그 날짜를 날마다 민다. 여기서 로컬 날짜로 덮으면 세계가 엉뚱한 날로 간다.
 * (예: 시드 문구에서 달력 날짜를 뺀 변경 — "8월 정기 점검 (8/20)"이 9월에 등록된 공지로 보였다)
 */
const TEXT_ONLY = [
  {
    table: "BOARD_DETAIL",
    key: "NTT_ID",
    cols: ["NTT_SJ", "NTT_CN"],
    where: "COALESCE(DELETE_FG,'N') <> 'Y' AND COALESCE(USE_FG,'Y') = 'Y'",
  },
];

const DRY = process.argv.includes("--dry");
const LOCAL =
  process.env.SQLITE_PATH ?? path.join(process.cwd(), ".data", "nexio.db");
const URL = process.env.TURSO_DATABASE_URL?.trim();
const TOKEN = process.env.TURSO_AUTH_TOKEN?.trim();

if (!existsSync(LOCAL)) {
  console.error(
    `로컬 데모 DB 가 없습니다: ${LOCAL}\n  → npm run dev 를 한 번 띄워 시드를 만든 뒤 다시 실행하세요.`,
  );
  process.exit(1);
}
if (!URL) {
  console.error(
    "TURSO_DATABASE_URL 이 없습니다. (.env.turso 에 좌표를 넣으세요)",
  );
  process.exit(1);
}

const local = new Database(LOCAL, { readonly: true });
const remote = createClient({ url: URL, authToken: TOKEN });

const colsOf = (table) =>
  local
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

const remoteColsOf = async (table) => {
  const rs = await remote.execute(`PRAGMA table_info(${table})`);
  const i = rs.columns.indexOf("name");
  return rs.rows.map((r) => String(r[i]));
};

console.log(DRY ? "[미리보기] 쓰지 않습니다\n" : "");

/**
 * 🔴 **전부 확인한 뒤에 쓴다.** 표 하나씩 확인·반영을 번갈아 하면, 뒤쪽 표에서 스키마가
 *    어긋났을 때 앞쪽은 이미 반영된 뒤다 — 딱 "반쪽만 맞춘" 상태로 멈춘다.
 */
/**
 * 새로 생긴 **표**는 만들어 준다.
 *
 * 컬럼이 늘어난 변경은 행만 얹어서 못 따라가지만(아래에서 멈춘다), 표가 통째로 없는 것은
 * 다르다 — 로컬은 `SCHEMA_VERSION` 을 보고 다시 만들어지는데 공유 DB 에는 그 장치가 없어,
 * 새 기능이 배포되는 순간 라이브만 `no such table` 로 500 이 난다.
 * 내용은 옮기지 않는다(라이브에서 쌓이는 사용자 데이터다). 빈 표를 만들어 줄 뿐이다.
 *
 * ⚠️ 이 단계만 아래 "전부 확인한 뒤에 쓴다" 규칙 밖이다 — 표가 없으면 컬럼 대조 자체가
 *    성립하지 않아 먼저 만들어야 한다. 빈 표 생성은 되돌릴 필요가 없는 작업이라
 *    중간에 멈춰도 "반쪽만 맞춘" 상태가 되지 않는다.
 */
const localObjects = local
  .prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
  )
  .all();

const createdTables = [];
for (const o of localObjects.filter((x) => x.type === "table")) {
  if ((await remoteColsOf(o.name)).length > 0) continue;
  createdTables.push(o.name);
  if (DRY) continue;
  const idx = localObjects.filter(
    (x) => x.type === "index" && x.tbl_name === o.name,
  );
  await remote.batch(
    [{ sql: o.sql }, ...idx.map((x) => ({ sql: x.sql }))],
    "write",
  );
}
if (createdTables.length) {
  console.log(
    `  ${DRY ? "만들 표" : "새 표 생성"}: ${createdTables.join(", ")}
`,
  );
}

const plan = [];
let drift = false;

for (const { table, key } of MASTER) {
  const cols = colsOf(table);
  const rcols = await remoteColsOf(table);

  if (rcols.length === 0) {
    // 위에서 만들었으면 여기 오지 않는다. 그래도 왔다면 미리보기(--dry)라 아직 안 만든 것이다
    if (DRY && createdTables.includes(table)) continue;
    console.log(`  ${table}: 원격에 표가 없습니다 → 전체 재시드 필요`);
    drift = true;
    continue;
  }
  const missing = cols.filter((c) => !rcols.includes(c));
  if (missing.length) {
    console.log(
      `  ${table}: 원격에 없는 컬럼 ${missing.join(", ")} → 전체 재시드 필요`,
    );
    drift = true;
    continue;
  }

  const rows = local.prepare(`SELECT ${cols.join(",")} FROM ${table}`).all();

  // 무엇이 **새로 생기는지** 먼저 말한다 — 덮어쓰기는 조용해도 되지만 추가는 눈에 보여야 한다
  let added = [];
  if (key) {
    const rs = await remote.execute(`SELECT ${key} FROM ${table}`);
    const have = new Set(rs.rows.map((r) => String(r[0])));
    added = rows.map((r) => String(r[key])).filter((k) => !have.has(k));
  }
  plan.push({ table, key, cols, rows, added });
}

/** 문구만 맞출 행 — 확인은 여기서 끝내고 쓰기는 아래에서 한꺼번에 (반쪽 반영 금지) */
const textPlan = [];
for (const { table, key, cols, where } of TEXT_ONLY) {
  const rcols = await remoteColsOf(table);
  const missing = [key, ...cols, "DELETE_FG", "USE_FG"].filter(
    (c) => !rcols.includes(c),
  );
  if (rcols.length && missing.length) {
    console.log(
      `  ${table}: 원격에 없는 컬럼 ${missing.join(", ")} → 전체 재시드 필요`,
    );
    drift = true;
    continue;
  }
  const pick = `SELECT ${[key, ...cols].join(",")} FROM ${table} WHERE ${where}`;
  const rows = local.prepare(pick).all();
  const rs = rcols.length
    ? await remote.execute(pick)
    : { rows: [], columns: [] };
  const have = new Map(
    rs.rows.map((r) => [String(r[0]), cols.map((_, i) => r[i + 1] ?? null)]),
  );
  // 원격에 있는 행만, 문구가 다른 것만 — 없는 공지를 새로 만들지는 않는다(등록일을 지어낼 수 없다)
  const changed = rows.filter((r) => {
    const cur = have.get(String(r[key]));
    return cur && cols.some((c, i) => (r[c] ?? null) !== cur[i]);
  });
  textPlan.push({ table, key, cols, where, rows: changed });
}

if (drift) {
  console.error(
    "\n⛔ 스키마가 어긋났습니다. 행만 얹어서는 맞출 수 없습니다." +
      "\n   라이브에 쌓인 티켓·댓글·첨부를 버려도 된다면 npm run db:seed:remote (전체 재시드).",
  );
  local.close();
  process.exit(1);
}

let written = 0;
for (const { table, key, cols, rows, added } of plan) {
  if (!DRY) {
    const values = `(${cols.map(() => "?").join(",")})`;
    const stmts = key
      ? rows.map((r) => ({
          sql: `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES ${values}`,
          args: cols.map((c) => r[c] ?? null),
        }))
      : [
          // 버전 표는 키가 없다 — 한 트랜잭션 안에서 비우고 다시 넣는다
          { sql: `DELETE FROM ${table}` },
          ...rows.map((r) => ({
            sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
            args: cols.map((c) => r[c] ?? null),
          })),
        ];
    await remote.batch(stmts, "write");
    written += rows.length;
  }
  console.log(
    `  ${table}: ${rows.length}행${added.length ? ` (신규 ${added.length}: ${added.join(", ")})` : ""}`,
  );
}

for (const { table, key, cols, where, rows } of textPlan) {
  if (!DRY && rows.length) {
    await remote.batch(
      rows.map((r) => ({
        // 쓰는 순간에도 보이는 행만 — 확인과 쓰기 사이에 숨김 행이 된 경우까지 막는다
        sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ? AND ${where}`,
        args: [...cols.map((c) => r[c] ?? null), r[key]],
      })),
      "write",
    );
  }
  console.log(
    `  ${table}: 문구 ${rows.length}건${rows.length ? ` (${rows.map((r) => r[key]).join(", ")})` : ""} — 등록일은 그대로`,
  );
}

console.log(
  DRY
    ? "\n미리보기 끝 — 실제로 반영하려면 --dry 없이 다시 실행하세요."
    : `\n완료 — 마스터 ${written}행 반영. 티켓·댓글·읽음선·첨부는 건드리지 않았고, 공지는 문구만 맞췄습니다.`,
);
local.close();
