/**
 * Pure project-team operations.
 *
 * A team change is one named operation over the stored `projects.project_team`
 * list: add a member, remove a member, or change one member's role. Each
 * operation reads membership through the shared identity layer, never rewrites
 * unrelated members, and refuses a lead designation change without lead
 * authority. Once a project has a lead, removing or demoting the final lead
 * requires either explicit clear authority or a named replacement who is a
 * different current member; the replacement is promoted in the same result.
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
	| 'LEAD_CHANGE_NOT_ALLOWED'
	| 'LAST_LEAD_REQUIRES_REPLACEMENT'
	| 'REPLACEMENT_NOT_IN_TEAM';

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
	/**
	 * Explicit authority to leave the project without any Project Lead.
	 * Lead-only authority must not set this.
	 */
	canClearFinalLead?: boolean;
	/**
	 * Member promoted to Project Lead when this operation would remove or
	 * demote the project's final lead.
	 */
	replacementLeadId?: unknown;
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

const LAST_LEAD_ERROR =
	'A project must keep at least one Project Lead. Name a replacement lead from the current team, or use team-management authority to clear the final lead.';
const REPLACEMENT_ERROR =
	'The replacement lead must be a different member of the current project team.';

function isLeadMember(member: ProjectTeamMember | undefined): boolean {
	return Boolean(
		member && resolveProjectTeamRole(member.role) === PROJECT_LEAD_ROLE
	);
}

/** True when both identities resolve to the same stored member. */
function sameMemberIdentity(
	left: { userId: string; email: string },
	right: { userId: string; email: string }
): boolean {
	if (left.userId && right.userId) {
		return left.userId === right.userId;
	}
	if (left.email && right.email) {
		return left.email.toLowerCase() === right.email.toLowerCase();
	}
	return false;
}

/**
 * Apply the last-lead rule to a proposed team.
 *
 * When the stored team has a lead and the proposed team would have none, the
 * operation is allowed only with explicit clear authority or with a named
 * replacement who is a different current member. The replacement is promoted
 * in the same result, so the project keeps exactly one intended lead.
 */
function settleFinalLead(
	teamBefore: readonly ProjectTeamMember[],
	teamAfter: ProjectTeamMember[],
	operatedIdentity: { userId: string; email: string },
	options: TeamOperationOptions
): { ok: true; team: ProjectTeamMember[] } | TeamOperationFailure {
	if (!teamBefore.some(isLeadMember) || teamAfter.some(isLeadMember)) {
		return { ok: true, team: teamAfter };
	}

	if (options.canClearFinalLead) {
		return { ok: true, team: teamAfter };
	}

	const replacementId = options.replacementLeadId;
	if (
		replacementId === undefined ||
		replacementId === null ||
		(typeof replacementId === 'string' && !replacementId.trim())
	) {
		return failure('LAST_LEAD_REQUIRES_REPLACEMENT', LAST_LEAD_ERROR);
	}

	const replacementIdentity = resolveMemberIdentity(replacementId);
	if (!replacementIdentity) {
		return failure('REPLACEMENT_NOT_IN_TEAM', REPLACEMENT_ERROR);
	}
	if (sameMemberIdentity(replacementIdentity, operatedIdentity)) {
		return failure('REPLACEMENT_NOT_IN_TEAM', REPLACEMENT_ERROR);
	}

	const replacementIndex = memberIndex(teamAfter, replacementIdentity);
	if (replacementIndex < 0) {
		return failure('REPLACEMENT_NOT_IN_TEAM', REPLACEMENT_ERROR);
	}

	return {
		ok: true,
		team: teamAfter.map((member, position) =>
			position === replacementIndex
				? { ...member, role: PROJECT_LEAD_ROLE }
				: member
		),
	};
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

	const settled = settleFinalLead(
		team,
		team.filter((_, position) => position !== index),
		identity,
		options
	);
	if (!settled.ok) return settled;

	return {
		ok: true,
		team: settled.team,
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
	const settled = settleFinalLead(
		team,
		team.map((member, position) => (position === index ? updated : member)),
		identity,
		options
	);
	if (!settled.ok) return settled;

	return {
		ok: true,
		team: settled.team,
		member: updated,
	};
}
