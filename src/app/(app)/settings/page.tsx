import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout';
import { SettingsPage } from '@/components/settings';
import { IntakeAnswersPanel } from './intake-answers-panel';

/**
 * `?tab=<id>` opens a specific tab (e.g. `/settings?tab=subscription` from an
 * upgrade prompt). The value is untrusted: SettingsPage only honours it when it
 * names a tab the viewer is allowed to see.
 *
 * The "Intake answers" tab is server-rendered and passed in as a slot, so the
 * answers are read on the server and stream in under Suspense.
 */
export default async function SettingsRoute({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your account and preferences"
      />
      <SettingsPage
        initialTab={typeof tab === 'string' ? tab : undefined}
        intakeAnswers={
          <Suspense
            fallback={
              <div className="flex min-h-[20vh] items-center justify-center">
                <Loader2
                  className="h-5 w-5 animate-spin text-[hsl(var(--foreground-muted))]"
                  aria-label="Loading intake answers"
                />
              </div>
            }
          >
            <IntakeAnswersPanel />
          </Suspense>
        }
      />
    </PageContainer>
  );
}
