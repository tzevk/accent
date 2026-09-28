import { describe, it, expect } from 'vitest';
import {
	STANDARD_WORKING_HOURS,
	HALF_DAY_HOURS,
	UNDER_UTILIZATION_THRESHOLD,
	OVER_UTILIZATION_THRESHOLD,
	resolveMonthlyCost,
	computeCtcHourlyRate,
	resolveCtcHourlyRate,
	sumLoggedHours,
	buildCapacity,
	utilizationPercent,
	bandForUtilization,
	buildTeamRow,
	buildUtilizationTotals,
	monthLabel,
} from '@/app/reports/employee-utilization/data-source';
import type { SalaryProfile } from '@/app/reports/manhours-billing/data-source';

// May 2026: 31 days. Sundays 3/10/17/24/31, Saturdays 2/9/16/23/30.
// Scheduled weekly offs: 5 Sundays + 2nd Sat (9th) + 4th Sat (23rd) = 7.
// Working days with no holidays: 24 → gross capacity 192h.
const MAY = '2026-05';

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
		tds_percentage: 10,
		effective_from: '2026-01-01',
		effective_to: null,
		...overrides,
	};
}

function entries(hoursByDate: Record<string, number>): string {
	return JSON.stringify(
		Object.entries(hoursByDate).map(([date, hours]) => ({ date, hours }))
	);
}

describe('constants', () => {
	it('pins the standard day and band thresholds from the spec', () => {
		expect(STANDARD_WORKING_HOURS).toBe(8);
		expect(HALF_DAY_HOURS).toBe(4);
		expect(UNDER_UTILIZATION_THRESHOLD).toBe(80);
		expect(OVER_UTILIZATION_THRESHOLD).toBe(100);
	});
});

describe('buildCapacity', () => {
	it('counts working days net of scheduled weekly offs', () => {
		const capacity = buildCapacity(MAY, [], new Set());
		expect(capacity.working_days).toBe(24);
		expect(capacity.weekly_off_days).toBe(7);
		expect(capacity.holiday_days).toBe(0);
		expect(capacity.gross_capacity_hours).toBe(192);
		expect(capacity.capacity_hours).toBe(192);
	});

	it('excludes injected holidays from working days', () => {
		const capacity = buildCapacity(MAY, [], new Set(['2026-05-01']));
		expect(capacity.holiday_days).toBe(1);
		expect(capacity.working_days).toBe(23);
		expect(capacity.capacity_hours).toBe(184);
	});

	it('reduces capacity by a full day for approved leave', () => {
		const capacity = buildCapacity(
			MAY,
			[{ date: '2026-05-04', status: 'PL' }],
			new Set()
		);
		expect(capacity.leave_days).toBe(1);
		expect(capacity.capacity_hours).toBe(184);
	});

	it('reduces capacity by half a day for half-day leave', () => {
		const capacity = buildCapacity(
			MAY,
			[{ date: '2026-05-04', status: 'HD' }],
			new Set()
		);
		expect(capacity.half_days).toBe(1);
		expect(capacity.capacity_hours).toBe(188);
	});

	it('keeps capacity for absent days (unsanctioned, still expected)', () => {
		const capacity = buildCapacity(
			MAY,
			[{ date: '2026-05-04', status: 'A' }],
			new Set()
		);
		expect(capacity.leave_days).toBe(0);
		expect(capacity.capacity_hours).toBe(192);
	});

	it('ignores leave recorded on weekly offs and holidays', () => {
		const capacity = buildCapacity(
			MAY,
			[
				{ date: '2026-05-03', status: 'PL' },
				{ date: '2026-05-01', status: 'CL' },
			],
			new Set(['2026-05-01'])
		);
		expect(capacity.leave_days).toBe(0);
		expect(capacity.capacity_hours).toBe(184);
	});

	it('honours the attendance weekly-off flag over the schedule', () => {
		const capacity = buildCapacity(
			MAY,
			[{ date: '2026-05-03', status: 'P', is_weekly_off: 0 }],
			new Set()
		);
		expect(capacity.working_days).toBe(25);
		expect(capacity.capacity_hours).toBe(200);
	});

	it('returns zeros for an invalid month', () => {
		const capacity = buildCapacity('garbage', [], new Set());
		expect(capacity.working_days).toBe(0);
		expect(capacity.capacity_hours).toBe(0);
	});
});

describe('sumLoggedHours', () => {
	it('sums daily-entry hours for the month without capping', () => {
		// 10h + 10h days: overtime is kept, not clipped to 8h.
		const total = sumLoggedHours(
			[entries({ '2026-05-04': 10, '2026-05-05': 10 })],
			MAY
		);
		expect(total).toBe(20);
	});

	it('merges several assignment payloads and drops other months', () => {
		const total = sumLoggedHours(
			[
				entries({ '2026-05-04': 8, '2026-06-01': 8 }),
				entries({ '2026-05-05': 4.5 }),
			],
			MAY
		);
		expect(total).toBe(12.5);
	});

	it('ignores zero, negative, and malformed entries', () => {
		const total = sumLoggedHours(
			[
				'not json',
				entries({ '2026-05-04': 0, '2026-05-05': -3 }),
				JSON.stringify([{ qty_done: 5 }, null, { date: '2026-05-06' }]),
			],
			MAY
		);
		expect(total).toBe(0);
	});
});

describe('utilizationPercent and bandForUtilization', () => {
	it('computes the logged-over-capacity percentage', () => {
		expect(utilizationPercent(160, 192)).toBe(83.33);
		expect(utilizationPercent(0, 192)).toBe(0);
	});

	it('returns null when there is no capacity to divide by', () => {
		expect(utilizationPercent(10, 0)).toBeNull();
		expect(bandForUtilization(null)).toBeNull();
	});

	it('bands under 80 as under', () => {
		expect(bandForUtilization(79.99)).toBe('under');
	});

	it('bands the 80 and 100 boundaries as healthy', () => {
		expect(bandForUtilization(80)).toBe('healthy');
		expect(bandForUtilization(100)).toBe('healthy');
	});

	it('bands above 100 as over', () => {
		expect(bandForUtilization(100.01)).toBe('over');
	});

	it('reads overtime past 100 instead of clipping it', () => {
		expect(bandForUtilization(utilizationPercent(200, 192))).toBe('over');
	});
});

describe('resolveMonthlyCost', () => {
	it('prefers stored CTC over gross salary over gross (CTC-first)', () => {
		// Deliberate divergence from the billing Gross-first order:
		// bench prioritization needs true burn.
		expect(resolveMonthlyCost(profile())).toBe(22000);
		expect(
			resolveMonthlyCost(
				profile({ employer_cost: 0, gross_salary: 15000, gross: 18000 })
			)
		).toBe(15000);
		expect(
			resolveMonthlyCost(
				profile({ employer_cost: 0, gross_salary: 0, gross: 18000 })
			)
		).toBe(18000);
	});
});

describe('computeCtcHourlyRate and resolveCtcHourlyRate', () => {
	it('apportions monthly CTC over standard days times hours per day', () => {
		// 22000 / (26 × 8) = 105.769… unrounded for money math.
		expect(computeCtcHourlyRate(profile())).toBeCloseTo(105.7692, 4);
		expect(resolveCtcHourlyRate(profile())).toBe(105.77);
	});

	it('uses the direct rate for hourly, daily, and custom types', () => {
		expect(
			computeCtcHourlyRate(profile({ salary_type: 'hourly', hourly_rate: 250 }))
		).toBe(250);
		expect(
			computeCtcHourlyRate(profile({ salary_type: 'daily', daily_rate: 800 }))
		).toBe(800);
		expect(
			computeCtcHourlyRate(profile({ salary_type: 'custom', hourly_rate: 300 }))
		).toBe(300);
	});

	it('falls back to 26 days and 8 hours when the profile omits them', () => {
		expect(
			computeCtcHourlyRate(
				profile({ std_working_days: 0, std_hours_per_day: 0 })
			)
		).toBeCloseTo(22000 / 208, 4);
	});

	it('respects profile-level working days and hours per day', () => {
		expect(
			resolveCtcHourlyRate(
				profile({
					employer_cost: 22000,
					std_working_days: 22,
					std_hours_per_day: 8,
				})
			)
		).toBe(125);
	});

	it('returns 0 when there is no monthly cost', () => {
		expect(
			computeCtcHourlyRate(
				profile({ employer_cost: 0, gross_salary: 0, gross: 0 })
			)
		).toBe(0);
	});
});

describe('buildTeamRow', () => {
	it('builds a team row with footing costs', () => {
		const row = buildTeamRow({
			employee_id: 7,
			employee_name: 'Asha Rao',
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8, '2026-05-05': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		expect(row.capacity_hours).toBe(192);
		expect(row.logged_hours).toBe(16);
		expect(row.utilization_percent).toBe(8.33);
		expect(row.utilization_band).toBe('under');
		expect(row.monthly_cost).toBe(22000);
		expect(row.cost_status).toBe('priced');
		// 16h × 105.769… = 1692.31; fractional + bench foots to monthly.
		expect(row.fractional_cost).toBe(1692.31);
		expect(row.fractional_cost! + row.bench_cost!).toBeCloseTo(
			row.monthly_cost!,
			2
		);
	});

	it('prices every salary type through the one CTC rule', () => {
		const cases: Array<{
			salary_type: string;
			overrides: Partial<SalaryProfile>;
			monthly: number;
			rate: number;
		}> = [
			{ salary_type: 'monthly', overrides: {}, monthly: 22000, rate: 105.77 },
			{
				salary_type: 'contract',
				overrides: {
					salary_type: 'contract',
					employer_cost: 30000,
					gross_salary: 30000,
				},
				monthly: 30000,
				rate: 144.23,
			},
			{
				salary_type: 'hourly',
				overrides: {
					salary_type: 'hourly',
					hourly_rate: 250,
					employer_cost: 52000,
					gross_salary: 52000,
				},
				monthly: 52000,
				rate: 250,
			},
			{
				salary_type: 'daily',
				overrides: {
					salary_type: 'daily',
					daily_rate: 800,
					employer_cost: 20800,
					gross_salary: 20800,
				},
				monthly: 20800,
				rate: 800,
			},
			{
				salary_type: 'lumpsum',
				overrides: {
					salary_type: 'lumpsum',
					employer_cost: 45000,
					gross_salary: 45000,
				},
				monthly: 45000,
				rate: 216.35,
			},
			{
				salary_type: 'custom',
				overrides: {
					salary_type: 'custom',
					hourly_rate: 300,
					employer_cost: 30000,
					gross_salary: 30000,
				},
				monthly: 30000,
				rate: 300,
			},
		];
		for (const c of cases) {
			const row = buildTeamRow({
				employee_id: 1,
				month: MAY,
				daily_entries: [entries({ '2026-05-04': 8 })],
				attendance: [],
				holidays: new Set(),
				profiles: [profile(c.overrides)],
			});
			expect(row.monthly_cost).toBe(c.monthly);
			expect(row.cost_status).toBe('priced');
			expect(resolveCtcHourlyRate(profile(c.overrides))).toBe(c.rate);
			expect(row.fractional_cost! + row.bench_cost!).toBeCloseTo(
				row.monthly_cost!,
				2
			);
		}
	});

	it('shows hours and utilization with blank cost for a missing profile', () => {
		const row = buildTeamRow({
			employee_id: 9,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [],
		});
		expect(row.logged_hours).toBe(8);
		expect(row.utilization_percent).toBe(4.17);
		expect(row.monthly_cost).toBeNull();
		expect(row.fractional_cost).toBeNull();
		expect(row.bench_cost).toBeNull();
		expect(row.cost_status).toBe('no-profile');
	});

	it('nets holidays and leave out of row capacity', () => {
		const row = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [entries({ '2026-05-05': 8, '2026-05-06': 8 })],
			attendance: [{ date: '2026-05-04', status: 'PL' }],
			holidays: new Set(['2026-05-01']),
			profiles: [profile()],
		});
		// 23 working days minus one leave day → 22 × 8 = 176h.
		expect(row.capacity_hours).toBe(176);
		expect(row.logged_hours).toBe(16);
		expect(row.utilization_percent).toBe(9.09);
		expect(row.utilization_band).toBe('under');
		expect(row.bench_cost!).toBeGreaterThan(0);
	});

	it('reads overload above 100 with overtime hours', () => {
		const logged: Record<string, number> = {};
		for (let day = 4; day <= 29; day++) {
			logged[`2026-05-${String(day).padStart(2, '0')}`] = 10;
		}
		const row = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [entries(logged)],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		expect(row.logged_hours).toBe(260);
		expect(row.utilization_percent).toBe(135.42);
		expect(row.utilization_band).toBe('over');
		// 260h × 105.769… = 27500 ≫ 22000 monthly: bench goes negative.
		expect(row.bench_cost!).toBeLessThan(0);
		expect(row.fractional_cost! + row.bench_cost!).toBeCloseTo(
			row.monthly_cost!,
			2
		);
	});

	it('prices the month with its own effective-dated profile', () => {
		const row = buildTeamRow({
			employee_id: 1,
			month: '2026-10',
			daily_entries: [entries({ '2026-10-05': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [
				profile({ employer_cost: 22000, effective_to: '2026-09-30' }),
				profile({ employer_cost: 26000, effective_from: '2026-10-01' }),
			],
		});
		expect(row.monthly_cost).toBe(26000);
	});
});

describe('buildUtilizationTotals', () => {
	it('sums priced rows with the footing identity intact', () => {
		const priced = buildTeamRow({
			employee_id: 1,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		const unpriced = buildTeamRow({
			employee_id: 2,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [],
		});
		const totals = buildUtilizationTotals([priced, unpriced]);
		expect(totals.employee_count).toBe(2);
		expect(totals.priced_count).toBe(1);
		expect(totals.unpriced_count).toBe(1);
		expect(totals.capacity_hours).toBe(384);
		expect(totals.logged_hours).toBe(16);
		expect(totals.monthly_cost).toBe(22000);
		expect(totals.fractional_cost! + totals.bench_cost!).toBeCloseTo(
			totals.monthly_cost!,
			2
		);
	});
});

describe('monthLabel', () => {
	it('formats YYYY-MM into a readable label', () => {
		expect(monthLabel('2026-05')).toBe('May 2026');
	});

	it('returns the input for invalid months', () => {
		expect(monthLabel('garbage')).toBe('garbage');
	});
});
