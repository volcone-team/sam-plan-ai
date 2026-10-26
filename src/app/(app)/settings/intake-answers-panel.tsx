import { createClient } from '@supabase/supabase-js';
import { requireCompanyMember } from '@/lib/require-company-member';
import { loadIntakeDraft } from '@/lib/intake/load-draft';
import { initiativeKeysNeedingNames, toAnswerSections } from '@/lib/intake/answers-view';
import { loadLibrary } from '@/lib/workbook/read';
import { IntakeAnswers, type IntakeAnswersData } from '@/components/settings/intake-answers';

/**
 * Server half of Settings → "Intake answers".
 *
 * Same scoping as GET /api/intake/draft: the company comes from the signed-in
 * session (`requireCompanyMember`, which admits every role, viewer included),
 * and the service-role client only ever queries by that company id. Read-only:
 * nothing here writes.
 *
 * Rendered inside <Suspense> by the settings page, so the rest of Settings
 * does not wait on these queries.
 */
export async function IntakeAnswersPanel() {
  return <IntakeAnswers data={await loadData()} />;
}

async function loadData(): Promise<IntakeAnswersData> {
  try {
    const member = await requireCompanyMember();
    // No company yet means no intake to show.
    if (!member.ok) return { status: 'empty' };

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { restored, updatedAt } = await loadIntakeDraft(db, member.companyId);
    if (!restored.found) return { status: 'empty' };

    /**
     * Rows store the library name they were picked under, so the library is
     * only read for older rows without one. The whole library, including
     * admin-disabled entries: this names what the customer said, not what we
     * would recommend.
     */
    const library =
      initiativeKeysNeedingNames(restored.initiatives).length > 0
        ? (await loadLibrary(db, { includeInactive: true })).map((entry) => ({
            key: entry.initiativeKey,
            name: entry.name,
          }))
        : [];

    return { status: 'ok', sections: toAnswerSections(restored, library), updatedAt };
  } catch (err: unknown) {
    console.error(
      '[settings/intake-answers] load failed:',
      err instanceof Error ? err.message : String(err)
    );
    return { status: 'error' };
  }
}
