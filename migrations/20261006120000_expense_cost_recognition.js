/**
 * Direct-cost recognition for the company expenditure reconciliation (#306).
 *
 * Extends the general `expenses` ledger — the one expense store that already
 * carries `project_id` and `currency` — with the financial identity and
 * recognition fields the expenditure report needs. No second expense store and
 * no second write path: `expenses` stays the single row for a direct cost, and
 * `src/lib/company-expenditure` is the single module that reads or changes its
 * financial fields.
 *
 * Column roles:
 *   cost_uid               stable cost identity for later source references,
 *                          versioned commands, and period controls.
 *   cost_classification    deliberate destination: a Project, Company
 *                          Overhead, or Unallocated Cost. NULL is the explicit
 *                          unresolved state (no evidence yet) and never
 *                          defaults to a made-up destination.
 *   recognition_state      draft | pending_evidence | recognized | rejected |
 *                          cancelled. Only `recognized` rows are confirmed
 *                          cost. This is separate from `status`, the existing
 *                          operational lifecycle of the expense register: an
 *                          approved register row is not recognized cost.
 *   recognition_period     the month the cost belongs to, derived from the
 *                          received-work/service period, or from the bill date
 *                          as a disclosed fallback (`period_basis`).
 *   financial_version      monotonic version for the versioned commands; a
 *                          command that carries a stale version is refused.
 *   recognized_amount      cost after evidenced recoverable tax; NULL means no
 *                          confirmed cost. Gross liability stays in
 *                          `total_amount`, and `amount`/`total_amount` are now
 *                          NULLable so a missing amount is unknown, not zero.
 *
 * `financial_cost_events` is the append-only command journal: one row per
 * accepted command, keyed (cost_uid, version), carrying the actor, reason,
 * evidence reference, and the financial snapshot the command produced.
 *
 * Idempotent: every step checks information_schema first, so a re-run (or a
 * database that already has the columns) is a no-op.
 */

const COST_COLUMNS = [
	{
		name: 'cost_uid',
		ddl: 'VARCHAR(64) NULL COMMENT \'Stable cost identity shared with source references\'',
	},
	{
		name: 'cost_classification',
		ddl: "ENUM('project','company_overhead','unallocated') NULL COMMENT 'NULL = not yet classified (unresolved)'",
	},
	{
		name: 'recognition_state',
		ddl: "ENUM('draft','pending_evidence','recognized','rejected','cancelled') NOT NULL DEFAULT 'draft'",
	},
	{
		name: 'recognition_period',
		ddl: "DATE NULL COMMENT 'First day of the recognised month'",
	},
	{
		name: 'period_basis',
		ddl: "ENUM('service_period','bill_date_fallback','unresolved') NOT NULL DEFAULT 'unresolved'",
	},
	{ name: 'service_period_start', ddl: 'DATE NULL' },
	{ name: 'service_period_end', ddl: 'DATE NULL' },
	{
		name: 'tax_treatment',
		ddl: "ENUM('none','recoverable','non_recoverable','unresolved') NOT NULL DEFAULT 'unresolved'",
	},
	{ name: 'tax_evidence_reference', ddl: 'VARCHAR(255) NULL' },
	{ name: 'recognized_amount', ddl: 'DECIMAL(15,2) NULL' },
	{ name: 'source_reference', ddl: 'VARCHAR(191) NULL' },
	{ name: 'evidence_reference', ddl: 'VARCHAR(500) NULL' },
	{
		name: 'financial_version',
		ddl: 'INT NOT NULL DEFAULT 1 COMMENT \'Version the next financial command must present\'',
	},
	{ name: 'recognized_by', ddl: 'INT NULL' },
	{ name: 'recognized_at', ddl: 'DATETIME NULL' },
];

export async function up(knex) {
	const hasColumn = async (table, column) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
			 LIMIT 1`,
			[table, column]
		);
		return rows.length > 0;
	};
	const hasIndex = async (table, index) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
			 LIMIT 1`,
			[table, index]
		);
		return rows.length > 0;
	};

	for (const column of COST_COLUMNS) {
		if (!(await hasColumn('expenses', column.name))) {
			await knex.raw(
				`ALTER TABLE \`expenses\` ADD COLUMN \`${column.name}\` ${column.ddl}`
			);
		}
	}

	// Missing is unknown, not zero: a cost whose amount is not known yet must be
	// storable as NULL. Existing rows keep their recorded 0.00 (a known zero).
	for (const column of ['amount', 'tax_amount', 'total_amount']) {
		const [rows] = await knex.raw(
			`SELECT is_nullable FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = 'expenses' AND column_name = ?
			 LIMIT 1`,
			[column]
		);
		if (rows.length && rows[0].is_nullable === 'NO') {
			await knex.raw(
				`ALTER TABLE \`expenses\` MODIFY COLUMN \`${column}\` DECIMAL(15,2) NULL DEFAULT NULL`
			);
		}
	}

	if (!(await hasIndex('expenses', 'unique_cost_uid'))) {
		await knex.raw(
			'ALTER TABLE `expenses` ADD UNIQUE KEY `unique_cost_uid` (`cost_uid`)'
		);
	}
	if (!(await hasIndex('expenses', 'idx_cost_recognition'))) {
		await knex.raw(
			'ALTER TABLE `expenses` ADD KEY `idx_cost_recognition` (`recognition_state`, `recognition_period`)'
		);
	}
	if (!(await hasIndex('expenses', 'idx_cost_classification'))) {
		await knex.raw(
			'ALTER TABLE `expenses` ADD KEY `idx_cost_classification` (`cost_classification`, `recognition_period`)'
		);
	}
	if (!(await hasIndex('expenses', 'idx_cost_source_reference'))) {
		await knex.raw(
			'ALTER TABLE `expenses` ADD KEY `idx_cost_source_reference` (`source_reference`)'
		);
	}

	// Existing rows get a deterministic identity so later source references can
	// address them; their recognition state stays 'draft', i.e. not confirmed
	// cost, until finance recognises them through the module.
	await knex.raw(
		`UPDATE \`expenses\`
		    SET cost_uid = CONCAT('cost-', LPAD(id, 8, '0'))
		  WHERE cost_uid IS NULL`
	);

	const [events] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
		  WHERE table_schema = DATABASE() AND table_name = 'financial_cost_events'
		  LIMIT 1`
	);
	if (!events.length) {
		await knex.raw(`
      CREATE TABLE \`financial_cost_events\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`cost_uid\` VARCHAR(64) NOT NULL,
        \`source_table\` VARCHAR(64) NOT NULL,
        \`source_id\` INT NOT NULL,
        \`version\` INT NOT NULL,
        \`command\` ENUM('recorded','updated','submitted','recognized','rejected','cancelled') NOT NULL,
        \`actor_user_id\` INT NULL,
        \`reason\` VARCHAR(500) NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`snapshot\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(\`snapshot\`)),
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`unique_cost_event_version\` (\`cost_uid\`, \`version\`),
        KEY \`idx_cost_event_source\` (\`source_table\`, \`source_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS `financial_cost_events`');
	for (const column of [
		'cost_uid',
		'cost_classification',
		'recognition_state',
		'recognition_period',
		'period_basis',
		'service_period_start',
		'service_period_end',
		'tax_treatment',
		'tax_evidence_reference',
		'recognized_amount',
		'source_reference',
		'evidence_reference',
		'financial_version',
		'recognized_by',
		'recognized_at',
	]) {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = 'expenses' AND column_name = ?
			 LIMIT 1`,
			[column]
		);
		if (rows.length) {
			await knex.raw(`ALTER TABLE \`expenses\` DROP COLUMN \`${column}\``);
		}
	}
	for (const index of [
		'unique_cost_uid',
		'idx_cost_recognition',
		'idx_cost_classification',
		'idx_cost_source_reference',
	]) {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = 'expenses' AND index_name = ?
			 LIMIT 1`,
			[index]
		);
		if (rows.length) {
			await knex.raw(`ALTER TABLE \`expenses\` DROP INDEX \`${index}\``);
		}
	}
}
