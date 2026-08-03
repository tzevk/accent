/**
 * Soft-delete upgrade for other_expenses — same pattern as expenses,
 * invoices, and purchase_invoices:
 *
 * - Adds deleted_at / deleted_by columns (auditable, restorable deletions).
 * - Re-scopes the UNIQUE voucher_number constraint to ACTIVE rows via the
 *   generated column active_voucher_number (= voucher_number while isDelete =
 *   0, NULL once deleted), so deleted voucher numbers can be reused.
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

	if (!(await hasColumn('other_expenses', 'deleted_at'))) {
		await knex.raw(`
			ALTER TABLE other_expenses
				ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
				ADD COLUMN deleted_by INT NULL DEFAULT NULL
		`);
	}
	if (await hasIndex('other_expenses', 'voucher_number')) {
		await knex.raw('ALTER TABLE other_expenses DROP INDEX voucher_number');
	}
	if (!(await hasColumn('other_expenses', 'active_voucher_number'))) {
		await knex.raw(`
			ALTER TABLE other_expenses
				ADD COLUMN active_voucher_number VARCHAR(191)
				GENERATED ALWAYS AS (IF(isDelete = 0, voucher_number, NULL)) STORED
		`);
	}
	if (!(await hasIndex('other_expenses', 'voucher_number'))) {
		await knex.raw(
			'ALTER TABLE other_expenses ADD UNIQUE KEY voucher_number (active_voucher_number)'
		);
	}
}

export async function down(knex) {
	await knex.raw(
		'ALTER TABLE other_expenses DROP INDEX voucher_number, DROP COLUMN active_voucher_number'
	);
	await knex.raw(
		'ALTER TABLE other_expenses ADD UNIQUE KEY voucher_number (voucher_number)'
	);
	await knex.raw(
		'ALTER TABLE other_expenses DROP COLUMN deleted_by, DROP COLUMN deleted_at'
	);
}
