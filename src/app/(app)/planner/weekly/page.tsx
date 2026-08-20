import { PageContainer, PageHeader } from "@/components/layout";
import { WeeklyPlanner } from "@/components/planning";

export default function WeeklyPlannerPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Weekly Planner"
        description="Your weekly operating cadence"
      />
      <WeeklyPlanner />
    </PageContainer>
  );
}
