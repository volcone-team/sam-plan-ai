'use client';

import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

interface PermissionGateProps {
  /**
   * The permission key to check (e.g. 'initiatives.create', 'tasks.delete')
   */
  permission: string;
  /**
   * Content to show when the user HAS the permission
   */
  children: ReactNode;
  /**
   * Optional: what to show when the user does NOT have permission.
   * Defaults to nothing (hidden).
   */
  fallback?: ReactNode;
}

/**
 * Wrapper component that shows/hides content based on user permissions.
 *
 * Usage:
 *   <PermissionGate permission="initiatives.create">
 *     <button>+ Add Initiative</button>
 *   </PermissionGate>
 *
 *   <PermissionGate permission="settings.manage_team" fallback={<p>No access</p>}>
 *     <TeamSettings />
 *   </PermissionGate>
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const hasPermission = usePermission(permission);

  if (!hasPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
