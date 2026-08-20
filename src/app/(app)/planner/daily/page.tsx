import { PageContainer, PageHeader } from "@/components/layout";
import { DailyPlanner } from "@/components/planning";

export default function DailyPlannerPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Daily Planner"
        description="Today's tasks and priorities"
      />
      <DailyPlanner />
    </PageContainer>
  );
}
