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
const plan = [];
let drift = false;

for (const { table, key } of MASTER) {
  const cols = colsOf(table);
  const rcols = await remoteColsOf(table);

  if (rcols.length === 0) {
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

console.log(
  DRY
    ? "\n미리보기 끝 — 실제로 반영하려면 --dry 없이 다시 실행하세요."
    : `\n완료 — 마스터 ${written}행 반영. 티켓·댓글·읽음선·첨부·공지는 건드리지 않았습니다.`,
);
local.close();
