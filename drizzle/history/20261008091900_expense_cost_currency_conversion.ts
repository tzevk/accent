import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

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
		// Wider than `recognized_amount`: an amount near the (15,2) limit
		// times a rate can exceed it, and a reporting figure must not fail to
		// store after the cost was accepted.
		ddl: 'DECIMAL(20,2) NULL',
	},
];

async function hasExpensesTable(db: MigrationDb) {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.tables
		  WHERE table_schema = DATABASE() AND table_name = 'expenses'
		  LIMIT 1`
	);
	return rows.length > 0;
}

async function columnExists(db: MigrationDb, name: string) {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'expenses'
		    AND column_name = ?
		  LIMIT 1`,
		[name]
	);
	return rows.length > 0;
}

export async function up(db: MigrationDb): Promise<void> {
	if (!(await hasExpensesTable(db))) return; // Pre-#306 schema.
	for (const column of COLUMNS) {
		if (await columnExists(db, column.name)) continue;
		await executeMigrationSql(
			db,
			`ALTER TABLE \`expenses\` ADD COLUMN \`${column.name}\` ${column.ddl}`
		);
	}
}
