import { PageContainer, PageHeader } from "@/components/layout";
import { TimelineView } from "@/components/planning";

export default function TimelinePage() {
  return (
    <PageContainer>
      <PageHeader
        title="Timeline"
        description="Gantt-style view of all initiatives across the year"
      />
      <TimelineView />
    </PageContainer>
  );
}
