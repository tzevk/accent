/**
 * Ticket #315 — other-expense recognition, receipt copies, and canonical
 * cost identity.
 *
 * `other_expenses` becomes a cost-bearing source of the shared financial
 * module: it carries the same financial column vocabulary as `expenses`
 * (#306/#311 contract), a `linked_cost_uid` for a receipt copy that evidences
 * an already-recognized cost instead of creating a second one, and a numeric
 * `row_no` so module reads can address its rows (its own key stays the
 * CHAR(36) `id`).
 *
 * Legacy vouchers keep their evidence: they get a canonical `cost_uid` and a
 * registry row, but their `recognition_state` stays `draft` — approval must
 * establish recognition explicitly, so nothing becomes confirmed cost by this
 * migration.
 *
 * Idempotent: every step checks information_schema first.
 */

const FINANCIAL_COLUMNS = [
	[
		'cost_uid',
		"VARCHAR(64) NULL COMMENT 'Stable identity of this row; the authoritative cost is linked_cost_uid when set'",
	],
	[
		'cost_classification',
		"ENUM('project','company_overhead','unallocated') NULL COMMENT 'NULL = not yet classified'",
	],
	[
		'recognition_state',
		"ENUM('draft','pending_evidence','recognized','rejected','cancelled') NOT NULL DEFAULT 'draft'",
	],
	['recognition_period', "DATE NULL COMMENT 'First day of the recognised month'"],
	[
		'period_basis',
		"ENUM('service_period','service_period_end','bill_date_fallback','unresolved') NOT NULL DEFAULT 'unresolved'",
	],
	['service_period_start', 'DATE NULL'],
	['service_period_end', 'DATE NULL'],
	['currency', 'VARCHAR(10) NULL'],
	[
		'tax_treatment',
		"ENUM('none','recoverable','non_recoverable','unresolved') NOT NULL DEFAULT 'unresolved'",
	],
	['tax_evidence_reference', 'VARCHAR(255) NULL'],
	[
		'recognized_amount',
		'DECIMAL(15,2) NULL COMMENT "Frozen when the row is recognised; NULL = unknown"',
	],
	['recognized_by', 'INT NULL'],
	['recognized_at', 'DATETIME NULL'],
	['financial_version', 'INT NOT NULL DEFAULT 1'],
	['source_reference', 'VARCHAR(191) NULL'],
	['evidence_reference', 'VARCHAR(500) NULL'],
	[
		'receipt_url',
		'VARCHAR(500) NULL COMMENT "Register copy of the supporting bill/receipt"',
	],
	[
		'linked_cost_uid',
		"VARCHAR(64) NULL COMMENT 'Canonical cost this receipt copy evidences; NULL = this row is its own cost'",
	],
	[
		'project_id',
		'INT NULL COMMENT "Set only for a Project classification"',
	],
	// Conversion evidence (#319 contract): the same column names and shapes as
	// `expenses`, so this register can state an original amount in the company
	// reporting currency without any source-specific conversion logic.
	[
		'reporting_currency',
		'VARCHAR(3) NULL COMMENT "Reporting target of the conversion; NULL = none stated"',
	],
	[
		'conversion_rate',
		'DECIMAL(20,10) NULL COMMENT "Original -> reporting rate effective on conversion_date"',
	],
	['conversion_date', 'DATE NULL'],
	['conversion_evidence_reference', 'VARCHAR(500) NULL'],
	[
		'converted_amount',
		'DECIMAL(20,2) NULL COMMENT "Recognized amount in the reporting currency, recomputed by the module"',
	],
];

const INDEXES = [
	[
		'uq_other_expenses_cost_uid',
		'UNIQUE KEY `uq_other_expenses_cost_uid` (`cost_uid`)',
	],
	[
		'idx_other_expenses_recognition',
		'KEY `idx_other_expenses_recognition` (`recognition_state`, `recognition_period`)',
	],
	[
		'idx_other_expenses_classification',
		'KEY `idx_other_expenses_classification` (`cost_classification`)',
	],
	[
		'idx_other_expenses_linked_cost',
		'KEY `idx_other_expenses_linked_cost` (`linked_cost_uid`)',
	],
	['idx_other_expenses_project', 'KEY `idx_other_expenses_project` (`project_id`)'],
];

/** Columns the register's own numbers live in, made nullable like #306 did. */
const AMOUNT_COLUMNS = ['bill_amount', 'gst_amount', 'net_amount'];

async function hasColumn(knex, table, column) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
}

async function hasIndex(knex, table, index) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
		[table, index]
	);
	return rows.length > 0;
}

async function hasTable(knex, table) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
		[table]
	);
	return rows.length > 0;
}

export async function up(knex) {
	if (!(await hasTable(knex, 'other_expenses'))) return;

	for (const [name, ddl] of FINANCIAL_COLUMNS) {
		if (!(await hasColumn(knex, 'other_expenses', name))) {
			await knex.raw(`ALTER TABLE \`other_expenses\` ADD COLUMN \`${name}\` ${ddl}`);
		}
	}

	// A missing amount is unknown, never zero: the register's own number
	// columns stop pretending a blank amount is a recorded 0.
	for (const name of AMOUNT_COLUMNS) {
		const [rows] = await knex.raw(
			`SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'other_expenses' AND column_name = ? LIMIT 1`,
			[name]
		);
		if (rows.length > 0 && rows[0].is_nullable === 'NO') {
			await knex.raw(
				`ALTER TABLE \`other_expenses\` MODIFY COLUMN \`${name}\` DECIMAL(15,2) NULL`
			);
		}
	}

	// Module reads address a row by number even though the register's key is a
	// UUID; the surrogate is added as a key so it can auto-increment.
	if (!(await hasColumn(knex, 'other_expenses', 'row_no'))) {
		await knex.raw(
			`ALTER TABLE \`other_expenses\`
         ADD COLUMN \`row_no\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
         ADD UNIQUE KEY \`uq_other_expenses_row_no\` (\`row_no\`)`
		);
	}

	for (const [name, ddl] of INDEXES) {
		if (!(await hasIndex(knex, 'other_expenses', name))) {
			await knex.raw(`ALTER TABLE \`other_expenses\` ADD ${ddl}`);
		}
	}

	// Legacy vouchers keep their evidence and gain their canonical identity.
	// They stay `draft`: an approved register status is not a recognition
	// decision, and this migration never invents confirmed cost.
	await knex.raw(
		`UPDATE \`other_expenses\` SET cost_uid = CONCAT('cost-', UUID()) WHERE cost_uid IS NULL`
	);
	if (await hasTable(knex, 'financial_cost_links')) {
		// `other_expenses.id` is utf8mb4_general_ci while the link table is
		// utf8mb4_unicode_ci; stating the register's collation explicitly keeps
		// the comparison legal instead of raising an illegal collation mix.
		await knex.raw(`
      INSERT INTO \`financial_cost_links\`
        (cost_uid, source_table, source_id, role, basis, review_state)
      SELECT o.cost_uid, 'other_expenses', o.id, 'cost', 'system', 'confirmed'
        FROM \`other_expenses\` o
       WHERE o.cost_uid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM \`financial_cost_links\` l
            WHERE l.source_table = 'other_expenses'
              AND l.source_id COLLATE utf8mb4_general_ci = o.id
              AND l.role = 'cost'
         )
    `);
	}
}

export async function down(knex) {
	if (!(await hasTable(knex, 'other_expenses'))) return;

	if (await hasTable(knex, 'financial_cost_links')) {
		await knex.raw(
			`DELETE FROM \`financial_cost_links\` WHERE source_table = 'other_expenses'`
		);
	}
	if (await hasIndex(knex, 'other_expenses', 'uq_other_expenses_row_no')) {
		await knex.raw(
			'ALTER TABLE `other_expenses` DROP INDEX `uq_other_expenses_row_no`'
		);
	}
	if (await hasColumn(knex, 'other_expenses', 'row_no')) {
		await knex.raw('ALTER TABLE `other_expenses` DROP COLUMN `row_no`');
	}
	for (const [name] of INDEXES) {
		if (await hasIndex(knex, 'other_expenses', name)) {
			await knex.raw(`ALTER TABLE \`other_expenses\` DROP INDEX \`${name}\``);
		}
	}
	for (const [name] of FINANCIAL_COLUMNS) {
		if (await hasColumn(knex, 'other_expenses', name)) {
			await knex.raw(`ALTER TABLE \`other_expenses\` DROP COLUMN \`${name}\``);
		}
	}
}
