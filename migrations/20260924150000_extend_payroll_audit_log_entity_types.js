/**
 * Extend payroll_audit_logs.entity_type for the mutations issue #243 audits.
 *
 * The baseline enum has no member for three of the four payroll writes that
 * now record an audit row: a Payroll Slip payment, a Salary Profile edit, and
 * a Component Rate (`payroll_schedules`) edit. No existing member can stand in
 * for them:
 *   - `employee_payroll` / `statutory_payment` named tables that
 *     20260903090000_drop_dead_run_era_tables.js dropped, so they would point
 *     at nothing.
 *   - `salary_structure` is the legacy `salary_structures` table superseded by
 *     `employee_salary_profile` (ADR-0001) and is read-only; reusing it would
 *     make the log name the wrong table.
 *
 * Existing members are all kept — they may already be on historical rows, and
 * that removal is its own cleanup, not this ticket's.
 */

export async function up(knex) {
	await knex.raw(
		`ALTER TABLE \`payroll_audit_logs\`
       MODIFY COLUMN \`entity_type\`
       enum('salary_structure','daily_work_hours','attendance','employee_loan','payroll_run','employee_payroll','statutory_payment','manual_override','salary_profile','payroll_slip','component_rate') NOT NULL`
	);
}

/**
 * Restore the baseline enum, exactly as 20260722080106_baseline_schema.js
 * declared it. MySQL refuses the narrowing ALTER while any row still uses one
 * of the added members, which is deliberate: rolling back must not silently
 * discard audit rows.
 */
export async function down(knex) {
	await knex.raw(
		`ALTER TABLE \`payroll_audit_logs\`
       MODIFY COLUMN \`entity_type\`
       enum('salary_structure','daily_work_hours','attendance','employee_loan','payroll_run','employee_payroll','statutory_payment','manual_override') NOT NULL`
	);
}
