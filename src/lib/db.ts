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
 * 🔒 read-only 계약 유지. select() 가 SELECT/WITH 이외의 구문을 기계적으로 거부한다.
 *    (쓰기 경로가 열리면 별도의 전용 함수로 추가한다 — 이 관문을 넓히지 않는다)
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

export interface Param {
  name: string;
  value: string | number | null;
}

/** SELECT 전용. 다른 구문은 실행하지 않고 던진다 */
export async function select<T = Record<string, unknown>>(
  sql: string,
  params: Param[] = [],
): Promise<T[]> {
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (!READ_ONLY.test(stripped)) {
    throw new Error(
      "select() 는 SELECT/WITH 만 실행합니다. 쓰기 구문이 감지됐습니다.",
    );
  }
  // 쿼리에 실제로 등장하는 파라미터만 바인딩한다 — 남는 바인딩은 드라이버가 거부한다
  const bound: Record<string, string | number | null> = {};
  for (const { name, value } of params) {
    if (new RegExp(`@${name}\\b`).test(stripped)) bound[name] = value;
  }
  return db().prepare(stripped).all(bound) as T[];
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
