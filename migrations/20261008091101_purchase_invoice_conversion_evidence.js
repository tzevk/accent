/**
 * Supplier invoice conversion evidence (#311, contract #319 currency).
 *
 * A supplier invoice may be captured in a foreign transaction currency. Its
 * reporting-currency statement uses exactly the same evidence rule as a direct
 * expense: the requested reporting basis must match either the original
 * currency or a stored target with a full rate triple (rate, date, reference).
 * No inverse or cross-rate is derived, and a missing/partial triple stays an
 * explicit exception rather than a guessed figure.
 *
 * Columns mirror `expenses` (migration 20261008091900, #319) so every source
 * feeds one conversion interpretation:
 *   reporting_currency             the currency this cost is reported in
 *   conversion_rate                effective original → reporting rate
 *                                  (DECIMAL(20,10): kept as its decimal text,
 *                                  never routed through a JS number)
 *   conversion_date                date the rate is effective
 *   conversion_evidence_reference  where the rate came from
 *   converted_amount               reporting-currency value of the recognized
 *                                  amount; NULL until recognized or when the
 *                                  evidence does not support the target.
 *
 * Idempotent: every step checks information_schema first.
 */

export async function up(knex) {
	const hasColumn = async (column) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = 'purchase_invoices' AND column_name = ?
			 LIMIT 1`,
			[column]
		);
		return rows.length > 0;
	};

	const columns = [
		{
			name: 'reporting_currency',
			ddl: "VARCHAR(3) NULL COMMENT 'Reporting target; NULL = the company reporting currency'",
		},
		{
			name: 'conversion_rate',
			ddl: "DECIMAL(20,10) NULL COMMENT 'Effective original → reporting rate at conversion_date'",
		},
		{ name: 'conversion_date', ddl: 'DATE NULL' },
		{
			name: 'conversion_evidence_reference',
			ddl: "VARCHAR(500) NULL COMMENT 'Where the rate came from'",
		},
		{
			name: 'converted_amount',
			ddl: "DECIMAL(20,2) NULL COMMENT 'Reporting-currency value of recognized_amount'",
		},
	];

	for (const column of columns) {
		if (!(await hasColumn(column.name))) {
			await knex.raw(
				`ALTER TABLE \`purchase_invoices\` ADD COLUMN \`${column.name}\` ${column.ddl}`
			);
		}
	}
}

export async function down(knex) {
	for (const column of [
		'reporting_currency',
		'conversion_rate',
		'conversion_date',
		'conversion_evidence_reference',
		'converted_amount',
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
