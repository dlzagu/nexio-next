import type { Metadata } from "next";
import Script from "next/script";
import { AnalyticsClient } from "@/components/layout/AnalyticsClient";
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

const SITE_NAME = "넥시오 벤더포털";
const SHARE_TITLE = "넥시오 — 유지보수 서비스데스크 포털 (Next.js 재구축 데모)";
const DESCRIPTION =
  "사내 벤더포털을 Next.js 로 재설계·재구축한 포트폴리오 데모 — 신청·조회·업무 현황·대시보드. 고객사·인물·티켓은 전부 가상 데이터입니다.";

/**
 * 링크 미리보기(카드) — 포트폴리오 링크는 이력서·메신저에 **붙여서** 전달된다.
 * og 태그가 없으면 크롤러가 `/` → `/dashboard` 리다이렉트 끝의 `<title>`("대시보드 · 넥시오")만
 * 잡아 무엇의 데모인지 모르는 텍스트 카드가 된다.
 *
 * ⚠️ `metadataBase` 가 없으면 `/og.png` 를 절대 URL 로 만들 수 없다(카드에 이미지가 안 뜬다).
 *    프리뷰 배포도 라이브 이미지를 가리키게 되지만, 미리보기 목적상 그쪽이 오히려 안전하다.
 * ⚠️ `title.template` 은 아직 두지 않는다 — 페이지들이 " · 넥시오" 를 직접 붙이고 있어
 *    지금 넣으면 "대시보드 · 넥시오 · 넥시오" 가 된다. 페이지 쪽을 걷어낼 때 함께 넣는다.
 * 이미지 `public/og.png` = `docs/screenshots/01-dashboard.png` 상단을 1200×630 으로 자른 것
 * (가상 시드 화면 — 실데이터·실명 없음).
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://nexio-next.vercel.app"),
  title: SITE_NAME,
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: SITE_NAME,
    title: SHARE_TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "넥시오 대시보드 — 지금 할 일 카드와 미처리 목록 (가상 데이터)",
      },
    ],
  },
  // 제목·설명·이미지는 openGraph 에서 자동으로 채워진다 — 카드 크기만 정한다
  twitter: { card: "summary_large_image" },
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
        {/* 익명 방문 통계 — 본인 기기 제외는 ?analytics=off (AnalyticsClient 주석 참조) */}
        <AnalyticsClient />
      </body>
    </html>
  );
}
