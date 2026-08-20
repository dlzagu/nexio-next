"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * 방문 통계 (Vercel Web Analytics).
 *
 * 익명 집계만 한다 — 쿠키 없음, IP 저장 없음, 개인 식별 없음.
 * 보는 것: 방문 수 · 페이지 · 유입 링크(UTM) · 기기 · 국가.
 *
 * 🔕 본인 제외는 IP 가 아니라 **기기 표시**로 한다. IP 는 통신사·와이파이를
 *    오가며 계속 바뀌어서 제외 기준이 못 된다. 각 기기에서 한 번
 *    `?analytics=off` 를 열면 그 브라우저는 이후 아무것도 보내지 않는다.
 *    (되돌리기: `?analytics=on`)
 */
export function AnalyticsClient() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          const sw = new URL(event.url).searchParams.get("analytics");
          if (sw === "off") localStorage.setItem("nx-analytics", "off");
          if (sw === "on") localStorage.removeItem("nx-analytics");
          if (localStorage.getItem("nx-analytics") === "off") return null;
        } catch {
          // localStorage 를 못 쓰는 환경(시크릿 강화 모드 등)이면 그냥 보낸다
        }
        return event;
      }}
    />
  );
}
