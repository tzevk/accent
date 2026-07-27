export async function up(knex) {
	// The next-number API does LIKE 'ATSPL/Q/MM/YY-YY/%' on this column
	// without an index → full table scan on every "create quotation" page load.
	await knex.raw(
		`ALTER TABLE quotations ADD INDEX idx_quotation_number (quotation_number)`
	);
}

export async function down(knex) {
	await knex.raw(`ALTER TABLE quotations DROP INDEX idx_quotation_number`);
}
