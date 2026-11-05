import type { PoolConnection } from 'mysql2/promise';

function normalizeText(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** One stored member in a project's JSON team list. */
export type ProjectTeamMember = Record<string, unknown>;
type ProjectTeamRecord = ProjectTeamMember;

/**
 * Parse the stored JSON team list without trusting malformed data.
 * Exported so team mutations read the same records as membership checks.
 */
export function parseProjectTeam(
	projectTeam: unknown
): ProjectTeamRecord[] {
	if (projectTeam === null || projectTeam === undefined) return [];

	let team: unknown = projectTeam;
	if (typeof projectTeam === 'string') {
		try {
			team = JSON.parse(projectTeam);
		} catch {
			return [];
		}
	}

	if (!Array.isArray(team)) return [];
	return team.filter(
		(member): member is ProjectTeamRecord =>
			Boolean(member) && typeof member === 'object'
	);
}

/**
 * Lead identity is the team member's role value exactly `Project Lead`
 * after trimming and case folding. Designation, position, and account role
 * never establish lead authority.
 */
export function isProjectLeadRole(role: unknown): boolean {
	return normalizeText(role) === 'project lead';
}

/**
 * Resolve a user's relationship to one project from the stored team list.
 * Identity matching keeps the existing tolerance for user id, legacy id, and
 * email (case-insensitive).
 */
export function getProjectTeamMembership(
	projectTeam: unknown,
	userId: number | string,
	userEmail?: string | null
): {
	isMember: boolean;
	isLead: boolean;
	member: ProjectTeamRecord | null;
} {
	const normalizedUserId = String(userId ?? '').trim();
	const normalizedEmail = normalizeText(userEmail);

	const member =
		parseProjectTeam(projectTeam).find((record) => {
			const memberIds = [record.user_id, record.id]
				.filter((value) => value !== null && value !== undefined)
				.map((value) => String(value).trim());
			const memberEmail = normalizeText(record.email);

			return (
				(Boolean(normalizedUserId) && memberIds.includes(normalizedUserId)) ||
				(Boolean(normalizedEmail) && memberEmail === normalizedEmail)
			);
		}) ?? null;

	return {
		isMember: member !== null,
		isLead: member !== null && isProjectLeadRole(member.role),
		member,
	};
}

/**
 * Check whether a user is represented in a project's JSON team list.
 * The stored list has appeared with both user IDs and employee-like IDs,
 * so all supported identity fields are checked without trusting malformed data.
 */
export function isUserInProjectTeam(
	projectTeam: unknown,
	userId: number | string,
	userEmail?: string | null
): boolean {
	return getProjectTeamMembership(projectTeam, userId, userEmail).isMember;
}

/**
 * Check normalized activity assignments for any identifier belonging to the
 * resolved project row. Dashboard assignments use project_id, while other
 * project relations may use the numeric row id or project_code.
 */
export async function hasUserProjectAssignment(
	db: Pick<PoolConnection, 'execute'>,
	project: {
		id?: number | string;
		project_id?: number | string;
		project_code?: number | string;
	},
	userId: number | string
): Promise<boolean> {
	const projectIdentifiers = [
		project?.id,
		project?.project_id,
		project?.project_code,
	]
		.filter((value) => value !== null && value !== undefined)
		.map((value) => String(value).trim())
		.filter(Boolean);

	const uniqueIdentifiers = [...new Set(projectIdentifiers)];
	if (uniqueIdentifiers.length === 0) return false;

	const placeholders = uniqueIdentifiers.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`SELECT 1 FROM user_activity_assignments
         WHERE user_id = ? AND project_id IN (${placeholders})
         LIMIT 1`,
		[userId, ...uniqueIdentifiers]
	);

	return Array.isArray(rows) && rows.length > 0;
}
