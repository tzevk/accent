/**
 * Currency conversion evidence for direct cost (#319).
 *
 * Stores the transaction currency's reporting target and the effective
 * conversion evidence behind a reporting-currency figure:
 *   - `reporting_currency`  the currency the cost is reported in; NULL means
 *                           the company reporting currency (INR), which is a
 *                           reporting-target default, never a guess about the
 *                           original transaction currency;
 *   - `conversion_rate`     original → reporting rate, effective on
 *                           `conversion_date`, exactly as recorded (strings
 *                           are preserved; DECIMAL(20,10) holds more digits
 *                           than a JS number can state);
 *   - `conversion_date`     when the rate is effective;
 *   - `conversion_evidence_reference`  where the rate came from;
 *   - `converted_amount`    the reporting-currency value of
 *                           `recognized_amount` at that rate, kept so a later
 *                           close snapshot and the append-only journal can
 *                           preserve the figure even if a default or rate
 *                           changes afterwards.
 *
 * `expenses.currency` remains the original/transaction currency and is never
 * rewritten; a NULL there is unknown and stays unknown.
 *
 * Idempotent: every column is added only when `information_schema` says it is
 * absent, so a re-run (or a database that already carries the column) is a
 * no-op.
 */

const COLUMNS = [
	{
		name: 'reporting_currency',
		ddl: 'VARCHAR(3) NULL',
	},
	{
		name: 'conversion_rate',
		ddl: 'DECIMAL(20,10) NULL',
	},
	{
		name: 'conversion_date',
		ddl: 'DATE NULL',
	},
	{
		name: 'conversion_evidence_reference',
		ddl: 'VARCHAR(500) NULL',
	},
	{
		name: 'converted_amount',
		ddl: 'DECIMAL(15,2) NULL',
	},
];

async function hasExpensesTable(knex) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
		  WHERE table_schema = DATABASE() AND table_name = 'expenses'
		  LIMIT 1`
	);
	return rows.length > 0;
}

async function columnExists(knex, name) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'expenses'
		    AND column_name = ?
		  LIMIT 1`,
		[name]
	);
	return rows.length > 0;
}

export async function up(knex) {
	if (!(await hasExpensesTable(knex))) return; // Pre-#306 schema.
	for (const column of COLUMNS) {
		if (await columnExists(knex, column.name)) continue;
		await knex.raw(
			`ALTER TABLE \`expenses\` ADD COLUMN \`${column.name}\` ${column.ddl}`
		);
	}
}

export async function down(knex) {
	if (!(await hasExpensesTable(knex))) return;
	for (const column of COLUMNS) {
		if (!(await columnExists(knex, column.name))) continue;
		await knex.raw(`ALTER TABLE \`expenses\` DROP COLUMN \`${column.name}\``);
	}
}
