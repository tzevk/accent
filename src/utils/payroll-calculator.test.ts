import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module before importing payroll-calculator
vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn(),
}));

// Static imports after mock
import { dbConnect } from '@/utils/database';
import {
	calculateEmployeePayroll,
	computePayroll,
	getEffectivePayrollSchedule,
} from '@/utils/payroll-calculator';
import PAYROLL_CONFIG from '@/utils/payroll-config';

/** Default attendance record matching the expected shape. */
function defaultAttendance(overrides = {}) {
	return {
		standardWorkingDays: 26,
		daysPresent: 26,
		daysAbsent: 0,
		daysLeave: 0,
		weeklyOff: 4,
		holidays: 0,
		halfDays: 0,
		payableDays: 26,
		lopDays: 0,
		totalOvertimeHours: 0,
		hasAttendanceData: true,
		...overrides,
	};
}

/** Minimal salary profile for a given gross, no deductions, no saved breakdown. */
function makeProfile(gross: number, overrides: Record<string, unknown> = {}) {
	return {
		gross_salary: gross,
		other_allowances: 0,
		pf_applicable: 0,
		esic_applicable: 0,
		pt_applicable: 0,
		mlwf_applicable: 0,
		retention_applicable: 0,
		bonus_applicable: 0,
		monthly_bonus: 0,
		incentive_applicable: 0,
		insurance_applicable: 0,
		// No saved breakdown — falls back to percentage calc
		basic: null,
		da: null,
		hra: null,
		conveyance: null,
		call_allowance: null,
		bonus: null,
		incentive: null,
		mlwf: null,
		retention: null,
		insurance: null,
		mlwf_employer: null,
		pl_total: 21,
		pl_used: 0,
		pl_balance: 21,
		...overrides,
	};
}

describe('computePayroll', () => {
	it('produces exact integer outputs for R30,000 gross with no deductions', () => {
		const gross = 30_000;
		const profile = makeProfile(gross);
		const daAmount = 0;
		const attendance = defaultAttendance();

		const result = computePayroll(
			'EMP001',
			'2026-01-01',
			profile,
			daAmount,
			attendance,
			false
		);

		// Salary heads: BASIC_DA=60%, HRA=20%, CONVEYANCE=10%, CALL_ALLOWANCE=10%
		// basic+da = 18000, da=0 → basic=18000
		expect(result.basic).toBe(18_000);
		expect(result.da).toBe(0);
		expect(result.hra).toBe(6_000);
		expect(result.conveyance).toBe(3_000);
		expect(result.call_allowance).toBe(3_000);

		// total_earnings = basic + da + hra + conveyance + call_allowance + others(0)
		expect(result.total_earnings).toBe(30_000);

		// All deductions disabled
		expect(result.pf_employee).toBe(0);
		expect(result.esic_employee).toBe(0);
		expect(result.pt).toBe(0);
		expect(result.mlwf).toBe(0);
		expect(result.retention).toBe(0);
		expect(result.total_deductions).toBe(0);

		// Net pay
		expect(result.net_pay).toBe(30_000);

		// Cross-check invariant: earnings - deductions === net_pay
		expect(result.total_earnings - result.total_deductions).toBe(
			result.net_pay
		);

		// Gratuity is always calculated (4.81% of basic)
		// basic=18000, gratuity=18000*4.81/100=865.8→866
		expect(result.gratuity).toBe(866);
		expect(result.total_employer_contributions).toBe(866);
		expect(result.employer_cost).toBe(30_866);
	});

	it('pays the logged hours at the CTC rate and drops the attendance OT premium', () => {
		const profile = makeProfile(30_000, { employer_cost: 30_000 });
		const daAmount = 0;
		const attendance = defaultAttendance({
			totalOvertimeHours: 8,
			loggedHours: 104,
		});

		const result = computePayroll(
			'EMP001',
			'2026-01-01',
			profile,
			daAmount,
			attendance,
			false
		);

		// rate = 30000 / (26 × 8) = 144.23; 104h logged → 15000 for the month.
		expect(result.basis_hours).toBe(208);
		expect(result.hourly_rate).toBe(144.23);
		expect(result.logged_hours).toBe(104);
		expect(result.gross).toBe(15_000);
		expect(result.ot_rate).toBe(0);
		expect(result.total_earnings).toBe(15_000);
		expect(result.net_pay).toBe(15_000);
	});

	it('uses saved profile values when available', () => {
		const profile = makeProfile(30_000, {
			basic: 15_000,
			da: 3_000,
			hra: 5_000,
			conveyance: 2_000,
			call_allowance: 2_000,
			bonus: 500,
			incentive: 1_000,
			monthly_bonus: 1,
			incentive_applicable: 1,
		});
		const daAmount = 0;
		const attendance = defaultAttendance();

		const result = computePayroll(
			'EMP001',
			'2026-01-01',
			profile,
			daAmount,
			attendance,
			true
		);

		expect(result.basic).toBe(15_000);
		expect(result.da).toBe(3_000);
		expect(result.hra).toBe(5_000);
		expect(result.conveyance).toBe(2_000);
		expect(result.call_allowance).toBe(2_000);
		expect(result.bonus).toBe(500);
		expect(result.incentive).toBe(1_000);
	});

	it('calculates gratuity on full basic when no saved basic', () => {
		const gross = 50_000;
		const profile = makeProfile(gross);
		const daAmount = 0;
		const attendance = defaultAttendance();

		const result = computePayroll(
			'EMP001',
			'2026-01-01',
			profile,
			daAmount,
			attendance,
			false
		);

		// fullBasic = 60% of 50000 - daAmount = 30000
		// gratuity = 4.81% of 30000 = 1443
		expect(result.gratuity).toBe(1_443);
		expect(result.basic).toBe(30_000);
	});
});

/** Minimal db stub whose execute routes by SQL so call order never matters. */
function scheduleDb(
	canonicalRows: Record<string, unknown>[],
	legacyRows: Record<string, unknown>[] = []
) {
	const executed: string[] = [];
	return {
		executed,
		execute: vi.fn(async (sql: string) => {
			executed.push(sql);
			if (sql.includes('FROM payroll_schedules'))
				return [canonicalRows, undefined];
			if (sql.includes('FROM da_schedule')) return [legacyRows, undefined];
			return [[], undefined];
		}),
		release: vi.fn(),
	};
}

describe('getEffectivePayrollSchedule DA resolution (canonical Component Rates only)', () => {
	beforeEach(() => {
		vi.mocked(dbConnect).mockReset();
	});

	it('resolves DA from a payroll_schedules Component Rate row', async () => {
		const db = scheduleDb([
			{
				component_type: 'da',
				value_type: 'fixed',
				value: 2500,
				min_salary: null,
				max_salary: null,
				id: 7,
			},
		]);
		vi.mocked(dbConnect).mockResolvedValue(db as never);

		const { components } = await getEffectivePayrollSchedule('2026-06-01');

		expect(components.da).toMatchObject({ value_type: 'fixed', value: 2500 });
	});

	it('never queries the legacy da_schedule table', async () => {
		// Canonical table has other components but no DA row — the case where the
		// legacy fallback used to fire.
		const db = scheduleDb([
			{
				component_type: 'pt',
				value_type: 'fixed',
				value: 200,
				min_salary: null,
				max_salary: null,
				id: 1,
			},
		]);
		vi.mocked(dbConnect).mockResolvedValue(db as never);

		const { components } = await getEffectivePayrollSchedule('2026-06-01');

		expect(db.executed.some((sql) => sql.includes('da_schedule'))).toBe(false);
	});

	it('falls back to the frozen config default when no Component Rate DA row exists', async () => {
		const db = scheduleDb([]);
		vi.mocked(dbConnect).mockResolvedValue(db as never);

		const { components } = await getEffectivePayrollSchedule('2026-06-01');

		expect(components.da).toEqual({
			value_type: 'fixed',
			value: PAYROLL_CONFIG.DA_FIXED_AMOUNT,
		});
		expect(db.executed.some((sql) => sql.includes('da_schedule'))).toBe(false);
	});
});

describe('calculateEmployeePayroll — hours-based pay', () => {
	beforeEach(() => {
		vi.mocked(dbConnect).mockReset();
	});

	/** DB stub routing by SQL so call order never matters. */
	function payrollDb() {
		return {
			executed: [] as string[],
			execute: vi.fn(async (sql: string) => {
				if (sql.includes('FROM employee_salary_profile')) {
					return [
						[
							{
								employee_id: 7,
								employer_cost: 26_000,
								gross_salary: 20_000,
								pf_applicable: 0,
								esic_applicable: 0,
								pt_applicable: 0,
								effective_from: '2026-01-01',
							},
						],
						undefined,
					];
				}
				if (sql.includes('FROM user_activity_assignments')) {
					return [
						[
							{
								employee_id: null,
								user_employee_id: 7,
								user_email: null,
								user_username: null,
								daily_entries: JSON.stringify([
									{ date: '2026-06-01', hours: 8 },
									{ date: '2026-06-15', hours: 4 },
									// Another month's entry never counts.
									{ date: '2026-05-30', hours: 8 },
								]),
							},
							{
								// Nothing links this row to a pay agreement — dropped.
								employee_id: null,
								user_employee_id: null,
								user_email: 'ghost@example.com',
								user_username: null,
								daily_entries: JSON.stringify([
									{ date: '2026-06-02', hours: 8 },
								]),
							},
						],
						undefined,
					];
				}
				return [[], undefined];
			}),
			release: vi.fn(),
		};
	}

	it('prices the month from the logged assignment hours', async () => {
		vi.mocked(dbConnect).mockResolvedValue(payrollDb() as never);

		const payroll = await calculateEmployeePayroll(7, '2026-06-01');

		// June 2026 has 26 working days (Sundays excluded) → 208 payable hours.
		expect(payroll?.basis_hours).toBe(208);
		expect(payroll?.ctc_used).toBe(26_000);
		expect(payroll?.hourly_rate).toBe(125);
		expect(payroll?.logged_hours).toBe(12);
		expect(payroll?.gross).toBe(1_500);
		expect(payroll?.total_earnings).toBe(1_500);
	});
});
