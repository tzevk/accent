import { ensurePermission, RESOURCES } from '@/utils/api-permissions';

type PermissionResult = Awaited<ReturnType<typeof ensurePermission>>;

/** True only for a genuine grant — Response (denied) or `{authorized:false}` fails. */
const isAuthorized = (result: PermissionResult): boolean =>
	!(result instanceof Response) && result.authorized === true;

/**
 * Either-or gate (ADR-0008 / issue #239): routes whose callers may sit behind
 * /employees gating accept EMPLOYEES:<permission> OR PAYROLL:<permission>.
 * PAYROLL alone must always suffice. When neither holds, the EMPLOYEES
 * denial is returned so the route can pass it straight through.
 *
 * Returns the authorized result (`{ authorized: true }`) or a 401/403
 * Response — `ensurePermission` never throws.
 */
export async function ensureEmployeesOrPayroll(
	request: Request,
	permission: string
) {
	const employeePermission = await ensurePermission(
		request,
		RESOURCES.EMPLOYEES,
		permission
	);
	if (isAuthorized(employeePermission)) return employeePermission;

	const payrollPermission = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		permission
	);
	return isAuthorized(payrollPermission)
		? payrollPermission
		: employeePermission;
}
