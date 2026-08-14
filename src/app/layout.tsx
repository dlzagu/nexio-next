import type { Metadata } from "next";
import Script from "next/script";
import { AppShell } from "@/components/layout/AppShell";
import { themeBootScript } from "@/components/layout/Topbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "넥시오 벤더포털",
  description:
    "유지보수 서비스데스크 포털 데모 — 신청·조회·대시보드 (전체 가상 데이터)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="bg-canvas text-fg antialiased">
        {/* 첫 페인트 전에 테마·밀도를 적용해 깜빡임을 막는다.
            next/script 의 beforeInteractive 는 초기 HTML 에 주입되므로
            컴포넌트 트리 안의 <script> 와 달리 실제로 실행된다. */}
        <Script id="nx-theme-boot" strategy="beforeInteractive">
          {themeBootScript}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
