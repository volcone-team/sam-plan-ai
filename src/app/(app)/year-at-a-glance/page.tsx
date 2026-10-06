import type { Metadata } from 'next';
import { PageContainer, PageHeader } from '@/components/layout';
import { YearAtAGlance } from '@/components/planning';

/**
 * Your Dashboard — the app's main tab.
 *
 * Renamed from "Year at a Glance". The ROUTE stays /year-at-a-glance: it is the
 * post-login redirect in middleware and in the two-factor flow, so changing the
 * path to match the label would break both for no user-visible gain.
 *
 * A SERVER component, deliberately. It was marked 'use client' but uses no
 * client features of its own — everything interactive lives inside
 * <YearAtAGlance />, which carries its own 'use client'. Metadata exports are
 * only supported in Server Components, so the directive had to go for the
 * browser tab title to be settable at all.
 */
export const metadata: Metadata = {
  title: 'Your Dashboard · SAM Plan AI',
  description: 'Annual overview of your revenue plan',
};

export default function YearAtAGlancePage() {
  return (
    <PageContainer>
      <PageHeader
        title="Your Dashboard"
        // No year here. It previously read "for 2026" from a hardcoded string,
        // which stayed 2026 even when 2027 was selected — the year belongs to
        // the sidebar picker and the plan header, not to a static subtitle.
        description="Annual overview of your revenue plan"
      />
      <YearAtAGlance />
    </PageContainer>
  );
}
