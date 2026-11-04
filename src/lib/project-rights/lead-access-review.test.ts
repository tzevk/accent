import { describe, expect, it } from 'vitest';
import {
	selectLeadAccessReviewUsers,
	type LeadAccessReviewProject,
	type LeadAccessReviewUser,
} from './lead-access-review';

const team = (role: string, email = 'person@example.com') => [
	{ id: 1, email, name: 'Person', role },
];

const projects: LeadAccessReviewProject[] = [
	{ project_team: team('Project Lead', 'lead@example.com') },
	{ project_team: team('project lead ', 'lead@example.com') },
	{ project_team: team('Project Lead', 'mixed@example.com') },
	{ project_team: team('Team Member', 'mixed@example.com') },
	{ project_team: team('Team Member', 'member@example.com') },
	{ project_team: team('Project Manager', 'legacy@example.com') },
	{ project_team: team('Project Lead', 'legacy@example.com') },
	{ project_team: team('Project Lead', 'lead@example.com') },
];

function user(overrides: Partial<LeadAccessReviewUser>): LeadAccessReviewUser {
	return {
		id: 1,
		full_name: 'Person',
		email: 'person@example.com',
		role_name: 'Employee',
		permissions: ['projects:update'],
		...overrides,
	};
}

describe('lead access review selection', () => {
	it('lists a user holding update while every relationship is a lead', () => {
		const rows = selectLeadAccessReviewUsers(
			[user({ id: 7, email: 'lead@example.com', full_name: 'Lead User' })],
			projects
		);

		expect(rows).toEqual([
			{
				user_id: 7,
				full_name: 'Lead User',
				email: 'lead@example.com',
				role_name: 'Employee',
				project_count: 3,
				led_project_count: 3,
			},
		]);
	});

	it('does not list users without an update grant', () => {
		const rows = selectLeadAccessReviewUsers(
			[
				user({
					id: 7,
					email: 'lead@example.com',
					permissions: ['projects:read'],
					merged_permissions: ['projects:read'],
					role_permissions: [],
				}),
			],
			projects
		);
		expect(rows).toEqual([]);
	});

	it('does not list users with any ordinary membership', () => {
		const rows = selectLeadAccessReviewUsers(
			[user({ id: 3, email: 'mixed@example.com' })],
			projects
		);
		expect(rows).toEqual([]);
	});

	it('does not list users with no project relationship', () => {
		const rows = selectLeadAccessReviewUsers(
			[user({ id: 99, email: 'nobody@example.com' })],
			projects
		);
		expect(rows).toEqual([]);
	});

	it('reads a legacy role as ordinary membership, never lead', () => {
		const rows = selectLeadAccessReviewUsers(
			[user({ id: 4, email: 'legacy@example.com' })],
			projects
		);
		// One lead project plus one legacy-role project: not every
		// relationship is a lead, so the user is not listed.
		expect(rows).toEqual([]);
	});

	it('recognises grants from role and merged permissions too', () => {
		const rows = selectLeadAccessReviewUsers(
			[
				user({
					id: 7,
					email: 'lead@example.com',
					permissions: [],
					role_permissions: ['projects:update'],
				}),
			],
			projects
		);
		expect(rows).toHaveLength(1);
	});

	it('excludes super admins from the review list', () => {
		const rows = selectLeadAccessReviewUsers(
			[
				user({
					id: 7,
					email: 'lead@example.com',
					is_super_admin: 1,
					permissions: [],
				}),
			],
			projects
		);
		expect(rows).toEqual([]);
	});
});
