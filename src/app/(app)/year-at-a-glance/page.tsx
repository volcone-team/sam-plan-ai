'use client';

import { PageContainer, PageHeader } from '@/components/layout';
import { YearAtAGlance } from '@/components/planning';

export default function YearAtAGlancePage() {
  return (
    <PageContainer>
      <PageHeader
        title="Year at a Glance"
        description="Annual overview of your revenue plan and initiatives for 2026"
      />
      <YearAtAGlance />
    </PageContainer>
  );
}
