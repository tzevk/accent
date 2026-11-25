import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Ticket #331 — how a Work Session ended.
 *
 * `user_work_sessions.end_source` records the close path that wrote the row's
 * end: `logout` (the user pressed Sign out), `beacon` (the page-close beacon
 * caught a clean exit) or `sweep` (the ops script ended a session whose owner's
 * presence heartbeat went silent).
 *
 * Historical rows are deliberately left untouched, so NULL means "pre-existing
 * end, source unrecorded" and is read as a real end rather than an inferred
 * one. The column is nullable for that reason, not to allow new writers to
 * skip it.
 *
 * Idempotent: the step checks information_schema first, so a re-run is a no-op.
 */

async function hasColumn(
	db: MigrationDb,
	table: string,
	column: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
}

export async function up(db: MigrationDb): Promise<void> {
	if (await hasColumn(db, 'user_work_sessions', 'end_source')) return;

	await executeMigrationSql(
		db,
		`ALTER TABLE user_work_sessions
      ADD COLUMN end_source VARCHAR(16) NULL DEFAULT NULL AFTER status`
	);
}
