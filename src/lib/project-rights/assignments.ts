/**
 * Activity-assignment membership rules.
 *
 * Work may be assigned only to people already on the project team. The team
 * list is the single membership source, so an assignment never grants
 * workspace access and never changes the team.
 */

import { getProjectTeamMembership } from '@/utils/project-access';

/** Distinguishable refusal code shared by every assignment write path. */
export const ASSIGNEE_NOT_PROJECT_MEMBER = 'ASSIGNEE_NOT_PROJECT_MEMBER';

export type AssignmentTarget = {
	userId: number | string;
	email?: string | null;
	name?: string | null;
};

function displayName(target: AssignmentTarget | null | undefined): string {
	const name = target?.name;
	return typeof name === 'string' && name.trim() ? name.trim() : 'This person';
}

/** The one refusal message: it names team membership as the prerequisite. */
export function assigneeNotMemberMessage(
	name?: string | null
): string {
	const label =
		typeof name === 'string' && name.trim() ? name.trim() : 'This person';
	return `Add ${label} to the Project Team before assigning this activity.`;
}

/** True when the target is already represented in the stored team list. */
export function isAssignmentTargetMember(
	projectTeam: unknown,
	target: AssignmentTarget
): boolean {
	return getProjectTeamMembership(
		projectTeam,
		target.userId,
		target.email ?? undefined
	).isMember;
}

/**
 * Every target that is not a current team member, in input order and without
 * duplicates. An empty list means every target may be assigned.
 */
export function findNonMemberTargets(
	projectTeam: unknown,
	targets: readonly AssignmentTarget[]
): AssignmentTarget[] {
	const seen = new Set<string>();
	const nonMembers: AssignmentTarget[] = [];

	for (const target of targets) {
		if (target.userId === null || target.userId === undefined) continue;
		const key = String(target.userId).trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		if (!isAssignmentTargetMember(projectTeam, target)) {
			nonMembers.push({ ...target, name: displayName(target) });
		}
	}

	return nonMembers;
}
