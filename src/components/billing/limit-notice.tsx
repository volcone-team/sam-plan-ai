'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import type { LimitNotice as LimitNoticeData } from '@/lib/billing/limit-notice';
import { cn } from '@/lib/utils';

/**
 * Inline alert for a plan-limit refusal: the server's message, plus an
 * "Upgrade" link for the one role that can act on it.
 *
 * Only owners can change plan (`settings.billing`), so everyone else sees the
 * message alone rather than a link to a tab they cannot open.
 */
export function LimitNotice({
  notice,
  className,
}: {
  notice: LimitNoticeData | null;
  className?: string;
}) {
  const canUpgrade = usePermission('settings.billing');
  if (!notice) return null;

  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {notice.message}
        {canUpgrade && (
          <>
            {' '}
            <Link href={notice.upgradeUrl} className="font-semibold underline underline-offset-2">
              Upgrade
            </Link>
          </>
        )}
      </span>
    </p>
  );
}

/** Toast action for a limit refusal; undefined for roles that cannot upgrade. */
export function upgradeAction(
  notice: LimitNoticeData,
  canUpgrade: boolean
): { label: string; href: string } | undefined {
  return canUpgrade ? { label: 'Upgrade', href: notice.upgradeUrl } : undefined;
}
