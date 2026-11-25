import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Recognition-period disclosure for a partial received-work period (#306
 * review fix): a cost whose service period start is not recorded but whose end
 * is now resolves to the end month and records `period_basis =
 * 'service_period_end'`, instead of silently falling through to the bill date.
 *
 * Extends the existing `period_basis` ENUM from
 * `20261006120000_expense_cost_recognition.js`; it never duplicates the column.
 *
 * Idempotent: the `information_schema` check makes a re-run (or a database
 * that already carries the value) a no-op.
 */

const BASIS_VALUES = [
	'service_period',
	'service_period_end',
	'bill_date_fallback',
	'unresolved',
];

function enumDefinition(values: readonly string[]) {
	return `ENUM(${values.map((value) => `'${value}'`).join(',')}) NOT NULL DEFAULT 'unresolved'`;
}

async function columnType(db: MigrationDb) {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT COLUMN_TYPE FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'expenses'
		    AND column_name = 'period_basis'
		  LIMIT 1`
	);
	return rows.length ? String(rows[0].COLUMN_TYPE) : null;
}

export async function up(db: MigrationDb): Promise<void> {
	const type = await columnType(db);
	if (type === null) return; // Pre-#306 schema: nothing to extend.
	if (type.includes("'service_period_end'")) return;
	await executeMigrationSql(
		db,
		`ALTER TABLE \`expenses\` MODIFY COLUMN \`period_basis\` ${enumDefinition(BASIS_VALUES)}`
	);
}
