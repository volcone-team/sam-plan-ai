import { PageContainer, PageHeader } from '@/components/layout';
import { SettingsPage } from '@/components/settings';

/**
 * `?tab=<id>` opens a specific tab (e.g. `/settings?tab=subscription` from an
 * upgrade prompt). The value is untrusted: SettingsPage only honours it when it
 * names a tab the viewer is allowed to see.
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
      <SettingsPage initialTab={typeof tab === 'string' ? tab : undefined} />
    </PageContainer>
  );
}
