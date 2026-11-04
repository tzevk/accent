/**
 * Pure project-team operations.
 *
 * A team change is one named operation over the stored `projects.project_team`
 * list: add a member, remove a member, or change one member's role. Each
 * operation reads membership through the shared identity layer, never rewrites
 * unrelated members, and refuses a lead designation change without lead
 * authority. The last-lead replacement rule is not part of this module.
 */

import {
	getProjectTeamMembership,
	parseProjectTeam,
	type ProjectTeamMember,
} from '@/utils/project-access';
import {
	DEFAULT_PROJECT_TEAM_ROLE,
	PROJECT_LEAD_ROLE,
	resolveProjectTeamRole,
	type ProjectTeamRole,
} from './team-roles';

export type TeamOperationErrorCode =
	| 'MEMBER_NOT_IN_TEAM'
	| 'MEMBER_ALREADY_IN_TEAM'
	| 'INVALID_ROLE'
	| 'INVALID_MEMBER'
	| 'LEAD_CHANGE_NOT_ALLOWED';

export type TeamOperationFailure = {
	ok: false;
	code: TeamOperationErrorCode;
	error: string;
};

export type TeamOperationSuccess = {
	ok: true;
	/** The full updated list; unaffected members keep their stored values. */
	team: ProjectTeamMember[];
	/** The member an operation added, removed, or changed. */
	member: ProjectTeamMember;
};

export type TeamOperationResult = TeamOperationSuccess | TeamOperationFailure;

export type TeamOperationOptions = {
	/** Lead designation authority resolved by the policy module. */
	canChangeLeadDesignation: boolean;
};

function failure(
	code: TeamOperationErrorCode,
	error: string
): TeamOperationFailure {
	return { ok: false, code, error };
}

/** A usable identity is a non-empty id or email after trimming. */
function usableIdentity(value: unknown): string {
	if (value === null || value === undefined) return '';
	const text = String(value).trim();
	return text && text !== 'undefined' && text !== 'null' ? text : '';
}

/**
 * Resolve the identity of a member record or a bare identifier. Add requests
 * carry the whole record; remove and role changes carry a member id.
 */
function resolveMemberIdentity(
	member: unknown
): { userId: string; email: string } | null {
	if (typeof member === 'number' || typeof member === 'string') {
		const userId = usableIdentity(member);
		return userId ? { userId, email: '' } : null;
	}
	if (!member || typeof member !== 'object' || Array.isArray(member)) {
		return null;
	}
	const record = member as ProjectTeamMember;
	const userId = usableIdentity(record.user_id ?? record.id);
	const email =
		typeof record.email === 'string' ? record.email.trim() : '';
	return userId || email ? { userId, email } : null;
}

/** Index of the single record the identity layer matches, or -1. */
function memberIndex(
	team: readonly ProjectTeamMember[],
	identity: { userId: string; email: string }
): number {
	return team.findIndex(
		(record) =>
			getProjectTeamMembership([record], identity.userId, identity.email)
				.isMember
	);
}

function resolveRoleInput(
	value: unknown,
	options: { allowDefault: boolean }
): ProjectTeamRole | null {
	if (value === undefined || value === null || value === '') {
		return options.allowDefault ? DEFAULT_PROJECT_TEAM_ROLE : null;
	}
	return resolveProjectTeamRole(value);
}

/**
 * Add one member to the stored team. The member is rejected when it is
 * already present, when its identity is unusable, when the role is not a
 * canonical team role, or when the new lead designation lacks authority.
 */
export function addProjectTeamMember(
	currentTeam: unknown,
	member: unknown,
	options: TeamOperationOptions
): TeamOperationResult {
	const identity = resolveMemberIdentity(member);
	if (!identity || typeof member !== 'object' || Array.isArray(member)) {
		return failure('INVALID_MEMBER', 'A valid team member is required');
	}

	const record = { ...(member as ProjectTeamMember) };
	const role = resolveRoleInput(record.role, { allowDefault: true });
	if (!role) {
		return failure('INVALID_ROLE', 'The selected project role is not valid');
	}

	const team = parseProjectTeam(currentTeam);
	if (
		getProjectTeamMembership(team, identity.userId, identity.email).isMember
	) {
		return failure(
			'MEMBER_ALREADY_IN_TEAM',
			'This user is already in the project team'
		);
	}

	if (role === PROJECT_LEAD_ROLE && !options.canChangeLeadDesignation) {
		return failure(
			'LEAD_CHANGE_NOT_ALLOWED',
			'You cannot change the project lead designation'
		);
	}

	const nextMember: ProjectTeamMember = { ...record, role };
	return { ok: true, team: [...team, nextMember], member: nextMember };
}

/**
 * Remove one member from the stored team. Removing a member who currently
 * holds the lead role is a lead designation change.
 */
export function removeProjectTeamMember(
	currentTeam: unknown,
	memberId: unknown,
	options: TeamOperationOptions
): TeamOperationResult {
	const identity = resolveMemberIdentity(memberId);
	if (!identity) {
		return failure('INVALID_MEMBER', 'A valid team member id is required');
	}

	const team = parseProjectTeam(currentTeam);
	const index = memberIndex(team, identity);
	if (index < 0) {
		return failure('MEMBER_NOT_IN_TEAM', 'This user is not in the project team');
	}

	const existing = team[index];
	if (
		resolveProjectTeamRole(existing.role) === PROJECT_LEAD_ROLE &&
		!options.canChangeLeadDesignation
	) {
		return failure(
			'LEAD_CHANGE_NOT_ALLOWED',
			'You cannot change the project lead designation'
		);
	}

	return {
		ok: true,
		team: team.filter((_, position) => position !== index),
		member: existing,
	};
}

/**
 * Change one member's role. Both entering and leaving the lead role are lead
 * designation changes; other role changes need only team authority.
 */
export function updateProjectTeamMemberRole(
	currentTeam: unknown,
	memberId: unknown,
	roleInput: unknown,
	options: TeamOperationOptions
): TeamOperationResult {
	const identity = resolveMemberIdentity(memberId);
	if (!identity) {
		return failure('INVALID_MEMBER', 'A valid team member id is required');
	}

	const role = resolveRoleInput(roleInput, { allowDefault: false });
	if (!role) {
		return failure('INVALID_ROLE', 'The selected project role is not valid');
	}

	const team = parseProjectTeam(currentTeam);
	const index = memberIndex(team, identity);
	if (index < 0) {
		return failure('MEMBER_NOT_IN_TEAM', 'This user is not in the project team');
	}

	const existing = team[index];
	const wasLead = resolveProjectTeamRole(existing.role) === PROJECT_LEAD_ROLE;
	const becomesLead = role === PROJECT_LEAD_ROLE;
	if (
		(wasLead || becomesLead) &&
		!options.canChangeLeadDesignation
	) {
		return failure(
			'LEAD_CHANGE_NOT_ALLOWED',
			'You cannot change the project lead designation'
		);
	}

	const updated: ProjectTeamMember = { ...existing, role };
	return {
		ok: true,
		team: team.map((member, position) =>
			position === index ? updated : member
		),
		member: updated,
	};
}
