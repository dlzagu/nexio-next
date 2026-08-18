/**
 * 런타임 스모크 — **앱을 실제로 띄워** 주요 경로가 살아 있는지 본다.
 *
 * 왜 필요한가: CI 가 lint·typecheck·test·build 로 끝나면 앱이 한 번도 실행되지 않는다.
 * 실제로 겪은 사고 셋은 전부 **빌드는 green 인데 화면이 깨진** 종류였다 —
 *   · 옛 스키마가 남은 DB → `no such column` 으로 SSR 500
 *   · 서버(UTC)·브라우저(KST) 날짜가 어긋나 하이드레이션 붕괴
 *   · 공유 DB 가 시드보다 뒤처져 역할 전환이 404
 * 셋 다 타입도 테스트도 통과한다. 한 번 띄워서 200 을 받아 보는 것이 유일한 방벽이다.
 *
 *   npm run smoke            # 빌드 산출물(.next)이 있어야 한다
 *   npm run smoke -- 3100    # 포트 지정
 *
 * ⚠️ 서버는 이 스크립트가 직접 띄우고 반드시 내린다 — CI 잡이 좀비 프로세스로 매달리지 않게.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const PORT = Number(process.argv[2] || process.env.PORT || 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

/** 화면 경로는 200 이면 통과. /api/diag 는 **내용까지** 본다 (개별 조회의 성패가 담긴다) */
const PAGES = [
  "/",
  "/dashboard",
  "/requests",
  "/requests/new",
  "/board",
  "/notices",
  "/customers",
  "/styleguide",
];
const APIS = ["/api/session", "/api/notifications"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ npx/next 를 이름으로 부르지 않는다 — 윈도우에서는 `.cmd` 라 spawn 이 EINVAL 로 죽는다.
//    node 로 진입 파일을 직접 실행하면 셸 없이 어느 OS 에서나 같게 뜬다.
const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

let serverLog = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (d) => {
    serverLog += d;
  });
}

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  ✕ ${msg}`);
};

async function ready() {
  const until = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < until) {
    if (server.exitCode !== null) {
      throw new Error(
        `서버가 뜨기 전에 종료됐습니다 (code ${server.exitCode})\n${serverLog}`,
      );
    }
    try {
      await fetch(BASE + "/api/session");
      return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`${BOOT_TIMEOUT_MS}ms 안에 뜨지 않았습니다\n${serverLog}`);
}

try {
  console.log(`서버 기동 중… ${BASE}`);
  await ready();

  for (const path of [...PAGES, ...APIS]) {
    const res = await fetch(BASE + path, { redirect: "manual" });
    const ok = res.status === 200 || (path === "/" && res.status < 400);
    if (ok) console.log(`  ✓ ${path} → ${res.status}`);
    else fail(`${path} → ${res.status}`);
  }

  // 진단은 상태 코드에 **각 조회의 성패가 모여 있다** (하나라도 실패하면 500)
  const diag = await fetch(BASE + "/api/diag");
  const body = await diag.json().catch(() => ({}));
  if (diag.status === 200) {
    console.log(
      `  ✓ /api/diag → 200 (${body.db?.mode}, 티켓 ${body.db?.tickets})`,
    );
  } else {
    fail(`/api/diag → ${diag.status}`);
    for (const [k, v] of Object.entries(body)) {
      if (v && typeof v === "object" && v.ok === false) {
        console.error(`      ${k}: ${v.error}`);
      }
    }
  }

  /**
   * 200 을 믿지 않는다. 이 앱은 DB 를 못 열어도 **원인을 설명하는 화면을 200 으로** 그린다
   * (원인을 감추지 않는다는 설계라 그 자체는 옳다). 그래서 상태 코드만 보면
   * "전부 초록인데 앱은 아무것도 못 하는" 배포를 통과시킨다 — 본문까지 본다.
   */
  const html = await (await fetch(BASE + "/dashboard")).text();
  if (!html.includes("<main")) fail("/dashboard 에 본문(<main>)이 없습니다");
  if (html.includes("데모 DB 를 열 수 없습니다")) {
    fail("/dashboard 가 200 이지만 DB 오류 화면입니다");
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  server.kill();
  // 윈도우에서는 kill 이 즉시 안 먹는 경우가 있어 조금 기다렸다 강제로
  await wait(300);
  if (server.exitCode === null) server.kill("SIGKILL");
}

if (failed) {
  console.error(`\n스모크 실패 — ${failed}건`);
  process.exit(1);
}
console.log("\n스모크 통과");
