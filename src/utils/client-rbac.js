'use client';

import { useSession } from '@/context/SessionContext';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

// Re-export useSession as useSessionRBAC for backward compatibility
/**
 * @returns {{
 *   loading: boolean,
 *   user: (Record<string, unknown> & { is_super_admin?: unknown }) | null,
 *   can: (resource: string, permission: string) => boolean,
 *   RESOURCES: Record<string, string>,
 *   PERMISSIONS: Record<string, string>,
 * }}
 */
export function useSessionRBAC() {
	const session = useSession();
	return {
		loading: session.loading,
		user: session.user,
		can: session.can,
		RESOURCES,
		PERMISSIONS,
	};
}
