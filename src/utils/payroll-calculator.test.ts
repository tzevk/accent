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
vi.mock('@/lib/salary-profile-store', () => ({
	lockSalaryEmployees: vi.fn(),
	recordSalaryAgreementUse: vi.fn(),
}));

// Static imports after mock
import { dbConnect, withTransaction } from '@/utils/database';
import { loadPayrollRunRoster } from '@/lib/payroll-run-roster';
import {
	lockSalaryEmployees,
	recordSalaryAgreementUse,
} from '@/lib/salary-profile-store';
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

/**
 * Every generation write path takes the shared Employee mutex before reading
 * terms. Default stubs keep unrelated generation tests focused: all requested
 * ids exist and use evidence records successfully unless a test overrides it.
 */
const stubEmployeeLocks = () => {
	vi.mocked(lockSalaryEmployees).mockImplementation(
		async (_db, employeeIds) => ({
			locks: employeeIds.map((employee_id) => ({
				employee_id,
				timeline_version: 0,
				timeline_exists: false,
				joining_date: null,
				hire_date: null,
				is_delete: false,
			})),
			missing_employee_ids: [],
		})
	);
};
const stubRecordedUse = () => {
	vi.mocked(recordSalaryAgreementUse).mockResolvedValue({
		recorded: true,
		ambiguous_prior: false,
		timeline_version: 1,
	});
};
stubEmployeeLocks();
stubRecordedUse();

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
				if (sql.includes('FROM logged_activity_assignments')) {
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

	it('refuses overlapping covering agreements as ambiguous, naming the competitors', () => {
		const refusal = payrollGenerationRefusal(
			member({
				salary_profile: null,
				profile_source: null,
				profile_id: null,
				salary_type: null,
				salary_issue: 'salary_profile_ambiguous',
				salary_conflict_ids: [3, 5],
			}),
			7,
			'2026-08-01'
		);
		expect(refusal).toMatchObject({
			status: 422,
			code: 'payroll_salary_ambiguous',
			reviewReason: 'salary_profile_ambiguous',
		});
		expect(refusal?.message).toMatch(/overlapping Salary Profiles/i);
		expect(refusal?.message).toContain('3, 5');
	});

	it('refuses an agreement with no CTC instead of pricing it as zero', () => {
		const refusal = payrollGenerationRefusal(
			member({
				salary_profile: makeProfile(0, {
					gross_salary: null,
					employer_cost: null,
				}),
				salary_issue: 'salary_ctc_missing',
			}),
			7,
			'2026-08-01'
		);
		expect(refusal).toMatchObject({
			status: 422,
			code: 'payroll_ctc_missing',
			reviewReason: 'salary_ctc_missing',
		});
		expect(refusal?.message).toMatch(/no monthly CTC/i);
	});

	it('refuses a present-but-invalid CTC separately from missing', () => {
		const refusal = payrollGenerationRefusal(
			member({
				salary_profile: { employer_cost: -1 },
				salary_issue: 'salary_ctc_invalid',
			}),
			7,
			'2026-08-01'
		);
		expect(refusal).toMatchObject({
			status: 422,
			code: 'payroll_ctc_invalid',
			reviewReason: 'salary_ctc_invalid',
		});
		expect(refusal?.message).toMatch(/CTC is invalid/i);
	});

	it('allows an explicitly zero canonical CTC', () => {
		const refusal = payrollGenerationRefusal(
			member({
				salary_profile: { employer_cost: 0 },
				salary_issue: null,
				salary_ctc_source: 'employer_cost',
			}),
			7,
			'2026-08-01'
		);
		expect(refusal).toBeNull();
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

describe('payroll generation — locked terms, recorded provenance and durable use (issue #438)', () => {
	beforeEach(() => {
		vi.mocked(dbConnect).mockReset();
		vi.mocked(withTransaction).mockReset();
		vi.mocked(loadPayrollRunRoster).mockReset();
		vi.mocked(lockSalaryEmployees).mockReset();
		vi.mocked(recordSalaryAgreementUse).mockReset();
		stubEmployeeLocks();
		stubRecordedUse();
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
		salary_profile: { employer_cost: 30_000 },
		profile_source: 'employee_salary_profile',
		profile_id: employeeId,
		salary_type: 'monthly',
		salary_issue: null,
		salary_conflict_ids: [],
		salary_ctc_source: 'employer_cost',
		issue: null,
		...overrides,
	});

	/** One connection for the slip writes, holiday reads and existing-slip check. */
	function generationDb(existingSlipIds: number[] = []) {
		const inserted: Array<{ sql: string; params: unknown[] }> = [];
		const db = {
			execute: vi.fn(async (sql: string, params: unknown[] = []) => {
				const text = String(sql);
				if (text.includes('INSERT INTO payroll_slips')) {
					inserted.push({ sql: text, params });
					return [{ insertId: inserted.length, affectedRows: 1 }, undefined];
				}
				if (text.includes('FROM payroll_slips')) {
					return [
						existingSlipIds.map((employee_id) => ({
							id: employee_id + 100,
							employee_id,
						})),
						undefined,
					];
				}
				if (text.includes('FROM payroll_schedules')) return [[], undefined];
				return [[], undefined];
			}),
			query: vi.fn(async (sql: string, params: unknown[] = []) => {
				inserted.push({ sql: String(sql), params });
				return [{ affectedRows: 1 }, undefined];
			}),
			release: vi.fn(),
		};
		return { db, inserted };
	}

	/** Map one generated slip's parameter list back to its column names. */
	function slipValues(insert: { sql: string; params: unknown[] }) {
		const match = /INSERT INTO payroll_slips \(([\s\S]*?)\)\s*VALUES/.exec(
			insert.sql
		);
		if (!match) throw new Error('not a slip insert');
		const columns = match[1].split(',').map((column) => column.trim());
		return Object.fromEntries(
			columns.map((column, index) => [column, insert.params[index]])
		);
	}

	it('locks the Employee, records the exact agreement on the slip and durable use in the same transaction', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(7)],
			excluded: [],
		} as never);

		await generatePayrollSlip(7, '2026-08-01', {
			db: db as never,
			payrollRunId: 42,
			actorId: 9,
		});

		// Current terms are re-read under the sorted Employee lock, not the run
		// row's snapshot.
		expect(loadPayrollRunRoster).toHaveBeenCalledWith(db, '2026-08-01', {
			employeeIds: [7],
			forUpdate: true,
		});
		// The Employee mutex is taken before the agreement terms are re-read.
		expect(
			vi.mocked(lockSalaryEmployees).mock.invocationCallOrder[0]
		).toBeLessThan(vi.mocked(loadPayrollRunRoster).mock.invocationCallOrder[0]);
		expect(inserted).toHaveLength(1);
		expect(slipValues(inserted[0])).toMatchObject({
			month: '2026-08-01',
			employee_id: 7,
			salary_profile_id: 7,
			salary_profile_source: 'employee_salary_profile',
			salary_type: 'monthly',
		});
		// Source-qualified agreement/month use on the caller's transaction, so
		// the insert and the protection commit or roll back together.
		expect(recordSalaryAgreementUse).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				employeeId: 7,
				agreementId: 7,
				agreementSource: 'employee_salary_profile',
				month: '2026-08-01',
				evidence: 'payroll_generation',
				evidenceContext: { payroll_run_id: 42 },
				actorId: 9,
			})
		);
	});

	it('locks the candidate population before pricing an all-employee run and records use only for new slips', async () => {
		const { db, inserted } = generationDb([11]);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(11), member(12)],
			excluded: [],
		} as never);

		const results = await generateMonthlyPayroll(
			'2026-08-01',
			null,
			false,
			null,
			{ db: db as never, payrollRunId: 42 }
		);

		expect(loadPayrollRunRoster).toHaveBeenCalledWith(db, '2026-08-01', {
			forUpdate: true,
		});
		expect(results).toMatchObject({ total: 2, success: 1, skipped: 1 });
		expect(inserted).toHaveLength(1);
		expect(slipValues(inserted[0])).toMatchObject({
			employee_id: 12,
			salary_profile_id: 12,
		});
		// The skipped existing slip is never repriced and never re-used.
		expect(recordSalaryAgreementUse).toHaveBeenCalledTimes(1);
		expect(recordSalaryAgreementUse).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				employeeId: 12,
				agreementId: 12,
				evidence: 'payroll_generation',
			})
		);
	});

	it('scopes a batch lock to the requested Employees and records each inserted agreement', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(7), member(8)],
			excluded: [],
		} as never);

		await generatePayrollSlipsBatch([8, 7], '2026-08-01', false, null, {
			db: db as never,
		});

		expect(lockSalaryEmployees).toHaveBeenCalledWith(db, [7, 8]);
		expect(loadPayrollRunRoster).toHaveBeenCalledWith(db, '2026-08-01', {
			employeeIds: [7, 8],
			forUpdate: true,
		});
		expect(inserted.map((insert) => slipValues(insert).employee_id)).toEqual([
			7, 8,
		]);
		expect(
			vi
				.mocked(recordSalaryAgreementUse)
				.mock.calls.map(([, input]) => input.employeeId)
		).toEqual([7, 8]);
	});

	it('refuses a batch member with missing CTC with a distinct reason and writes nothing', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [
				member(7, {
					salary_profile: { employer_cost: null, gross_salary: null },
					salary_issue: 'salary_ctc_missing',
					salary_ctc_source: 'none',
				}),
			],
			excluded: [],
		} as never);

		const results = await generatePayrollSlipsBatch(
			[7],
			'2026-08-01',
			false,
			null,
			{ db: db as never }
		);

		expect(results).toMatchObject({ success: 0, failed: 1 });
		expect(results.errors[0]).toMatchObject({
			employee_id: 7,
			reason: 'payroll_ctc_missing',
			review_reason: 'salary_ctc_missing',
		});
		expect(inserted).toHaveLength(0);
		expect(recordSalaryAgreementUse).not.toHaveBeenCalled();
	});

	it('prices an explicitly zero canonical CTC and marks it used', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [
				member(7, {
					salary_profile: { employer_cost: 0 },
					salary_ctc_source: 'employer_cost',
				}),
			],
			excluded: [],
		} as never);

		await generatePayrollSlip(7, '2026-08-01', { db: db as never });

		expect(inserted).toHaveLength(1);
		expect(Number(slipValues(inserted[0]).ctc_used)).toBe(0);
		expect(recordSalaryAgreementUse).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				employeeId: 7,
				agreementId: 7,
				evidence: 'payroll_generation',
			})
		);
	});

	it('refuses a requested Employee who no longer exists instead of pricing nothing', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(lockSalaryEmployees).mockResolvedValueOnce({
			locks: [],
			missing_employee_ids: [99],
		});

		await expect(
			generatePayrollSlip(99, '2026-08-01', { db: db as never })
		).rejects.toMatchObject({
			code: 'payroll_member_not_found',
			status: 422,
		});
		expect(inserted).toHaveLength(0);
		expect(recordSalaryAgreementUse).not.toHaveBeenCalled();
	});

	it('skips an existing single Employee slip without pricing or marking new use', async () => {
		const { db, inserted } = generationDb([7]);
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(7)],
			excluded: [],
		} as never);

		await expect(
			generatePayrollSlip(7, '2026-08-01', { db: db as never })
		).rejects.toThrow(/already exists/i);
		expect(inserted).toHaveLength(0);
		expect(recordSalaryAgreementUse).not.toHaveBeenCalled();
	});

	it('propagates a failed use write so the same transaction rolls the slip back', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(7)],
			excluded: [],
		} as never);
		vi.mocked(recordSalaryAgreementUse).mockRejectedValueOnce(
			new Error('use evidence write failed')
		);

		await expect(
			generatePayrollSlip(7, '2026-08-01', { db: db as never })
		).rejects.toThrow('use evidence write failed');
		// The insert ran first; the caller's transaction is what removes it.
		expect(inserted).toHaveLength(1);
	});

	it('never prices a roster member with missing CTC during an all-employee run', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [
				member(7),
				member(8, {
					salary_profile: { employer_cost: null, gross_salary: null },
					salary_issue: 'salary_ctc_missing',
					salary_ctc_source: 'none',
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

		expect(results).toMatchObject({ total: 1, success: 1, failed: 0 });
		expect(inserted).toHaveLength(1);
		expect(slipValues(inserted[0]).employee_id).toBe(7);
		expect(recordSalaryAgreementUse).toHaveBeenCalledTimes(1);
		expect(recordSalaryAgreementUse).toHaveBeenCalledWith(
			db,
			expect.objectContaining({ employeeId: 7 })
		);
	});

	it('aborts an all-employee run instead of committing slips without use evidence', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(7)],
			excluded: [],
		} as never);
		vi.mocked(recordSalaryAgreementUse).mockRejectedValueOnce(
			new Error('use evidence write failed')
		);

		await expect(
			generateMonthlyPayroll('2026-08-01', null, false, null, {
				db: db as never,
			})
		).rejects.toThrow('use evidence write failed');
		expect(inserted).toHaveLength(1);
	});

	it('aborts a batch instead of committing a slip it could not protect', async () => {
		const { db, inserted } = generationDb();
		vi.mocked(loadPayrollRunRoster).mockResolvedValue({
			month: '2026-08-01',
			members: [member(7)],
			excluded: [],
		} as never);
		vi.mocked(recordSalaryAgreementUse).mockRejectedValueOnce(
			new Error('use evidence write failed')
		);

		await expect(
			generatePayrollSlipsBatch([7], '2026-08-01', false, null, {
				db: db as never,
			})
		).rejects.toThrow('use evidence write failed');
		expect(inserted).toHaveLength(1);
	});
});
