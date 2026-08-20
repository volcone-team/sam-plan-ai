'use client';

import { useState, useEffect, useCallback } from 'react';
import { permissionService } from '@/services/permission.service';

/**
 * Current user's role ID.
 * TODO: Replace with actual auth context once Supabase is wired.
 * For now defaults to 'role-owner' (full access) for development.
 */
const CURRENT_USER_ROLE_ID = 'role-owner';

/**
 * Hook to check if the current user has a specific permission.
 *
 * Usage:
 *   const canCreate = usePermission('initiatives.create');
 *   if (canCreate) { show button }
 */
export function usePermission(permissionKey: string): boolean {
  const [hasPermission, setHasPermission] = useState(true); // Default true for Owner during dev

  useEffect(() => {
    let cancelled = false;

    permissionService.hasPermission(CURRENT_USER_ROLE_ID, permissionKey).then(result => {
      if (!cancelled) setHasPermission(result);
    });

    return () => { cancelled = true; };
  }, [permissionKey]);

  return hasPermission;
}

/**
 * Hook to check multiple permissions at once.
 *
 * Usage:
 *   const { canView, canEdit } = usePermissions({
 *     canView: 'initiatives.view',
 *     canEdit: 'initiatives.edit',
 *   });
 */
export function usePermissions<T extends Record<string, string>>(
  permissionMap: T
): Record<keyof T, boolean> {
  const [results, setResults] = useState<Record<keyof T, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of Object.keys(permissionMap)) {
      initial[key] = true; // Default true for Owner during dev
    }
    return initial as Record<keyof T, boolean>;
  });

  useEffect(() => {
    let cancelled = false;

    async function checkAll() {
      const checked: Record<string, boolean> = {};
      for (const [alias, permKey] of Object.entries(permissionMap)) {
        checked[alias] = await permissionService.hasPermission(CURRENT_USER_ROLE_ID, permKey);
      }
      if (!cancelled) setResults(checked as Record<keyof T, boolean>);
    }

    checkAll();
    return () => { cancelled = true; };
  }, []);

  return results;
}

/**
 * Get the current user's role ID.
 * Used by components that need to know the role directly.
 */
export function useCurrentRoleId(): string {
  return CURRENT_USER_ROLE_ID;
}
