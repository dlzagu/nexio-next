/**
 * README 스크린샷 생성기.
 *
 * 저장소 의존성에는 넣지 않는다 — CI 의 `npm ci` 가 매번 브라우저를 받게 되기 때문이다.
 * 쓸 때만 한 번 준비한다:
 *
 *   npx playwright install chromium
 *   npm run dev            # 다른 터미널에서 (기본 포트 3000)
 *   node scripts/screenshots.mjs
 *
 * playwright 를 저장소 밖(임시 폴더)에 설치했다면 그 위치를 알려 준다 —
 * ESM 은 NODE_PATH 를 보지 않아서, 경로를 넘기는 것 말고는 방법이 없다:
 *
 *   PLAYWRIGHT_MODULE=file:///C:/tmp/pw/node_modules/playwright/index.mjs \
 *     node scripts/screenshots.mjs
 *
 * 결과물 → docs/screenshots/*.png (README 가 참조한다)
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const OUT =
  process.env.SHOT_OUT ?? path.join(process.cwd(), "docs", "screenshots");
const VIEWPORT = { width: 1440, height: 900 };
/** 아이폰 13 급 — 실제로 가장 좁게 쓰이는 폭이다 */
const MOBILE = { width: 390, height: 844 };

/** 캡처 목록 — 이름 · 경로 · 찍기 전에 할 일 */
const SHOTS = [
  {
    name: "01-dashboard",
    url: "/dashboard",
    wait: ".card",
  },
  {
    name: "02-requests-list",
    url: "/requests?view=open",
    wait: "tbody tr",
  },
  {
    name: "03-request-detail",
    url: "/requests?view=all",
    // 첨부가 달린 건을 열어 탭 구성이 다 보이게 한다
    async before(page) {
      const echoNum = await findTicketWithAttachment(page);
      await page.goto(`${BASE}/requests?view=all&open=${echoNum}`, {
        waitUntil: "networkidle",
      });
      await page.waitForSelector('[role="dialog"]');
      await page.waitForTimeout(600);
    },
  },
  {
    name: "04-board",
    url: "/board",
    wait: "[data-column], .card, section",
  },
  {
    name: "05-request-new",
    url: "/requests/new",
    wait: "form",
  },
  {
    name: "06-dashboard-dark",
    url: "/dashboard",
    wait: ".card",
    dark: true,
  },

  /* ── 좁은 화면 ─────────────────────────────────────────────
     데스크톱 샷만 올리면 "좁은 화면은 안 봤겠지"로 읽힌다. 실제로 그랬고,
     그래서 고쳤다 — 고친 결과도 같은 자리에서 보여준다. */
  {
    name: "07-mobile-dashboard",
    url: "/dashboard",
    wait: ".card",
    viewport: MOBILE,
  },
  {
    name: "08-mobile-requests",
    url: "/requests?view=open",
    wait: "tbody tr",
    viewport: MOBILE,
  },
  {
    name: "09-mobile-nav",
    url: "/requests?view=open",
    wait: "tbody tr",
    viewport: MOBILE,
    // 서랍을 연 상태 — 좁은 화면의 주 메뉴가 여기로 들어갔다는 것이 핵심이다
    async before(page) {
      await page.click('button[aria-label="메뉴 열기"]');
      await page.waitForSelector(".drawer");
      await page.waitForTimeout(500);
    },
  },
];

/**
 * 상세 샷에 쓸 티켓 고르기 — **내용이 가장 많은 건**을 찾는다.
 * 첨부가 있고, 해결안제시(4) 이상이라 처리결과 탭이 기본으로 열리는 건이 1순위다
 * (빈 화면을 스크린샷으로 남기면 화면이 아니라 껍데기를 보여주는 셈이다).
 */
async function findTicketWithAttachment(page) {
  const nums = await page.evaluate(async () => {
    const html = await (await fetch("/requests?view=all")).text();
    return [
      ...new Set(
        [...html.matchAll(/[A-Z]{2}-20\d{4}-\d{3}/g)].map((m) => m[0]),
      ),
    ].slice(0, 40);
  });
  let fallback = null;
  for (const n of nums) {
    const info = await page.evaluate(async (echoNum) => {
      const r = await fetch(`/api/tickets/${echoNum}`);
      if (!r.ok) return null;
      const d = await r.json();
      return {
        files: (d.attachments ?? []).length,
        progress: Number(d.ticket.progress),
        comments: d.ticket.comments.filter((c) => !c.isLog).length,
      };
    }, n);
    if (!info?.files) continue;
    if (info.progress >= 4 && info.progress !== 10 && info.comments > 0)
      return n;
    fallback ??= n;
  }
  return fallback ?? nums[0];
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: shot.viewport ?? VIEWPORT,
    // 2배로 찍어야 README 에서 흐리지 않다
    deviceScaleFactor: 2,
    colorScheme: shot.dark ? "dark" : "light",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    // 좁은 화면 샷은 실제로 손가락으로 쓰는 환경이어야 의미가 있다
    isMobile: !!shot.viewport,
    hasTouch: !!shot.viewport,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle" });
  if (shot.wait) await page.waitForSelector(shot.wait, { timeout: 15_000 });
  if (shot.before) await shot.before(page);
  // 차트·전환 애니메이션이 멎을 때까지
  await page.waitForTimeout(900);

  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  console.log("찍음:", path.relative(process.cwd(), file));
  await context.close();
}

await browser.close();
