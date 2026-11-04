import { describe, expect, it, vi } from 'vitest';
import {
	getProjectTeamMembership,
	hasUserProjectAssignment,
	isProjectLeadRole,
	isUserInProjectTeam,
} from '@/utils/project-access';

describe('project access helpers', () => {
	it('matches JSON team members by user_id and id', () => {
		expect(
			isUserInProjectTeam(JSON.stringify([{ user_id: 42 }, { id: '77' }]), 42)
		).toBe(true);
		expect(isUserInProjectTeam([{ id: '77' }], '77')).toBe(true);
	});

	it('matches team members by email without case sensitivity', () => {
		expect(
			isUserInProjectTeam(
				[{ email: 'Employee@example.com' }],
				12,
				' employee@EXAMPLE.com '
			)
		).toBe(true);
	});

	it('accepts assignment access across project identifiers', async () => {
		const execute = vi.fn().mockResolvedValue([[{ id: 1 }]]);
		const project = { id: 9, project_id: 'PRJ-42', project_code: 4200 };

		expect(await hasUserProjectAssignment({ execute }, project, 12)).toBe(true);
		const [sql, params] = execute.mock.calls[0];
		expect(sql).toContain('user_activity_assignments');
		expect(params).toEqual([12, '9', 'PRJ-42', '4200']);
	});

	it('does not treat an unrelated assignment as project membership', async () => {
		const execute = vi.fn().mockResolvedValue([[]]);

		expect(
			await hasUserProjectAssignment(
				{ execute },
				{ id: 9, project_id: 'PRJ-42', project_code: 4200 },
				12
			)
		).toBe(false);
	});

	it('resolves membership and lead identity from the same team list', () => {
		const team = [
			{ user_id: 42, role: 'Team Member' },
			{ email: 'lead@example.com', role: '  project LEAD ' },
		];

		expect(getProjectTeamMembership(team, 42)).toEqual({
			isMember: true,
			isLead: false,
			member: { user_id: 42, role: 'Team Member' },
		});
		expect(
			getProjectTeamMembership(team, 99, 'LEAD@example.com')
		).toMatchObject({
			isMember: true,
			isLead: true,
		});
		expect(getProjectTeamMembership(team, 7, 'other@example.com')).toEqual({
			isMember: false,
			isLead: false,
			member: null,
		});
	});

	it('treats only the exact Project Lead role as lead identity', () => {
		expect(isProjectLeadRole('Project Lead')).toBe(true);
		expect(isProjectLeadRole(' project lead ')).toBe(true);
		expect(isProjectLeadRole('Project Manager')).toBe(false);
		expect(isProjectLeadRole('Lead Designer')).toBe(false);
		expect(isProjectLeadRole(undefined)).toBe(false);
	});

	it('rejects malformed or unrelated team data', () => {
		expect(isUserInProjectTeam('{not-json}', 12, 'employee@example.com')).toBe(
			false
		);
		expect(
			isUserInProjectTeam(
				[{ user_id: 99, email: 'other@example.com' }],
				12,
				'employee@example.com'
			)
		).toBe(false);
	});
});
