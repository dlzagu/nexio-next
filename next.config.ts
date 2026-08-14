import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 는 네이티브 애드온이라 번들에 넣지 않고 런타임에 require 한다
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
