import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module before importing payroll-calculator
vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn(),
	withTransaction: vi.fn(),
}));
vi.mock('@/lib/payroll-run-roster', () => ({
	loadPayrollRunRoster: vi.fn(),
	loadFrozenPayrollRunRoster: vi.fn(),
}));

// Static imports after mock
import { dbConnect, withTransaction } from '@/utils/database';
import { loadPayrollRunRoster } from '@/lib/payroll-run-roster';
import {
	PayrollGenerationError,
	calculateEmployeePayroll,
	computePayroll,
	generateMonthlyPayroll,
	generatePayrollSlip,
	generatePayrollSlipsBatch,
	getEffectivePayrollSchedule,
	payrollGenerationRefusal,
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
		vi.mocked(loadPayrollRunRoster).mockReset();
	});

	/** DB stub routing by SQL so call order never matters. */
	function payrollDb() {
		return {
			executed: [] as string[],
			execute: vi.fn(async (sql: string) => {
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

	it('prices the month from the logged assignment hours and the roster profile', async () => {
		const db = payrollDb();
		vi.mocked(dbConnect).mockResolvedValue(db as never);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-06-01',
			members: [
				{
					employee_id: 7,
					employee_code: 'EMP007',
					name: 'Asha Rao',
					employee_type: 'Payroll',
					employment_start: '2026-01-01',
					employment_end: null,
					profile_date: '2026-06-01',
					salary_profile: {
						...makeProfile(20_000),
						employer_cost: 26_000,
					},
					profile_source: 'employee_salary_profile',
					profile_id: 3,
					salary_type: 'monthly',
					issue: null,
				},
			],
			excluded: [],
		} as never);

		const payroll = await calculateEmployeePayroll(7, '2026-06-01');

		// June 2026 has 26 working days (Sundays excluded) → 208 payable hours.
		expect(payroll?.basis_hours).toBe(208);
		expect(payroll?.ctc_used).toBe(26_000);
		expect(payroll?.hourly_rate).toBe(125);
		expect(payroll?.logged_hours).toBe(12);
		expect(payroll?.gross).toBe(1_500);
		expect(payroll?.total_earnings).toBe(1_500);
	});

	it('returns null for an employee the roster does not cover', async () => {
		const db = payrollDb();
		vi.mocked(dbConnect).mockResolvedValue(db as never);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-06-01',
			members: [],
			excluded: [],
		} as never);

		expect(await calculateEmployeePayroll(7, '2026-06-01')).toBeNull();
	});
});

describe('payrollGenerationRefusal — one eligibility rule for every generation path', () => {
	const member = (overrides: Record<string, unknown> = {}) => ({
		employee_id: 7,
		employee_code: 'EMP007',
		name: 'Asha Rao',
		employee_type: 'Payroll',
		employment_start: '2026-01-01',
		employment_end: null,
		profile_date: '2026-08-01',
		salary_profile: makeProfile(30_000),
		profile_source: 'employee_salary_profile',
		profile_id: 3,
		salary_type: 'monthly',
		issue: null,
		...overrides,
	});

	it('allows an eligible member', () => {
		expect(payrollGenerationRefusal(member(), 7, '2026-08-01')).toBeNull();
	});

	it('refuses an employee the roster does not contain', () => {
		const refusal = payrollGenerationRefusal(null, 99, '2026-08-01');
		expect(refusal).toBeInstanceOf(PayrollGenerationError);
		expect(refusal).toMatchObject({
			status: 422,
			code: 'payroll_member_not_found',
			employeeId: 99,
		});
	});

	it('refuses an employment-date review with the named reason', () => {
		const refusal = payrollGenerationRefusal(
			member({ issue: 'employment_dates_missing' }),
			7,
			'2026-08-01'
		);
		expect(refusal).toMatchObject({
			status: 422,
			code: 'payroll_employment_review',
			reviewReason: 'employment_dates_missing',
		});
		expect(refusal?.message).toMatch(/employment dates are missing/);
	});

	it('refuses a member without a Salary Profile', () => {
		const refusal = payrollGenerationRefusal(
			member({ salary_profile: null }),
			7,
			'2026-08-01'
		);
		expect(refusal).toMatchObject({
			status: 400,
			code: 'payroll_profile_missing',
		});
		expect(refusal?.message).toContain('No active salary profile');
	});
});

describe('payroll generation — the shared roster is the only population', () => {
	beforeEach(() => {
		vi.mocked(dbConnect).mockReset();
		vi.mocked(withTransaction).mockReset();
		vi.mocked(loadPayrollRunRoster).mockReset();
	});

	const member = (
		employeeId: number,
		overrides: Record<string, unknown> = {}
	) => ({
		employee_id: employeeId,
		employee_code: `EMP00${employeeId}`,
		name: `Employee ${employeeId}`,
		employee_type: 'Payroll',
		employment_start: '2026-01-01',
		employment_end: null,
		profile_date: '2026-08-01',
		salary_profile: makeProfile(30_000),
		profile_source: 'employee_salary_profile',
		profile_id: employeeId,
		salary_type: 'monthly',
		issue: null,
		...overrides,
	});

	/** One connection for the insert writes and for the holiday read. */
	function generationDb(existingSlipIds: number[] = []) {
		const inserted: unknown[][] = [];
		const db = {
			execute: vi.fn(async (sql: string, params: unknown[] = []) => {
				const text = String(sql);
				if (text.includes('INSERT INTO payroll_slips')) {
					inserted.push(params);
					return [{ insertId: inserted.length, affectedRows: 1 }, undefined];
				}
				if (text.includes('FROM payroll_slips')) {
					return [
						existingSlipIds.map((employee_id) => ({ employee_id })),
						undefined,
					];
				}
				if (text.includes('FROM payroll_schedules')) {
					return [[], undefined];
				}
				return [[], undefined];
			}),
			query: vi.fn(async (_sql: string, params: unknown[]) => {
				inserted.push(params);
				return [{ affectedRows: 1 }, undefined];
			}),
			release: vi.fn(),
		};
		return { db, inserted };
	}

	it('generates for an eligible leaver and skips an employee who already has a slip', async () => {
		const { db, inserted } = generationDb([11]);
		vi.mocked(dbConnect).mockResolvedValue(db as never);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [
				member(11),
				// Inactive leaver with a mid-month exit: still employed this month.
				member(12, {
					employment_end: '2026-08-15',
					employee_type: 'Contract',
					salary_type: 'contract',
				}),
				// Payroll/Contract candidates with gaps never generate; Finalize names them.
				member(13, { salary_profile: null }),
				member(14, {
					employment_start: null,
					issue: 'employment_dates_missing',
				}),
			],
			excluded: [],
		} as never);

		const results = await generateMonthlyPayroll(
			'2026-08-01',
			null,
			false,
			null,
			{ db: db as never }
		);

		expect(results).toMatchObject({
			total: 2,
			success: 1,
			failed: 0,
			skipped: 1,
		});
		expect(inserted).toHaveLength(1);
		// SLIP_INSERT_COLUMNS: month first, employee_id second.
		expect(inserted[0][1]).toBe(12);
	});

	it('refuses a directly requested employee the roster does not cover', async () => {
		const { db, inserted } = generationDb([]);
		vi.mocked(dbConnect).mockResolvedValue(db as never);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(11)],
			excluded: [
				{
					employee_id: 99,
					employee_code: 'EMP099',
					name: 'Off Roster',
					reason: 'not_employed',
				},
			],
		} as never);

		const results = await generatePayrollSlipsBatch(
			[11, 99],
			'2026-08-01',
			false,
			null,
			{ db: db as never }
		);

		expect(results.success).toBe(1);
		expect(results.failed).toBe(1);
		expect(results.errors[0]).toMatchObject({
			employee_id: 99,
			reason: 'payroll_member_not_found',
		});
		expect(inserted).toHaveLength(1);
		expect(inserted[0][1]).toBe(11);
	});

	it('refuses a single slip for an employee the roster does not cover', async () => {
		const { db, inserted } = generationDb([]);
		vi.mocked(dbConnect).mockResolvedValue(db as never);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [],
			excluded: [],
		} as never);

		await expect(
			generatePayrollSlip(99, '2026-08-01', { db: db as never })
		).rejects.toMatchObject({
			code: 'payroll_member_not_found',
			status: 422,
		});
		expect(inserted).toHaveLength(0);
	});

	it('takes the run row lock when called without a caller transaction', async () => {
		const db = {
			execute: vi.fn(async (sql: string) =>
				String(sql).includes('FROM payroll_runs')
					? [
							[
								{
									id: 7,
									month: 8,
									year: 2026,
									run_number: 1,
									status: 'finalized',
								},
							],
							undefined,
						]
					: [[], undefined]
			),
			query: vi.fn(),
			release: vi.fn(),
		};
		vi.mocked(withTransaction).mockImplementation(async (fn) =>
			fn(db as never)
		);

		await expect(generateMonthlyPayroll('2026-08-01')).rejects.toMatchObject({
			code: 'payroll_run_locked',
			status: 409,
		});
		expect(db.query).not.toHaveBeenCalled();
	});
});
