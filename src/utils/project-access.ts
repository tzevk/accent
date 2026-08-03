import type { PoolConnection } from 'mysql2/promise';

function normalizeText(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
	if (projectTeam === null || projectTeam === undefined) return false;

	let team: unknown = projectTeam;
	if (typeof projectTeam === 'string') {
		try {
			team = JSON.parse(projectTeam);
		} catch {
			return false;
		}
	}

	if (!Array.isArray(team)) return false;

	const normalizedUserId = String(userId).trim();
	const normalizedEmail = normalizeText(userEmail);

	return team.some((member) => {
		if (!member || typeof member !== 'object') return false;
		const record = member as Record<string, unknown>;
		const memberIds = [record.user_id, record.id]
			.filter((value) => value !== null && value !== undefined)
			.map((value) => String(value).trim());
		const memberEmail = normalizeText(record.email);

		return (
			memberIds.includes(normalizedUserId) ||
			(Boolean(normalizedEmail) && memberEmail === normalizedEmail)
		);
	});
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
