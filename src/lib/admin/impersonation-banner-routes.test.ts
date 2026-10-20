import { describe, it, expect } from 'vitest';
import { isImpersonationBannerHiddenPath } from './impersonation-banner-routes';

describe('isImpersonationBannerHiddenPath', () => {
  it('hides the banner across the /auth sign-in flows', () => {
    expect(isImpersonationBannerHiddenPath('/auth/login')).toBe(true);
    expect(isImpersonationBannerHiddenPath('/auth/verify-code')).toBe(true);
    expect(isImpersonationBannerHiddenPath('/auth/confirmed')).toBe(true);
    // The page whose entire job is ending impersonation.
    expect(isImpersonationBannerHiddenPath('/auth/impersonation-ended')).toBe(true);
    expect(isImpersonationBannerHiddenPath('/auth')).toBe(true);
  });

  it('shows the banner on the routes the old (app)-only mount missed', () => {
    expect(isImpersonationBannerHiddenPath('/intake')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/intake/products')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/welcome')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/choose-plan')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/checkout')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/account-paused')).toBe(false);
  });

  it('shows the banner on app pages', () => {
    expect(isImpersonationBannerHiddenPath('/year-at-a-glance')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/settings')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/')).toBe(false);
  });

  it('does not treat a path that merely starts with the same letters as /auth', () => {
    expect(isImpersonationBannerHiddenPath('/authors')).toBe(false);
    expect(isImpersonationBannerHiddenPath('/author-settings')).toBe(false);
  });

  it('falls open when the pathname is unknown, so the way back is never lost', () => {
    expect(isImpersonationBannerHiddenPath(null)).toBe(false);
    expect(isImpersonationBannerHiddenPath('')).toBe(false);
  });
});
