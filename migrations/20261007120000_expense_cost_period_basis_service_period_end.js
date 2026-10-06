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

function enumDefinition(values) {
	return `ENUM(${values.map((value) => `'${value}'`).join(',')}) NOT NULL DEFAULT 'unresolved'`;
}

async function columnType(knex) {
	const [rows] = await knex.raw(
		`SELECT COLUMN_TYPE FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'expenses'
		    AND column_name = 'period_basis'
		  LIMIT 1`
	);
	return rows.length ? String(rows[0].COLUMN_TYPE) : null;
}

export async function up(knex) {
	const type = await columnType(knex);
	if (type === null) return; // Pre-#306 schema: nothing to extend.
	if (type.includes("'service_period_end'")) return;
	await knex.raw(
		`ALTER TABLE \`expenses\` MODIFY COLUMN \`period_basis\` ${enumDefinition(BASIS_VALUES)}`
	);
}

export async function down(knex) {
	const type = await columnType(knex);
	if (type === null || !type.includes("'service_period_end'")) return;
	// Narrowing with rows still carrying the value would truncate them under
	// STRICT_TRANS_TABLES; leave the wider ENUM in place then.
	const [rows] = await knex.raw(
		`SELECT 1 FROM \`expenses\` WHERE period_basis = 'service_period_end' LIMIT 1`
	);
	if (rows.length) return;
	await knex.raw(
		`ALTER TABLE \`expenses\` MODIFY COLUMN \`period_basis\` ${enumDefinition(
			BASIS_VALUES.filter((value) => value !== 'service_period_end')
		)}`
	);
}
