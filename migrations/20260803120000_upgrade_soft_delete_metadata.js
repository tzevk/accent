/**
 * Soft-delete upgrade for invoices + purchase_invoices:
 *
 * - Adds deleted_at / deleted_by columns (when deleted + by whom) so deletions
 *   are auditable and restorable without touching the row's business data.
 * - Scopes the unique invoice-number constraint to ACTIVE rows via a generated
 *   column: `active_invoice_number` = invoice_number while isDelete = 0, NULL
 *   once deleted. MySQL/MariaDB treat NULLs as distinct in unique indexes, so
 *   deleted rows never collide with a re-created number — this removes the
 *   need for the '-DEL' rename workaround in the invoices DELETE handler.
 *
 * A plain composite key (invoice_number, deleted_at) would NOT work here:
 * rows soft-deleted before this migration carry deleted_at = NULL and would
 * share the "active" slot, silently disabling the active-number uniqueness.
 * The generated column expresses "unique among active rows" directly.
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

	// invoices
	if (!(await hasColumn('invoices', 'deleted_at'))) {
		await knex.raw(`
			ALTER TABLE invoices
				ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
				ADD COLUMN deleted_by INT NULL DEFAULT NULL
		`);
	}
	if (await hasIndex('invoices', 'unique_active_invoice')) {
		await knex.raw('ALTER TABLE invoices DROP INDEX unique_active_invoice');
	}
	if (!(await hasColumn('invoices', 'active_invoice_number'))) {
		await knex.raw(`
			ALTER TABLE invoices
				ADD COLUMN active_invoice_number VARCHAR(191)
				GENERATED ALWAYS AS (IF(isDelete = 0, invoice_number, NULL)) STORED
		`);
	}
	if (!(await hasIndex('invoices', 'unique_active_invoice'))) {
		await knex.raw(
			'ALTER TABLE invoices ADD UNIQUE KEY unique_active_invoice (active_invoice_number)'
		);
	}

	// purchase_invoices
	if (!(await hasColumn('purchase_invoices', 'deleted_at'))) {
		await knex.raw(`
			ALTER TABLE purchase_invoices
				ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
				ADD COLUMN deleted_by INT NULL DEFAULT NULL
		`);
	}
	if (await hasIndex('purchase_invoices', 'invoice_number')) {
		await knex.raw('ALTER TABLE purchase_invoices DROP INDEX invoice_number');
	}
	if (!(await hasColumn('purchase_invoices', 'active_invoice_number'))) {
		await knex.raw(`
			ALTER TABLE purchase_invoices
				ADD COLUMN active_invoice_number VARCHAR(191)
				GENERATED ALWAYS AS (IF(isDelete = 0, invoice_number, NULL)) STORED
		`);
	}
	if (!(await hasIndex('purchase_invoices', 'invoice_number'))) {
		await knex.raw(
			'ALTER TABLE purchase_invoices ADD UNIQUE KEY invoice_number (active_invoice_number)'
		);
	}
}

export async function down(knex) {
	await knex.raw(
		'ALTER TABLE invoices DROP INDEX unique_active_invoice, DROP COLUMN active_invoice_number'
	);
	await knex.raw(
		'ALTER TABLE invoices ADD UNIQUE KEY unique_active_invoice (invoice_number, isDelete)'
	);
	await knex.raw(
		'ALTER TABLE purchase_invoices DROP INDEX invoice_number, DROP COLUMN active_invoice_number'
	);
	await knex.raw(
		'ALTER TABLE purchase_invoices ADD UNIQUE KEY invoice_number (invoice_number)'
	);
	await knex.raw(
		'ALTER TABLE invoices DROP COLUMN deleted_by, DROP COLUMN deleted_at'
	);
	await knex.raw(
		'ALTER TABLE purchase_invoices DROP COLUMN deleted_by, DROP COLUMN deleted_at'
	);
}
