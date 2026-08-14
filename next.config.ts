import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 는 네이티브 애드온이라 번들에 넣지 않고 런타임에 require 한다.
  // isomorphic-dompurify(→jsdom)는 동적 require 파일이 서버리스 번들 트레이싱에서
  // 누락돼 Vercel 에서만 SSR 500 을 냈다 — 번들 제외로 온전한 패키지를 포함시킨다
  serverExternalPackages: ["better-sqlite3", "isomorphic-dompurify", "jsdom"],
};

export default nextConfig;
