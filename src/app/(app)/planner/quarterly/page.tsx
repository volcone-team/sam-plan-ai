import { PageContainer, PageHeader } from "@/components/layout";
import { QuarterlyPlanner } from "@/components/planning";

export default function QuarterlyPlannerPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Quarterly Planner"
        description="Quarterly strategy review and adjustment"
      />
      <QuarterlyPlanner />
    </PageContainer>
  );
}
