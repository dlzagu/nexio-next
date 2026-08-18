/**
 * 공유 DB(libSQL)가 **앱이 기대는 SQLite 규칙**을 그대로 지키는지 확인한다.
 *
 *   npm run db:verify:remote      # .env.turso 를 읽는다
 *
 * 왜 필요한가: 데이터 계층은 SQLite 의 특정 동작에 기대고 있다. 특히 ①번(GROUP BY 의
 * bare column 이 MAX() 행을 따라간다)은 표준 SQL 이 아니라 SQLite 의 성질이라,
 * 저장소를 바꿀 때 **조용히 다른 행을 집어** 알림센터가 엉뚱한 글을 대표로 보여줄 수 있다.
 * 쓰기 검사(④⑤)는 트랜잭션에 넣고 롤백하므로 데모 데이터에 흔적을 남기지 않는다.
 */
import { createClient } from "@libsql/client";
const c = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const q = async (sql, args = {}) => (await c.execute({ sql, args })).rows;

// ① 알림센터가 기대는 규칙: min/max 집계가 정확히 하나면 bare column 이 그 행을 따라간다
const g = await q(`SELECT MAX(r.ID) AS ID, r.PECHONUM, COUNT(*) AS n, r.COMMENT
                     FROM NX_OPTREPORTR r GROUP BY r.PECHONUM ORDER BY ID DESC LIMIT 1`);
const maxRow = await q(`SELECT COMMENT FROM NX_OPTREPORTR WHERE ID = @id`, {
  id: g[0].ID,
});
console.log(
  "① GROUP BY bare column:",
  g[0].COMMENT === maxRow[0].COMMENT ? "SQLite 와 동일 ✅" : "❌ 다름",
);

// ② 첨부 BLOB 이 바이트로 돌아오는가
const b = await q(
  `SELECT FILE_NM, FILE_SZ, FILE_DATA FROM NX_OPTREPORT_FILE LIMIT 1`,
);
const bytes = b[0].FILE_DATA;
console.log(
  "② BLOB:",
  b[0].FILE_NM,
  "선언",
  b[0].FILE_SZ,
  "실제",
  Buffer.from(bytes).length,
  Buffer.from(bytes).length === Number(b[0].FILE_SZ) ? "✅" : "❌",
);

// ③ 대시보드가 쓰는 날짜 함수 · 파생 테이블 집계
const d = await q(`SELECT COUNT(*) AS n FROM NX_OPTREPORTD
                    WHERE REQDATE >= date('now','-11 months','start of month')`);
console.log(
  "③ date('now',…):",
  Number(d[0].n).toLocaleString("ko-KR"),
  "건 ✅",
);

// ④ 쓰기 — 트랜잭션으로 넣어 보고 되돌린다 (데모 DB 에 흔적을 남기지 않는다)
const before = Number(
  (await q(`SELECT COUNT(*) AS n FROM NX_OPTREPORTR`))[0].n,
);
const tx = await c.transaction("write");
await tx.execute({
  sql: `INSERT INTO NX_OPTREPORTR (PECHONUM,USERID,COMMENT,COMMDATE,ADMIN_ONLY_YN,IS_LOG_YN,PPROGRESS)
                          VALUES ('__probe__','probe','<p>x</p>','2026-08-18 00:00:00','N','N',NULL)`,
  args: {},
});
const mid = Number(
  (await tx.execute(`SELECT COUNT(*) AS n FROM NX_OPTREPORTR`)).rows[0].n,
);
await tx.rollback();
const after = Number((await q(`SELECT COUNT(*) AS n FROM NX_OPTREPORTR`))[0].n);
console.log(
  "④ 쓰기/트랜잭션:",
  before,
  "→",
  mid,
  "→ 롤백 후",
  after,
  before === after && mid === before + 1 ? "✅" : "❌",
);

// ⑤ INSERT OR REPLACE (읽음선 UPSERT) 구문 수용 여부 — 역시 롤백
const tx2 = await c.transaction("write");
await tx2.execute(
  `INSERT OR REPLACE INTO NX_OPTREPORT_READ_STATE (ECHONUM,USER_ID,LAST_SEEN_COMMENT_ID) VALUES ('__probe__','p',1)`,
);
await tx2.rollback();
console.log("⑤ INSERT OR REPLACE: 수용 ✅");
