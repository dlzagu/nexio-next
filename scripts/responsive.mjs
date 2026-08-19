/**
 * 반응형 회귀 검사 — **폭을 바꿔가며 실제로 띄워** 넘치는 곳이 없는지 본다.
 *
 * 왜 필요한가: 좁은 화면이 깨진 것을 사람이 브라우저를 열어서야 찾았다
 * (216px 사이드바가 본문을 159px 로 만들고 있었다). 화면이 하나 늘 때마다
 * 사람이 다시 재야 한다면, 언젠가 아무도 재지 않는다.
 *
 * 잡는 것 두 가지:
 *   1. 가로 넘침 — 페이지가 뷰포트보다 넓어지면 실패. 넘친 요소를 이름까지 찍어 준다.
 *   2. 골격 — 좁으면 사이드바 대신 메뉴 버튼, 넓으면 그 반대. 서랍이 열리고 닫히는가.
 *
 * 실행 (브라우저는 저장소 의존성이 아니다 — 필요할 때만 받는다):
 *   npm i --no-save playwright@1.56.1 && npx playwright install chromium
 *   npm run build && npm run responsive
 *
 * 저장소 밖에 설치했다면 위치를 넘긴다 (ESM 은 NODE_PATH 를 보지 않는다):
 *   PLAYWRIGHT_MODULE=file:///C:/tmp/pw/node_modules/playwright/index.mjs npm run responsive
 */
import { spawn } from "node:child_process";
import path from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);

const PORT = Number(process.env.RESPONSIVE_PORT ?? 3300);
const BASE = `http://127.0.0.1:${PORT}`;

/** 실제로 쓰이는 폭 세 개 — 그 사이는 같은 규칙이 이어진다 */
const WIDTHS = [
  { name: "모바일", width: 390, height: 844 },
  { name: "태블릿", width: 768, height: 1024 },
  { name: "데스크톱", width: 1440, height: 900 },
];

const ROUTES = [
  "/dashboard",
  "/requests?view=open",
  "/board",
  "/requests/new",
  "/notices",
  "/customers",
  "/styleguide",
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextBin = path.join("node_modules", "next", "dist", "bin", "next");

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  ✕ ${msg}`);
};

const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
  stdio: "ignore",
});

async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${BASE}/api/session`);
      return true;
    } catch {
      await wait(400);
    }
  }
  return false;
}

/**
 * 넘친 요소를 **이름까지** 돌려준다. "어딘가 넘쳤다"만 알려주면
 * 결국 사람이 브라우저를 다시 열어야 한다 — 그러면 검사한 보람이 없다.
 */
const OVERFLOW_PROBE = () => {
  const de = document.documentElement;
  const over = de.scrollWidth - de.clientWidth;
  if (over <= 1) return { over: 0, culprits: [] };
  const culprits = [];
  for (const el of document.querySelectorAll("main *, header *")) {
    const r = el.getBoundingClientRect();
    if (r.right > de.clientWidth + 1 && el.children.length < 20) {
      culprits.push(
        `${el.tagName.toLowerCase()}.${String(el.className || "").slice(0, 40)} (w=${Math.round(r.width)})`,
      );
    }
  }
  return { over, culprits: [...new Set(culprits)].slice(0, 5) };
};

try {
  if (!(await ready())) {
    throw new Error(
      "서버가 뜨지 않았습니다 — npm run build 를 먼저 실행하세요",
    );
  }
  const browser = await chromium.launch();

  for (const vp of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      isMobile: vp.width < 768,
      hasTouch: vp.width < 768,
    });
    const page = await context.newPage();

    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      const { over, culprits } = await page.evaluate(OVERFLOW_PROBE);
      if (over > 1) {
        fail(`${vp.name}(${vp.width}) ${route} — 가로로 ${over}px 넘친다`);
        for (const c of culprits) console.error(`        ${c}`);
      }
    }

    // ── 골격: 좁으면 메뉴 버튼, 넓으면 사이드바 ────────────────
    await page.goto(`${BASE}/requests?view=open`, { waitUntil: "networkidle" });
    const shell = await page.evaluate(() => {
      const vis = (el) => !!el && el.offsetParent !== null;
      return {
        sidebar: vis(document.querySelector("aside")),
        burger: vis(document.querySelector('button[aria-label="메뉴 열기"]')),
      };
    });
    const narrow = vp.width < 768;
    if (shell.sidebar === narrow) {
      fail(
        `${vp.name}(${vp.width}) 사이드바가 ${shell.sidebar ? "보인다" : "안 보인다"} — 기대와 반대다`,
      );
    }
    if (shell.burger !== narrow) {
      fail(
        `${vp.name}(${vp.width}) 메뉴 버튼이 ${shell.burger ? "보인다" : "안 보인다"} — 기대와 반대다`,
      );
    }

    // ── 좁은 화면에서만: 서랍이 열리고, 이동하면 닫힌다 ─────────
    if (narrow) {
      await page.click('button[aria-label="메뉴 열기"]');
      await page.waitForSelector(".drawer", { timeout: 5000 });
      const links = await page.$$eval(".drawer nav a", (as) => as.length);
      if (links < 5) fail(`${vp.name} 서랍의 메뉴가 ${links}개뿐이다`);
      await page.click(".drawer nav a:nth-child(3)");
      await page.waitForTimeout(1200);
      if (await page.$(".drawer")) {
        fail(`${vp.name} 서랍이 이동 후에도 닫히지 않는다`);
      }
    }

    console.log(`  ✓ ${vp.name} (${vp.width}px) — ${ROUTES.length}개 경로`);
    await context.close();
  }

  await browser.close();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  server.kill();
  await wait(300);
  if (server.exitCode === null) server.kill("SIGKILL");
}

if (failed) {
  console.error(`\n반응형 검사 실패 — ${failed}건`);
  process.exit(1);
}
console.log("\n반응형 검사 통과");
