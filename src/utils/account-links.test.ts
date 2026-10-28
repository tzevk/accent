import { describe, expect, it } from 'vitest';
import {
	isAccountLinkConflict,
	ownershipChangeRequested,
	resolveAccessState,
} from './account-links';

describe('account ownership and access rules', () => {
	it('rejects changed ownership but permits unchanged values', () => {
		expect(
			ownershipChangeRequested({ employee_id: '12' }, { employee_id: 12 })
		).toBe(false);
		expect(
			ownershipChangeRequested({ employee_id: null }, { employee_id: 12 })
		).toBe(true);
		expect(
			ownershipChangeRequested(
				{ account_type: 'vendor' },
				{ account_type: 'employee' }
			)
		).toBe(true);
	});
	it('treats malformed requested IDs as ownership changes, not null links', () => {
		expect(
			ownershipChangeRequested({ employee_id: 1.1 }, { employee_id: null })
		).toBe(true);
		expect(
			ownershipChangeRequested({ vendor_id: '1.5' }, { vendor_id: null })
		).toBe(true);
		expect(
			ownershipChangeRequested({ employee_id: '12' }, { employee_id: 12 })
		).toBe(false);
		expect(
			ownershipChangeRequested({ employee_id: '' }, { employee_id: null })
		).toBe(false);
	});
	it('rejects changed ownership fields, including null and account type changes', () => {
		expect(
			ownershipChangeRequested({ employee_id: null }, { employee_id: 12 })
		).toBe(true);
		expect(ownershipChangeRequested({ vendor_id: '' }, { vendor_id: 7 })).toBe(
			true
		);
		expect(
			ownershipChangeRequested(
				{ account_type: 'vendor' },
				{ account_type: 'employee' }
			)
		).toBe(true);
	});

	it('normalizes a single supplied access flag and rejects contradictory flags', () => {
		expect(resolveAccessState({ status: 'inactive' })).toEqual({
			status: 'inactive',
			is_active: 0,
		});
		expect(resolveAccessState({ is_active: true })).toEqual({
			status: 'active',
			is_active: 1,
		});
		expect(resolveAccessState({ is_active: false })).toEqual({
			status: 'inactive',
			is_active: 0,
		});
		expect(resolveAccessState({ is_active: 1 })).toEqual({
			status: 'active',
			is_active: 1,
		});
		expect(resolveAccessState({ is_active: 0 })).toEqual({
			status: 'inactive',
			is_active: 0,
		});
		expect(resolveAccessState({ status: 'ACTIVE' })).toEqual({
			status: 'active',
			is_active: 1,
		});
		expect(
			resolveAccessState({ status: 'active', is_active: false })
		).toBeNull();
	});

	it('rejects malformed access flags rather than coercing them', () => {
		for (const status of [
			null,
			['active'],
			{ value: 'active' },
			true,
			1,
			'enabled',
		]) {
			expect(resolveAccessState({ status })).toBeNull();
		}
		for (const is_active of [null, {}, [], 'true', 'false', 2, -1]) {
			expect(resolveAccessState({ is_active })).toBeNull();
		}
	});

	it('recognizes database ownership conflicts', () => {
		expect(isAccountLinkConflict({ code: 'ER_DUP_ENTRY' })).toBe(true);
		expect(isAccountLinkConflict({ errno: 1452 })).toBe(true);
		expect(isAccountLinkConflict(new Error('other'))).toBe(false);
	});
});
