/**
 * Read-only review of suspicious project update grants.
 *
 * A user appears when they hold a `projects:update` grant yet every project
 * relationship they have is a project they lead. That combination suggests
 * the grant was created only to give them lead access. This module selects
 * and shapes the list; it never changes a grant.
 */

import { getProjectTeamMembership } from '@/utils/project-access';
import { hasProjectAction, type PermissionCarrier } from './grants';

export type LeadAccessReviewUser = PermissionCarrier & {
	id?: number | string | null;
	user_id?: number | string | null;
	full_name?: string | null;
	email?: string | null;
	role_name?: string | null;
};

export type LeadAccessReviewProject = {
	project_team?: unknown;
};

export type LeadAccessReviewRow = {
	user_id: number | string;
	full_name: string | null;
	email: string | null;
	role_name: string | null;
	project_count: number;
	led_project_count: number;
};

function userIdentifier(user: LeadAccessReviewUser): number | string | null {
	const identifier = user.user_id ?? user.id;
	if (identifier === undefined || identifier === null || identifier === '') {
		return null;
	}
	return identifier;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Select users whose only project relationships are projects they lead while
 * they still hold a project update grant.
 *
 * - Every related project must resolve the user as its lead; one ordinary
 *   membership disqualifies the user.
 * - Users with no project relationship are not a lead-access concern.
 * - Super admins are excluded: their authority is not a grant to review.
 */
export function selectLeadAccessReviewUsers(
	users: readonly LeadAccessReviewUser[],
	projects: readonly LeadAccessReviewProject[]
): LeadAccessReviewRow[] {
	const rows: LeadAccessReviewRow[] = [];

	for (const user of users) {
		if (!user || user.is_super_admin) continue;
		if (!hasProjectAction(user, 'update')) continue;

		const identifier = userIdentifier(user);
		if (identifier === null) continue;

		let projectCount = 0;
		let ledProjectCount = 0;

		for (const project of projects) {
			const membership = getProjectTeamMembership(
				project?.project_team,
				identifier,
				user.email
			);
			if (!membership.isMember) continue;

			projectCount += 1;
			if (membership.isLead) ledProjectCount += 1;
		}

		if (projectCount === 0 || ledProjectCount !== projectCount) continue;

		rows.push({
			user_id: identifier,
			full_name: text(user.full_name),
			email: text(user.email),
			role_name: text(user.role_name),
			project_count: projectCount,
			led_project_count: ledProjectCount,
		});
	}

	return rows.sort((a, b) => {
		const byName = (a.full_name ?? '').localeCompare(b.full_name ?? '');
		if (byName !== 0) return byName;
		const byEmail = (a.email ?? '').localeCompare(b.email ?? '');
		if (byEmail !== 0) return byEmail;
		return String(a.user_id).localeCompare(String(b.user_id));
	});
}
