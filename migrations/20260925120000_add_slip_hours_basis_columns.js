/**
 * Record the hours basis on each Payroll Slip.
 *
 * Gross is derived from the Salary Profile's CTC apportioned over the payroll
 * month's working hours and paid at the hours logged in Project Activity
 * Assignments — so a slip must be able to show the arithmetic it was priced
 * with: the CTC it started from, the month's hours basis, the resulting
 * hourly rate, and the hours actually logged. Without them the snapshot
 * (ADR-0009) could not be audited once the Salary Profile or the timesheet
 * changed, and the slip detail would have to re-derive the model.
 */

export async function up(knex) {
	await knex.raw(
		`ALTER TABLE \`payroll_slips\`
       ADD COLUMN \`ctc_used\` DECIMAL(12,2) DEFAULT NULL AFTER \`gross\`,
       ADD COLUMN \`basis_hours\` DECIMAL(8,2) DEFAULT NULL AFTER \`ctc_used\`,
       ADD COLUMN \`hourly_rate\` DECIMAL(12,2) DEFAULT NULL AFTER \`basis_hours\`,
       ADD COLUMN \`logged_hours\` DECIMAL(10,2) DEFAULT NULL AFTER \`hourly_rate\``
	);
}

export async function down(knex) {
	await knex.raw(
		`ALTER TABLE \`payroll_slips\`
       DROP COLUMN \`logged_hours\`,
       DROP COLUMN \`hourly_rate\`,
       DROP COLUMN \`basis_hours\`,
       DROP COLUMN \`ctc_used\``
	);
}
