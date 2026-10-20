import type { Knex } from 'knex';

/**
 * Ticket #372 — the correction of a logged Lead activity.
 *
 * Schema:
 * - `lead_activity_corrections` records every correction of a Lead
 *   activity: the values before the correction, the values after it, the
 *   reason, the user who corrected it (the actor of the session), and the
 *   moment the correction was made. The rows are evidence, never a
 *   replacement for the activity they correct: the activity keeps its own
 *   row, and the correction history keeps every version of it.
 * - `lead_activities.version` is the concurrency token of a correction. An
 *   editor sends the version it saw; a correction of an activity that moved
 *   on is refused instead of overwriting the accepted correction.
 *
 * Idempotent: every step checks information_schema first. Reversible:
 * `down()` drops the correction history and the version token.
 */

const ACTIVITY_TABLE = 'lead_activities';
const CORRECTION_TABLE = 'lead_activity_corrections';

async function hasTable(knex: Knex, table: string): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
      LIMIT 1`,
		[table]
	);
	return rows.length > 0;
}

async function hasColumn(
	knex: Knex,
	table: string,
	column: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'leads'))) return;
	if (!(await hasTable(knex, ACTIVITY_TABLE))) return;

	// 1. The version token of every activity. Existing rows start at 1: a
	//    row that was never corrected is the first version of itself.
	if (!(await hasColumn(knex, ACTIVITY_TABLE, 'version'))) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\`
        ADD COLUMN version INT NOT NULL DEFAULT 1`
		);
	}
	await knex.raw(
		`UPDATE \`${ACTIVITY_TABLE}\` SET version = 1 WHERE version IS NULL OR version < 1`
	);

	// 2. The correction history.
	if (!(await hasTable(knex, CORRECTION_TABLE))) {
		await knex.raw(`
      CREATE TABLE ${CORRECTION_TABLE} (
        id INT NOT NULL AUTO_INCREMENT,
        activity_id INT NOT NULL,
        lead_id INT NOT NULL,
        previous_values TEXT NOT NULL,
        corrected_values TEXT NOT NULL,
        reason TEXT NOT NULL,
        corrected_by INT NULL DEFAULT NULL,
        corrected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_activity_corrections_lead (lead_id),
        KEY idx_lead_activity_corrections_activity (activity_id),
        KEY idx_lead_activity_corrections_actor (corrected_by),
        CONSTRAINT fk_lead_activity_corrections_activity FOREIGN KEY (activity_id)
          REFERENCES ${ACTIVITY_TABLE} (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_activity_corrections_lead FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_activity_corrections_actor FOREIGN KEY (corrected_by)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}
}

export async function down(knex: Knex): Promise<void> {
	if (await hasTable(knex, CORRECTION_TABLE)) {
		await knex.raw(`DROP TABLE \`${CORRECTION_TABLE}\``);
	}
	if (
		(await hasTable(knex, ACTIVITY_TABLE)) &&
		(await hasColumn(knex, ACTIVITY_TABLE, 'version'))
	) {
		await knex.raw(`ALTER TABLE \`${ACTIVITY_TABLE}\` DROP COLUMN version`);
	}
}
