import type { Knex } from 'knex';

/**
 * Ticket #322 — close reconciled financial months.
 *
 * `financial_close_snapshots` is one row per closed company financial
 * month: the immutable frozen figures (a JSON snapshot of the
 * `CompanyReconciliation` the month closed with), the source and
 * allocation versions the figures rest on (inside the snapshot), and the
 * closure review (actor, timestamp, reason, evidence). Ordinary writes to
 * costs, accruals, settlements, allocations, and classifications in a
 * closed month are blocked by the module guards; only explicit revisions
 * (ticket #323) can change closed figures.
 *
 * Idempotent: every step checks information_schema first, so a re-run or a
 * database that already has the table is a no-op. Identifier columns use
 * `utf8mb4_general_ci`, the collation every financial cost identity
 * carries (migration 20261009000000): a join must never need query-level
 * `COLLATE`/`CONVERT`.
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
	if (!(await hasTable(knex, 'financial_close_snapshots'))) {
		await knex.raw(`
      CREATE TABLE \`financial_close_snapshots\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`month\` VARCHAR(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`close_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`financial_version\` INT NOT NULL DEFAULT 1,
        \`status\` ENUM('closed') NOT NULL DEFAULT 'closed',
        \`snapshot\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(\`snapshot\`)),
        \`reviewed_by\` INT NULL,
        \`reviewed_at\` DATETIME NULL,
        \`review_reason\` VARCHAR(500) NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`created_by\` INT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`isDelete\` TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY \`uq_financial_close_snapshots_month\` (\`month\`, \`isDelete\`),
        UNIQUE KEY \`uq_financial_close_snapshots_uid\` (\`close_uid\`),
        KEY \`idx_financial_close_snapshots_month\` (\`month\`, \`status\`, \`isDelete\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}

	for (const index of [
		'uq_financial_close_snapshots_month',
		'uq_financial_close_snapshots_uid',
		'idx_financial_close_snapshots_month',
	]) {
		if (!(await hasIndex(knex, 'financial_close_snapshots', index))) {
			throw new Error(
				`[migration 20261008092200] expected index ${index} on financial_close_snapshots`
			);
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS `financial_close_snapshots`');
}
