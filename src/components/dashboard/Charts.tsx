"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "@/lib/types";

/**
 * 차트는 디자인 시스템 팔레트를 공유한다. 색을 var() 로 넘겨
 * [data-theme] 전환에 자동으로 따라가게 한다.
 * 상태 색 순서는 워크플로 순서(대기→신청→진행→해결안→…)를 따른다.
 */
const STATUS_COLORS: Record<string, string> = {
  "1": "var(--warning-400)",
  "2": "var(--info-400)",
  "3": "var(--brand-500)",
  "4": "var(--brand-300)",
  "5": "var(--info-300)",
  "6": "var(--info-200)",
  "7": "var(--gray-400)",
  "8": "var(--gray-500)",
  "10": "var(--warning-300)",
};

const axis = {
  tick: { fontSize: 11, fill: "var(--fg-subtle)" },
  stroke: "var(--border-default)",
} as const;

const tooltipStyle = {
  contentStyle: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--r-sm)",
    fontSize: "12px",
    boxShadow: "var(--shadow-2)",
    color: "var(--fg-default)",
  },
  labelStyle: { color: "var(--fg-muted)", fontSize: "11px" },
} as const;

export function TrendChart({ data }: { data: DashboardData["trend"] }) {
  if (!data.length) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart
        data={data}
        margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
      >
        <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={(v: string) => v.slice(5)}
          tick={axis.tick}
          stroke={axis.stroke}
        />
        <YAxis tick={axis.tick} stroke={axis.stroke} allowDecimals={false} />
        <Tooltip {...tooltipStyle} />
        <Legend
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: "var(--fg-muted)" }}
        />
        <Line
          type="monotone"
          dataKey="created"
          name="접수"
          stroke="var(--brand-500)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="completed"
          name="완료"
          stroke="var(--success-500)"
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * 🔴 완료가 99%라 전 상태를 한 도넛에 그리면 원 하나가 되고 정보량이 0이 된다.
 *    → 완료는 옆에 큰 숫자로 빼고, 도넛은 **미완료만** 그린다.
 */
export function StatusDonut({
  open,
  completedTotal,
}: {
  open: DashboardData["openByStatus"];
  completedTotal: number;
}) {
  const total = open.reduce((a, d) => a + d.n, 0);
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        {open.length ? (
          <ResponsiveContainer width="100%" height={168}>
            <PieChart>
              <Pie
                data={open}
                dataKey="n"
                nameKey="label"
                innerRadius={44}
                outerRadius={68}
                paddingAngle={2}
                stroke="var(--bg-surface)"
                strokeWidth={2}
              >
                {open.map((d) => (
                  <Cell
                    key={d.code}
                    fill={STATUS_COLORS[d.code] ?? "var(--gray-400)"}
                  />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty height={168} />
        )}
      </div>
      <div className="w-[132px] shrink-0">
        <p className="text-11 text-fg-subtle">미완료 합계</p>
        <p className="num text-20 text-fg-strong font-semibold">
          {total.toLocaleString("ko-KR")}
        </p>
        <ul className="mt-2 space-y-1">
          {open.map((d) => (
            <li key={d.code} className="text-11 flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{
                  background: STATUS_COLORS[d.code] ?? "var(--gray-400)",
                }}
              />
              <span className="ell text-fg-muted flex-1">{d.label}</span>
              <span className="num text-fg-default">{d.n}</span>
            </li>
          ))}
        </ul>
        <p className="border-line-subtle text-11 text-fg-subtle mt-2 border-t pt-2">
          종료됨{" "}
          <span className="num text-fg-muted">
            {completedTotal.toLocaleString("ko-KR")}
          </span>
        </p>
      </div>
    </div>
  );
}

export function DurationBar({ data }: { data: DashboardData["duration"] }) {
  if (!data.length) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="bucket" tick={axis.tick} stroke={axis.stroke} />
        <YAxis tick={axis.tick} stroke={axis.stroke} allowDecimals={false} />
        <Tooltip {...tooltipStyle} />
        <Bar
          dataKey="n"
          name="건수"
          fill="var(--brand-500)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ height = 200 }: { height?: number }) {
  return (
    <div
      className="text-12 text-fg-subtle flex items-center justify-center"
      style={{ height }}
    >
      표시할 데이터가 없습니다
    </div>
  );
}
