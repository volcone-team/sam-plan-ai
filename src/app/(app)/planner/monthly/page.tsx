import { PageContainer, PageHeader } from "@/components/layout";
import { MonthlyPlanner } from "@/components/planning";

export default function MonthlyPlannerPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Monthly Planner"
        description="Monthly trajectory tuning and trend analysis"
      />
      <MonthlyPlanner />
    </PageContainer>
  );
}
