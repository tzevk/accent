/**
 * The financial-source read gate (#308).
 *
 * A reconstruction command returns Payroll Slip employer cost and share
 * figures, so the operation privilege alone is not enough: the caller must
 * also hold the same source-read conjunction the expenditure report enforces —
 * the reporting privilege plus both source reads. Super admins bypass, exactly
 * like every route in this family; the command modules never see an
 * unauthorized actor because the routes refuse before they run.
 */

import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasPermission } from '@/utils/rbac';

export function canReadFinancialSources(user: unknown): boolean {
	if (!user || typeof user !== 'object') return false;
	const isSuperAdmin =
		'is_super_admin' in user
			? user.is_super_admin === true || user.is_super_admin === 1
			: false;
	if (isSuperAdmin) return true;
	return (
		hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ) &&
		hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
		hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ)
	);
}
