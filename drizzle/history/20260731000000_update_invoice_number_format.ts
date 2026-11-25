import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

export async function up(db: MigrationDb): Promise<void> {
	await executeMigrationSql(
		db,
		`
    UPDATE invoices
    SET invoice_number = REPLACE(invoice_number, 'ATS-I/', 'ATS/I/')
    WHERE invoice_number LIKE 'ATS-I/%';
  `
	);
}
