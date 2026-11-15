import type { Knex } from 'knex';

/**
 * Immutable Payroll Run roster snapshots.
 *
 * Finalize validates the month's expected employee set and appends one row
 * per finalization; re-finalizing after a Reopen appends the next `version`
 * instead of overwriting history. The `members` payload holds identity,
 * employment dates and Salary Profile provenance only — never mutable Salary
 * Profile money, which stays on the Payroll Slips and frozen allocations.
 *
 * The table is deliberately not backfilled. A finalized run that predates this
 * migration has no snapshot and must be reported as a legacy run with an
 * unavailable roster; inferring its original membership from slips would
 * invent history.
 *
 * Idempotent: the table and its indexes are checked through
 * information_schema, so an already-applied schema is left unchanged.
 */

async function hasTable(knex: Knex, table: string): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
      LIMIT 1`,
		[table]
	);
	return (rows as unknown[]).length > 0;
}

async function hasIndex(
	knex: Knex,
	table: string,
	index: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
      LIMIT 1`,
		[table, index]
	);
	return (rows as unknown[]).length > 0;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'payroll_run_rosters'))) {
		await knex.raw(`
      CREATE TABLE \`payroll_run_rosters\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`run_id\` INT NOT NULL,
        \`month\` DATE NOT NULL,
        \`version\` INT NOT NULL,
        \`members\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
          CHECK (json_valid(\`members\`)),
        \`frozen_by\` INT NULL,
        \`frozen_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`isDelete\` TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY \`uq_payroll_run_rosters_run_version\` (\`run_id\`, \`version\`),
        KEY \`idx_payroll_run_rosters_month\` (\`month\`, \`isDelete\`),
        KEY \`idx_payroll_run_rosters_run\` (\`run_id\`, \`isDelete\`, \`version\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}

	for (const index of [
		'uq_payroll_run_rosters_run_version',
		'idx_payroll_run_rosters_month',
		'idx_payroll_run_rosters_run',
	]) {
		if (!(await hasIndex(knex, 'payroll_run_rosters', index))) {
			throw new Error(
				`[migration 20261109120000] expected index ${index} on payroll_run_rosters`
			);
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS `payroll_run_rosters`');
}
