import { describe, it, expect } from 'vitest';
import { filterApprovers } from '@/utils/notifications';

describe('filterApprovers', () => {
	const candidate = (overrides = {}) => ({
		id: 5,
		is_super_admin: 0,
		role_permissions: [],
		user_permissions: [],
		...overrides,
	});

	it('includes super admins even without the leaves:approve key', () => {
		const ids = filterApprovers([candidate({ id: 1, is_super_admin: 1 })], 99);
		expect(ids).toEqual([1]);
	});

	it('includes approvers via role permissions', () => {
		const rows = [
			candidate({ id: 2, role_permissions: ['projects:read', 'leaves:approve'] }),
		];
		expect(filterApprovers(rows, 99)).toEqual([2]);
	});

	it('includes approvers via user-level permissions', () => {
		const rows = [candidate({ id: 3, user_permissions: ['leaves:approve'] })];
		expect(filterApprovers(rows, 99)).toEqual([3]);
	});

	it('excludes read-only holders and the applicant', () => {
		const rows = [
			candidate({ id: 4, user_permissions: ['leaves:read'] }),
			candidate({ id: 5, user_permissions: ['leaves:approve'] }),
			candidate({ id: 6, is_super_admin: 1 }),
		];
		// applicant is id 5 — excluded despite being an approver
		expect(filterApprovers(rows, 5)).toEqual([6]);
	});

	it('handles permissions stored as JSON strings', () => {
		const rows = [
			candidate({ id: 7, role_permissions: '["leaves:approve"]' }),
			candidate({ id: 8, user_permissions: '["leaves:read"]' }),
		];
		expect(filterApprovers(rows, 99)).toEqual([7]);
	});

	it('returns empty for no approvers', () => {
		expect(filterApprovers([candidate({ id: 9 })], 99)).toEqual([]);
	});
});
