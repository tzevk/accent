import type { RowDataPacket } from 'mysql2/promise';

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Store the shared Project Lead policy.
 *
 * One row (id = 1) holds the section map that applies to every project:
 * each work section is `hidden`, `view`, or `edit` for every Project Lead.
 * There is no per-project or per-user column by design.
 *
 * The row starts at the approved policy — every work section editable — so
 * rollout does not narrow existing lead access. Running the migration again
 * never overwrites an operator's saved policy.
 */

const WORK_SECTION_IDS = [
	'project_details',
	'scope',
	'project_activity',
	'project_schedule',
	'project_team',
	'documents_received',
	'documents_issued',
	'minutes_internal_meet',
	'project_handover',
	'project_manhours',
	'software',
	'query_log',
	'assumption',
	'lessons_learnt',
	'discussion',
	'upload_documents',
];

interface PolicyRow extends RowDataPacket {
	id: number;
}

export async function up(db: MigrationDb): Promise<void> {
	await executeMigrationSql(
		db,
		`
		CREATE TABLE IF NOT EXISTS project_lead_policy (
			id TINYINT NOT NULL,
			sections JSON NOT NULL,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			updated_by INT NULL,
			PRIMARY KEY (id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`
	);

	const [existing] = await executeMigrationSql<PolicyRow>(
		db,
		'SELECT id FROM project_lead_policy WHERE id = 1 LIMIT 1'
	);
	if (existing.length > 0) return;

	const sections = Object.fromEntries(
		WORK_SECTION_IDS.map((section) => [section, 'edit'])
	);

	await executeMigrationSql(
		db,
		'INSERT INTO project_lead_policy (id, sections, updated_by) VALUES (?, ?, ?)',
		[1, JSON.stringify(sections), null]
	);
}
