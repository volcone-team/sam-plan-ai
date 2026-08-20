import { PageContainer, PageHeader } from "@/components/layout";
import { ReportsPage } from "@/components/reports";

export default function ReportsPageRoute() {
  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Business performance and revenue reporting"
      />
      <ReportsPage />
    </PageContainer>
  );
}
