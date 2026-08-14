import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // eslint-config-next 기본 무시 목록 (여기서 덮어쓰므로 다시 나열해야 한다)
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 이 프로젝트 추가
    "coverage/**",
    ".dev/**", // AI 스크래치 — 진실 아님
    "docs/**", // 산출물(styleguide.html 등)은 린트 대상이 아니다
  ]),
]);

export default eslintConfig;
