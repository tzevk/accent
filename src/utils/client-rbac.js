'use client';

import { useSession } from '@/context/SessionContext';
import { RESOURCES, PERMISSIONS } from '@/utils/rbac';

// Re-export useSession as useSessionRBAC for backward compatibility
export function useSessionRBAC() {
  const session = useSession();
  return {
    loading: session.loading,
    user: session.user,
    can: session.can,
    RESOURCES,
    PERMISSIONS
  };
}
