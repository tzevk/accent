export async function up(knex) {
	// The outgoing_quotations table may have up to 60 identical UNIQUE KEYs on
	// quotation_number. Drop all duplicates beyond the first. This is safe to
	// re-run — it silently skips indexes that don't exist.
	const [rows] = await knex.raw(
		`SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'outgoing_quotations'
     AND COLUMN_NAME = 'quotation_number'
     AND INDEX_NAME LIKE 'quotation_number\\\\_%'`
	);
	const duplicateNames = (rows[0] || [])
		.map((r) => r.INDEX_NAME)
		.filter((name) => name !== 'quotation_number');

	for (const name of duplicateNames) {
		await knex.raw(`ALTER TABLE outgoing_quotations DROP INDEX \`${name}\``);
	}
}

export async function down(knex) {
	// Restoration not practical — the baseline migration recreates them if needed.
}
