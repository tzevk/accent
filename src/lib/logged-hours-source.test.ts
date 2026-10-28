import { describe, expect, it } from 'vitest';
import { resolveLoggedHoursEmployeeId } from '@/lib/logged-hours-source';

describe('resolveLoggedHoursEmployeeId', () => {
	it('preserves the Employee recorded on a historical assignment over the current account link', () => {
		expect(
			resolveLoggedHoursEmployeeId({ employee_id: 11, user_employee_id: 22 })
		).toBe(11);
	});

	it('retains explicit historical attribution when the linked account is unavailable', () => {
		expect(
			resolveLoggedHoursEmployeeId({
				employee_id: 11,
				user_employee_id: null,
			})
		).toBe(11);
	});

	it('uses only the linked account Employee id when the assignment has no recorded Employee', () => {
		expect(
			resolveLoggedHoursEmployeeId({
				employee_id: null,
				user_employee_id: 22,
			})
		).toBe(22);
	});

	it('ignores matching contact and display identifiers when the assignment is unlinked', () => {
		const unlinkedRow = {
			employee_id: null,
			user_employee_id: null,
			user_email: 'employee@example.test',
			user_username: 'alex',
			employee_name: 'Alex Smith',
		};

		expect(
			resolveLoggedHoursEmployeeId(
				unlinkedRow as unknown as Parameters<
					typeof resolveLoggedHoursEmployeeId
				>[0]
			)
		).toBe(0);
	});

	it('keeps the canonical linked Employee despite a different login email', () => {
		const linkedRow = {
			employee_id: null,
			user_employee_id: 22,
			user_email: 'someone-else@example.test',
		};

		expect(
			resolveLoggedHoursEmployeeId(
				linkedRow as unknown as Parameters<
					typeof resolveLoggedHoursEmployeeId
				>[0]
			)
		).toBe(22);
	});
});
