/**
 * Soft-delete upgrade for expenses — same pattern as invoices and
 * purchase_invoices (20260803120000/130000):
 *
 * - Adds deleted_at / deleted_by columns (auditable, restorable deletions).
 * - Re-scopes the UNIQUE expense_number constraint to ACTIVE rows via the
 *   generated column active_expense_number (= expense_number while isDelete =
 *   0, NULL once deleted), so deleted numbers can be reused. A plain composite
 *   (expense_number, deleted_at) would be toothless: pre-existing soft-deleted
 *   rows carry deleted_at = NULL and MySQL/MariaDB treat NULLs as distinct in
 *   unique indexes, silently disabling active-number uniqueness.
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

	if (!(await hasColumn('expenses', 'deleted_at'))) {
		await knex.raw(`
			ALTER TABLE expenses
				ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
				ADD COLUMN deleted_by INT NULL DEFAULT NULL
		`);
	}
	if (await hasIndex('expenses', 'expense_number')) {
		await knex.raw('ALTER TABLE expenses DROP INDEX expense_number');
	}
	if (!(await hasColumn('expenses', 'active_expense_number'))) {
		await knex.raw(`
			ALTER TABLE expenses
				ADD COLUMN active_expense_number VARCHAR(191)
				GENERATED ALWAYS AS (IF(isDelete = 0, expense_number, NULL)) STORED
		`);
	}
	if (!(await hasIndex('expenses', 'expense_number'))) {
		await knex.raw(
			'ALTER TABLE expenses ADD UNIQUE KEY expense_number (active_expense_number)'
		);
	}
}

export async function down(knex) {
	await knex.raw(
		'ALTER TABLE expenses DROP INDEX expense_number, DROP COLUMN active_expense_number'
	);
	await knex.raw(
		'ALTER TABLE expenses ADD UNIQUE KEY expense_number (expense_number)'
	);
	await knex.raw(
		'ALTER TABLE expenses DROP COLUMN deleted_by, DROP COLUMN deleted_at'
	);
}
