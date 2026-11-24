import type { RowDataPacket } from 'mysql2/promise';

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

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

const CANONICAL_BY_NORMALIZED = new Map<string, string>(
	CANONICAL_ROLES.map((role): [string, string] => [role.toLowerCase(), role])
);
const DEFAULT_ROLE = 'Team Member';

interface ProjectRow extends RowDataPacket {
	project_id?: number;
	id?: number;
	project_team: unknown;
}

function normalizeRole(value: unknown): string {
	if (typeof value !== 'string') return DEFAULT_ROLE;
	return (
		CANONICAL_BY_NORMALIZED.get(value.trim().toLowerCase()) ?? DEFAULT_ROLE
	);
}

/** Parse the stored team JSON. A malformed value is left untouched. */
function parseProjectTeam(raw: unknown): unknown[] | null {
	if (raw === null || raw === undefined) return null;
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	return Array.isArray(parsed) ? parsed : null;
}

function normalizeProjectTeam(
	raw: unknown
):
	| { changed: false; project_team: null }
	| { changed: true; project_team: string } {
	const team = parseProjectTeam(raw);
	if (!team) return { changed: false, project_team: null };

	let changed = false;
	const next = team.map((member) => {
		if (!member || typeof member !== 'object' || Array.isArray(member)) {
			return member;
		}
		const record = member as Record<string, unknown>;
		if (typeof record.role !== 'string') return member;

		const role = normalizeRole(record.role);
		if (role === record.role) return member;

		changed = true;
		return { ...record, role };
	});

	if (!changed) return { changed: false, project_team: null };
	return { changed: true, project_team: JSON.stringify(next) };
}

async function hasColumn(db: MigrationDb, column: string): Promise<boolean> {
	const [rows] = await executeMigrationSql<RowDataPacket>(
		db,
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
		 LIMIT 1`,
		['projects', column]
	);
	return rows.length > 0;
}

export async function up(db: MigrationDb): Promise<void> {
	if (!(await hasColumn(db, 'project_team'))) return;

	// Baseline deployments key projects by `project_id`; the runtime
	// schema-init variant uses `id`.
	let identifier: 'project_id' | 'id' | null = null;
	if (await hasColumn(db, 'project_id')) identifier = 'project_id';
	else if (await hasColumn(db, 'id')) identifier = 'id';
	if (!identifier) return;

	const [rows] = await executeMigrationSql<ProjectRow>(
		db,
		identifier === 'project_id'
			? 'SELECT project_id, project_team FROM projects WHERE isDelete = ?'
			: 'SELECT id, project_team FROM projects WHERE isDelete = ?',
		[0]
	);

	for (const row of rows) {
		const normalized = normalizeProjectTeam(row.project_team);
		if (!normalized.changed) continue;

		if (identifier === 'project_id') {
			await executeMigrationSql(
				db,
				'UPDATE projects SET project_team = ? WHERE project_id = ?',
				[normalized.project_team, row.project_id]
			);
		} else {
			await executeMigrationSql(
				db,
				'UPDATE projects SET project_team = ? WHERE id = ?',
				[normalized.project_team, row.id]
			);
		}
	}
}
