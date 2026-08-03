/**
 * Soft-delete upgrade for payment_issues — audit metadata only:
 *
 * - Adds deleted_at / deleted_by columns (auditable, restorable deletions).
 * - No unique business-key change: payment_issues has no unique index on any
 *   number column (invoice_number is a plain non-unique index), so there is no
 *   number-reuse collision to re-scope.
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

	if (!(await hasColumn('payment_issues', 'deleted_at'))) {
		await knex.raw(`
			ALTER TABLE payment_issues
				ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
				ADD COLUMN deleted_by INT NULL DEFAULT NULL
		`);
	}
}

export async function down(knex) {
	await knex.raw(
		'ALTER TABLE payment_issues DROP COLUMN deleted_by, DROP COLUMN deleted_at'
	);
}
