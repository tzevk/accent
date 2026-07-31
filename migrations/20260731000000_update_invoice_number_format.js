export async function up(knex) {
	await knex.raw(`
    UPDATE invoices
    SET invoice_number = REPLACE(invoice_number, 'ATS-I/', 'ATS/I/')
    WHERE invoice_number LIKE 'ATS-I/%';
  `);
}

export async function down(knex) {
	await knex.raw(`
    UPDATE invoices
    SET invoice_number = REPLACE(invoice_number, 'ATS/I/', 'ATS-I/')
    WHERE invoice_number LIKE 'ATS/I/%';
  `);
}
