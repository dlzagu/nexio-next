import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // tsconfig.json 의 "@/*" 를 그대로 재사용한다 (별칭을 두 곳에서 관리하지 않는다)
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["{src,tests}/**/*.test.{ts,tsx}"],
  },
});
