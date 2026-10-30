import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { REGISTRATION_CLOSED_MESSAGE } from '@/lib/auth/registration-setting';

/**
 * Shown on /auth/signup and /get-started while the admin has closed new
 * registrations (migration 062). Existing customers can still sign in.
 */
export function RegistrationClosedNotice() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center">
          <BrandLogo width={140} height={47} />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Registration is closed</h1>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">{REGISTRATION_CLOSED_MESSAGE}</p>
        </div>
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-[hsl(var(--primary))] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
