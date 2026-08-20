import { PageContainer, PageHeader } from "@/components/layout";
import { CalendarView } from "@/components/planning";

export default function CalendarPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Calendar"
        description="Monthly calendar with initiatives and tasks"
      />
      <CalendarView />
    </PageContainer>
  );
}
