import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureSeed } from "./dev-seed/generate";

/**
 * 데모 DB (SQLite + 가상 시드 데이터).
 *
 * 사이드 프로젝트 전환(ADR-0004) — 회사 개발 DB 직접 조회(ADR-0002)를 대체한다.
 * 외부 DB 서버·계정·환경변수 없이 클론 직후 바로 돈다:
 *  - 로컬: `.data/nexio.db` 파일. 없으면 첫 접속 때 스키마 생성 + 시드 (npm run db:reset 으로 재생성)
 *  - 서버리스(Vercel): 파일시스템이 read-only 라 `:memory:` — 콜드스타트마다 시드를 즉석 생성
 *
 * 🔒 읽기·쓰기 관문이 분리돼 있다. select() 는 SELECT/WITH 이외를 기계적으로 거부하고,
 *    쓰기는 write() 라는 **별도의 좁은 문**으로만 들어간다 (select 를 넓히지 않는다).
 */

function dbPath(): string {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  // Vercel 등 서버리스 런타임은 배포 파일시스템이 read-only
  if (process.env.VERCEL) return ":memory:";
  return path.join(process.cwd(), ".data", "nexio.db");
}

// dev 서버 HMR 마다 커넥션이 새로 생기지 않게 전역에 캐시한다
const g = globalThis as unknown as { __nxDb?: Database.Database };

function db(): Database.Database {
  if (g.__nxDb) return g.__nxDb;
  const p = dbPath();
  if (p !== ":memory:") {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  }
  const database = new Database(p);
  if (p !== ":memory:") database.pragma("journal_mode = WAL");
  ensureSeed(database);
  g.__nxDb = database;
  return database;
}

const READ_ONLY = /^\s*(?:select|with)\b/i;
const WRITE_ONLY = /^\s*(?:insert|update)\b/i;

export interface Param {
  name: string;
  value: string | number | null;
}

const stripComments = (sql: string) =>
  sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** 쿼리에 실제로 등장하는 파라미터만 바인딩한다 — 남는 바인딩은 드라이버가 거부한다 */
function bindable(sql: string, params: Param[]) {
  const bound: Record<string, string | number | null> = {};
  for (const { name, value } of params) {
    if (new RegExp(`@${name}\\b`).test(sql)) bound[name] = value;
  }
  return bound;
}

/** SELECT 전용. 다른 구문은 실행하지 않고 던진다 */
export async function select<T = Record<string, unknown>>(
  sql: string,
  params: Param[] = [],
): Promise<T[]> {
  const stripped = stripComments(sql);
  if (!READ_ONLY.test(stripped)) {
    throw new Error(
      "select() 는 SELECT/WITH 만 실행합니다. 쓰기 구문이 감지됐습니다.",
    );
  }
  return db().prepare(stripped).all(bindable(stripped, params)) as T[];
}

export async function selectOne<T = Record<string, unknown>>(
  sql: string,
  params: Param[] = [],
): Promise<T | null> {
  const rows = await select<T>(sql, params);
  return rows[0] ?? null;
}

/** 데모 DB 쓰기 허용 플래그. 기본 false — 신청 저장이 실제 INSERT 하지 않는다 */
export function devWritesAllowed(): boolean {
  return process.env.ALLOW_DEV_WRITES === "true";
}

export class WriteDisabledError extends Error {
  constructor() {
    super("데모 DB 쓰기가 비활성 상태입니다 (ALLOW_DEV_WRITES).");
    this.name = "WriteDisabledError";
  }
}

export interface WriteStatement {
  sql: string;
  params?: Param[];
}

/**
 * 쓰기 관문. 넘긴 구문 **전체를 하나의 트랜잭션**으로 실행한다 —
 * 상태 변경과 이력 로그가 따로 커밋되면 이력 없는 티켓이 생긴다.
 *
 * 🔒 fail-closed 3중
 *   ① ALLOW_DEV_WRITES 가 아니면 실행 자체를 하지 않는다 (라우트에서도 한 번 더 막지만,
 *      관문 안쪽에 두어야 새 호출자가 게이트를 잊어도 뚫리지 않는다)
 *   ② INSERT/UPDATE 만 통과 — DELETE·DDL 은 이 앱이 쓰지 않으므로 아예 거부한다
 *   ③ 한 문자열에 두 구문을 넣는 경로는 better-sqlite3 prepare 가 거부한다
 *
 * @returns 구문별 변경 행 수
 */
export async function write(statements: WriteStatement[]): Promise<number[]> {
  if (!devWritesAllowed()) throw new WriteDisabledError();
  if (statements.length === 0) return [];

  const database = db();
  const prepared = statements.map(({ sql, params = [] }) => {
    const stripped = stripComments(sql);
    if (!WRITE_ONLY.test(stripped)) {
      throw new Error(
        "write() 는 INSERT/UPDATE 만 실행합니다. 허용되지 않는 구문입니다.",
      );
    }
    return {
      stmt: database.prepare(stripped),
      bound: bindable(stripped, params),
    };
  });

  const tx = database.transaction(() =>
    prepared.map(({ stmt, bound }) => stmt.run(bound).changes),
  );
  return tx();
}

export async function dbHealth(): Promise<{
  ok: boolean;
  error?: string;
  mode?: string;
  tickets?: number;
}> {
  try {
    const rows = await select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM NX_OPTREPORTD",
    );
    return {
      ok: true,
      mode: dbPath() === ":memory:" ? "memory" : "file",
      tickets: Number(rows[0]?.n ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
