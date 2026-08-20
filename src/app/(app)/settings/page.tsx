import { PageContainer, PageHeader } from '@/components/layout';
import { SettingsPage } from '@/components/settings';

export default function SettingsRoute() {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your account and preferences"
      />
      <SettingsPage />
    </PageContainer>
  );
}
