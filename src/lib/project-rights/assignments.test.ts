import { describe, expect, it } from 'vitest';
import {
	ASSIGNEE_NOT_PROJECT_MEMBER,
	assigneeNotMemberMessage,
	findNonMemberTargets,
	isAssignmentTargetMember,
} from './assignments';

const team = [
	{ user_id: 42, name: 'Mona Member', email: 'member@example.com' },
	{ id: 43, name: 'Lea Lead', email: 'lead@example.com', role: 'Project Lead' },
];

describe('activity assignment membership', () => {
	it('accepts a target matched by user id or email', () => {
		expect(isAssignmentTargetMember(team, { userId: 42 })).toBe(true);
		expect(
			isAssignmentTargetMember(team, {
				userId: 999,
				email: 'MEMBER@example.com',
			})
		).toBe(true);
	});

	it('rejects a target outside the stored team', () => {
		expect(isAssignmentTargetMember(team, { userId: 99 })).toBe(false);
		expect(isAssignmentTargetMember(null, { userId: 42 })).toBe(false);
	});

	it('lists only non-members, in order and without duplicates', () => {
		const nonMembers = findNonMemberTargets(team, [
			{ userId: 42 },
			{ userId: 99, name: 'Sam Stranger' },
			{ userId: 99, name: 'Sam Stranger' },
			{ userId: 7 },
		]);

		expect(nonMembers.map((target) => String(target.userId))).toEqual([
			'99',
			'7',
		]);
		expect(nonMembers[0].name).toBe('Sam Stranger');
	});

	it('names team membership as the missing prerequisite', () => {
		expect(assigneeNotMemberMessage('Sam Stranger')).toBe(
			'Add Sam Stranger to the Project Team before assigning this activity.'
		);
		expect(assigneeNotMemberMessage(null)).toBe(
			'Add This person to the Project Team before assigning this activity.'
		);
		expect(ASSIGNEE_NOT_PROJECT_MEMBER).toBe('ASSIGNEE_NOT_PROJECT_MEMBER');
	});
});
