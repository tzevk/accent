/**
 * Active-row uniqueness for six document-number columns (SEC-28, workstream E2).
 *
 * Each of these numbers is minted by a non-atomic `SELECT MAX/COUNT → INSERT`
 * generator, so two concurrent requests can mint the same number. The insert
 * paths are serialized (transaction + `FOR UPDATE` + retry on duplicate key),
 * and these indexes are the database-level backstop that makes the retry
 * possible and the invariant true.
 *
 * Pattern (same as `active_invoice_number` / `active_expense_number`):
 *   active_<column> = IF(isDelete = 0, <column>, NULL) STORED + UNIQUE KEY
 * MySQL/MariaDB treat NULLs as distinct in unique indexes, so soft-deleted rows
 * never block a re-used number while active rows stay unique.
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

	const targets = [
		{ table: 'quotations', column: 'quotation_number', type: 'VARCHAR(191)' },
		{ table: 'payment_entries', column: 'receipt_no', type: 'VARCHAR(191)' },
		{
			table: 'project_invoices',
			column: 'invoice_number',
			type: 'VARCHAR(191)',
		},
		{
			table: 'project_quotations',
			column: 'quotation_number',
			type: 'VARCHAR(191)',
		},
		{ table: 'outgoing_purchase_orders', column: 'sr_no', type: 'INT' },
		{ table: 'leads', column: 'lead_id', type: 'VARCHAR(191)' },
	];

	for (const { table, column, type } of targets) {
		const activeColumn = `active_${column}`;
		const indexName = `unique_${activeColumn}`;

		if (!(await hasColumn(table, activeColumn))) {
			await knex.raw(
				`ALTER TABLE \`${table}\`
					ADD COLUMN \`${activeColumn}\` ${type}
					GENERATED ALWAYS AS (IF(isDelete = 0, \`${column}\`, NULL)) STORED`
			);
		}
		if (!(await hasIndex(table, indexName))) {
			await knex.raw(
				`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`${activeColumn}\`)`
			);
		}
	}
}

export async function down(knex) {
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

	const targets = [
		{ table: 'quotations', column: 'quotation_number' },
		{ table: 'payment_entries', column: 'receipt_no' },
		{ table: 'project_invoices', column: 'invoice_number' },
		{ table: 'project_quotations', column: 'quotation_number' },
		{ table: 'outgoing_purchase_orders', column: 'sr_no' },
		{ table: 'leads', column: 'lead_id' },
	];

	for (const { table, column } of targets) {
		const activeColumn = `active_${column}`;
		const indexName = `unique_${activeColumn}`;

		if (await hasIndex(table, indexName)) {
			await knex.raw(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
		}
		if (await hasColumn(table, activeColumn)) {
			await knex.raw(
				`ALTER TABLE \`${table}\` DROP COLUMN \`${activeColumn}\``
			);
		}
	}
}
