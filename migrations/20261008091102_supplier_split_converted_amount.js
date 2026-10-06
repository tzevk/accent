/**
 * Supplier invoice split conversion figures (#311, contract #319 currency).
 *
 * A recognized invoice that is stated in another reporting basis freezes its
 * reporting-currency figure at recognition. Its service-period slices carry
 * their own per-slice converted amount, computed with the same per-record
 * rounding the report applies, so the slices and the invoice statement agree
 * to the cent when a rate produces fractional cents.
 *
 * Idempotent: the column check is an information_schema read.
 */

export async function up(knex) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'supplier_invoice_periods'
		    AND column_name = 'converted_amount'
		  LIMIT 1`
	);
	if (rows.length === 0) {
		await knex.raw(
			`ALTER TABLE \`supplier_invoice_periods\`
         ADD COLUMN \`converted_amount\` DECIMAL(20,2) NULL
         COMMENT 'Reporting-currency value of recognized_amount, frozen at recognition'`
		);
	}
}

export async function down(knex) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'supplier_invoice_periods'
		    AND column_name = 'converted_amount'
		  LIMIT 1`
	);
	if (rows.length) {
		await knex.raw(
			'ALTER TABLE `supplier_invoice_periods` DROP COLUMN `converted_amount`'
		);
	}
}
