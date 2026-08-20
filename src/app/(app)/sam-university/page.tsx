import { PageContainer, PageHeader } from '@/components/layout';
import { SamUniversity } from '@/components/help';

export default function SamUniversityPage() {
  return (
    <PageContainer>
      <PageHeader
        title="SAM University"
        description="Master revenue growth strategy with guided training modules"
      />
      <SamUniversity />
    </PageContainer>
  );
}
