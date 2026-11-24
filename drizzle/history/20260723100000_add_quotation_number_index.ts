import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

export async function up(db: MigrationDb): Promise<void> {
	// The next-number API does LIKE 'ATSPL/Q/MM/YY-YY/%' on this column
	// without an index → full table scan on every "create quotation" page load.
	await executeMigrationSql(
		db,
		`ALTER TABLE quotations ADD INDEX idx_quotation_number (quotation_number)`
	);
}
