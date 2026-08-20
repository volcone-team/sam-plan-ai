import { PageContainer, PageHeader } from "@/components/layout";
import { QuickstartGuide } from "@/components/help";

export default function QuickstartGuidePage() {
  return (
    <PageContainer maxWidth="lg">
      <PageHeader
        title="Quickstart Guide"
        description="Get up and running with SAM Flow AI in 5 steps"
      />
      <QuickstartGuide />
    </PageContainer>
  );
}
