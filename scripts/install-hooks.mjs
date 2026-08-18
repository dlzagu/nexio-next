/**
 * git 훅을 저장소에 붙인다 (`npm install` 의 prepare 단계에서 자동 실행).
 *
 * `.git/hooks` 는 버전 관리가 안 돼서 **클론에 따라오지 않는다** — 새 클론에서는
 * 방벽이 조용히 사라진다. 훅 본체는 `.githooks/` 에 커밋해 두고, 여기서
 * `core.hooksPath` 만 가리키게 한다.
 *
 * ⚠️ 설치 실패로 npm 을 멈추지 않는다. 훅이 없어도 앱은 돌아야 하고,
 *    CI 의 `npm ci` 나 zip 다운로드처럼 git 이 아닌 환경도 있다.
 *    다만 **조용히 실패하지도 않는다** — 왜 못 붙였는지 한 줄 남긴다.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const HOOKS_DIR = ".githooks";

try {
  if (!existsSync(".git")) {
    console.log("[hooks] git 저장소가 아니라 건너뜁니다");
    process.exit(0);
  }
  const current = (() => {
    try {
      return execFileSync("git", ["config", "--get", "core.hooksPath"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  })();

  if (current === HOOKS_DIR) process.exit(0);
  execFileSync("git", ["config", "core.hooksPath", HOOKS_DIR]);
  console.log(`[hooks] core.hooksPath → ${HOOKS_DIR}`);
} catch (e) {
  console.log(
    `[hooks] 설치하지 못했습니다: ${e instanceof Error ? e.message : e}`,
  );
}
