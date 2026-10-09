import type { Knex } from 'knex';

/**
 * Cost Accrual recognition (#313) — evidenced received work before invoicing,
 * and its partial/final replacement by supplier invoices.
 *
 * A Cost Accrual is its own cost-bearing row (`cost_accruals`) with its own
 * `cost_uid`, registered in the shared `financial_cost_links` registry with
 * `role='cost'`. A replacement invoice stays a `purchase_invoices` row; the
 * supersede is recorded twice, on purpose:
 *   - `financial_cost_links` gains the `replacement` role for the invoice →
 *     accrual reference (the shared chain mapping);
 *   - `cost_accrual_replacements` carries the matched amount, the invoice
 *     amount at match time, the estimate-versus-actual difference with its
 *     period/reason/evidence, and both versions, so a partial replacement
 *     leaves the unmatched accrual remainder visible and a cancelled invoice
 *     can release its matched amount with the history intact.
 *
 * `financial_cost_events.command` gains `replaced` and `released` for the two
 * accrual-side transitions. Cross-source cost/native identities use
 * `utf8mb4_general_ci` (migration 20261009000000), so column-to-column joins
 * need no per-query coercion. A Project classification carries `project_id`,
 * the same INT reference to `projects.project_id` that `other_expenses` and
 * `purchase_invoices` store; an INT join needs no collation.
 *
 * Idempotent: every step checks information_schema first. ESM `.ts` (Node 24 /
 * current Knex), additive, never edits an earlier migration.
 */

const GENERAL_CI =
	'VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci';

async function hasTable(knex: Knex, table: string): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
		  WHERE table_schema = DATABASE() AND table_name = ?
		  LIMIT 1`,
		[table]
	);
	return rows.length > 0;
}

async function hasColumn(
	knex: Knex,
	table: string,
	column: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
		  LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
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
	return rows.length > 0;
}

/**
 * Whether a column's ENUM already lists a value (idempotent growth).
 * The column must exist: a missing column means the migration that
 * creates it has not run, and silently skipping the MODIFY would
 * leave the shared registry unable to store the values this feature
 * writes — so this fails loudly instead.
 */
async function enumHasValue(
	knex: Knex,
	table: string,
	column: string,
	value: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT COLUMN_TYPE AS columnType FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
		  LIMIT 1`,
		[table, column]
	);
	if (rows.length === 0) {
		throw new Error(
			`${table}.${column} is absent from information_schema: its ENUM cannot grow. Run the migration that creates the column first.`
		);
	}
	const columnType = String(rows[0].columnType ?? '');
	return columnType.includes(`'${value}'`);
}

export async function up(knex: Knex): Promise<void> {
	// --- financial_cost_links.role gains 'replacement'.
	if (
		!(await enumHasValue(knex, 'financial_cost_links', 'role', 'replacement'))
	) {
		await knex.raw(
			`ALTER TABLE \`financial_cost_links\` MODIFY \`role\`
			 ENUM('cost','liability','receipt','settlement','funding','mirror','split','replacement') NOT NULL`
		);
	}

	// --- financial_cost_events.command gains 'replaced' and 'released'.
	if (
		!(await enumHasValue(
			knex,
			'financial_cost_events',
			'command',
			'replaced'
		)) ||
		!(await enumHasValue(knex, 'financial_cost_events', 'command', 'released'))
	) {
		await knex.raw(
			`ALTER TABLE \`financial_cost_events\` MODIFY \`command\`
			 ENUM('recorded','updated','submitted','recognized','rejected','cancelled','replaced','released') NOT NULL`
		);
	}

	// --- cost_accruals: the cost-bearing accrual row.
	if (!(await hasTable(knex, 'cost_accruals'))) {
		await knex.raw(`
      CREATE TABLE \`cost_accruals\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`accrual_number\` VARCHAR(64) NOT NULL,
        \`cost_uid\` ${GENERAL_CI} NOT NULL COMMENT 'Stable cost identity shared with source references',
        \`description\` VARCHAR(500) NOT NULL,
        \`vendor_name\` VARCHAR(255) NULL,
        \`vendor_reference\` VARCHAR(191) NULL COMMENT 'Supplier document text as captured; display evidence, never identity',
        \`order_uid\` ${GENERAL_CI} NULL COMMENT 'Canonical supplier order (#310) this work belongs to; consumption is #312/#314',
        \`evidence_basis\` ENUM('received_work','supported_estimate','purchase_order') NOT NULL DEFAULT 'received_work',
        \`cost_classification\` ENUM('project','company_overhead','unallocated') NULL COMMENT 'NULL = not yet classified (unresolved)',
        \`project_id\` INT NULL COMMENT 'Set only for a Project classification; the same INT reference to projects.project_id every native source stores',
        \`recognition_state\` ENUM('draft','pending_evidence','recognized','rejected','cancelled') NOT NULL DEFAULT 'draft',
        \`recognition_period\` DATE NULL COMMENT 'First day of the recognised month',
        \`period_basis\` ENUM('service_period','service_period_end','bill_date_fallback','unresolved') NOT NULL DEFAULT 'unresolved',
        \`service_period_start\` DATE NULL,
        \`service_period_end\` DATE NULL,
        \`gross_amount\` DECIMAL(15,2) NULL COMMENT 'Estimated gross; NULL = unknown, never zero',
        \`tax_amount\` DECIMAL(15,2) NULL,
        \`tax_treatment\` ENUM('none','recoverable','non_recoverable','unresolved') NOT NULL DEFAULT 'unresolved',
        \`tax_evidence_reference\` VARCHAR(255) NULL,
        \`currency\` VARCHAR(10) NOT NULL DEFAULT 'INR',
        \`reporting_currency\` VARCHAR(10) NULL,
        \`conversion_rate\` DECIMAL(20,10) NULL,
        \`conversion_date\` DATE NULL,
        \`conversion_evidence_reference\` VARCHAR(500) NULL,
        \`converted_amount\` DECIMAL(15,2) NULL,
        \`source_reference\` VARCHAR(191) NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`recognized_amount\` DECIMAL(15,2) NULL COMMENT 'Remaining recognised estimate; reduced by each replacement',
        \`replaced_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'Running total superseded by replacement invoices',
        \`recognized_by\` INT NULL,
        \`recognized_at\` DATETIME NULL,
        \`owner_user_id\` INT NULL COMMENT 'Finance owner accountable for this accrual',
        \`financial_version\` INT NOT NULL DEFAULT 1 COMMENT 'Version the next financial command must present',
        \`isDelete\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_cost_accrual_number\` (\`accrual_number\`),
        UNIQUE KEY \`uq_cost_accrual_cost_uid\` (\`cost_uid\`),
        KEY \`idx_cost_accrual_recognition\` (\`recognition_state\`, \`recognition_period\`),
        KEY \`idx_cost_accrual_classification\` (\`cost_classification\`, \`recognition_period\`),
        KEY \`idx_cost_accrual_project\` (\`project_id\`),
        KEY \`idx_cost_accrual_order\` (\`order_uid\`),
        KEY \`idx_cost_accrual_owner\` (\`owner_user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}

	// --- cost_accrual_replacements: the durable supersede record.
	if (!(await hasTable(knex, 'cost_accrual_replacements'))) {
		await knex.raw(`
      CREATE TABLE \`cost_accrual_replacements\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`accrual_id\` INT UNSIGNED NOT NULL,
        \`accrual_cost_uid\` ${GENERAL_CI} NOT NULL,
        \`invoice_id\` INT NOT NULL,
        \`invoice_cost_uid\` ${GENERAL_CI} NOT NULL,
        \`replaced_amount\` DECIMAL(15,2) NOT NULL COMMENT 'Matched accrual amount superseded by this invoice',
        \`invoice_amount\` DECIMAL(15,2) NULL COMMENT 'Invoice recognised amount at match time',
        \`difference_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'invoice_amount - replaced_amount (estimate vs actual)',
        \`difference_period\` DATE NULL COMMENT 'Month the difference belongs to',
        \`difference_reason\` VARCHAR(500) NULL,
        \`evidence_reference\` VARCHAR(500) NULL,
        \`replacement_period\` DATE NULL COMMENT 'Recognition month of the replacement invoice',
        \`is_final\` TINYINT(1) NOT NULL DEFAULT 0,
        \`state\` ENUM('active','released') NOT NULL DEFAULT 'active' COMMENT 'released = the cancel transition restored the amount',
        \`accrual_version\` INT NOT NULL COMMENT 'Accrual financial_version after this replacement',
        \`invoice_version\` INT NOT NULL,
        \`released_at\` DATETIME NULL,
        \`released_by\` INT NULL,
        \`release_reason\` VARCHAR(500) NULL,
        \`release_evidence_reference\` VARCHAR(500) NULL,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_accrual_replacement\` (\`accrual_id\`, \`invoice_id\`),
        KEY \`idx_accrual_replacement_invoice\` (\`invoice_id\`),
        KEY \`idx_accrual_replacement_state\` (\`state\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	} else {
		// A pre-existing table from an earlier attempt keeps its data; only the
		// release-tracking columns are added.
		for (const column of [
			['state', "ENUM('active','released') NOT NULL DEFAULT 'active'"],
			['released_at', 'DATETIME NULL'],
			['released_by', 'INT NULL'],
			['release_reason', 'VARCHAR(500) NULL'],
			['release_evidence_reference', 'VARCHAR(500) NULL'],
		] as const) {
			if (!(await hasColumn(knex, 'cost_accrual_replacements', column[0]))) {
				await knex.raw(
					`ALTER TABLE \`cost_accrual_replacements\` ADD COLUMN \`${column[0]}\` ${column[1]}`
				);
			}
		}
		if (
			!(await hasIndex(
				knex,
				'cost_accrual_replacements',
				'idx_accrual_replacement_state'
			))
		) {
			await knex.raw(
				'ALTER TABLE `cost_accrual_replacements` ADD KEY `idx_accrual_replacement_state` (`state`)'
			);
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS `cost_accrual_replacements`');
	await knex.raw('DROP TABLE IF EXISTS `cost_accruals`');

	// Narrow the ENUMs only when no row uses the added values: a narrowing with
	// rows present would truncate under STRICT_TRANS_TABLES.
	const [replacementRows] = await knex.raw(
		`SELECT 1 FROM \`financial_cost_links\` WHERE \`role\` = 'replacement' LIMIT 1`
	);
	if (replacementRows.length === 0) {
		await knex.raw(
			`ALTER TABLE \`financial_cost_links\` MODIFY \`role\`
			 ENUM('cost','liability','receipt','settlement','funding','mirror','split') NOT NULL`
		);
	}
	const [eventRows] = await knex.raw(
		`SELECT 1 FROM \`financial_cost_events\`
		  WHERE \`command\` IN ('replaced','released') LIMIT 1`
	);
	if (eventRows.length === 0) {
		await knex.raw(
			`ALTER TABLE \`financial_cost_events\` MODIFY \`command\`
			 ENUM('recorded','updated','submitted','recognized','rejected','cancelled') NOT NULL`
		);
	}
}
