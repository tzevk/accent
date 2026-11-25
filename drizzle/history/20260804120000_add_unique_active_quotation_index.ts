import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Normalize outgoing_quotations uniqueness to the active-row composite key.
 *
 * The old runtime DDL in `admin/outgoing-quotations/route.js` (now stripped)
 * was the only thing creating `unique_active_quotation (quotation_number,
 * isDelete)` — on fresh DBs the baseline leaves a plain UNIQUE KEY
 * `quotation_number`, which blocks re-creating a number after a soft delete
 * (deleted rows keep their number, so the plain unique never frees it).
 *
 * This migration makes the target state schema-managed on all environments:
 * drop the plain unique if present, add the composite if missing. Idempotent.
 */
export async function up(db: MigrationDb): Promise<void> {
	const hasIndex = async (table, index) => {
		const [rows] = await executeMigrationSql(
			db,
			`SELECT 1 FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
			 LIMIT 1`,
			[table, index]
		);
		return rows.length > 0;
	};

	if (await hasIndex('outgoing_quotations', 'quotation_number')) {
		await executeMigrationSql(
			db,
			'ALTER TABLE outgoing_quotations DROP INDEX quotation_number'
		);
	}

	if (!(await hasIndex('outgoing_quotations', 'unique_active_quotation'))) {
		await executeMigrationSql(
			db,
			'ALTER TABLE outgoing_quotations ADD UNIQUE KEY unique_active_quotation (quotation_number, isDelete)'
		);
	}
}
