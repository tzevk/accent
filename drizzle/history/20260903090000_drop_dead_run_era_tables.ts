import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Drop dead run-era detail tables (issue #239, ADR-0008).
 *
 * employee_payroll, employee_payroll_components, and statutory_payments were
 * the baseline schema's per-run detail design, all FK'd to payroll_runs.
 * Zero references exist anywhere in src/ or scripts/ — payroll_slips (its own
 * earnings/deductions/employer columns) replaced them long ago. Keeping them
 * invites wiring the incoming run lock into the wrong tables.
 *
 * Deliberately NOT dropped: payroll_runs and payroll_audit_logs (revived by
 * the run-lock work), payroll_slips/payroll_schedules/da_schedule (live),
 * salary_structures (live readers, retired separately per ADR-0001).
 *
 * Three baseline-era child tables still carry FKs INTO employee_payroll
 * (salary_manual_overrides, salary_slips, loan_repayment_schedule — all with
 * zero code references). They are out of this drop's scope, so up() removes
 * only their constraints and down() re-adds them; the orphaned columns stay
 * until those dead tables get their own cleanup ticket.
 */

/**
 * Drop one constraint only when it is still there.
 *
 * MySQL has no `DROP FOREIGN KEY IF EXISTS`, so an interrupted or re-run `up()`
 * would otherwise fail on a constraint it already dropped — which is exactly
 * when a migration is being retried by hand.
 */
async function dropForeignKeyIfExists(
	db: MigrationDb,
	table: string,
	constraint: string
) {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
		[table, constraint]
	);
	if (rows.length === 0) return false;
	await executeMigrationSql(
		db,
		`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${constraint}\``
	);
	return true;
}

export async function up(db: MigrationDb): Promise<void> {
	// Inbound FKs must go before their parent table.
	await dropForeignKeyIfExists(
		db,
		'salary_manual_overrides',
		'salary_manual_overrides_ibfk_1'
	);
	await dropForeignKeyIfExists(db, 'salary_slips', 'salary_slips_ibfk_1');
	await dropForeignKeyIfExists(
		db,
		'loan_repayment_schedule',
		'fk_loan_repayment_payroll'
	);

	// FK-safe order: components before its parent employee_payroll.
	await executeMigrationSql(
		db,
		'DROP TABLE IF EXISTS `employee_payroll_components`'
	);
	await executeMigrationSql(db, 'DROP TABLE IF EXISTS `employee_payroll`');
	await executeMigrationSql(db, 'DROP TABLE IF EXISTS `statutory_payments`');
}
