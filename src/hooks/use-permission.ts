'use client';

import { useAuth } from './use-auth';
import { roleHasPermission, isReadOnly, type Permission } from '@/lib/permissions';

/**
 * Hook to check if the current user has a specific permission,
 * based on their actual access role from the profiles table.
 */
export function usePermission(permissionKey: string): boolean {
  const { role, loading } = useAuth();
  if (loading) return false;
  return roleHasPermission(role, permissionKey as Permission);
}

/**
 * Hook to check multiple permissions at once.
 */
export function usePermissions<T extends Record<string, string>>(
  permissionMap: T
): Record<keyof T, boolean> {
  const { role, loading } = useAuth();
  const results: Record<string, boolean> = {};
  for (const [alias, permKey] of Object.entries(permissionMap)) {
    results[alias] = loading ? false : roleHasPermission(role, permKey as Permission);
  }
  return results as Record<keyof T, boolean>;
}

/**
 * Returns the current user's access role.
 */
export function useRole(): string | null {
  const { role } = useAuth();
  return role;
}

/**
 * Returns true if the current user is read-only (viewer).
 */
export function useIsReadOnly(): boolean {
  const { role, loading } = useAuth();
  if (loading) return true;
  return isReadOnly(role);
}
