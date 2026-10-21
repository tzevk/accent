import type { Knex } from 'knex';

/**
 * The two-way link of the transferred Lead work (review fix for #375).
 *
 * Schema:
 * - `proposal_followups.source_lead_activity_id` names the Lead activity
 *   the Proposal follow-up came from. The source activity already names its
 *   destination in `lead_activities.transferred_followup_id`; this column
 *   closes the other direction, so the handoff is traceable from both
 *   sides.
 *
 * The backfill copies the source of every Proposal follow-up that already
 * carries a `transferred_followup_id`: the Lead activity that points at it
 * is the source. Nothing is deleted, relinked, or rewritten otherwise, and
 * a follow-up that came from nowhere keeps a NULL source.
 *
 * Idempotent: every step checks information_schema first, and the backfill
 * only fills the rows that have no source yet.
 */

const FOLLOWUP_TABLE = 'proposal_followups';
const ACTIVITY_TABLE = 'lead_activities';

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

async function hasIndex(
	knex: Knex,
	table: string,
	index: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
      LIMIT 1`,
		[table, index]
	);
	return rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, FOLLOWUP_TABLE))) return;
	if (!(await hasTable(knex, ACTIVITY_TABLE))) return;

	// 1. The source of the transferred work.
	if (!(await hasColumn(knex, FOLLOWUP_TABLE, 'source_lead_activity_id'))) {
		await knex.raw(
			`ALTER TABLE \`${FOLLOWUP_TABLE}\`
        ADD COLUMN source_lead_activity_id INT NULL DEFAULT NULL`
		);
	}
	if (
		!(await hasIndex(
			knex,
			FOLLOWUP_TABLE,
			'idx_proposal_followups_source_activity'
		))
	) {
		await knex.raw(
			`ALTER TABLE \`${FOLLOWUP_TABLE}\`
        ADD KEY idx_proposal_followups_source_activity (source_lead_activity_id)`
		);
	}

	// 2. The backfill: a Proposal follow-up that a Lead activity already
	//    points at came from that activity.
	await knex.raw(`
    UPDATE \`${FOLLOWUP_TABLE}\` f
    JOIN \`${ACTIVITY_TABLE}\` a
      ON a.transferred_followup_id = f.id
    SET f.source_lead_activity_id = a.id
    WHERE f.source_lead_activity_id IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, FOLLOWUP_TABLE))) return;
	if (
		await hasIndex(
			knex,
			FOLLOWUP_TABLE,
			'idx_proposal_followups_source_activity'
		)
	) {
		await knex.raw(
			`ALTER TABLE \`${FOLLOWUP_TABLE}\`
        DROP INDEX idx_proposal_followups_source_activity`
		);
	}
	if (await hasColumn(knex, FOLLOWUP_TABLE, 'source_lead_activity_id')) {
		await knex.raw(
			`ALTER TABLE \`${FOLLOWUP_TABLE}\`
        DROP COLUMN source_lead_activity_id`
		);
	}
}
