/**
 * Petty-cash funding and spending controls for the company expenditure
 * reconciliation (#316).
 *
 * `petty_cash_expenses` is the petty-cash ledger: one row per cash movement.
 * This migration splits it into the two things it was conflating and gives the
 * spending rows the same financial identity/recognition contract the direct
 * expense store already carries (#306):
 *
 *   entry_kind           'funding' (cash into the float: a voucher and its
 *                        mirrored credit) or 'spend' (actual spending). A
 *                        funding row is cash movement, never operating cost.
 *   cost_uid             spending: the canonical cost identity (`cost-<uuid>`)
 *                        shared with source references (#311 link contract).
 *                        funding: the funding-event identity (`fund-<voucher>`),
 *                        deliberately not a cost and never registered as one.
 *   numeric_id           stable numeric row key for the append-only command
 *                        journal (`financial_cost_events.source_id` is INT).
 *   cost_classification  deliberate destination: a Project, Company Overhead,
 *                        or Unallocated Cost. NULL is the explicit unresolved
 *                        state and is never inferred from free text.
 *   project_id           the reliable Project reference; a Project
 *                        classification without it is refused, and the
 *                        voucher's free-text `project_number` is never used.
 *   linked_cost_uid      a receipt already linked to another cost settles that
 *                        cost instead of creating another one.
 *   recognition_state    draft | pending_evidence | recognized | rejected |
 *                        cancelled; only `recognized` is confirmed cost.
 *   recognition_period   the month the spending belongs to, from the
 *                        received-work period or the bill date fallback.
 *   financial_version    version the next command must present; every accepted
 *                        command appends one `financial_cost_events` row.
 *
 * Idempotent: every step checks information_schema (and the data) first, so a
 * re-run or a database that already has the columns is a no-op.
 */

const COST_COLUMNS = [
	{
		name: 'entry_kind',
		ddl: "ENUM('funding','spend') NOT NULL DEFAULT 'spend' COMMENT 'funding = cash into the float, never cost'",
	},
	{
		name: 'cost_uid',
		ddl: "VARCHAR(64) NULL COMMENT 'Canonical cost identity (cost-<uuid>) or funding-event identity (fund-<voucher>)'",
	},
	{
		name: 'cost_classification',
		ddl: "ENUM('project','company_overhead','unallocated') NULL COMMENT 'NULL = not yet classified (unresolved)'",
	},
	{ name: 'project_id', ddl: 'INT NULL' },
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
		ddl: "ENUM('service_period','service_period_end','bill_date_fallback','unresolved') NULL",
	},
	{ name: 'service_period_start', ddl: 'DATE NULL' },
	{ name: 'service_period_end', ddl: 'DATE NULL' },
	{ name: 'currency', ddl: 'VARCHAR(3) NULL' },
	{ name: 'tax_amount', ddl: 'DECIMAL(15,2) NULL' },
	{
		name: 'tax_treatment',
		ddl: "ENUM('none','recoverable','non_recoverable','unresolved') NULL",
	},
	{ name: 'tax_evidence_reference', ddl: 'VARCHAR(255) NULL' },
	{ name: 'recognized_amount', ddl: 'DECIMAL(15,2) NULL' },
	{ name: 'recognized_by', ddl: 'INT NULL' },
	{ name: 'recognized_at', ddl: 'DATETIME NULL' },
	{ name: 'source_reference', ddl: 'VARCHAR(191) NULL' },
	{ name: 'evidence_reference', ddl: 'VARCHAR(500) NULL' },
	{
		name: 'linked_cost_uid',
		ddl: "VARCHAR(64) NULL COMMENT 'Receipt settles this existing cost; never a second cost'",
	},
	{
		name: 'financial_version',
		ddl: 'INT NOT NULL DEFAULT 1 COMMENT \'Version the next financial command must present\'',
	},
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
		if (!(await hasColumn('petty_cash_expenses', column.name))) {
			await knex.raw(
				`ALTER TABLE \`petty_cash_expenses\` ADD COLUMN \`${column.name}\` ${column.ddl}`
			);
		}
	}

	// A stable numeric key for the append-only journal: `financial_cost_events`
	// keys its source by (source_table, source_id) and source_id is an INT,
	// while the ledger's own primary key is a UUID.
	if (!(await hasColumn('petty_cash_expenses', 'numeric_id'))) {
		await knex.raw(
			`ALTER TABLE \`petty_cash_expenses\`
			   ADD COLUMN \`numeric_id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
			   ADD UNIQUE KEY \`uq_pce_numeric_id\` (\`numeric_id\`)`
		);
	}

	// Split the ledger: a credit-only row is funding (cash into the float);
	// anything with a debit is spending. Re-running is a no-op because the
	// predicate is stable.
	await knex.raw(
		`UPDATE \`petty_cash_expenses\`
		    SET entry_kind = 'funding'
		  WHERE entry_kind = 'spend'
		    AND credit_amount > 0
		    AND debit_amount = 0`
	);

	// Legacy rows get deterministic identities: a spending row is its own cost;
	// a funding row carries the funding-event identity of its voucher (the
	// first mirror row per voucher; a duplicate from before this constraint
	// keeps its own identity so the unique key can still be added).
	await knex.raw(
		`UPDATE \`petty_cash_expenses\`
		    SET cost_uid = CONCAT('cost-', id)
		  WHERE entry_kind = 'spend'
		    AND (cost_uid IS NULL OR cost_uid = '')`
	);
	await knex.raw(
		`UPDATE \`petty_cash_expenses\` p
		  JOIN (
		        SELECT id,
		               source_voucher_id,
		               ROW_NUMBER() OVER (
		                 PARTITION BY source_voucher_id
		                 ORDER BY created_at, id
		               ) AS rn
		          FROM \`petty_cash_expenses\`
		         WHERE entry_kind = 'funding'
		           AND source_voucher_id IS NOT NULL
		           AND (cost_uid IS NULL OR cost_uid = '')
		       ) f ON f.id = p.id
		    SET p.cost_uid = CASE
		          WHEN f.rn = 1 THEN CONCAT('fund-', p.source_voucher_id)
		          ELSE CONCAT('fund-dup-', p.id)
		        END`
	);
	await knex.raw(
		`UPDATE \`petty_cash_expenses\`
		    SET cost_uid = CONCAT('fund-manual-', id)
		  WHERE entry_kind = 'funding'
		    AND (cost_uid IS NULL OR cost_uid = '')`
	);

	const indexes = [
		{
			name: 'uq_pce_cost_uid',
			ddl: 'ADD UNIQUE KEY `uq_pce_cost_uid` (`cost_uid`)',
		},
		{
			name: 'idx_pce_kind_date',
			ddl: 'ADD KEY `idx_pce_kind_date` (`entry_kind`, `transaction_date`)',
		},
		{
			name: 'idx_pce_voucher_kind',
			ddl: 'ADD KEY `idx_pce_voucher_kind` (`source_voucher_id`, `entry_kind`)',
		},
		{
			name: 'idx_pce_recognition',
			ddl: 'ADD KEY `idx_pce_recognition` (`recognition_state`, `recognition_period`)',
		},
		{
			name: 'idx_pce_linked_cost',
			ddl: 'ADD KEY `idx_pce_linked_cost` (`linked_cost_uid`)',
		},
		{
			name: 'idx_pce_project',
			ddl: 'ADD KEY `idx_pce_project` (`project_id`)',
		},
	];
	for (const index of indexes) {
		if (!(await hasIndex('petty_cash_expenses', index.name))) {
			await knex.raw(
				`ALTER TABLE \`petty_cash_expenses\` ${index.ddl}`
			);
		}
	}
}

export async function down(knex) {
	for (const index of [
		'uq_pce_cost_uid',
		'idx_pce_kind_date',
		'idx_pce_voucher_kind',
		'idx_pce_recognition',
		'idx_pce_linked_cost',
		'idx_pce_project',
		'uq_pce_numeric_id',
	]) {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = 'petty_cash_expenses' AND index_name = ?
			 LIMIT 1`,
			[index]
		);
		if (rows.length) {
			await knex.raw(
				`ALTER TABLE \`petty_cash_expenses\` DROP INDEX \`${index}\``
			);
		}
	}
	for (const column of [...COST_COLUMNS.map((entry) => entry.name), 'numeric_id']) {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = 'petty_cash_expenses' AND column_name = ?
			 LIMIT 1`,
			[column]
		);
		if (rows.length) {
			await knex.raw(
				`ALTER TABLE \`petty_cash_expenses\` DROP COLUMN \`${column}\``
			);
		}
	}
}
