import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

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

export async function up(db: MigrationDb): Promise<void> {
	await executeMigrationSql(
		db,
		`ALTER TABLE \`payroll_audit_logs\`
       MODIFY COLUMN \`action\`
       enum('create','update','delete','approve','reject','finalize','lock','reopen') NOT NULL`
	);
}
