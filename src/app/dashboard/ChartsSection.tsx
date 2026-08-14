import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import {
  DurationBar,
  StatusDonut,
  TrendChart,
} from "@/components/dashboard/Charts";
import type { DashboardData } from "@/lib/types";

/** 차트 3종 배치. 차트 자체는 client 컴포넌트(recharts)다 */
export function Charts({ data }: { data: DashboardData }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <Card>
        <CardHeader title="월별 추이" hint="최근 12개월 · 이상치 제외" />
        <CardBody className="pr-3">
          <TrendChart data={data.trend} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="상태 분포" hint="미완료만" />
        <CardBody>
          <StatusDonut
            open={data.openByStatus}
            completedTotal={data.completedTotal}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="처리 소요 시간" hint="완료건 · 접수→완료" />
        <CardBody className="pr-3">
          <DurationBar data={data.duration} />
        </CardBody>
      </Card>
    </div>
  );
}
