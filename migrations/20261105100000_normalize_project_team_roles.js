/**
 * Normalise legacy project-team role values.
 *
 * The team interface can only produce the canonical roles below. Any stored
 * value outside that list (for example `Project Manager`) is data the UI
 * cannot express, so it is repaired to ordinary membership (`Team Member`).
 *
 * This is data repair only:
 * - the project_team member `role` is the sole field written;
 * - Employment designation, account role, and position are untouched;
 * - a legacy value never becomes `Project Lead`;
 * - rows whose roles are already canonical are not written, so running the
 *   migration again changes nothing.
 */

const CANONICAL_ROLES = [
	'Team Member',
	'Project Lead',
	'Designer',
	'Engineer',
	'Drafter',
	'Coordinator',
	'QA/QC',
	'Site Supervisor',
];

const CANONICAL_BY_NORMALIZED = new Map(
	CANONICAL_ROLES.map((role) => [role.toLowerCase(), role])
);
const DEFAULT_ROLE = 'Team Member';

function normalizeRole(value) {
	if (typeof value !== 'string') return DEFAULT_ROLE;
	return CANONICAL_BY_NORMALIZED.get(value.trim().toLowerCase()) ?? DEFAULT_ROLE;
}

/** Parse the stored team JSON. A malformed value is left untouched. */
function parseProjectTeam(raw) {
	if (raw === null || raw === undefined) return null;
	let parsed = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	return Array.isArray(parsed) ? parsed : null;
}

function normalizeProjectTeam(raw) {
	const team = parseProjectTeam(raw);
	if (!team) return { changed: false, project_team: null };

	let changed = false;
	const next = team.map((member) => {
		if (!member || typeof member !== 'object' || Array.isArray(member)) {
			return member;
		}
		if (typeof member.role !== 'string') return member;

		const role = normalizeRole(member.role);
		if (role === member.role) return member;

		changed = true;
		return { ...member, role };
	});

	if (!changed) return { changed: false, project_team: null };
	return { changed: true, project_team: JSON.stringify(next) };
}

async function hasColumn(knex, column) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
		 LIMIT 1`,
		['projects', column]
	);
	return Array.isArray(rows) && rows.length > 0;
}

export async function up(knex) {
	if (!(await hasColumn(knex, 'project_team'))) return;

	// Baseline deployments key projects by `project_id`; the runtime
	// schema-init variant uses `id`.
	let identifier = null;
	if (await hasColumn(knex, 'project_id')) identifier = 'project_id';
	else if (await hasColumn(knex, 'id')) identifier = 'id';
	if (!identifier) return;

	const rows = await knex('projects')
		.select(identifier, 'project_team')
		.where({ isDelete: 0 });

	for (const row of rows) {
		const normalized = normalizeProjectTeam(row.project_team);
		if (!normalized.changed) continue;

		await knex('projects')
			.where({ [identifier]: row[identifier] })
			.update({ project_team: normalized.project_team });
	}
}

export async function down() {
	// No-op: the repair must not be reversed. Restoring legacy values would
	// reintroduce roles the interface cannot produce.
}
