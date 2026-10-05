import { describe, it, expect } from 'vitest';
import {
	STANDARD_WORKING_HOURS,
	HALF_DAY_HOURS,
	STD_HOURS_PER_DAY_DEFAULT,
	UNDER_UTILIZATION_THRESHOLD,
	OVER_UTILIZATION_THRESHOLD,
	resolveMonthlyCost,
	basisDaysInMonth,
	computeCtcHourlyRate,
	resolveCtcHourlyRate,
	proratedMonthlyCost,
	buildCapacity,
	utilizationPercent,
	bandForUtilization,
	buildTeamRow,
	buildUtilizationTotals,
	summarizeTrailing,
	buildTrendPoint,
	buildDepartmentSummary,
	sortUtilizationRows,
	monthLabel,
	trendMonths,
} from '@/app/reports/employee-utilization/data-source';
import type { SalaryProfile } from '@/app/reports/manhours-billing/data-source';
import {
	PROJECT_BREAKDOWN_TOP_N,
	buildProjectBreakdown,
	buildProjectBuckets,
	projectDisplayName,
	type BreakdownAssignment,
} from '@/app/reports/employee-utilization/project-breakdown';
import { sumLoggedHoursForMonth as sumLoggedHours } from '@/lib/logged-hours';

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
		// An open window is the whole month: the two pro-rating counts agree.
		expect(capacity.employed_working_days).toBe(24);
		expect(capacity.month_working_days).toBe(24);
	});

	it('scopes every bucket to the employment window', () => {
		// 11–20 May 2026: 9 working days, Sunday 17th the only weekly off.
		const capacity = buildCapacity(MAY, [], new Set(), {
			start: '2026-05-11',
			end: '2026-05-20',
		});
		expect(capacity.working_days).toBe(9);
		expect(capacity.weekly_off_days).toBe(1);
		expect(capacity.holiday_days).toBe(0);
		expect(capacity.gross_capacity_hours).toBe(72);
		expect(capacity.capacity_hours).toBe(72);
		expect(capacity.employed_working_days).toBe(9);
		// The denominator stays the full month, holiday and all.
		expect(capacity.month_working_days).toBe(24);
	});

	it('counts the month denominator outside the window but no bucket', () => {
		const capacity = buildCapacity(MAY, [], new Set(['2026-05-01']), {
			start: '2026-05-11',
			end: '2026-05-20',
		});
		// The 1 May holiday is outside the window: no bucket, but it still
		// shortens the month's own working days (24 → 23).
		expect(capacity.holiday_days).toBe(0);
		expect(capacity.working_days).toBe(9);
		expect(capacity.month_working_days).toBe(23);
	});

	it('keeps the leave rules inside the window', () => {
		const capacity = buildCapacity(
			MAY,
			[
				{ date: '2026-05-12', status: 'PL' },
				{ date: '2026-05-13', status: 'HD' },
			],
			new Set(),
			{ start: '2026-05-11', end: '2026-05-20' }
		);
		expect(capacity.leave_days).toBe(1);
		expect(capacity.half_days).toBe(1);
		// 9 × 8 = 72, minus a full day and half a day.
		expect(capacity.capacity_hours).toBe(60);
	});

	it('credits the standard day for an H-status row (optional holiday)', () => {
		// An optional holiday is never injected; recorded 'H' attendance must
		// not zero the day either — it falls through to the 8h credit.
		const capacity = buildCapacity(
			MAY,
			[{ date: '2026-05-04', status: 'H' }],
			new Set()
		);
		expect(capacity.holiday_days).toBe(0);
		expect(capacity.leave_days).toBe(0);
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
		expect(capacity.employed_working_days).toBe(0);
		expect(capacity.month_working_days).toBe(0);
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

describe('basisDaysInMonth (payroll Basis Hours calendar)', () => {
	it('counts every non-Sunday day, 2nd/4th Saturdays included', () => {
		// May 2026: 31 days, 5 Sundays; Saturdays 9 and 23 stay in — the
		// capacity calendar's 24 working days would be wrong here.
		expect(basisDaysInMonth(MAY, new Set())).toBe(26);
	});

	it('subtracts injected holidays that are not Sundays', () => {
		expect(basisDaysInMonth(MAY, new Set(['2026-05-01']))).toBe(25);
		// A holiday landing on a Sunday is already excluded: no double count.
		expect(basisDaysInMonth(MAY, new Set(['2026-05-03']))).toBe(26);
	});

	it('moves with the calendar month', () => {
		// July 2026: 31 days, 4 Sundays (5/12/19/26) → 27 basis days.
		expect(basisDaysInMonth('2026-07', new Set())).toBe(27);
		expect(basisDaysInMonth('garbage', new Set())).toBe(0);
	});
});

describe('computeCtcHourlyRate and resolveCtcHourlyRate', () => {
	it('apportions CTC over the month’s Basis Hours', () => {
		// 26 basis days × 8h = 208h; 22000 / 208 = 105.769… for money math.
		expect(computeCtcHourlyRate(profile(), 26)).toBeCloseTo(105.7692, 4);
		expect(resolveCtcHourlyRate(profile(), 26)).toBe(105.77);
	});

	it('moves with the month’s basis days (the payroll rule)', () => {
		// July 2026: 27 basis days × 8 = 216h; 22000 / 216 = 101.8518…
		expect(computeCtcHourlyRate(profile(), 27)).toBeCloseTo(101.8519, 4);
		expect(resolveCtcHourlyRate(profile(), 27)).toBe(101.85);
		// One holiday on a working day lowers the denominator, raising the rate.
		expect(resolveCtcHourlyRate(profile(), 25)).toBe(110);
	});

	it('falls back to 8 hours per day when the profile omits them', () => {
		expect(STD_HOURS_PER_DAY_DEFAULT).toBe(8);
		expect(
			computeCtcHourlyRate(profile({ std_hours_per_day: 0 }), 26)
		).toBeCloseTo(22000 / 208, 4);
	});

	it('ignores std_working_days and direct stored rates', () => {
		// Payroll prices CTC over the month's basis hours: the profile's own
		// denominator and the direct hourly/daily/custom rates are all decoys.
		expect(
			resolveCtcHourlyRate(
				profile({ std_working_days: 22, employer_cost: 26000 }),
				26
			)
		).toBe(125);
		for (const salary_type of ['hourly', 'daily', 'custom']) {
			expect(
				resolveCtcHourlyRate(
					profile({
						salary_type,
						hourly_rate: 999,
						daily_rate: 999,
						employer_cost: 26000,
					}),
					26
				),
				salary_type
			).toBe(125);
		}
	});

	it('keeps the profile’s hours per day in the denominator', () => {
		// 26 basis days × 4h = 104h; 20000 / 104 = 192.307…
		expect(
			resolveCtcHourlyRate(
				profile({ employer_cost: 20000, std_hours_per_day: 4 }),
				26
			)
		).toBe(192.31);
	});

	it('returns 0 with no CTC or no basis days', () => {
		expect(
			computeCtcHourlyRate(
				profile({ employer_cost: 0, gross_salary: 0, gross: 0 }),
				26
			)
		).toBe(0);
		expect(computeCtcHourlyRate(profile(), 0)).toBe(0);
	});
});

describe('proratedMonthlyCost', () => {
	it('pro-rates by employed over month working days at 2dp', () => {
		expect(proratedMonthlyCost(22000, 12, 24)).toBe(11000);
		expect(proratedMonthlyCost(22000, 9, 24)).toBe(8250);
		// 22000 × 11 ÷ 24 = 10083.333… → 10083.33.
		expect(proratedMonthlyCost(22000, 11, 24)).toBe(10083.33);
	});

	it('reproduces the monthly cost exactly for a full-month window', () => {
		expect(proratedMonthlyCost(22000, 24, 24)).toBe(22000);
		expect(proratedMonthlyCost(22000.567, 24, 24)).toBe(22000.57);
	});

	it('costs nothing when the window has no working days', () => {
		// A window covering only weekly offs/holidays: capacity 0, cost 0.
		expect(proratedMonthlyCost(22000, 0, 24)).toBe(0);
		expect(proratedMonthlyCost(22000, 0, 0)).toBe(0);
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
		expect(row.state).toBeNull();
		// No month scope in this input: both window bounds read as open.
		expect(row.employment_start).toBeNull();
		expect(row.employment_end).toBeNull();
		expect(row.is_partial_window).toBe(false);
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
				// The stored hourly rate (250) is a decoy: CTC ÷ 208h wins.
				salary_type: 'hourly',
				overrides: {
					salary_type: 'hourly',
					hourly_rate: 250,
					employer_cost: 40000,
					gross_salary: 40000,
				},
				monthly: 40000,
				rate: 192.31,
			},
			{
				// Likewise the stored daily rate (800): 20800 ÷ 208 = 100.
				salary_type: 'daily',
				overrides: {
					salary_type: 'daily',
					daily_rate: 800,
					employer_cost: 20800,
					gross_salary: 20800,
				},
				monthly: 20800,
				rate: 100,
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
				rate: 144.23,
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
			// May 2026 has 26 basis days × 8h = 208h.
			expect(resolveCtcHourlyRate(profile(c.overrides), 26)).toBe(c.rate);
			expect(row.fractional_cost! + row.bench_cost!).toBeCloseTo(
				row.monthly_cost!,
				2
			);
		}
	});

	it('prices with the month’s basis days, not the profile denominator', () => {
		const row = buildTeamRow({
			employee_id: 1,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8, '2026-05-05': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [
				profile({
					salary_type: 'hourly',
					hourly_rate: 999,
					std_working_days: 22,
					employer_cost: 26000,
					gross_salary: 26000,
				}),
			],
		});
		// 26000 / (26 × 8) = 125 — never 26000 / (22 × 8) = 147.73, never 999.
		expect(row.monthly_cost).toBe(26000);
		expect(row.fractional_cost).toBe(2000);
		expect(row.bench_cost).toBe(24000);
	});

	it('folds the month’s holidays into the rate denominator', () => {
		const row = buildTeamRow({
			employee_id: 1,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(['2026-05-01']),
			profiles: [profile({ employer_cost: 22000, gross_salary: 22000 })],
		});
		// 25 basis days × 8h = 200h → 110/h; Capacity nets the same holiday.
		expect(row.fractional_cost).toBe(880);
		expect(row.capacity_hours).toBe(184);
	});

	it('carries the window and pro-rates capacity and Monthly Cost to it', () => {
		const row = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [entries({ '2026-05-12': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			employment_start: '2026-05-11',
			employment_end: '2026-05-20',
		});
		expect(row.employment_start).toBe('2026-05-11');
		expect(row.employment_end).toBe('2026-05-20');
		expect(row.is_partial_window).toBe(true);
		// 9 working days inside the window × 8h.
		expect(row.capacity_hours).toBe(72);
		// 22000 × 9 ÷ 24 = 8250; 8h × 105.769… = 846.15, footing preserved.
		expect(row.monthly_cost).toBe(8250);
		expect(row.fractional_cost).toBe(846.15);
		expect(row.fractional_cost! + row.bench_cost!).toBeCloseTo(
			row.monthly_cost!,
			2
		);
	});

	it('marks a window covering the whole month as not partial', () => {
		const row = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			employment_start: '2026-05-01',
			employment_end: '2026-05-31',
		});
		expect(row.is_partial_window).toBe(false);
		expect(row.capacity_hours).toBe(192);
		expect(row.monthly_cost).toBe(22000);
	});

	it('costs a window with no working days at zero with null utilization', () => {
		const row = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			// 23 May = 4th Saturday (weekly off), 24 May = Sunday.
			employment_start: '2026-05-23',
			employment_end: '2026-05-24',
		});
		expect(row.is_partial_window).toBe(true);
		expect(row.capacity_hours).toBe(0);
		expect(row.utilization_percent).toBeNull();
		expect(row.utilization_band).toBeNull();
		expect(row.monthly_cost).toBe(0);
		expect(row.fractional_cost).toBe(0);
		expect(row.bench_cost).toBe(0);
		expect(row.cost_status).toBe('priced');
	});

	it('flags a zero-Logged-Hours month as no time logged without moving the band', () => {
		const row = buildTeamRow({
			employee_id: 2,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		// The 0% Under reading stays factual — the state rides alongside it.
		expect(row.logged_hours).toBe(0);
		expect(row.utilization_percent).toBe(0);
		expect(row.utilization_band).toBe('under');
		expect(row.state).toBe('no_time_logged');
		// A full-month idle row keeps the whole CTC as bench: 22000 − 0.
		expect(row.capacity_hours).toBe(192);
		expect(row.bench_cost).toBe(22000);
	});

	it('applies the no-time-logged state independently of cost and capacity', () => {
		// No covering profile: the blank costs stay blank, the state still applies.
		const noProfileRow = buildTeamRow({
			employee_id: 9,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [],
		});
		expect(noProfileRow.state).toBe('no_time_logged');
		expect(noProfileRow.cost_status).toBe('no-profile');
		expect(noProfileRow.monthly_cost).toBeNull();
		expect(noProfileRow.bench_cost).toBeNull();

		// A window covering no working days reads percent/band null — and the
		// state still stands, because it is about the Logged Hours alone.
		const noCapacityRow = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			employment_start: '2026-05-23',
			employment_end: '2026-05-24',
		});
		expect(noCapacityRow.utilization_percent).toBeNull();
		expect(noCapacityRow.utilization_band).toBeNull();
		expect(noCapacityRow.state).toBe('no_time_logged');
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

	it('carries the trailing window it is given, and an empty one otherwise', () => {
		const trailing = summarizeTrailing([
			{ month: '2026-03', employed: true, utilization_percent: 50 },
			{ month: '2026-04', employed: true, utilization_percent: 40 },
			{ month: '2026-05', employed: true, utilization_percent: 8.33 },
		]);
		const withHistory = buildTeamRow({
			employee_id: 7,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			trailing,
		});
		expect(withHistory.trailing).toEqual(trailing.trailing);
		expect(withHistory.chronic_under).toBe(true);

		// A single-month row carries no history, so no marker can stand.
		const single = buildTeamRow({
			employee_id: 8,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		expect(single.trailing).toEqual([]);
		expect(single.chronic_under).toBe(false);
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
		expect(totals.no_logged_count).toBe(0);
		expect(totals.capacity_hours).toBe(384);
		expect(totals.logged_hours).toBe(16);
		expect(totals.monthly_cost).toBe(22000);
		expect(totals.fractional_cost! + totals.bench_cost!).toBeCloseTo(
			totals.monthly_cost!,
			2
		);
	});

	it('counts the rows that logged nothing in the month', () => {
		const idle = buildTeamRow({
			employee_id: 3,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		const busy = buildTeamRow({
			employee_id: 4,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [],
		});
		const totals = buildUtilizationTotals([idle, busy]);
		expect(idle.state).toBe('no_time_logged');
		expect(busy.state).toBeNull();
		expect(totals.no_logged_count).toBe(1);
		expect(totals.employee_count).toBe(2);
		expect(totals.logged_hours).toBe(8);
		expect(buildUtilizationTotals([]).no_logged_count).toBe(0);
	});
});

describe('trendMonths', () => {
	it('reads the six months ending at the viewed month, oldest first', () => {
		expect(trendMonths('2019-01')).toEqual([
			'2018-08',
			'2018-09',
			'2018-10',
			'2018-11',
			'2018-12',
			'2019-01',
		]);
		// The span crosses the year boundary backwards; the trailing window is
		// its last three months.
		expect(trendMonths('2026-05')).toEqual([
			'2025-12',
			'2026-01',
			'2026-02',
			'2026-03',
			'2026-04',
			'2026-05',
		]);
		expect(trendMonths('2026-05').slice(-3)).toEqual([
			'2026-03',
			'2026-04',
			'2026-05',
		]);
	});

	it('returns no span for an invalid month', () => {
		expect(trendMonths('garbage')).toEqual([]);
		expect(trendMonths('2026-13')).toEqual([]);
	});
});

describe('summarizeTrailing', () => {
	const cell = (
		month: string,
		employed: boolean,
		utilization_percent: number | null
	) => ({ month, employed, utilization_percent });

	it('keeps the three months oldest first and marks an all-under window chronic', () => {
		const window = summarizeTrailing([
			cell('2026-03', true, 50),
			cell('2026-04', true, 79.99),
			cell('2026-05', true, 0),
		]);
		expect(window.trailing).toEqual([
			{ month: '2026-03', employed: true, utilization_percent: 50 },
			{ month: '2026-04', employed: true, utilization_percent: 79.99 },
			{ month: '2026-05', employed: true, utilization_percent: 0 },
		]);
		expect(window.chronic_under).toBe(true);
	});

	it('needs at least two employed months of history', () => {
		// Two employed months, both under: chronic even with a blank earlier cell.
		expect(
			summarizeTrailing([
				cell('2026-03', false, null),
				cell('2026-04', true, 40),
				cell('2026-05', true, 60),
			]).chronic_under
		).toBe(true);
		// One employed month is a one-off, never chronic.
		expect(
			summarizeTrailing([
				cell('2026-03', false, null),
				cell('2026-04', false, null),
				cell('2026-05', true, 40),
			]).chronic_under
		).toBe(false);
	});

	it('breaks the marker on any employed month at or above 80', () => {
		expect(
			summarizeTrailing([
				cell('2026-03', true, 50),
				cell('2026-04', true, 80),
				cell('2026-05', true, 30),
			]).chronic_under
		).toBe(false);
	});

	it('never counts a null percent (no capacity) as below', () => {
		expect(
			summarizeTrailing([
				cell('2026-03', true, null),
				cell('2026-04', true, 30),
				cell('2026-05', true, 30),
			]).chronic_under
		).toBe(false);
	});

	it('does not mark a window with no employed month', () => {
		expect(
			summarizeTrailing([
				cell('2026-03', false, null),
				cell('2026-04', false, null),
				cell('2026-05', false, null),
			]).chronic_under
		).toBe(false);
	});
});

describe('buildTrendPoint', () => {
	const pricedRow = buildTeamRow({
		employee_id: 1,
		month: MAY,
		daily_entries: [entries({ '2026-05-04': 8, '2026-05-05': 8 })],
		attendance: [],
		holidays: new Set(),
		profiles: [profile()],
	});
	const unpricedRow = buildTeamRow({
		employee_id: 2,
		month: MAY,
		daily_entries: [entries({ '2026-05-04': 8, '2026-05-05': 8 })],
		attendance: [],
		holidays: new Set(),
		profiles: [],
	});

	it('weights utilization by capacity and sums bench over priced rows', () => {
		const point = buildTrendPoint(MAY, [pricedRow, unpricedRow]);
		expect(point.month).toBe(MAY);
		// 32h logged over 384h of capacity; the unpriced row still counts for hours.
		expect(point.utilization_percent).toBe(8.33);
		// Bench covers the priced row only: 22000 − 1692.31.
		expect(point.bench_cost).toBe(20307.69);
	});

	it('leaves the percent null when the month credits no capacity', () => {
		const empty = buildTeamRow({
			employee_id: 3,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			// 23 May = 4th Saturday, 24 May = Sunday: no working days.
			employment_start: '2026-05-23',
			employment_end: '2026-05-24',
		});
		const point = buildTrendPoint(MAY, [empty]);
		expect(point.utilization_percent).toBeNull();
		// The window still costs (a priced zero-capacity row keeps its bench).
		expect(point.bench_cost).toBe(0);
	});

	it('leaves bench null when no row is priced, and for an empty roster', () => {
		expect(buildTrendPoint(MAY, [unpricedRow]).bench_cost).toBeNull();
		expect(buildTrendPoint(MAY, [])).toEqual({
			month: MAY,
			utilization_percent: null,
			bench_cost: null,
		});
	});
});

describe('buildDepartmentSummary', () => {
	/** 12 working days × 8h — half of May 2026's 192h capacity. */
	const HALF_MONTH_ENTRIES = [
		entries({
			'2026-05-04': 8,
			'2026-05-05': 8,
			'2026-05-06': 8,
			'2026-05-07': 8,
			'2026-05-08': 8,
			'2026-05-11': 8,
			'2026-05-12': 8,
			'2026-05-13': 8,
			'2026-05-14': 8,
			'2026-05-18': 8,
			'2026-05-19': 8,
			'2026-05-20': 8,
		}),
	];

	const engineeringPriced = buildTeamRow({
		employee_id: 1,
		department: 'Engineering',
		month: MAY,
		daily_entries: [entries({ '2026-05-04': 8, '2026-05-05': 8 })],
		attendance: [],
		holidays: new Set(),
		profiles: [profile()],
	});
	const engineeringIdleUnpriced = buildTeamRow({
		employee_id: 2,
		department: 'Engineering',
		month: MAY,
		daily_entries: [],
		attendance: [],
		holidays: new Set(),
		profiles: [],
	});
	const operationsIdle = buildTeamRow({
		employee_id: 3,
		department: 'Operations',
		month: MAY,
		daily_entries: [],
		attendance: [],
		holidays: new Set(),
		profiles: [profile()],
	});
	const unsetHalfMonth = buildTeamRow({
		employee_id: 4,
		month: MAY,
		daily_entries: HALF_MONTH_ENTRIES,
		attendance: [],
		holidays: new Set(),
		profiles: [profile()],
	});

	it('rolls the month up per department, weighted by capacity, unset last', () => {
		const summaries = buildDepartmentSummary([
			operationsIdle,
			unsetHalfMonth,
			engineeringIdleUnpriced,
			engineeringPriced,
		]);

		// Name ascending, the unset bucket last.
		expect(summaries.map((summary) => summary.department)).toEqual([
			'Engineering',
			'Operations',
			null,
		]);

		// Two members, one priced and one not: the unpriced row still counts
		// for hours (16h over 384h = 4.17%) but contributes no money, and it
		// is the department's one no-log row.
		const engineering = summaries[0];
		expect(engineering).toEqual({
			department: 'Engineering',
			headcount: 2,
			capacity_weighted_utilization: 4.17,
			logged_hours: 16,
			capacity_hours: 384,
			bench_cost: 20307.69,
			no_logged_count: 1,
		});

		// An idle priced member: 0h logged of 192h, the whole CTC benched.
		expect(summaries[1]).toEqual({
			department: 'Operations',
			headcount: 1,
			capacity_weighted_utilization: 0,
			logged_hours: 0,
			capacity_hours: 192,
			bench_cost: 22000,
			no_logged_count: 1,
		});

		// The unset bucket: 96h of 192h = 50%, bench 22000 − round2(96 ×
		// 105.769…) = 11846.15, nothing unlogged.
		expect(summaries[2]).toEqual({
			department: null,
			headcount: 1,
			capacity_weighted_utilization: 50,
			logged_hours: 96,
			capacity_hours: 192,
			bench_cost: 11846.15,
			no_logged_count: 0,
		});
	});

	it('weights utilization by capacity, not by the mean of the rows’ percents', () => {
		// A half-utilized partial window (72h capacity, 36h logged) beside a
		// full idle month (192h): Σ logged ÷ Σ capacity = 36/264 = 13.64%,
		// where the two rows' own percents average 25%.
		const partial = buildTeamRow({
			employee_id: 5,
			department: 'Field',
			month: MAY,
			daily_entries: [
				entries({
					'2026-05-11': 8,
					'2026-05-12': 8,
					'2026-05-13': 8,
					'2026-05-14': 8,
					'2026-05-15': 4,
				}),
			],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			employment_start: '2026-05-11',
			employment_end: '2026-05-20',
		});
		const full = buildTeamRow({
			employee_id: 6,
			department: 'Field',
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		expect(partial.utilization_percent).toBe(50);
		expect(full.utilization_percent).toBe(0);

		const [summary] = buildDepartmentSummary([partial, full]);
		expect(summary.capacity_weighted_utilization).toBe(13.64);
		expect(summary.logged_hours).toBe(36);
		expect(summary.capacity_hours).toBe(264);
	});

	it('normalizes an empty-string department to the unset bucket', () => {
		const blank = buildTeamRow({
			employee_id: 7,
			department: '',
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		expect(blank.department).toBeNull();
		expect(buildDepartmentSummary([blank]).map((s) => s.department)).toEqual([
			null,
		]);
		// A raw named department rides on the row untouched.
		const named = buildTeamRow({
			employee_id: 8,
			department: 'Engineering',
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		expect(named.department).toBe('Engineering');
	});

	it('leaves bench null for a wholly unpriced department and percent null without capacity', () => {
		const [unpriced] = buildDepartmentSummary([engineeringIdleUnpriced]);
		expect(unpriced.department).toBe('Engineering');
		expect(unpriced.capacity_weighted_utilization).toBe(0);
		expect(unpriced.bench_cost).toBeNull();

		// 23 May = 4th Saturday, 24 May = Sunday: a priced window with no
		// working day credits no capacity and benches its zero monthly cost.
		const noCapacity = buildTeamRow({
			employee_id: 9,
			department: 'Bench',
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
			employment_start: '2026-05-23',
			employment_end: '2026-05-24',
		});
		const [empty] = buildDepartmentSummary([noCapacity]);
		expect(empty.capacity_weighted_utilization).toBeNull();
		expect(empty.capacity_hours).toBe(0);
		expect(empty.bench_cost).toBe(0);
	});

	it('returns nothing for an empty roster', () => {
		expect(buildDepartmentSummary([])).toEqual([]);
	});
});

describe('sortUtilizationRows', () => {
	it('keeps a no-time-logged row in its band-then-bench slot', () => {
		// The idle row's 22000 bench (0 logged) out-ranks the busy row's
		// 21153.85 even though the busy row logged hours: the state is not a
		// sort key, the Under band plus bench cost is.
		const idle = buildTeamRow({
			employee_id: 1,
			month: MAY,
			daily_entries: [],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		const busy = buildTeamRow({
			employee_id: 2,
			month: MAY,
			daily_entries: [entries({ '2026-05-04': 8 })],
			attendance: [],
			holidays: new Set(),
			profiles: [profile()],
		});
		const sorted = sortUtilizationRows([busy, idle]);
		expect(sorted.map((row) => row.employee_id)).toEqual([1, 2]);
		expect(sorted[0].state).toBe('no_time_logged');
		expect(sorted[0].utilization_band).toBe('under');
		expect(sorted[1].state).toBeNull();
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

describe('project breakdown', () => {
	function assignment(
		overrides: Partial<BreakdownAssignment> = {}
	): BreakdownAssignment {
		return {
			project_id: 1,
			resolved_project_id: 1,
			project_code: 'P-1',
			project_title: 'Project One',
			project_name: null,
			client_name: 'Client One',
			activity_name: 'Design',
			discipline_name: null,
			hours: 8,
			...overrides,
		};
	}

	it('pins the top-N constant from the brief', () => {
		expect(PROJECT_BREAKDOWN_TOP_N).toBe(5);
	});

	it('groups one project’s assignments, summing hours and activity detail', () => {
		const result = buildProjectBuckets([
			assignment({ activity_name: 'Modeling', hours: 8 }),
			assignment({
				activity_name: 'Design',
				discipline_name: 'Piping',
				hours: 16,
			}),
			assignment({ activity_name: 'Modeling', hours: 4 }),
			assignment({
				project_id: 2,
				resolved_project_id: 2,
				project_code: 'P-2',
				project_title: 'Project Two',
				client_name: 'Client Two',
				activity_name: 'Review',
				hours: 12,
			}),
		]);

		expect(result.projects.map((bucket) => bucket.project_id)).toEqual([1, 2]);
		expect(result.projects[0].hours).toBe(28);
		expect(result.projects[0].activities).toEqual([
			{ activity_name: 'Design', discipline_name: 'Piping', hours: 16 },
			{ activity_name: 'Modeling', discipline_name: null, hours: 12 },
		]);
		expect(result.projects[0].project_code).toBe('P-1');
		expect(result.projects[0].project_name).toBe('Project One');
		expect(result.projects[0].client_name).toBe('Client One');
		expect(result.noProject).toBeNull();
		expect(result.loggedHours).toBe(40);
	});

	it('sorts project groups hours descending with the project id as tie-break', () => {
		const result = buildProjectBuckets([
			assignment({ project_id: 9, resolved_project_id: 9, hours: 8 }),
			assignment({ project_id: 4, resolved_project_id: 4, hours: 8 }),
			assignment({ project_id: 7, resolved_project_id: 7, hours: 16 }),
		]);
		expect(result.projects.map((bucket) => bucket.project_id)).toEqual([
			7, 4, 9,
		]);
		expect(result.projects.map((bucket) => bucket.hours)).toEqual([16, 8, 8]);
	});

	it('keeps the top N and folds the rest into Other with its project count', () => {
		const assignments: BreakdownAssignment[] = [];
		for (let projectId = 1; projectId <= 7; projectId += 1) {
			assignments.push(
				assignment({
					project_id: projectId,
					resolved_project_id: projectId,
					project_code: `P-${projectId}`,
					project_title: `Project ${projectId}`,
					hours: projectId * 8,
				})
			);
		}
		const breakdown = buildProjectBreakdown({
			month: '2026-05',
			employee: { id: 3, code: 'E-3', name: 'Three' },
			assignments,
		});

		expect(breakdown.projects.map((bucket) => bucket.project_id)).toEqual([
			7, 6, 5, 4, 3,
		]);
		expect(breakdown.other).toEqual({ hours: 24, project_count: 2 });
		expect(breakdown.no_project).toBeNull();
		expect(breakdown.logged_hours).toBe(224);
		// Footing: top N + Other + (No project) is the whole month.
		expect(
			[
				...breakdown.projects,
				...(breakdown.no_project ? [breakdown.no_project] : []),
			].reduce((sum, bucket) => sum + bucket.hours, 0) + breakdown.other.hours
		).toBe(breakdown.logged_hours);
		expect(breakdown.top_n).toBe(PROJECT_BREAKDOWN_TOP_N);
	});

	it('keeps No project explicit and never merges it into Other', () => {
		const assignments: BreakdownAssignment[] = [];
		for (let projectId = 1; projectId <= 6; projectId += 1) {
			assignments.push(
				assignment({ project_id: projectId, resolved_project_id: projectId })
			);
		}
		assignments.push(
			assignment({
				project_id: null,
				resolved_project_id: null,
				project_code: null,
				project_title: null,
				client_name: null,
				activity_name: 'Internal',
				hours: 8,
			})
		);
		// A project id the `projects` rows do not resolve is project-less too.
		assignments.push(
			assignment({
				project_id: 99,
				resolved_project_id: null,
				project_code: null,
				project_title: null,
				client_name: null,
				activity_name: 'Unresolved',
				hours: 8,
			})
		);

		const breakdown = buildProjectBreakdown({
			month: '2026-05',
			employee: { id: 4, code: 'E-4', name: 'Four' },
			assignments,
		});

		expect(breakdown.projects.length).toBe(PROJECT_BREAKDOWN_TOP_N);
		expect(breakdown.other).toEqual({ hours: 8, project_count: 1 });
		expect(breakdown.no_project).toMatchObject({
			project_id: null,
			project_code: null,
			project_name: null,
			client_name: null,
			hours: 16,
		});
		expect(
			breakdown.no_project!.activities.map((activity) => activity.activity_name)
		).toEqual(['Internal', 'Unresolved']);
		expect(breakdown.logged_hours).toBe(64);
	});

	it('ignores zero and negative hours and returns an empty payload for nothing', () => {
		const breakdown = buildProjectBreakdown({
			month: '2026-05',
			employee: { id: 5, code: 'E-5', name: 'Five' },
			assignments: [
				assignment({ hours: 0 }),
				assignment({ project_id: 2, resolved_project_id: 2, hours: -4 }),
			],
		});
		expect(breakdown.projects).toEqual([]);
		expect(breakdown.other).toEqual({ hours: 0, project_count: 0 });
		expect(breakdown.no_project).toBeNull();
		expect(breakdown.logged_hours).toBe(0);

		const empty = buildProjectBreakdown({
			month: '2026-05',
			employee: { id: 6, code: 'E-6', name: 'Six' },
			assignments: [],
		});
		expect(empty.projects).toEqual([]);
		expect(empty.other).toEqual({ hours: 0, project_count: 0 });
		expect(empty.no_project).toBeNull();
		expect(empty.logged_hours).toBe(0);
		expect(empty.top_n).toBe(PROJECT_BREAKDOWN_TOP_N);
	});

	it('falls back title → name → code → Project #<id> for the display name', () => {
		expect(
			projectDisplayName({
				project_id: 1,
				project_title: 'Title',
				project_name: 'Name',
				project_code: 'C-1',
			})
		).toBe('Title');
		expect(
			projectDisplayName({
				project_id: 2,
				project_title: '  ',
				project_name: 'Name',
				project_code: 'C-2',
			})
		).toBe('Name');
		expect(
			projectDisplayName({
				project_id: 3,
				project_title: null,
				project_name: null,
				project_code: 'C-3',
			})
		).toBe('C-3');
		expect(
			projectDisplayName({
				project_id: 4,
				project_title: null,
				project_name: null,
				project_code: null,
			})
		).toBe('Project #4');
	});
});
