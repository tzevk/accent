import type { Knex } from 'knex';

/**
 * Ticket #323 — revise closed financial costs.
 *
 * `financial_revision_events` is the append-only header of every accepted
 * financial revision: which closed month was revised, the frozen close it
 * targeted (close UID + the closed version the operator saw), the target
 * cost or settlement, the prior and new financial versions, the prior and
 * new figures (amount, currency, classification, period, state, and the
 * Project and source labels reconstructed at revision time), and the
 * authorization evidence (reason, evidence reference, actor, timestamp).
 * The row never changes the frozen `financial_close_snapshots` row it
 * targets; the versioned detail lives in the existing journals
 * (`financial_cost_events`, `financial_settlement_events`,
 * `order_consumption_events`), whose rows the revision appends through the
 * same command path as an ordinary correction.
 *
 * The migration also extends `order_consumption_events.event` with
 * `'revised'`: carrying a consumption forward onto a revised slice is its
 * own journal act, distinct from `recorded` and `released`.
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

async function consumptionEventType(knex: Knex): Promise<string | null> {
	const [rows] = await knex.raw(
		`SELECT COLUMN_TYPE FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'order_consumption_events'
        AND column_name = 'event'
      LIMIT 1`
	);
	const row = (rows as Array<{ COLUMN_TYPE?: unknown }>)[0];
	return typeof row?.COLUMN_TYPE === 'string' ? row.COLUMN_TYPE : null;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'financial_revision_events'))) {
		await knex.raw(`
      CREATE TABLE \`financial_revision_events\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`revision_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`month\` VARCHAR(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`close_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`close_version\` INT NOT NULL,
        \`target_kind\` ENUM('cost','settlement') NOT NULL,
        \`target_uid\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
        \`source_table\` VARCHAR(64) NOT NULL,
        \`source_id\` INT NOT NULL,
        \`command\` ENUM('updated','cancelled') NOT NULL,
        \`prior_version\` INT NOT NULL,
        \`new_version\` INT NOT NULL,
        \`prior_snapshot\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(\`prior_snapshot\`)),
        \`new_snapshot\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(\`new_snapshot\`)),
        \`reason\` VARCHAR(500) NOT NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`actor_user_id\` INT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`isDelete\` TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY \`uq_financial_revision_events_uid\` (\`revision_uid\`),
        UNIQUE KEY \`uq_financial_revision_events_target_version\` (\`target_uid\`, \`new_version\`),
        KEY \`idx_financial_revision_events_month\` (\`month\`, \`isDelete\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}

	for (const index of [
		'uq_financial_revision_events_uid',
		'uq_financial_revision_events_target_version',
		'idx_financial_revision_events_month',
	]) {
		if (!(await hasIndex(knex, 'financial_revision_events', index))) {
			throw new Error(
				`[migration 20261008092300] expected index ${index} on financial_revision_events`
			);
		}
	}

	// A carried consumption is neither a fresh record nor a release.
	const eventType = await consumptionEventType(knex);
	if (eventType !== null && !eventType.includes("'revised'")) {
		await knex.raw(
			`ALTER TABLE \`order_consumption_events\`
        MODIFY \`event\` ENUM('recorded','released','revised') NOT NULL`
		);
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS `financial_revision_events`');
	// Narrow the consumption event vocabulary only when no carried
	// consumption used it: rewriting a recorded act would falsify history.
	const [rows] = (await knex.raw(
		`SELECT COUNT(*) AS revised FROM \`order_consumption_events\`
      WHERE \`event\` = 'revised'`
	)) as unknown as [Array<{ revised: number }>, unknown];
	if (Number(rows[0]?.revised ?? 0) === 0) {
		await knex.raw(
			`ALTER TABLE \`order_consumption_events\`
        MODIFY \`event\` ENUM('recorded','released') NOT NULL`
		);
	}
}
