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

export async function up(knex) {
	await knex.raw(`
		CREATE TABLE IF NOT EXISTS project_lead_policy (
			id TINYINT NOT NULL,
			sections JSON NOT NULL,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			updated_by INT NULL,
			PRIMARY KEY (id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	const [existing] = await knex.raw(
		'SELECT id FROM project_lead_policy WHERE id = 1 LIMIT 1'
	);
	if (Array.isArray(existing) && existing.length > 0) return;

	const sections = Object.fromEntries(
		WORK_SECTION_IDS.map((section) => [section, 'edit'])
	);

	await knex('project_lead_policy').insert({
		id: 1,
		sections: JSON.stringify(sections),
		updated_by: null,
	});
}

export async function down(knex) {
	// Drop-safe by design: the row is operator configuration, not business
	// data. Dropping the table makes `loadLeadPolicy` fall back to the
	// default every section editable policy, so a rollback never leaves
	// unreadable state behind. No per-project or per-user data is touched.
	await knex.raw('DROP TABLE IF EXISTS project_lead_policy');
}
