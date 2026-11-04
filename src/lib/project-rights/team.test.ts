import { describe, expect, it } from 'vitest';
import {
	addProjectTeamMember,
	removeProjectTeamMember,
	updateProjectTeamMemberRole,
	type TeamOperationOptions,
} from './team';

const TEAM = [
	{
		id: 42,
		employee_id: 'E42',
		name: 'Member',
		email: 'member@example.com',
		department: 'Engineering',
		role: 'Team Member',
	},
	{
		id: 43,
		employee_id: 'E43',
		name: 'Lead',
		email: 'lead@example.com',
		position: 'Project Manager',
		role: 'Project Lead',
	},
];

const NO_LEAD_AUTHORITY: TeamOperationOptions = {
	canChangeLeadDesignation: false,
};
const LEAD_AUTHORITY: TeamOperationOptions = {
	canChangeLeadDesignation: true,
};

const NEW_MEMBER = {
	id: 44,
	employee_id: 'E44',
	name: 'Newcomer',
	email: 'newcomer@example.com',
	department: 'Design',
	role: 'Engineer',
};

describe('addProjectTeamMember', () => {
	it('adds one canonical member and preserves every stored member', () => {
		const result = addProjectTeamMember(
			JSON.stringify(TEAM),
			{ ...NEW_MEMBER, role: 'engineer' },
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team).toHaveLength(3);
		expect(result.team[0]).toEqual(TEAM[0]);
		expect(result.team[1]).toEqual(TEAM[1]);
		expect(result.team[2]).toMatchObject({
			id: 44,
			email: 'newcomer@example.com',
			role: 'Engineer',
		});
	});

	it('defaults a missing role to ordinary membership', () => {
		const result = addProjectTeamMember(
			[],
			{ ...NEW_MEMBER, role: undefined },
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team[0].role).toBe('Team Member');
	});

	it('refuses a member already in the team, matching email case-insensitively', () => {
		const result = addProjectTeamMember(
			TEAM,
			{ id: 99, email: 'MEMBER@example.com', name: 'Duplicate' },
			LEAD_AUTHORITY
		);

		expect(result).toEqual({
			ok: false,
			code: 'MEMBER_ALREADY_IN_TEAM',
			error: expect.any(String),
		});
	});

	it.each([{}, { name: 'No identity' }, 42, null])(
		'refuses an unusable member identity: %j',
		(member) => {
			const result = addProjectTeamMember(TEAM, member, LEAD_AUTHORITY);

			expect(result).toMatchObject({ ok: false, code: 'INVALID_MEMBER' });
		}
	);

	it('refuses a role the team UI cannot produce', () => {
		const result = addProjectTeamMember(
			TEAM,
			{ ...NEW_MEMBER, role: 'Project Manager' },
			LEAD_AUTHORITY
		);

		expect(result).toMatchObject({ ok: false, code: 'INVALID_ROLE' });
	});

	it('refuses a new lead without lead authority', () => {
		const result = addProjectTeamMember(
			TEAM,
			{ ...NEW_MEMBER, role: 'Project Lead' },
			NO_LEAD_AUTHORITY
		);

		expect(result).toMatchObject({
			ok: false,
			code: 'LEAD_CHANGE_NOT_ALLOWED',
		});
	});

	it('adds a new lead when the actor may change the designation', () => {
		const result = addProjectTeamMember(
			TEAM,
			{ ...NEW_MEMBER, role: 'Project Lead' },
			LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team[2].role).toBe('Project Lead');
	});

	it('treats a malformed stored list as empty', () => {
		const result = addProjectTeamMember(
			'not json',
			NEW_MEMBER,
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team).toHaveLength(1);
	});
});

describe('removeProjectTeamMember', () => {
	it('removes only the requested ordinary member', () => {
		const result = removeProjectTeamMember(
			TEAM,
			42,
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team).toEqual([TEAM[1]]);
		expect(result.member).toEqual(TEAM[0]);
	});

	it('matches the member by stored user_id without touching others', () => {
		const team = [
			{ user_id: 42, email: 'member@example.com', role: 'Team Member' },
			{ user_id: 43, email: 'lead@example.com', role: 'Project Lead' },
		];
		const result = removeProjectTeamMember(
			JSON.stringify(team),
			'42',
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team).toEqual([team[1]]);
	});

	it('refuses a member who is not in the team', () => {
		const result = removeProjectTeamMember(
			TEAM,
			99,
			LEAD_AUTHORITY
		);

		expect(result).toMatchObject({ ok: false, code: 'MEMBER_NOT_IN_TEAM' });
	});

	it('refuses a missing member id', () => {
		const result = removeProjectTeamMember(
			TEAM,
			'  ',
			LEAD_AUTHORITY
		);

		expect(result).toMatchObject({ ok: false, code: 'INVALID_MEMBER' });
	});

	it('refuses removing a lead without lead authority', () => {
		const result = removeProjectTeamMember(
			TEAM,
			43,
			NO_LEAD_AUTHORITY
		);

		expect(result).toMatchObject({
			ok: false,
			code: 'LEAD_CHANGE_NOT_ALLOWED',
		});
	});

	it('removes a lead when the actor may change the designation', () => {
		const result = removeProjectTeamMember(TEAM, 43, LEAD_AUTHORITY);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team).toEqual([TEAM[0]]);
	});
});

describe('updateProjectTeamMemberRole', () => {
	it('changes one ordinary role and preserves the member and everyone else', () => {
		const result = updateProjectTeamMemberRole(
			TEAM,
			42,
			'Designer',
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team).toHaveLength(2);
		expect(result.team[0]).toEqual({ ...TEAM[0], role: 'Designer' });
		expect(result.team[1]).toEqual(TEAM[1]);
	});

	it('canonicalizes the requested role casing', () => {
		const result = updateProjectTeamMemberRole(
			TEAM,
			42,
			'qa/qc',
			NO_LEAD_AUTHORITY
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.team[0].role).toBe('QA/QC');
	});

	it('refuses a member who is not in the team', () => {
		const result = updateProjectTeamMemberRole(
			TEAM,
			99,
			'Engineer',
			LEAD_AUTHORITY
		);

		expect(result).toMatchObject({ ok: false, code: 'MEMBER_NOT_IN_TEAM' });
	});

	it('refuses an invalid role and an unusable member id', () => {
		expect(
			updateProjectTeamMemberRole(TEAM, 42, 'manager', LEAD_AUTHORITY)
		).toMatchObject({ ok: false, code: 'INVALID_ROLE' });

		expect(
			updateProjectTeamMemberRole(TEAM, '', 'Engineer', LEAD_AUTHORITY)
		).toMatchObject({ ok: false, code: 'INVALID_MEMBER' });
	});

	it('refuses promoting a member to lead without lead authority', () => {
		const result = updateProjectTeamMemberRole(
			TEAM,
			42,
			'Project Lead',
			NO_LEAD_AUTHORITY
		);

		expect(result).toMatchObject({
			ok: false,
			code: 'LEAD_CHANGE_NOT_ALLOWED',
		});
	});

	it('refuses demoting the current lead without lead authority', () => {
		const result = updateProjectTeamMemberRole(
			TEAM,
			43,
			'Team Member',
			NO_LEAD_AUTHORITY
		);

		expect(result).toMatchObject({
			ok: false,
			code: 'LEAD_CHANGE_NOT_ALLOWED',
		});
	});

	it('changes the lead designation when the actor has lead authority', () => {
		const promoted = updateProjectTeamMemberRole(
			TEAM,
			42,
			'Project Lead',
			LEAD_AUTHORITY
		);
		const demoted = updateProjectTeamMemberRole(
			TEAM,
			43,
			'Coordinator',
			LEAD_AUTHORITY
		);

		expect(promoted.ok).toBe(true);
		expect(demoted.ok).toBe(true);
		if (!promoted.ok || !demoted.ok) return;
		expect(promoted.team[0].role).toBe('Project Lead');
		expect(demoted.team[1].role).toBe('Coordinator');
	});
});
