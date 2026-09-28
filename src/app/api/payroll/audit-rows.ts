import type { Mock } from 'vitest';

/** One `payroll_audit_logs` row a route wrote, with the columns named. */
export type PayrollAuditRow = {
	entityType: string;
	entityId: number;
	employeeId: number | null;
	action: string;
	oldValues: Record<string, unknown> | null;
	newValues: Record<string, unknown> | null;
	payrollRunId: number | null;
	month: number | null;
	year: number | null;
	performedBy: number;
};

/**
 * The audit entries a payroll route wrote, as named fields.
 *
 * The INSERT's bind order is `recordPayrollAudit`'s business, not the caller's:
 * a suite should assert *what* was attributed — entity, action, performer, the
 * values it displaced — so that order is decoded here once instead of being
 * re-derived positionally in every test that touches an audit row.
 */
export function payrollAuditRows(execute: Mock): PayrollAuditRow[] {
	const parse = (value: unknown) =>
		value == null
			? null
			: (JSON.parse(String(value)) as Record<string, unknown>);

	return execute.mock.calls
		.filter(([sql]) => String(sql).includes('INSERT INTO payroll_audit_logs'))
		.map(([, params]) => {
			const [
				entityType,
				entityId,
				employeeId,
				action,
				oldValues,
				newValues,
				payrollRunId,
				month,
				year,
				performedBy,
			] = params as unknown[];

			return {
				entityType: String(entityType),
				entityId: Number(entityId),
				employeeId: employeeId == null ? null : Number(employeeId),
				action: String(action),
				oldValues: parse(oldValues),
				newValues: parse(newValues),
				payrollRunId: payrollRunId == null ? null : Number(payrollRunId),
				month: month == null ? null : Number(month),
				year: year == null ? null : Number(year),
				performedBy: Number(performedBy),
			};
		});
}
