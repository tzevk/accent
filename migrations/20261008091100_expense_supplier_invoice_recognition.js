/**
 * Supplier invoice recognition (#311) — the shared source identity/link seam.
 *
 * One underlying supplier liability is one `purchase_invoices` row. This
 * migration gives that row the same financial identity/recognition fields the
 * #306 direct-expense store has (cost_uid, classification, recognition state,
 * service period, currency, tax treatment, versioned command fields), so the
 * shared expenditure module can read and change it without a second cost
 * truth. A multi-period invoice gets `supplier_invoice_periods` rows: the
 * period slices total exactly to the invoice gross and are recognised per
 * service period instead of repeating the whole invoice in each period.
 *
 * `financial_cost_links` is the shared durable link/registry table (#311 owns
 * it; contract: C:/Files/OCDSE/Work/expenditure-source-contract.md):
 *   - one role='cost' row per cost-bearing row (here: `expenses` and
 *     `purchase_invoices`), so a cost_uid resolves with one indexed lookup;
 *   - role='liability' / 'receipt' / 'settlement' / 'funding' / 'mirror' /
 *     'split' rows for foreign rows that reference a cost without creating
 *     another one.
 * Only `review_state='confirmed'` links are authoritative; text matches stay
 * candidate evidence for review and never merge identity.
 *
 * `payment_payables.cost_uid` migrates payables with a reliable relational
 * reference (`purchase_invoice_id`) to the invoice's canonical cost identity.
 * A payable without that reference keeps its vendor-number evidence and stays
 * unlinked (reviewable) — nothing here guesses a duplicate identity.
 *
 * Idempotent: every step checks information_schema first.
 */

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
	const hasTable = async (table) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema = DATABASE() AND table_name = ?
			 LIMIT 1`,
			[table]
		);
		return rows.length > 0;
	};

	// --- purchase_invoices: the financial cost identity and recognition fields.
	const costColumns = [
		{
			name: 'cost_uid',
			ddl: "VARCHAR(64) NULL COMMENT 'Stable cost identity shared with source references'",
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
			ddl: "ENUM('service_period','service_period_end','bill_date_fallback','unresolved') NOT NULL DEFAULT 'unresolved'",
		},
		{ name: 'service_period_start', ddl: 'DATE NULL' },
		{ name: 'service_period_end', ddl: 'DATE NULL' },
		{
			name: 'tax_treatment',
			ddl: "ENUM('none','recoverable','non_recoverable','unresolved') NOT NULL DEFAULT 'unresolved'",
		},
		{ name: 'tax_evidence_reference', ddl: 'VARCHAR(255) NULL' },
		{ name: 'recognized_amount', ddl: 'DECIMAL(15,2) NULL' },
		{ name: 'recognized_by', ddl: 'INT NULL' },
		{ name: 'recognized_at', ddl: 'DATETIME NULL' },
		{
			name: 'financial_version',
			ddl: "INT NOT NULL DEFAULT 1 COMMENT 'Version the next financial command must present'",
		},
		{
			name: 'currency',
			ddl: "VARCHAR(10) NOT NULL DEFAULT 'INR' COMMENT 'Transaction currency of the invoice'",
		},
		{
			name: 'source_reference',
			ddl: "VARCHAR(191) NULL COMMENT 'Supplier/document number as captured; display evidence, never identity'",
		},
		{ name: 'evidence_reference', ddl: 'VARCHAR(500) NULL' },
		{
			name: 'withholding_tax_amount',
			ddl: "DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'TDS: settlement only, never reduces incurred cost'",
		},
	];
	for (const column of costColumns) {
		if (!(await hasColumn('purchase_invoices', column.name))) {
			await knex.raw(
				`ALTER TABLE \`purchase_invoices\` ADD COLUMN \`${column.name}\` ${column.ddl}`
			);
		}
	}

	if (
		!(await hasIndex('purchase_invoices', 'unique_purchase_invoice_cost_uid'))
	) {
		await knex.raw(
			'ALTER TABLE `purchase_invoices` ADD UNIQUE KEY `unique_purchase_invoice_cost_uid` (`cost_uid`)'
		);
	}
	if (
		!(await hasIndex('purchase_invoices', 'idx_purchase_invoice_recognition'))
	) {
		await knex.raw(
			'ALTER TABLE `purchase_invoices` ADD KEY `idx_purchase_invoice_recognition` (`recognition_state`, `recognition_period`)'
		);
	}
	if (
		!(await hasIndex(
			'purchase_invoices',
			'idx_purchase_invoice_classification'
		))
	) {
		await knex.raw(
			'ALTER TABLE `purchase_invoices` ADD KEY `idx_purchase_invoice_classification` (`cost_classification`, `recognition_period`)'
		);
	}
	if (
		!(await hasIndex(
			'purchase_invoices',
			'idx_purchase_invoice_source_reference'
		))
	) {
		await knex.raw(
			'ALTER TABLE `purchase_invoices` ADD KEY `idx_purchase_invoice_source_reference` (`source_reference`)'
		);
	}

	// Existing invoices get a deterministic identity (distinct from the
	// `expenses` backfill) so source references can address them. They stay in
	// `draft` — unconfirmed cost — until finance recognises them.
	await knex.raw(
		`UPDATE \`purchase_invoices\`
		    SET cost_uid = CONCAT('cost-sinv-', LPAD(id, 8, '0'))
		  WHERE cost_uid IS NULL`
	);

	// --- supplier_invoice_periods: one row per service period of an invoice.
	if (!(await hasTable('supplier_invoice_periods'))) {
		await knex.raw(`
      CREATE TABLE \`supplier_invoice_periods\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`invoice_id\` INT NOT NULL,
        \`service_period_start\` DATE NULL,
        \`service_period_end\` DATE NOT NULL,
        \`recognition_period\` DATE NOT NULL COMMENT 'First day of the month this slice belongs to',
        \`amount\` DECIMAL(15,2) NOT NULL COMMENT 'Gross amount of this service period',
        \`tax_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        \`recognized_amount\` DECIMAL(15,2) NULL COMMENT 'Frozen when the invoice is recognised',
        \`note\` VARCHAR(500) NULL,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_supplier_split_invoice\` (\`invoice_id\`),
        KEY \`idx_supplier_split_period\` (\`recognition_period\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}

	// --- financial_cost_links: the shared cost registry and reference table.
	if (!(await hasTable('financial_cost_links'))) {
		await knex.raw(`
      CREATE TABLE \`financial_cost_links\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`cost_uid\` VARCHAR(64) NOT NULL,
        \`source_table\` VARCHAR(64) NOT NULL,
        \`source_id\` VARCHAR(64) NOT NULL,
        \`role\` ENUM('cost','liability','receipt','settlement','funding','mirror','split') NOT NULL,
        \`basis\` ENUM('system','explicit','document','candidate') NOT NULL DEFAULT 'explicit',
        \`review_state\` ENUM('confirmed','pending_review','rejected') NOT NULL DEFAULT 'confirmed',
        \`evidence_reference\` VARCHAR(500) NULL,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_cost_link\` (\`source_table\`, \`source_id\`, \`role\`),
        KEY \`idx_cost_link_uid\` (\`cost_uid\`),
        KEY \`idx_cost_link_review\` (\`review_state\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}

	// --- payment_payables: canonical reference to the underlying cost.
	if (!(await hasColumn('payment_payables', 'cost_uid'))) {
		await knex.raw(
			`ALTER TABLE \`payment_payables\` ADD COLUMN \`cost_uid\` VARCHAR(64) NULL COMMENT 'Canonical cost this follow-up tracks; NULL = not linked yet'`
		);
	}
	if (!(await hasIndex('payment_payables', 'idx_payable_cost_uid'))) {
		await knex.raw(
			'ALTER TABLE `payment_payables` ADD KEY `idx_payable_cost_uid` (`cost_uid`)'
		);
	}

	// --- backfill: register every cost-bearing row, then migrate reliable
	// payable → invoice references. Text-only matches are never linked here.
	if (await hasTable('financial_cost_links')) {
		await knex.raw(`
      INSERT INTO \`financial_cost_links\`
        (cost_uid, source_table, source_id, role, basis, review_state)
      SELECT e.cost_uid, 'expenses', CAST(e.id AS CHAR), 'cost', 'system', 'confirmed'
        FROM \`expenses\` e
       WHERE e.cost_uid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM \`financial_cost_links\` l
            WHERE l.source_table = 'expenses' AND l.source_id = CAST(e.id AS CHAR) AND l.role = 'cost'
         )
    `);
		await knex.raw(`
      INSERT INTO \`financial_cost_links\`
        (cost_uid, source_table, source_id, role, basis, review_state)
      SELECT i.cost_uid, 'purchase_invoices', CAST(i.id AS CHAR), 'cost', 'system', 'confirmed'
        FROM \`purchase_invoices\` i
       WHERE i.cost_uid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM \`financial_cost_links\` l
            WHERE l.source_table = 'purchase_invoices' AND l.source_id = CAST(i.id AS CHAR) AND l.role = 'cost'
         )
    `);
		// A payable that already points at its invoice relationally is migrated
		// to the invoice's canonical identity (explicit, confirmed). Anything
		// else keeps its native evidence and stays visibly unlinked.
		await knex.raw(`
      UPDATE \`payment_payables\` pp
        JOIN \`purchase_invoices\` pi ON pi.id = pp.purchase_invoice_id
         SET pp.cost_uid = pi.cost_uid
       WHERE pp.cost_uid IS NULL AND pi.cost_uid IS NOT NULL
    `);
		await knex.raw(`
      INSERT INTO \`financial_cost_links\`
        (cost_uid, source_table, source_id, role, basis, review_state)
      SELECT pp.cost_uid, 'payment_payables', CAST(pp.id AS CHAR), 'liability', 'explicit', 'confirmed'
        FROM \`payment_payables\` pp
       WHERE pp.cost_uid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM \`financial_cost_links\` l
            WHERE l.source_table = 'payment_payables' AND l.source_id = CAST(pp.id AS CHAR) AND l.role = 'liability'
         )
    `);
	}
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS `financial_cost_links`');
	await knex.raw('DROP TABLE IF EXISTS `supplier_invoice_periods`');

	const [hasUid] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'payment_payables' AND column_name = 'cost_uid'
		  LIMIT 1`
	);
	if (hasUid.length) {
		const [hasIndex] = await knex.raw(
			`SELECT 1 FROM information_schema.statistics
			  WHERE table_schema = DATABASE() AND table_name = 'payment_payables' AND index_name = 'idx_payable_cost_uid'
			  LIMIT 1`
		);
		if (hasIndex.length) {
			await knex.raw(
				'ALTER TABLE `payment_payables` DROP INDEX `idx_payable_cost_uid`'
			);
		}
		await knex.raw('ALTER TABLE `payment_payables` DROP COLUMN `cost_uid`');
	}

	for (const index of [
		'unique_purchase_invoice_cost_uid',
		'idx_purchase_invoice_recognition',
		'idx_purchase_invoice_classification',
		'idx_purchase_invoice_source_reference',
	]) {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = 'purchase_invoices' AND index_name = ?
			 LIMIT 1`,
			[index]
		);
		if (rows.length) {
			await knex.raw(
				`ALTER TABLE \`purchase_invoices\` DROP INDEX \`${index}\``
			);
		}
	}
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
		'recognized_by',
		'recognized_at',
		'financial_version',
		'currency',
		'source_reference',
		'evidence_reference',
		'withholding_tax_amount',
	]) {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = 'purchase_invoices' AND column_name = ?
			 LIMIT 1`,
			[column]
		);
		if (rows.length) {
			await knex.raw(
				`ALTER TABLE \`purchase_invoices\` DROP COLUMN \`${column}\``
			);
		}
	}
}
