import { describe, it, expect } from 'vitest';
import {
	parseDailyEntries,
	sumMonthlyHours,
	monthLabel,
	resolveMonthlySalary,
	resolveHourlyRate,
	pickActiveProfile,
	buildBillingRows,
	buildTotals,
	type SalaryProfile,
} from '@/app/reports/manhours-billing/data-source';

function profile(overrides: Partial<SalaryProfile> = {}): SalaryProfile {
	return {
		employee_id: 1,
		gross: 0,
		gross_salary: 20000,
		employer_cost: 22000,
		hourly_rate: 0,
		daily_rate: 0,
		std_hours_per_day: 8,
		std_working_days: 26,
		salary_type: 'monthly',
		effective_from: '2026-01-01',
		effective_to: null,
		...overrides,
	};
}

describe('parseDailyEntries', () => {
	it('parses a JSON string array', () => {
		const entries = parseDailyEntries(
			'[{"date":"2026-04-13","hours":8},{"date":"2026-04-14","hours":9}]'
		);
		expect(entries).toHaveLength(2);
		expect(entries[0].hours).toBe(8);
	});

	it('accepts an already-parsed array', () => {
		const entries = parseDailyEntries([{ date: '2026-04-13', hours: 8 }]);
		expect(entries).toHaveLength(1);
	});

	it('drops non-object and date-less members', () => {
		const entries = parseDailyEntries(
			JSON.stringify([
				{ qty_done: 3 },
				null,
				'x',
				{ date: '2026-04-13', hours: 2 },
			])
		);
		expect(entries).toHaveLength(1);
		expect(entries[0].date).toBe('2026-04-13');
	});

	it('returns [] for null, empty, and invalid JSON', () => {
		expect(parseDailyEntries(null)).toEqual([]);
		expect(parseDailyEntries('')).toEqual([]);
		expect(parseDailyEntries('not json')).toEqual([]);
	});
});

describe('sumMonthlyHours', () => {
	it('sums hours for the month and ignores other months', () => {
		const raw = JSON.stringify([
			{ date: '2026-04-01', hours: 8 },
			{ date: '2026-04-15', hours: 9.5 },
			{ date: '2026-05-01', hours: 40 },
			{ date: '2026-04-20', hours: 0 },
		]);
		expect(sumMonthlyHours(raw, '2026-04')).toEqual({
			total_hours: 17.5,
			has_entries: true,
		});
	});

	it('returns zero when nothing was logged in the month', () => {
		expect(sumMonthlyHours('[]', '2026-04')).toEqual({
			total_hours: 0,
			has_entries: false,
		});
		expect(
			sumMonthlyHours(
				JSON.stringify([{ date: '2026-03-01', hours: 8 }]),
				'2026-04'
			)
		).toEqual({
			total_hours: 0,
			has_entries: false,
		});
	});
});

describe('monthLabel', () => {
	it('formats YYYY-MM into a readable label', () => {
		expect(monthLabel('2026-08')).toBe('August 2026');
	});

	it('returns the input for invalid months', () => {
		expect(monthLabel('garbage')).toBe('garbage');
		expect(monthLabel('2026-13')).toBe('2026-13');
	});
});

describe('resolveMonthlySalary', () => {
	it('prefers gross_salary over gross over employer_cost', () => {
		expect(resolveMonthlySalary(profile())).toBe(20000);
		expect(
			resolveMonthlySalary(
				profile({ gross_salary: 0, gross: 15000, employer_cost: 22000 })
			)
		).toBe(15000);
		expect(
			resolveMonthlySalary(
				profile({ gross_salary: 0, gross: 0, employer_cost: 22000 })
			)
		).toBe(22000);
	});
});

describe('resolveHourlyRate', () => {
	it('divides monthly gross by standard working days × hours per day', () => {
		// 20000 / (26 × 8) = 96.15
		expect(resolveHourlyRate(profile())).toBe(96.15);
	});

	it('uses the stored hourly rate for hourly salary types', () => {
		expect(
			resolveHourlyRate(profile({ salary_type: 'hourly', hourly_rate: 250 }))
		).toBe(250);
	});

	it('uses the stored daily rate for daily salary types', () => {
		expect(
			resolveHourlyRate(profile({ salary_type: 'daily', daily_rate: 800 }))
		).toBe(800);
	});

	it('uses the stored hourly rate for custom salary types', () => {
		expect(
			resolveHourlyRate(profile({ salary_type: 'custom', hourly_rate: 300 }))
		).toBe(300);
	});

	it('respects profile-level working days and hours per day', () => {
		expect(
			resolveHourlyRate(
				profile({
					std_working_days: 26,
					std_hours_per_day: 8,
					gross_salary: 20800,
				})
			)
		).toBe(100);
	});

	it('returns 0 when there is no gross salary', () => {
		expect(
			resolveHourlyRate(
				profile({ gross_salary: 0, gross: 0, employer_cost: 0 })
			)
		).toBe(0);
	});
});

describe('pickActiveProfile', () => {
	const older = profile({
		employee_id: 1,
		gross_salary: 18000,
		effective_from: '2025-01-01',
		effective_to: '2025-12-31',
	});
	const current = profile({
		employee_id: 1,
		gross_salary: 20000,
		effective_from: '2026-01-01',
		effective_to: null,
	});

	it('picks the profile whose effective range covers the month', () => {
		expect(pickActiveProfile([older, current], '2026-08')?.gross_salary).toBe(
			20000
		);
		expect(pickActiveProfile([older, current], '2025-06')?.gross_salary).toBe(
			18000
		);
	});

	it('falls back to the latest profile when none covers the month', () => {
		const late = profile({ gross_salary: 25000, effective_from: '2027-01-01' });
		expect(pickActiveProfile([older, late], '2026-08')?.gross_salary).toBe(
			25000
		);
	});

	it('returns null for an empty list', () => {
		expect(pickActiveProfile([], '2026-08')).toBeNull();
	});
});

describe('buildBillingRows', () => {
	const employees = new Map([
		[
			1,
			{
				employee_id: 1,
				employee_code: 'ATS0001',
				name: 'Alice',
				designation: 'Engineer',
			},
		],
		[
			2,
			{
				employee_id: 2,
				employee_code: 'ATS0002',
				name: 'Bob',
				designation: 'Designer',
			},
		],
		[
			3,
			{
				employee_id: 3,
				employee_code: 'ATS0003',
				name: 'Carol',
				designation: 'Director',
			},
		],
	]);
	const userToEmployee = new Map([
		[10, 1],
		[11, 2],
	]);
	const contactMap = new Map([['alice@accent.com', 1]]);
	const profiles = [
		profile({ employee_id: 1, gross_salary: 20000 }),
		profile({ employee_id: 2, gross_salary: 20800 }),
		profile({ employee_id: 3, gross_salary: 26000 }),
	];

	it('groups hours by employee and computes salary, rate, and amount', () => {
		const rows = buildBillingRows(
			[
				{
					id: 'a1',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([
						{ date: '2026-04-01', hours: 8 },
						{ date: '2026-04-02', hours: 8 },
					]),
				},
				{
					id: 'a2',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-03', hours: 4 }]),
				},
				{
					id: 'b1',
					user_id: 11,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 10 }]),
				},
			],
			employees,
			userToEmployee,
			contactMap,
			profiles,
			'2026-04'
		);
		expect(rows).toHaveLength(2);

		// Alice: 8 + 8 + 4 = 20h; rate = 20000 / 208 = 96.15; amount = 1923.08
		const alice = rows.find((r) => r.employee_name === 'Alice')!;
		expect(alice.total_manhours).toBe(20);
		expect(alice.hourly_rate_ctc).toBe(96.15);
		expect(alice.amount).toBe(1923.08);

		// Bob: 10h at 100/hr = 1000.00
		const bob = rows.find((r) => r.employee_name === 'Bob')!;
		expect(bob.total_manhours).toBe(10);
		expect(bob.amount).toBe(1000);
	});

	it('resolves employees via explicit employee_id, then user link, then contact match', () => {
		const rows = buildBillingRows(
			[
				// explicit employee_id (Carol, id 3)
				{
					id: 'c1',
					user_id: 99,
					employee_id: 3,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 6 }]),
				},
				// no employee_id, user has no employee link, but email matches Alice
				{
					id: 'a1',
					user_id: 99,
					employee_id: null,
					user_email: 'alice@accent.com',
					user_username: '',
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 6 }]),
				},
				// unresolvable → dropped
				{
					id: 'x1',
					user_id: 999,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 6 }]),
				},
			],
			employees,
			new Map<number, number>(),
			contactMap,
			profiles,
			'2026-04'
		);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.employee_name).sort()).toEqual(['Alice', 'Carol']);
	});

	it('drops employees with no hours in the month', () => {
		const rows = buildBillingRows(
			[
				{
					id: 'z1',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-03-01', hours: 8 }]),
				},
			],
			employees,
			userToEmployee,
			contactMap,
			profiles,
			'2026-04'
		);
		expect(rows).toHaveLength(0);
	});

	it('assigns sequential sr_no after sorting by name', () => {
		const rows = buildBillingRows(
			[
				{
					id: 'b1',
					user_id: 11,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 2 }]),
				},
				{
					id: 'a1',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 2 }]),
				},
			],
			employees,
			userToEmployee,
			contactMap,
			profiles,
			'2026-04'
		);
		expect(rows.map((r) => r.employee_name)).toEqual(['Alice', 'Bob']);
		expect(rows.map((r) => r.sr_no)).toEqual([1, 2]);
	});
});

describe('buildTotals', () => {
	it('sums manhours and amounts', () => {
		const totals = buildTotals([
			{
				sr_no: 1,
				employee_id: 1,
				employee_code: 'A',
				employee_name: 'A',
				designation: '',
				monthly_salary_ctc: 0,
				hourly_rate_ctc: 0,
				total_manhours: 20,
				amount: 1923.08,
			},
			{
				sr_no: 2,
				employee_id: 2,
				employee_code: 'B',
				employee_name: 'B',
				designation: '',
				monthly_salary_ctc: 0,
				hourly_rate_ctc: 0,
				total_manhours: 10,
				amount: 1000.0,
			},
		]);
		expect(totals).toEqual({ total_manhours: 30, total_amount: 2923.08 });
	});

	it('returns zeros for no rows', () => {
		expect(buildTotals([])).toEqual({ total_manhours: 0, total_amount: 0 });
	});
});
