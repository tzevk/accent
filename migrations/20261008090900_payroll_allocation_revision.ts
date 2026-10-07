import type { Knex } from 'knex';

/**
 * Project Cost Allocation Revision (#309, ADR-0016).
 *
 * A revision corrects how a finalized Payroll Slip's recorded employer cost is
 * attributed to Projects. It appends an ordinary `payroll_employee_allocations`
 * row for the same slip with the next `version` and a `revision` journal row —
 * no new table, no change to the frozen rows. The only schema change is the
 * `kind` vocabulary: `finalization` and `reconstruction` already exist, and
 * `revision` names the corrected version so history can label it.
 *
 * Idempotent: MODIFY to a definition that already holds is a no-op; `down`
 * narrows only when no revision row uses the value (a narrowing with rows
 * present would truncate under STRICT_TRANS_TABLES).
 */

const TABLE = 'payroll_employee_allocations';

async function hasTable(knex: Knex, table: string): Promise<boolean> {
	const [rows] = (await knex.raw(
		`SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
      LIMIT 1`,
		[table]
	)) as [unknown[], unknown];
	return rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, TABLE))) return;
	await knex.raw(
		`ALTER TABLE \`${TABLE}\`
       MODIFY COLUMN \`kind\` ENUM('finalization','reconstruction','revision')
       NOT NULL COMMENT 'How the allocation was produced'`
	);
}

export async function down(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, TABLE))) return;
	const [rows] = (await knex.raw(
		`SELECT 1 FROM \`${TABLE}\` WHERE \`kind\` = 'revision' LIMIT 1`
	)) as [unknown[], unknown];
	if (rows.length > 0) return;
	await knex.raw(
		`ALTER TABLE \`${TABLE}\`
       MODIFY COLUMN \`kind\` ENUM('finalization','reconstruction')
       NOT NULL COMMENT 'How the allocation was produced'`
	);
}
