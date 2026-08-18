import type { Metadata } from "next";
import Script from "next/script";
import { AppShell } from "@/components/layout/AppShell";
import { themeBootScript } from "@/components/layout/Topbar";
import "./globals.css";

/**
 * 🔴 이 앱에는 **빌드 시점에 만들 수 있는 화면이 없다.** 모든 페이지가 요청한 사람과
 * 그 시점의 DB 를 읽는다(권한·미읽음·목록 전부). 그런데 쿠키를 읽지 않는 페이지는
 * Next 가 정적 생성 대상으로 잡아 **빌드 중에 DB 를 호출한다** —
 * 로컬 파일 DB 로는 조용히 통과하지만, 공유 DB(원격)를 붙이면 빌드가 네트워크를 타다
 * 죽는다(실측: /notices 프리렌더 중 LibsqlError 401 → 배포 실패).
 * 통과했더라도 더 나쁘다: 공지 목록이 **빌드 시점 데이터로 굳는다.**
 */
export const dynamic = "force-dynamic";

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
