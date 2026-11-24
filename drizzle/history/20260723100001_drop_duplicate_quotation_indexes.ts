import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

export async function up(db: MigrationDb): Promise<void> {
	// The outgoing_quotations table may have up to 60 identical UNIQUE KEYs on
	// quotation_number. Drop all duplicates beyond the first. This is safe to
	// re-run — it silently skips indexes that don't exist.
	const [rows] = await executeMigrationSql(
		db,
		`SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'outgoing_quotations'
     AND COLUMN_NAME = 'quotation_number'
     AND INDEX_NAME LIKE 'quotation_number\\\\_%'`
	);
	const duplicateNames = (rows || [])
		.map((r) => r.INDEX_NAME)
		.filter((name) => name !== 'quotation_number');

	for (const name of duplicateNames) {
		await executeMigrationSql(
			db,
			`ALTER TABLE outgoing_quotations DROP INDEX \`${name}\``
		);
	}
}
