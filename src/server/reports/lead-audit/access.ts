import { hasPermission, RESOURCES, PERMISSIONS } from '@/utils/rbac';

interface ReportUser {
	is_super_admin?: boolean | number | string | null;
}

/**
 * The Lead Audit gate: both the reporting privilege and the Lead read right,
 * or the established super-admin bypass. The unrelated Project Activities
 * report field grant is deliberately absent here; it opens its own reports
 * and must not open this one.
 */
export function canReadLeadAudit(user: ReportUser | null | undefined): boolean {
	if (!user) return false;
	if (
		user.is_super_admin === true ||
		user.is_super_admin === 1 ||
		user.is_super_admin === '1'
	) {
		return true;
	}
	return (
		hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ) &&
		hasPermission(user, RESOURCES.LEADS, PERMISSIONS.READ)
	);
}
