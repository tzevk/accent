/**
 * Canonical project-team role vocabulary.
 *
 * The team UI can only produce the roles below. Stored values that fall
 * outside this list are legacy data: they must be read as ordinary
 * membership, never as lead authority.
 */

export const PROJECT_TEAM_ROLES = [
	'Team Member',
	'Project Lead',
	'Designer',
	'Engineer',
	'Drafter',
	'Coordinator',
	'QA/QC',
	'Site Supervisor',
] as const;

export type ProjectTeamRole = (typeof PROJECT_TEAM_ROLES)[number];

/** The only role that grants lead authority. */
export const PROJECT_LEAD_ROLE: ProjectTeamRole = 'Project Lead';

/** Ordinary membership, and the destination for every legacy value. */
export const DEFAULT_PROJECT_TEAM_ROLE: ProjectTeamRole = 'Team Member';

const CANONICAL_BY_NORMALIZED = new Map<string, ProjectTeamRole>(
	PROJECT_TEAM_ROLES.map((role) => [role.toLowerCase(), role])
);

/**
 * Return the canonical role for a stored value.
 *
 * Matching is case-insensitive and ignores surrounding whitespace, so
 * `project lead` round-trips to `Project Lead`. Any unknown or legacy value,
 * including `Project Manager`, becomes ordinary membership. Unknown values
 * never become a lead.
 */
export function normalizeProjectTeamRole(value: unknown): ProjectTeamRole {
	if (typeof value !== 'string') return DEFAULT_PROJECT_TEAM_ROLE;
	const canonical = CANONICAL_BY_NORMALIZED.get(value.trim().toLowerCase());
	return canonical ?? DEFAULT_PROJECT_TEAM_ROLE;
}
