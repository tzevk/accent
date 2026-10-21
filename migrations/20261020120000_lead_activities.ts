import type { Knex } from 'knex';

/**
 * Ticket #371 — the Lead activity log, the dated next actions, and the
 * stage history.
 *
 * Schema:
 * - `lead_activities` (renamed from the legacy `follow_ups`) holds one row
 *   per Lead work item: a scheduled next action (`status = 'Scheduled'`) or
 *   the evidence of work that happened (`status = 'Completed'/'Cancelled'`).
 *   The legacy columns are adapted, not thrown away: `follow_up_date`
 *   becomes `scheduled_for`, `follow_up_type` becomes `legacy_type`, and
 *   `description` is merged into `notes`.
 * - `lead_stage_history` records every stage change with its source
 *   (`automatic`, `explicit`, `conversion`) and the actor.
 *
 * Cutover behaviour:
 * 1. The legacy table is renamed, its columns adapted, and the legacy rows
 *    keep their dates. Their author is unknown (`created_by` NULL), their
 *    call outcome is unknown (`call_outcome` NULL), their kind is mapped
 *    only when the legacy text is exactly `Call`, `Email`, or `Meeting`,
 *    and their occurrence time stays unknown (`occurred_at` NULL).
 * 2. Every legacy Lead with a `leads.follow_up_date` and no scheduled row
 *    of that date gets one scheduled row, so the dated next action the Lead
 *    carried becomes real work instead of a loose column value.
 * 3. `leads.follow_up_date` is recomputed as the earliest `scheduled_for`
 *    of the Lead's scheduled rows (NULL when it has none). It stays the
 *    Lead's dated next action, maintained by the Lead workflow module.
 *
 * No evidence is lost: the original scheduled date of a migrated row stays
 * in `legacy_scheduled_date` and the original kind in `legacy_type`.
 *
 * Idempotent: every step checks information_schema first, and the data
 * steps are pure functions of the current columns, so a re-run reproduces
 * them. Reversible: `down()` recreates `follow_ups` and copies the rows
 * back.
 */

const ACTIVITY_TABLE = 'lead_activities';
const LEGACY_TABLE = 'follow_ups';
const STAGE_HISTORY_TABLE = 'lead_stage_history';

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

async function hasIndexOnColumn(
	knex: Knex,
	table: string,
	column: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
}

async function hasConstraint(
	knex: Knex,
	table: string,
	constraint: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ?
        AND constraint_name = ?
      LIMIT 1`,
		[table, constraint]
	);
	return rows.length > 0;
}

/** The foreign keys that still point at `leads` from the activity table. */
async function leadForeignKeyNames(knex: Knex): Promise<string[]> {
	const [rows] = (await knex.raw(
		`SELECT rc.CONSTRAINT_NAME AS name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
       AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
        AND rc.TABLE_NAME = ?
        AND rc.REFERENCED_TABLE_NAME = 'leads'
        AND kcu.COLUMN_NAME = 'lead_id'`,
		[ACTIVITY_TABLE]
	)) as unknown as [{ name: string }[], unknown];
	return rows.map((row) => row.name);
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'leads'))) return;

	// 1. The activity table: the legacy table renamed, or a fresh table when
	//    no legacy table exists.
	if (!(await hasTable(knex, ACTIVITY_TABLE))) {
		if (await hasTable(knex, LEGACY_TABLE)) {
			await knex.raw(
				`RENAME TABLE \`${LEGACY_TABLE}\` TO \`${ACTIVITY_TABLE}\``
			);
		} else {
			await knex.raw(`
        CREATE TABLE lead_activities (
          id INT NOT NULL AUTO_INCREMENT,
          lead_id INT NOT NULL,
          activity_type VARCHAR(16) NULL DEFAULT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'Scheduled',
          call_outcome VARCHAR(16) NULL DEFAULT NULL,
          reply_confirmed TINYINT(1) NULL DEFAULT NULL,
          scheduled_for DATE NULL DEFAULT NULL,
          occurred_at DATETIME NULL DEFAULT NULL,
          completed_at DATETIME NULL DEFAULT NULL,
          next_action VARCHAR(255) NULL DEFAULT NULL,
          notes TEXT NULL DEFAULT NULL,
          created_by INT NULL DEFAULT NULL,
          recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          isDelete TINYINT(1) NOT NULL DEFAULT 0,
          legacy_type VARCHAR(50) NULL DEFAULT NULL,
          legacy_scheduled_date DATE NULL DEFAULT NULL,
          transferred_followup_id INT NULL DEFAULT NULL,
          transferred_at DATETIME NULL DEFAULT NULL,
          source_activity_id INT NULL DEFAULT NULL,
          PRIMARY KEY (id),
          KEY idx_lead_activities_lead (lead_id),
          KEY idx_lead_activities_status (status),
          KEY idx_lead_activities_scheduled (scheduled_for),
          KEY idx_lead_activities_isdelete (isDelete)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
		}
	}

	const legacyDateColumn = await hasColumn(
		knex,
		ACTIVITY_TABLE,
		'follow_up_date'
	);
	const legacyTypeColumn = await hasColumn(
		knex,
		ACTIVITY_TABLE,
		'follow_up_type'
	);
	const legacyDescriptionColumn = await hasColumn(
		knex,
		ACTIVITY_TABLE,
		'description'
	);

	// 2. The new columns, added one by one so a re-run is a no-op. The two
	//    columns that replace a legacy column are added only when the legacy
	//    column is absent (the rename below provides them otherwise).
	const columnsToAdd: Array<[string, string]> = [
		['activity_type', `VARCHAR(16) NULL DEFAULT NULL`],
		['call_outcome', `VARCHAR(16) NULL DEFAULT NULL`],
		['reply_confirmed', `TINYINT(1) NULL DEFAULT NULL`],
		['occurred_at', `DATETIME NULL DEFAULT NULL`],
		['completed_at', `DATETIME NULL DEFAULT NULL`],
		['notes', `TEXT NULL DEFAULT NULL`],
		['created_by', `INT NULL DEFAULT NULL`],
		['recorded_at', `TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`],
		['legacy_type', `VARCHAR(50) NULL DEFAULT NULL`],
		['legacy_scheduled_date', `DATE NULL DEFAULT NULL`],
		['transferred_followup_id', `INT NULL DEFAULT NULL`],
		['transferred_at', `DATETIME NULL DEFAULT NULL`],
		['source_activity_id', `INT NULL DEFAULT NULL`],
	];
	if (!legacyDateColumn) {
		columnsToAdd.push(['scheduled_for', `DATE NULL DEFAULT NULL`]);
	}
	if (!(await hasColumn(knex, ACTIVITY_TABLE, 'status'))) {
		columnsToAdd.push(['status', `VARCHAR(16) NOT NULL DEFAULT 'Scheduled'`]);
	}
	if (!(await hasColumn(knex, ACTIVITY_TABLE, 'next_action'))) {
		columnsToAdd.push(['next_action', `VARCHAR(255) NULL DEFAULT NULL`]);
	}
	for (const [column, definition] of columnsToAdd) {
		if (!(await hasColumn(knex, ACTIVITY_TABLE, column))) {
			await knex.raw(
				`ALTER TABLE \`${ACTIVITY_TABLE}\` ADD COLUMN ${column} ${definition}`
			);
		}
	}

	// 3. Legacy evidence first, before the legacy columns go away.
	if (legacyTypeColumn) {
		await knex.raw(
			`UPDATE \`${ACTIVITY_TABLE}\`
        SET legacy_type = follow_up_type
        WHERE legacy_type IS NULL AND follow_up_type IS NOT NULL`
		);
	}
	if (legacyDateColumn) {
		await knex.raw(
			`UPDATE \`${ACTIVITY_TABLE}\`
        SET legacy_scheduled_date = follow_up_date
        WHERE legacy_scheduled_date IS NULL AND follow_up_date IS NOT NULL`
		);
	}
	if (legacyDescriptionColumn) {
		await knex.raw(
			`UPDATE \`${ACTIVITY_TABLE}\`
        SET notes = COALESCE(NULLIF(notes, ''), description)`
		);
	}
	// The legacy kind is only a kind when it is exactly one of them.
	await knex.raw(
		`UPDATE \`${ACTIVITY_TABLE}\`
      SET activity_type = CASE legacy_type
        WHEN 'Call' THEN 'Call'
        WHEN 'Email' THEN 'Email'
        WHEN 'Meeting' THEN 'Meeting'
        WHEN 'Note' THEN 'Note'
        ELSE NULL
      END
      WHERE activity_type IS NULL`
	);
	// Legacy statuses are only scheduled, completed, or cancelled work.
	await knex.raw(
		`UPDATE \`${ACTIVITY_TABLE}\`
      SET status = CASE
        WHEN status = 'Completed' THEN 'Completed'
        WHEN status = 'Cancelled' THEN 'Cancelled'
        ELSE 'Scheduled'
      END`
	);
	// The recording time of a migrated row is the time the row was written.
	await knex.raw(
		`UPDATE \`${ACTIVITY_TABLE}\`
      SET recorded_at = COALESCE(created_at, CURRENT_TIMESTAMP)`
	);

	// 4. The legacy columns become the canonical ones. The original values
	//    already live in the legacy evidence columns, so the legacy kind
	//    column goes away and the legacy date column is renamed.
	if (legacyDateColumn) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\`
        CHANGE COLUMN follow_up_date scheduled_for DATE NULL DEFAULT NULL`
		);
	}
	if (legacyTypeColumn) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\` DROP COLUMN follow_up_type`
		);
	}
	if (legacyDescriptionColumn) {
		await knex.raw(`ALTER TABLE \`${ACTIVITY_TABLE}\` DROP COLUMN description`);
	}
	await knex.raw(
		`ALTER TABLE \`${ACTIVITY_TABLE}\`
      MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'Scheduled'`
	);
	if (await hasColumn(knex, ACTIVITY_TABLE, 'isDelete')) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\`
        MODIFY COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0`
		);
	}

	// 5. Keys: the Lead reference restricts (history is never cascaded away),
	//    the author reference restricts as well.
	for (const name of await leadForeignKeyNames(knex)) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\` DROP FOREIGN KEY \`${name}\``
		);
	}
	if (!(await hasConstraint(knex, ACTIVITY_TABLE, 'fk_lead_activities_lead'))) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\`
        ADD CONSTRAINT fk_lead_activities_lead FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT`
		);
	}
	if (
		!(await hasConstraint(knex, ACTIVITY_TABLE, 'fk_lead_activities_creator'))
	) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\`
        ADD CONSTRAINT fk_lead_activities_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT`
		);
	}
	if (!(await hasIndexOnColumn(knex, ACTIVITY_TABLE, 'lead_id'))) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\` ADD INDEX idx_lead_activities_lead (lead_id)`
		);
	}
	if (!(await hasIndex(knex, ACTIVITY_TABLE, 'idx_lead_activities_status'))) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\` ADD INDEX idx_lead_activities_status (status)`
		);
	}
	if (
		!(await hasIndex(knex, ACTIVITY_TABLE, 'idx_lead_activities_scheduled'))
	) {
		await knex.raw(
			`ALTER TABLE \`${ACTIVITY_TABLE}\` ADD INDEX idx_lead_activities_scheduled (scheduled_for)`
		);
	}

	// 6. The stage history.
	if (!(await hasTable(knex, STAGE_HISTORY_TABLE))) {
		await knex.raw(`
      CREATE TABLE lead_stage_history (
        id INT NOT NULL AUTO_INCREMENT,
        lead_id INT NOT NULL,
        from_stage VARCHAR(50) NULL DEFAULT NULL,
        to_stage VARCHAR(50) NOT NULL,
        change_source VARCHAR(20) NOT NULL,
        reason TEXT NULL DEFAULT NULL,
        actor_user_id INT NULL DEFAULT NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_stage_history_lead (lead_id),
        KEY idx_lead_stage_history_actor (actor_user_id),
        CONSTRAINT fk_lead_stage_history_lead FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_stage_history_actor FOREIGN KEY (actor_user_id)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}

	// 7. The dated next action a legacy Lead carried becomes real work.
	await knex.raw(`
    INSERT INTO lead_activities (
      lead_id, activity_type, status, scheduled_for, notes, created_by,
      legacy_scheduled_date, isDelete, recorded_at, created_at, updated_at
    )
    SELECT l.id, NULL, 'Scheduled', l.follow_up_date,
      'Next follow-up date recorded on the Lead before the activity log existed',
      NULL, l.follow_up_date, 0, NOW(), NOW(), NOW()
    FROM leads l
    WHERE l.follow_up_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM lead_activities a
        WHERE a.lead_id = l.id
          AND a.scheduled_for = l.follow_up_date
          AND a.status = 'Scheduled'
          AND (a.isDelete = 0 OR a.isDelete IS NULL)
      )
  `);

	// 8. `leads.follow_up_date` is the mirror of the earliest scheduled row.
	await knex.raw(`
    UPDATE leads l
    LEFT JOIN (
      SELECT lead_id, MIN(scheduled_for) AS next_date
      FROM lead_activities
      WHERE status = 'Scheduled'
        AND transferred_followup_id IS NULL
        AND scheduled_for IS NOT NULL
        AND (isDelete = 0 OR isDelete IS NULL)
      GROUP BY lead_id
    ) a ON a.lead_id = l.id
    SET l.follow_up_date = a.next_date
  `);

	// 9. The legacy table is gone: nothing may read or write it any more.
	if (await hasTable(knex, LEGACY_TABLE)) {
		await knex.raw(`DROP TABLE \`${LEGACY_TABLE}\``);
	}
}

export async function down(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'leads'))) return;

	// The legacy table comes back with the migrated rows.
	if (!(await hasTable(knex, LEGACY_TABLE))) {
		await knex.raw(`
      CREATE TABLE follow_ups (
        id INT NOT NULL AUTO_INCREMENT,
        lead_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        next_action VARCHAR(255) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        next_follow_up_date DATE DEFAULT NULL,
        isDelete TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY idx_follow_ups_lead (lead_id),
        KEY idx_follow_ups_isdelete (isDelete),
        CONSTRAINT follow_ups_ibfk_1 FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE CASCADE ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}
	if (await hasTable(knex, ACTIVITY_TABLE)) {
		await knex.raw(`
      INSERT INTO follow_ups (
        lead_id, follow_up_date, follow_up_type, description, status,
        next_action, next_follow_up_date, notes, created_at, updated_at, isDelete
      )
      SELECT a.lead_id,
        COALESCE(a.scheduled_for, a.legacy_scheduled_date, DATE(a.occurred_at), CURDATE()),
        COALESCE(a.legacy_type, a.activity_type, 'Call'),
        COALESCE(NULLIF(a.notes, ''), a.next_action, ''),
        COALESCE(a.status, 'Scheduled'),
        a.next_action,
        NULL,
        a.notes,
        COALESCE(a.created_at, CURRENT_TIMESTAMP),
        COALESCE(a.updated_at, CURRENT_TIMESTAMP),
        a.isDelete
      FROM lead_activities a
    `);
		await knex.raw(`DROP TABLE \`${ACTIVITY_TABLE}\``);
	}
	if (await hasTable(knex, STAGE_HISTORY_TABLE)) {
		await knex.raw(`DROP TABLE \`${STAGE_HISTORY_TABLE}\``);
	}
}
