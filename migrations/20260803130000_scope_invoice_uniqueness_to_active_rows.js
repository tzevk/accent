/**
 * Corrective migration: the first version of
 * 20260803120000_upgrade_soft_delete_metadata.js used
 * (invoice_number, deleted_at) as the active-scoped unique key. That is
 * toothless: MySQL/MariaDB treat NULLs as distinct in unique indexes, and
 * rows soft-deleted before the upgrade have deleted_at = NULL, so a deleted
 * row and an active row could share the same number slot without the
 * constraint firing.
 *
 * This migration replaces those keys with the generated-column pattern
 * (active_invoice_number = invoice_number while isDelete = 0, else NULL),
 * which enforces "one active row per number" directly. It is defensive:
 * every step checks information_schema, so it is a no-op on databases that
 * already have the corrected schema (fresh installs run the fixed migration
 * 20260803120000 and skip this one's work).
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

	for (const table of ['invoices', 'purchase_invoices']) {
		if (
			await hasIndex(
				table,
				table === 'invoices' ? 'unique_active_invoice' : 'invoice_number'
			)
		) {
			await knex.raw(
				`ALTER TABLE ${table} DROP INDEX ${table === 'invoices' ? 'unique_active_invoice' : 'invoice_number'}`
			);
		}
		if (!(await hasColumn(table, 'active_invoice_number'))) {
			await knex.raw(`
				ALTER TABLE ${table}
					ADD COLUMN active_invoice_number VARCHAR(191)
					GENERATED ALWAYS AS (IF(isDelete = 0, invoice_number, NULL)) STORED
			`);
		}
		if (
			!(await hasIndex(
				table,
				table === 'invoices' ? 'unique_active_invoice' : 'invoice_number'
			))
		) {
			await knex.raw(
				`ALTER TABLE ${table} ADD UNIQUE KEY ${table === 'invoices' ? 'unique_active_invoice' : 'invoice_number'} (active_invoice_number)`
			);
		}
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
}
