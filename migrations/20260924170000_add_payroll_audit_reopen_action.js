/**
 * Add 'reopen' to payroll_audit_logs.action (issue #244).
 *
 * Reopening a finalized Payroll Run is its own transition. It is not a
 * finalize, and logging it as 'update' would make the audit trail name the
 * wrong action for the one event that unlocks a signed-off month — the same
 * reasoning that widened `entity_type` in
 * 20260924150000_extend_payroll_audit_log_entity_types.js. The baseline enum
 * has no member for it, so the column is widened here.
 *
 * Existing members are all kept: historical rows may already use them, and
 * removing one is its own cleanup, not this ticket's.
 */

export async function up(knex) {
	await knex.raw(
		`ALTER TABLE \`payroll_audit_logs\`
       MODIFY COLUMN \`action\`
       enum('create','update','delete','approve','reject','finalize','lock','reopen') NOT NULL`
	);
}

/**
 * Restore the baseline enum, exactly as 20260722080106_baseline_schema.js
 * declared it. MySQL refuses the narrowing ALTER while any row still uses
 * 'reopen', which is deliberate: rolling back must not silently discard the
 * audit rows that record who unlocked a month.
 */
export async function down(knex) {
	await knex.raw(
		`ALTER TABLE \`payroll_audit_logs\`
       MODIFY COLUMN \`action\`
       enum('create','update','delete','approve','reject','finalize','lock') NOT NULL`
	);
}
