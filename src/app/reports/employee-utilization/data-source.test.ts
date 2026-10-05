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
	sortUtilizationRows,
	monthLabel,
} from '@/app/reports/employee-utilization/data-source';
import type { SalaryProfile } from '@/app/reports/manhours-billing/data-source';
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
