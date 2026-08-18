/**
 * 접근성·성능 측정 — Lighthouse 를 화면마다 돌려 **수치로** 남긴다.
 *
 * "접근성을 고려했다"와 "axe 위반 0건 · 접근성 100"은 무게가 다르다.
 * 구현만 해 두고 재보지 않으면, 어느 순간 깨져도 아무도 모른다
 * (실제로 재 보고서야 대비 4.33:1·역할 없는 span 의 aria-label·이름 없는 입력을 찾았다).
 *
 *   npm run build && npm run measure
 *
 * 전제: 로컬에 Chrome 이 있어야 한다. Lighthouse 는 npx 로 그때그때 받아 쓴다 —
 *       측정용 100MB 의존성을 저장소에 상주시키지 않는다.
 * 산출: docs/measurements/summary.md (커밋) + *.report.{html,json} (gitignore)
 *
 * ⚠️ CI 에 넣지 않았다. 러너 사양에 따라 성능 점수가 크게 흔들려 **깨지는 게이트**가 된다.
 *    회귀를 막는 것은 CI 의 런타임 스모크이고, 이건 사람이 돌려 기록을 갱신하는 도구다.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "docs/measurements";
const PAGES = [
  ["dashboard", "대시보드"],
  ["requests", "요청 조회"],
  ["board", "업무 현황"],
  ["notices", "공지사항"],
  ["customers", "고객사 관리"],
  ["styleguide", "스타일가이드"],
];
/** 모바일은 화면 두 개만 — 목적이 순위표가 아니라 **경향 확인**이다 */
const MOBILE = ["dashboard", "requests"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextBin = path.join("node_modules", "next", "dist", "bin", "next");

mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
  stdio: "ignore",
});

async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(BASE + "/api/session");
      return true;
    } catch {
      await wait(400);
    }
  }
  return false;
}

function lighthouse(page, preset) {
  const out = `${OUT}/lighthouse-${page}-${preset}`;
  const args = [
    "--yes",
    "lighthouse@12",
    `${BASE}/${page}`,
    "--quiet",
    "--output=json",
    "--output=html",
    `--output-path=${out}`,
    "--only-categories=performance,accessibility,best-practices,seo",
    "--chrome-flags=--headless=new --no-sandbox",
  ];
  if (preset === "desktop") args.splice(3, 0, "--preset=desktop");
  // 셸에 **인자 배열**을 넘기면 이스케이프 없이 이어 붙여져 경고가 뜬다(DEP0190).
  // 값이 전부 이 파일 안의 상수라 위험은 없지만, 한 줄로 만들어 따옴표를 직접 건다.
  const cmd = [
    "npx",
    ...args.map((a) => (a.includes(" ") ? `"${a}"` : a)),
  ].join(" ");
  spawnSync(cmd, { stdio: "ignore", shell: true });

  const r = JSON.parse(readFileSync(`${out}.report.json`, "utf8"));
  const score = (k) => Math.round(r.categories[k].score * 100);
  const failed = (cat) =>
    r.categories[cat].auditRefs
      .map((x) => r.audits[x.id])
      .filter((a) => a && a.score !== null && a.score < 1)
      .map((a) => a.id);
  return {
    page,
    preset,
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    lcp: r.audits["largest-contentful-paint"].displayValue,
    cls: r.audits["cumulative-layout-shift"].displayValue,
    tbt: r.audits["total-blocking-time"].displayValue,
    fails: [...failed("accessibility"), ...failed("best-practices")],
    version: r.lighthouseVersion,
  };
}

try {
  if (!(await ready()))
    throw new Error("서버가 뜨지 않았습니다 — npm run build 먼저");

  const rows = [];
  for (const [page] of PAGES) {
    const r = lighthouse(page, "desktop");
    rows.push(r);
    console.log(
      `  ${page.padEnd(11)} desktop  a11y ${r.accessibility} · perf ${r.performance}` +
        (r.fails.length ? `  (실패: ${r.fails.join(", ")})` : ""),
    );
  }
  for (const page of MOBILE) {
    const r = lighthouse(page, "mobile");
    rows.push(r);
    console.log(
      `  ${page.padEnd(11)} mobile   a11y ${r.accessibility} · perf ${r.performance}` +
        (r.fails.length ? `  (실패: ${r.fails.join(", ")})` : ""),
    );
  }

  const line = (r) =>
    `| \`/${r.page}\` | ${r.preset} | ${r.performance} | ${r.accessibility} | ${r.bestPractices} | ${r.seo} | ${r.lcp} | ${r.cls} | ${r.tbt} | ${r.fails.join(", ") || "—"} |`;

  writeFileSync(
    `${OUT}/summary.md`,
    [
      "<!-- npm run measure 가 생성한다. 손으로 고치지 말 것 -->",
      "",
      "| 화면 | 프로파일 | 성능 | 접근성 | 권장사항 | SEO | LCP | CLS | TBT | 남은 실패 |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...rows.map(line),
      "",
      `> Lighthouse ${rows[0].version} · 로컬 프로덕션 빌드(\`next start\`) 대상.`,
      "> 성능 점수는 측정 기기에 좌우된다 — **접근성·권장사항·SEO 는 기기와 무관**하므로 그쪽이 기준이다.",
      "> mobile 프로파일은 4배 CPU 스로틀 + 저속 4G 를 가정한다. 같은 코드로 반복 측정해도",
      "> 개발 PC 에서는 50~72 사이를 오갔다 — **모바일 성능 점수는 추세로만 읽는다.**",
    ].join("\n") + "\n",
  );
  console.log(`\n${OUT}/summary.md 갱신`);
} finally {
  server.kill();
  await wait(300);
  if (server.exitCode === null) server.kill("SIGKILL");
}
