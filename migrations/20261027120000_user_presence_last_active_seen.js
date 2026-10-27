/**
 * CRM Presence gains its last activity signal (ticket #386).
 *
 * `user_presence.last_seen` refreshed on every event, so the staleness sweep
 * could not tell a working browser from an idle one that kept heartbeating.
 * `last_active_seen` records the last activity signal: active evidence (a page
 * view, a logged action, a heartbeat reporting not-idle) refreshes it, an idle
 * heartbeat does not. The sweep counts silence from it and falls back to
 * `last_seen` while it is NULL.
 *
 * No backfill: the sweep's fallback keeps existing rows from reading as
 * instant silence, so they need no rewrite.
 *
 * Idempotent: the `information_schema` check makes a re-run (or a rollback on
 * a database that never ran the migration) a no-op.
 */
async function hasLastActiveSeen(knex) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'user_presence'
		    AND column_name = 'last_active_seen'
		  LIMIT 1`
	);
	return rows.length > 0;
}

export async function up(knex) {
	if (await hasLastActiveSeen(knex)) return;
	await knex.raw(`
    ALTER TABLE user_presence
      ADD COLUMN last_active_seen TIMESTAMP NULL DEFAULT NULL AFTER last_seen
  `);
}

export async function down(knex) {
	if (!(await hasLastActiveSeen(knex))) return;
	await knex.raw(`
    ALTER TABLE user_presence
      DROP COLUMN last_active_seen
  `);
}
