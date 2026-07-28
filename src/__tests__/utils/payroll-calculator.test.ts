import { describe, it, expect, vi } from 'vitest';

// Mock database module before importing payroll-calculator
vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn(),
}));

// Static imports after mock
import { computePayroll } from '@/utils/payroll-calculator';

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

	it('handles overtime correctly', () => {
		const gross = 30_000;
		const profile = makeProfile(gross);
		const daAmount = 0;
		const attendance = defaultAttendance({ totalOvertimeHours: 8 });

		const result = computePayroll(
			'EMP001',
			'2026-01-01',
			profile,
			daAmount,
			attendance,
			false
		);

		// OT = (basic + da) / 8 * overtimeHours = 18000/8*8 = 18000
		expect(result.ot_rate).toBe(18_000);
		expect(result.total_earnings).toBe(30_000 + 18_000);
		expect(result.net_pay).toBe(30_000 + 18_000);
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
