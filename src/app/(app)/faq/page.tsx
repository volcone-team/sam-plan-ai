import { PageContainer, PageHeader } from "@/components/layout";
import { FaqPage } from "@/components/help";

export default function Faq() {
  return (
    <PageContainer maxWidth="lg">
      <PageHeader
        title="FAQ"
        description="Frequently asked questions about SAM Flow AI"
      />
      <FaqPage />
    </PageContainer>
  );
}
