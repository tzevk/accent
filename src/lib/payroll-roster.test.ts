import { describe, it, expect } from 'vitest';
import {
	selectPayrollRoster,
	rosterWorkplaceClause,
	type RosterEmployeeInput,
} from '@/lib/payroll-roster';

/**
 * The roster's narrowing rules: one workplace, and nobody who has already
 * left. Pure inputs, no clock, no database.
 */

const TODAY = '2026-10-15';

function emp(
	overrides: Partial<RosterEmployeeInput> = {}
): RosterEmployeeInput {
	return {
		id: 1,
		employee_id: 'EMP-001',
		name: 'Test Person',
		employee_type: 'Payroll',
		status: 'active',
		isDelete: 0,
		...overrides,
	};
}

describe('selectPayrollRoster workplace filter', () => {
	it('keeps only the named workplace, ignoring case and space', () => {
		const { roster, disclosure } = selectPayrollRoster(
			[
				emp({ id: 1, employee_id: 'A', workplace: 'Mumbai' }),
				emp({ id: 2, employee_id: 'B', workplace: ' mumbai ' }),
				emp({ id: 3, employee_id: 'C', workplace: 'MUMBAI' }),
				emp({ id: 4, employee_id: 'D', workplace: 'Pune' }),
			],
			{ workplace: 'Mumbai' }
		);

		expect(roster.map((member) => member.employee_id)).toEqual(['A', 'B', 'C']);
		expect(disclosure?.excluded_count).toBe(1);
		expect(disclosure?.buckets).toEqual([
			{ reason: 'not_workplace', value: 'Pune', count: 1 },
		]);
	});

	it('excludes an employee with no workplace recorded, and says so', () => {
		const { roster, disclosure } = selectPayrollRoster(
			[
				emp({ id: 1, employee_id: 'A', workplace: 'Mumbai' }),
				emp({ id: 2, employee_id: 'B' }),
			],
			{ workplace: 'Mumbai' }
		);

		expect(roster).toHaveLength(1);
		expect(disclosure?.buckets).toEqual([
			{ reason: 'not_workplace', value: null, count: 1 },
		]);
		expect(disclosure?.excluded[0].reason).toBe('not_workplace');
	});

	it('names the Employee Type before the workplace', () => {
		// Someone who was never in scope must not be reported as being at the
		// wrong branch. Employee Type is the roster's own switch.
		const { disclosure } = selectPayrollRoster(
			[
				emp({ id: 1, employee_id: 'A', workplace: 'Mumbai' }),
				emp({
					id: 2,
					employee_id: 'B',
					employee_type: 'Permanent',
					workplace: 'Pune',
				}),
				emp({
					id: 3,
					employee_id: 'C',
					employee_type: null,
					workplace: 'Pune',
				}),
			],
			{ workplace: 'Mumbai' }
		);

		expect(disclosure?.buckets).toEqual([
			{ reason: 'not_payroll_type', value: 'Permanent', count: 1 },
			{ reason: 'not_payroll_type', value: null, count: 1 },
		]);
	});

	it('reports a Payroll employee at another branch as not_workplace', () => {
		const { disclosure } = selectPayrollRoster(
			[emp({ id: 1, employee_id: 'A', workplace: 'Pune' })],
			{ workplace: 'Mumbai' }
		);

		expect(disclosure?.buckets).toEqual([
			{ reason: 'not_workplace', value: 'Pune', count: 1 },
		]);
	});

	it('leaves every workplace in when no filter is set', () => {
		const { roster } = selectPayrollRoster([
			emp({ id: 1, employee_id: 'A', workplace: 'Mumbai' }),
			emp({ id: 2, employee_id: 'B', workplace: 'Pune' }),
			emp({ id: 3, employee_id: 'C' }),
		]);

		expect(roster).toHaveLength(3);
	});

	it('selects nobody when no employee holds the workplace', () => {
		const { roster, disclosure } = selectPayrollRoster(
			[emp({ id: 1, employee_id: 'A', workplace: 'Pune' })],
			{ workplace: 'Mumbai' }
		);

		expect(roster).toEqual([]);
		expect(disclosure?.roster_count).toBe(0);
		expect(disclosure?.excluded_count).toBe(1);
	});

	it('reports the bucket value the card renders', () => {
		const { disclosure } = selectPayrollRoster(
			[
				emp({ id: 1, employee_id: 'A', workplace: 'Mumbai' }),
				emp({ id: 2, employee_id: 'B', workplace: 'Pune' }),
				emp({ id: 3, employee_id: 'C', status: 'inactive', workplace: 'Pune' }),
			],
			{ workplace: 'Mumbai' }
		);

		// Status is named before workplace, so an inactive employee elsewhere
		// is reported as not Active rather than at another Workplace.
		expect(disclosure?.buckets).toEqual([
			{ reason: 'terminated', value: 'inactive', count: 1 },
			{ reason: 'not_workplace', value: 'Pune', count: 1 },
		]);
	});
});

describe('selectPayrollRoster exit date', () => {
	it('drops an employee whose exit date is on or before today', () => {
		const { roster, disclosure } = selectPayrollRoster(
			[
				emp({ id: 1, employee_id: 'A', exit_date: TODAY }),
				emp({ id: 2, employee_id: 'B', exit_date: '2026-05-31' }),
				emp({ id: 3, employee_id: 'C' }),
			],
			{ excludeExited: true, today: TODAY }
		);

		expect(roster.map((member) => member.employee_id)).toEqual(['C']);
		// Buckets sort by reason, then value ascending.
		expect(disclosure?.buckets).toEqual([
			{ reason: 'exited', value: '2026-05-31', count: 1 },
			{ reason: 'exited', value: TODAY, count: 1 },
		]);
	});

	it('keeps an employee whose exit date is still in the future', () => {
		const { roster } = selectPayrollRoster(
			[emp({ id: 1, employee_id: 'A', exit_date: '2026-12-31' })],
			{ excludeExited: true, today: TODAY }
		);

		expect(roster).toHaveLength(1);
	});

	it('keeps an exited employee when the rule is off', () => {
		const { roster } = selectPayrollRoster(
			[emp({ id: 1, employee_id: 'A', exit_date: '2026-05-31' })],
			{ today: TODAY }
		);

		expect(roster).toHaveLength(1);
	});

	it('is a no-op when the exit date is blank or absent', () => {
		const { roster } = selectPayrollRoster(
			[
				emp({ id: 1, employee_id: 'A', exit_date: null }),
				emp({ id: 2, employee_id: 'B', exit_date: '' }),
			],
			{ excludeExited: true, today: TODAY }
		);

		expect(roster).toHaveLength(2);
	});

	it('names the exit date on the excluded employee', () => {
		const { disclosure } = selectPayrollRoster(
			[emp({ id: 1, employee_id: 'A', exit_date: '2026-05-31' })],
			{ excludeExited: true, today: TODAY }
		);

		expect(disclosure?.excluded[0]).toMatchObject({
			reason: 'exited',
			value: '2026-05-31',
			status: 'active',
		});
	});
});

describe('rosterWorkplaceClause', () => {
	it('names the workplace the filter is scoped to', () => {
		expect(rosterWorkplaceClause('Mumbai')).toBe(', and Workplace is Mumbai');
	});

	it('is empty when no workplace is filtered on', () => {
		expect(rosterWorkplaceClause()).toBe('');
		expect(rosterWorkplaceClause('')).toBe('');
		expect(rosterWorkplaceClause('   ')).toBe('');
	});
});
