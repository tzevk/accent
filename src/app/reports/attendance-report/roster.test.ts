import { describe, it, expect } from 'vitest';
import {
	PAYROLL_EMPLOYEE_TYPE,
	selectPayrollRoster,
	type RosterEmployeeInput,
} from '@/app/reports/attendance-report/roster';

/**
 * The roster rule, in one line: live row + Active + Employee Type Payroll.
 * Everything below is a way that rule can be got wrong.
 */

/** Live active Payroll employee — the shape that must reach the report. */
const payroll = (
	id: number,
	employee_id: string,
	over: Partial<RosterEmployeeInput> = {}
): RosterEmployeeInput => ({
	id,
	employee_id,
	name: `Employee ${employee_id}`,
	department: null,
	smartoffice_code: null,
	employee_type: PAYROLL_EMPLOYEE_TYPE,
	status: 'active',
	isDelete: 0,
	...over,
});

/** The employee_id of every roster member, in report order. */
const codes = (employees: readonly { employee_id: string }[]) =>
	employees.map((e) => e.employee_id);

/** The bucket labels in disclosure order, NULL type last inside its reason. */
const bucketValues = (
	disclosure: { buckets: { value: string | null }[] } | null
) => (disclosure ? disclosure.buckets.map((b) => b.value) : []);

describe('selectPayrollRoster — the exact-inclusion rule', () => {
	it('keeps only live, active, Payroll employees', () => {
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { employee_type: 'Contract' }),
			payroll(3, 'EMP-003', { status: 'terminated' }),
			payroll(4, 'EMP-004', { status: 'inactive' }),
			payroll(5, 'EMP-005', { employee_type: null }),
			payroll(6, 'EMP-006', { isDelete: 1 }),
		]);

		expect(codes(roster)).toEqual(['EMP-001']);
		expect(roster[0]).toEqual({
			id: 1,
			employee_id: 'EMP-001',
			name: 'Employee EMP-001',
			department: null,
			smartoffice_code: null,
		});
		// Contract, terminated, inactive and NULL type are all dropped; the
		// soft-deleted row was never a candidate.
		expect(disclosure?.excluded_count).toBe(4);
		expect(disclosure?.excluded_type_count).toBe(2);
		expect(disclosure?.excluded_status_count).toBe(2);
	});

	it('includes a Payroll employee who has no salary profile row', () => {
		// The deliberate divergence from payroll: the report filters on the
		// Employee record, never on employee_salary_profile.
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001', { has_salary_profile: false }),
			payroll(2, 'EMP-002', { has_salary_profile: true }),
		]);

		expect(codes(roster)).toEqual(['EMP-001', 'EMP-002']);
		expect(disclosure).toBeNull();
	});

	it('matches employee_type exactly — lowercase "payroll" is not "Payroll"', () => {
		// employees.employee_type is an ENUM('Payroll','Contract','Deputation',
		// 'Permanent','Intern') storing the exact spelling; matching loosely
		// would invent a roster member the database cannot hold.
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001', { employee_type: 'payroll' }),
		]);

		expect(roster).toEqual([]);
		expect(disclosure?.excluded_type_count).toBe(1);
		expect(bucketValues(disclosure)).toEqual(['payroll']);
	});

	it('excludes Contract, Deputation, Permanent and Intern, each in its own bucket', () => {
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { employee_type: 'Contract' }),
			payroll(3, 'EMP-003', { employee_type: 'Deputation' }),
			payroll(4, 'EMP-004', { employee_type: 'Permanent' }),
			payroll(5, 'EMP-005', { employee_type: 'Intern' }),
		]);

		expect(codes(roster)).toEqual(['EMP-001']);
		expect(bucketValues(disclosure)).toEqual([
			'Contract',
			'Deputation',
			'Intern',
			'Permanent',
		]);
		expect(disclosure?.excluded_type_count).toBe(4);
		expect(disclosure?.excluded_status_count).toBe(0);
	});

	it('reports a NULL employee_type as its own bucket rather than dropping it', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001', { employee_type: null }),
			payroll(2, 'EMP-002', { employee_type: null }),
			payroll(3, 'EMP-003'),
		]);

		const nullBucket = disclosure?.buckets.find((b) => b.value === null);
		expect(nullBucket).toBeDefined();
		expect(nullBucket?.count).toBe(2);
		expect(nullBucket?.reason).toBe('not_payroll_type');
		expect(disclosure?.excluded_type_count).toBe(2);
		expect(disclosure?.excluded[0]).toMatchObject({
			employee_id: 'EMP-001',
			employee_type: null,
			reason: 'not_payroll_type',
		});
	});

	it('excludes a terminated Payroll employee under the terminated bucket', () => {
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { status: 'terminated' }),
		]);

		expect(codes(roster)).toEqual(['EMP-001']);
		expect(bucketValues(disclosure)).toEqual(['terminated']);
		expect(disclosure?.excluded_status_count).toBe(1);
		expect(disclosure?.excluded[0]).toMatchObject({
			employee_id: 'EMP-002',
			status: 'terminated',
			employee_type: 'Payroll',
			reason: 'terminated',
		});
	});

	it('excludes an inactive employee under the same bucket, labelled inactive', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001', { status: 'inactive' }),
		]);

		expect(bucketValues(disclosure)).toEqual(['inactive']);
		expect(disclosure?.excluded[0]).toMatchObject({
			employee_type: 'Payroll',
			status: 'inactive',
			reason: 'terminated',
		});
	});

	it('keeps a soft-deleted row off the roster and out of the disclosure', () => {
		// isDelete = 1 means the person is gone from the employee directory, so
		// counting them as an "excluded active employee" would be a lie.
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { isDelete: 1 }),
			payroll(3, 'EMP-003', { isDelete: 1, status: 'terminated' }),
		]);

		expect(codes(roster)).toEqual(['EMP-001']);
		expect(disclosure).toBeNull();
	});

	it('balances: roster + type-excluded + status-excluded = considered', () => {
		const { roster, disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { employee_type: 'Contract' }),
			payroll(3, 'EMP-003', { status: 'terminated' }),
			payroll(4, 'EMP-004', { employee_type: null }),
			payroll(5, 'EMP-005', { isDelete: 1 }),
		]);

		expect(disclosure).not.toBeNull();
		expect(
			roster.length +
				(disclosure?.excluded_type_count ?? 0) +
				(disclosure?.excluded_status_count ?? 0)
		).toBe(disclosure?.considered_count);
		expect(disclosure?.excluded_count).toBe(
			(disclosure?.excluded_type_count ?? 0) +
				(disclosure?.excluded_status_count ?? 0)
		);
	});
});

describe('selectPayrollRoster — disclosure shape', () => {
	it('stays silent on empty input', () => {
		expect(selectPayrollRoster([])).toEqual({ roster: [], disclosure: null });
	});

	it('stays silent when every active employee is Payroll', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002'),
		]);

		expect(disclosure).toBeNull();
	});

	it('reports a single excluded employee', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { employee_type: 'Contract' }),
		]);

		expect(disclosure?.excluded_count).toBe(1);
		expect(disclosure?.roster_count).toBe(1);
		expect(disclosure?.considered_count).toBe(2);
		expect(disclosure?.excluded).toHaveLength(1);
	});

	it('counts many, and names every one of them', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001'),
			payroll(2, 'EMP-002', { employee_type: 'Contract', name: 'Asha Rao' }),
			payroll(3, 'EMP-003', { employee_type: 'Intern', name: 'Bala Iyer' }),
			payroll(4, 'EMP-004', { status: 'terminated', name: "Cora D'Souza" }),
		]);

		expect(disclosure?.excluded_count).toBe(3);
		expect(disclosure?.excluded.map((e) => e.name)).toEqual([
			'Asha Rao',
			'Bala Iyer',
			"Cora D'Souza",
		]);
	});

	it('orders buckets by reason, then by the value that caused the drop', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-001', { status: 'terminated' }),
			payroll(2, 'EMP-002', { employee_type: 'Permanent' }),
			payroll(3, 'EMP-003', { employee_type: null }),
			payroll(4, 'EMP-004', { status: 'inactive' }),
			payroll(5, 'EMP-005', { employee_type: 'Contract' }),
		]);

		// not_payroll_type first (Contract, Permanent, then the NULL bucket),
		// then the non-active statuses alphabetically.
		expect(bucketValues(disclosure)).toEqual([
			'Contract',
			'Permanent',
			null,
			'inactive',
			'terminated',
		]);
	});
});

describe('selectPayrollRoster — ordering', () => {
	it('orders by employee code, breaking a shared prefix by number not by character', () => {
		const { roster } = selectPayrollRoster([
			payroll(1, 'EMP-100'),
			payroll(2, 'EMP-2'),
			payroll(3, 'EMP-10'),
			payroll(4, 'EMP-1'),
		]);

		expect(codes(roster)).toEqual(['EMP-1', 'EMP-2', 'EMP-10', 'EMP-100']);
	});

	it('breaks an equal code on the name, then on the id', () => {
		const { roster } = selectPayrollRoster([
			payroll(3, 'EMP-001', { name: 'Zoe' }),
			payroll(1, 'EMP-001', { name: 'Aditi' }),
			payroll(2, 'EMP-001', { name: 'Aditi' }),
		]);

		expect(roster.map((e) => [e.id, e.name])).toEqual([
			[1, 'Aditi'],
			[2, 'Aditi'],
			[3, 'Zoe'],
		]);
	});

	it('treats zero-padded and bare codes as the same number, then falls back to the id', () => {
		const { roster } = selectPayrollRoster([
			payroll(1, 'EMP-10', { name: 'Aditi' }),
			payroll(2, 'EMP-010', { name: 'Aditi' }),
		]);

		// The codes tie (10 === 010) and so do the names, so the id decides —
		// what matters is that the order never depends on the input's order.
		expect(codes(roster)).toEqual(['EMP-10', 'EMP-010']);
	});

	it('leaves the caller’s array untouched', () => {
		const input = [payroll(2, 'EMP-002'), payroll(1, 'EMP-001')];
		const before = input.map((e) => e.employee_id);

		selectPayrollRoster(input);

		expect(input.map((e) => e.employee_id)).toEqual(before);
	});

	it('orders the excluded identities the same way as the roster', () => {
		const { disclosure } = selectPayrollRoster([
			payroll(1, 'EMP-010', { employee_type: 'Intern' }),
			payroll(2, 'EMP-2', { employee_type: 'Intern' }),
		]);

		expect(disclosure?.excluded.map((e) => e.employee_id)).toEqual([
			'EMP-2',
			'EMP-010',
		]);
	});
});
