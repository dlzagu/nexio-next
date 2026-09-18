import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import {
  DurationBar,
  StatusDonut,
  TrendChart,
} from "@/components/dashboard/Charts";
import { WidgetError } from "@/components/dashboard/WidgetError";
import type { DashboardWidget } from "@/lib/data/dashboard";
import type { DashboardData } from "@/lib/types";

/**
 * 차트 3종 배치. 차트 자체는 client 컴포넌트(recharts)다.
 * 조회에 실패한 차트는 빈 차트('데이터 없음')가 아니라 실패로 그린다 (getDashboard 의 failed).
 */
export function Charts({
  data,
  failed = [],
}: {
  data: DashboardData;
  failed?: DashboardWidget[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <Card>
        <CardHeader title="월별 추이" hint="최근 12개월 · 이상치 제외" />
        {failed.includes("trend") ? (
          <WidgetError what="월별 추이" />
        ) : (
          <CardBody className="pr-3">
            <TrendChart data={data.trend} />
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader title="상태 분포" hint="미완료만" />
        {failed.includes("status") ? (
          <WidgetError what="상태 분포" />
        ) : (
          <CardBody>
            <StatusDonut
              open={data.openByStatus}
              completedTotal={data.completedTotal}
            />
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader title="처리 소요 시간" hint="완료건 · 접수→완료" />
        {failed.includes("duration") ? (
          <WidgetError what="처리 소요 시간" />
        ) : (
          <CardBody className="pr-3">
            <DurationBar data={data.duration} />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
