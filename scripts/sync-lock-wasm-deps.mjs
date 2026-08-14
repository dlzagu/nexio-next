/**
 * package-lock.json 보정 — Windows 에서 생성한 lock 은 Linux CI 의 `npm ci` 를 통과하지 못한다.
 *
 * 왜: tailwind·eslint 가 플랫폼별 optional 의존성으로 wasm32-wasi 패키지를 가진다.
 * Windows npm 은 현재 플랫폼에서 안 쓰는 이 가지의 **하위 의존성**(@emnapi/core·runtime)을
 * lock 에 적지 않는데, Linux 러너의 npm 은 그 항목을 요구한다 (npm/cli#4828 계열).
 * → `npm ci` 가 "Missing: @emnapi/runtime from lock file" 로 멈춘다.
 *
 * 이 스크립트는 registry 메타데이터와 같은 값으로 두 항목을 채운다. 멱등이다.
 * ⚠️ `npm install`·`npm uninstall` 은 lock 을 다시 쓰면서 이 항목을 지운다 →
 *    의존성을 바꾼 뒤에는 `npm run lock:fix` 를 한 번 돌린다.
 */
import fs from "node:fs";
import path from "node:path";

const LOCK = path.join(process.cwd(), "package-lock.json");

/** registry 실측값 (npm view <pkg>@<ver> dist.integrity dependencies) */
const ENTRIES = {
  "node_modules/@emnapi/core": {
    version: "1.11.3",
    resolved: "https://registry.npmjs.org/@emnapi/core/-/core-1.11.3.tgz",
    integrity:
      "sha512-zLpS5asjEb7lq8jYLq37N6XKaE41DIexlY1rF/z4/tIl3wo13Sqm28fRyfIsKZD+NZ8mM5RoKkpW/rBcuoSZSg==",
    dev: true,
    license: "MIT",
    optional: true,
    peer: true,
    dependencies: { "@emnapi/wasi-threads": "1.2.3", tslib: "^2.4.0" },
  },
  "node_modules/@emnapi/runtime": {
    version: "1.11.3",
    resolved: "https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz",
    integrity:
      "sha512-Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA==",
    dev: true,
    license: "MIT",
    optional: true,
    peer: true,
    dependencies: { tslib: "^2.4.0" },
  },
};

const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));

const added = Object.keys(ENTRIES).filter((k) => !lock.packages[k]);
if (added.length === 0) {
  console.log("lock 정상 — 보정할 항목 없음");
  process.exit(0);
}

for (const [key, value] of Object.entries(ENTRIES)) {
  lock.packages[key] ??= value;
}

// npm 과 같은 정렬(경로 사전순)을 유지해 diff 를 깨끗하게 둔다
lock.packages = Object.fromEntries(
  Object.keys(lock.packages)
    .sort()
    .map((k) => [k, lock.packages[k]]),
);

fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");
console.log(`보정 완료: ${added.join(", ")}`);
