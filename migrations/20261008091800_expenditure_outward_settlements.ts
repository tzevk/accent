import type { Knex } from 'knex';

/**
 * Ticket #318 — dated outward cash settlements.
 *
 * `financial_settlements` is one row per dated outward movement: a manual
 * payment, withholding, or deduction against a canonical cost or payroll slip
 * identity. `financial_settlement_events` is the append-only journal, one row
 * per accepted command (the #323 revision seam reads this pair).
 *
 * The cost-side link uses #311's existing `financial_cost_links` table
 * (`role='settlement'`), so no ENUM there is extended. Identifier columns use
 * `utf8mb4_general_ci`, the collation every financial cost identity carries
 * (migration 20261009000000): a join must never need query-level
 * `COLLATE`/`CONVERT`.
 *
 * Idempotent: every step checks information_schema first, so a re-run or a
 * database that already has the tables is a no-op.
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

async function hasIndex(knex: Knex, table: string, index: string) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
      LIMIT 1`,
		[table, index]
	);
	return (rows as unknown[]).length > 0;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'financial_settlements'))) {
		await knex.raw(`
      CREATE TABLE \`financial_settlements\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`settlement_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`target_kind\` ENUM('cost','payroll') NOT NULL,
        \`target_cost_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
        \`payroll_slip_id\` INT NULL,
        \`movement_kind\` ENUM('payment','withholding','deduction') NOT NULL DEFAULT 'payment',
        \`amount\` DECIMAL(15,2) NOT NULL,
        \`currency\` VARCHAR(10) NOT NULL DEFAULT 'INR',
        \`settled_on\` DATE NOT NULL,
        \`reference\` VARCHAR(191) NULL,
        \`destination\` VARCHAR(255) NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`status\` ENUM('recorded','cancelled') NOT NULL DEFAULT 'recorded',
        \`financial_version\` INT NOT NULL DEFAULT 1,
        \`created_by\` INT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`isDelete\` TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY \`uq_financial_settlements_uid\` (\`settlement_uid\`),
        KEY \`idx_financial_settlements_cash\` (\`settled_on\`, \`status\`, \`isDelete\`),
        KEY \`idx_financial_settlements_cost\` (\`target_cost_uid\`),
        KEY \`idx_financial_settlements_payroll\` (\`payroll_slip_id\`),
        KEY \`idx_financial_settlements_month\` (\`settled_on\`, \`currency\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}

	if (!(await hasTable(knex, 'financial_settlement_events'))) {
		await knex.raw(`
      CREATE TABLE \`financial_settlement_events\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`settlement_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`source_table\` VARCHAR(64) NOT NULL DEFAULT 'financial_settlements',
        \`source_id\` INT NOT NULL,
        \`version\` INT NOT NULL,
        \`command\` ENUM('recorded','updated','cancelled') NOT NULL,
        \`actor_user_id\` INT NULL,
        \`reason\` VARCHAR(500) NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`snapshot\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(\`snapshot\`)),
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_financial_settlement_events_version\` (\`settlement_uid\`, \`version\`),
        KEY \`idx_financial_settlement_events_source\` (\`source_table\`, \`source_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}

	for (const index of [
		'uq_financial_settlements_uid',
		'idx_financial_settlements_cash',
		'idx_financial_settlements_cost',
		'idx_financial_settlements_payroll',
		'idx_financial_settlements_month',
	]) {
		if (!(await hasIndex(knex, 'financial_settlements', index))) {
			throw new Error(
				`[migration 20261008091800] expected index ${index} on financial_settlements`
			);
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS `financial_settlement_events`');
	await knex.raw('DROP TABLE IF EXISTS `financial_settlements`');
}
