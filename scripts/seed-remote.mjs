/**
 * 로컬 데모 DB(`.data/nexio.db`)를 **공유 DB(libSQL/Turso)로 그대로 복사**한다.
 *
 * 왜 이렇게 하나: 시드 생성기는 better-sqlite3(동기)에 묶여 있다. 원격에서 다시 돌리려면
 * 생성기를 async 로 갈라야 하는데, 그건 시드의 결정성을 건드리는 일이다.
 * 이미 만들어진 파일을 복사하면 **로컬과 라이브가 같은 데이터**임이 자명해진다.
 *
 *   npm run dev              # 한 번 띄워 .data/nexio.db 를 만든다 (없으면)
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:seed:remote
 *
 * 스키마도 로컬 DB 에서 읽어 온다(sqlite_master) — 스키마 정의를 두 벌 관리하지 않는다.
 * ⚠️ 원격에 이미 있는 같은 이름의 테이블은 **지우고 다시 만든다**. 데모 DB 라 잃을 게 없다.
 */
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import path from "node:path";
import { existsSync } from "node:fs";

const LOCAL =
  process.env.SQLITE_PATH ?? path.join(process.cwd(), ".data", "nexio.db");
const URL = process.env.TURSO_DATABASE_URL?.trim();
const TOKEN = process.env.TURSO_AUTH_TOKEN?.trim();
const BATCH = 400;

if (!existsSync(LOCAL)) {
  console.error(
    `로컬 데모 DB 가 없습니다: ${LOCAL}\n  → npm run dev 를 한 번 띄워 시드를 만든 뒤 다시 실행하세요.`,
  );
  process.exit(1);
}
if (!URL) {
  console.error(
    "TURSO_DATABASE_URL 이 없습니다. (예: libsql://<db>-<org>.turso.io)",
  );
  process.exit(1);
}

const local = new Database(LOCAL, { readonly: true });
const remote = createClient({ url: URL, authToken: TOKEN });

/** 스키마 정본은 로컬 DB 자신이다 */
const schema = local
  .prepare(
    `SELECT type, name, sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`,
  )
  .all();

const tables = schema.filter((s) => s.type === "table").map((s) => s.name);
console.log(`테이블 ${tables.length}개: ${tables.join(", ")}`);

// ── 스키마 재생성 ────────────────────────────────────────────
const ddl = [
  ...tables.map((t) => ({ sql: `DROP TABLE IF EXISTS ${t}` })),
  ...schema.map((s) => ({ sql: s.sql })),
];
await remote.batch(ddl, "write");
console.log("스키마 생성 완료");

// ── 데이터 복사 ──────────────────────────────────────────────
let total = 0;
for (const table of tables) {
  const cols = local
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
  const rows = local.prepare(`SELECT ${cols.join(",")} FROM ${table}`).all();
  if (rows.length === 0) {
    console.log(`  ${table}: 0`);
    continue;
  }

  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => ({
      sql,
      // Buffer 는 그대로 넘긴다 (Uint8Array 라 libSQL 이 BLOB 으로 받는다)
      args: cols.map((c) => r[c] ?? null),
    }));
    await remote.batch(chunk, "write");
  }
  total += rows.length;
  console.log(`  ${table}: ${rows.length.toLocaleString("ko-KR")}`);
}

const check = await remote.execute("SELECT COUNT(*) AS n FROM NX_OPTREPORTD");
console.log(
  `\n완료 — ${total.toLocaleString("ko-KR")}행 복사, 원격 티켓 ${Number(check.rows[0].n).toLocaleString("ko-KR")}건`,
);
local.close();
