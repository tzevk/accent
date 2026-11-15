/**
 * Payroll audit trail (issue #243, ADR-0008).
 *
 * `payroll_audit_logs` is the record of who changed what in payroll: one row
 * per mutation of a Payroll Run, Payroll Slip, Salary Profile, or Component
 * Rate, so a disputed net-pay number can be traced back to the person who
 * changed the gross or the rate, and when.
 *
 * Three rules the callers depend on:
 *
 * 1. `performed_by` is the authenticated session user, never a value from the
 *    request body — an entry whose performer is client-supplied is worse than
 *    no entry at all.
 * 2. By default an audit write must never break the mutation it describes. The
 *    INSERT goes through this module, which owns its own error handling and
 *    returns without throwing, the same best-effort contract as
 *    src/utils/activity-logger.ts.
 * 3. A caller whose mutation is only defensible with its audit row opts into
 *    `required: true`: the entry then rejects on a missing session performer or
 *    a failed INSERT so the caller's transaction rolls the whole change back.
 *    The #434 salary commands use this; nothing else does.
 *
 * It takes the caller's connection instead of opening its own so it works with
 * both payroll patterns: the pooled routes (slips, salary-profile,
 * da-schedule) reuse their checkout, and the Component Rate routes call it
 * after `commit()` while their transaction handle is still open.
 */

/** entity_type values written here. The column's enum is widened by
 *  migrations/20260924150000_extend_payroll_audit_log_entity_types.js. */
export const PAYROLL_AUDIT_ENTITY = {
	PAYROLL_RUN: 'payroll_run',
	PAYROLL_SLIP: 'payroll_slip',
	SALARY_PROFILE: 'salary_profile',
	COMPONENT_RATE: 'component_rate',
};

/** action values written here. The column's enum is widened by
 *  migrations/20260924170000_add_payroll_audit_reopen_action.js, and for the
 *  salary lifecycle by the #434 foundation migration,
 *  migrations/20261115140000_salary_profile_revisions.ts. */
export const PAYROLL_AUDIT_ACTION = {
	CREATE: 'create',
	UPDATE: 'update',
	DELETE: 'delete',
	FINALIZE: 'finalize',
	REOPEN: 'reopen',
	CORRECT: 'correct',
	REVISE: 'revise',
	CANCEL: 'cancel',
};

/** Row bookkeeping nobody disputes — never worth storing in a snapshot. */
const HISTORY_COLUMNS = ['created_at', 'updated_at'];

/** `old_values`/`new_values` hold JSON or NULL, never a raw object. */
const toJson = (values) => (values == null ? null : JSON.stringify(values));

/**
 * A JSON-safe snapshot of a row (or of the columns a request writes) for
 * `old_values` / `new_values`.
 *
 * Both columns carry a `json_valid` CHECK, so what reaches them must be a JSON
 * document or NULL. `undefined` fields are dropped — a partial UPDATE really
 * does leave them alone — as are the row's own created_at/updated_at, and a
 * snapshot with nothing left becomes NULL rather than `{}`.
 */
export function auditSnapshot(row) {
	if (!row) return null;

	const snapshot = Object.fromEntries(
		Object.entries(row).filter(
			([column, value]) =>
				value !== undefined && !HISTORY_COLUMNS.includes(column)
		)
	);

	return Object.keys(snapshot).length > 0 ? snapshot : null;
}

/**
 * Write one audit entry for a payroll mutation that already landed.
 *
 * @param db Connection the caller holds — its pool checkout or open transaction.
 * @param entry.entityType  One of PAYROLL_AUDIT_ENTITY.
 * @param entry.entityId    Id of the row actually mutated (insertId for an
 *                          INSERT, the row's id for an UPDATE/DELETE).
 * @param entry.action      One of PAYROLL_AUDIT_ACTION.
 * @param entry.employeeId  The employee the row belongs to, when it has one.
 * @param entry.payrollRunId The run the mutation belongs to, when it has one.
 * @param entry.month       Period month (1-12), when there is one.
 * @param entry.year        Period year, when there is one.
 * @param entry.performedBy Session user id — never a request body field.
 * @param entry.oldValues   auditSnapshot() of the row read before the mutation.
 * @param entry.newValues   auditSnapshot() of the columns the mutation wrote.
 * @param entry.required    Fail instead of returning when the entry cannot be
 *                          written: a missing/invalid session performer or a
 *                          failed INSERT rejects. Salary commands (#434) pass
 *                          true so the audit row commits with the mutation;
 *                          leave it out for the best-effort default.
 */
export async function recordPayrollAudit(
	db,
	{
		entityType,
		entityId,
		action,
		employeeId = null,
		payrollRunId = null,
		month = null,
		year = null,
		performedBy,
		oldValues = null,
		newValues = null,
		required = false,
	}
) {
	// performed_by is NOT NULL and must be a real performer: without one the
	// row answers nothing. Best-effort callers skip the write rather than fail
	// their request; a required entry fails instead, because its mutation is
	// only truthful if this row lands. Mirrors logActivity()'s invalid-user
	// guard for the default path.
	const performer = Number.parseInt(String(performedBy), 10);
	if (!Number.isInteger(performer) || performer <= 0) {
		if (required) {
			throw new Error('Payroll audit entry requires a session performer');
		}
		console.warn(
			'Payroll audit entry skipped: no session user to attribute it to'
		);
		return;
	}

	try {
		await db.execute(
			`INSERT INTO payroll_audit_logs
         (entity_type, entity_id, employee_id, action, old_values, new_values,
          payroll_run_id, month, year, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entityType,
				entityId,
				employeeId,
				action,
				toJson(oldValues),
				toJson(newValues),
				payrollRunId,
				month,
				year,
				performer,
			]
		);
	} catch (error) {
		// Best-effort callers keep their mutation; a required entry lets the
		// original database error reach the caller's transaction so the whole
		// change rolls back instead of committing without its audit row.
		if (required) throw error;
		console.error('Payroll audit log write failed:', error);
	}
}
