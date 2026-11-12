import { describe, expect, it } from 'vitest';
import {
	COMPANY_SHEET_COLUMNS,
	buildCompanySheet,
	type CompanySheetAttendanceRecord,
	type CompanySheetInput,
	type CompanySheetRow,
	type CompanySheetSlipInput,
} from './payroll-company-sheet';

/**
 * Primary seam for the company-format payroll sheet (issue #426/#427).
 *
 * These tests use only the public read-model interface: an explicit month, an
 * explicit current date, already-normalized Payroll Slip rows, and explicit
 * attendance / holiday / employment evidence. Expected values are worked from
 * the agreement, never recomputed through the module.
 */

const EMPLOYEE_ID = 42;
const OTHER_EMPLOYEE_ID = 43;
const MONTH = '2026-02-01';
const CURRENT_DATE = '2026-02-28';

const EMPLOYMENT_FULL_MONTH = {
	employee_id: EMPLOYEE_ID,
	status: 'active',
	joining_date: '2020-01-01',
	hire_date: null,
	exit_date: null,
};

function slip(
	overrides: Partial<CompanySheetSlipInput> = {}
): CompanySheetSlipInput {
	return {
		id: 101,
		month: MONTH,
		employee_id: EMPLOYEE_ID,
		employee_name: 'Asha Rao',
		employee_code: 'EMP-042',
		position: 'Accountant',
		uan: '100200300400',
		pf_no: 'PF/042',
		esi_no: 'ESI/042',
		basic: 27000,
		da: 3000,
		hra: 9000,
		conveyance: 4500,
		call_allowance: 4500,
		other_allowances: 1000,
		bonus: 0,
		incentive: 0,
		total_earnings: 49000,
		pf_employee: 1800,
		esic_employee: 200,
		pt: 200,
		tds: 1000,
		retention: 50,
		mlwf: 25,
		lwf: 10,
		other_deductions: 3000,
		lop_deduction: 100,
		total_deductions: 6385,
		net_pay: 42615,
		...overrides,
	};
}

function record(
	date: string,
	status: string | null,
	overtime_hours: number | null = null,
	extra: Partial<CompanySheetAttendanceRecord> = {}
): CompanySheetAttendanceRecord {
	return {
		employee_id: EMPLOYEE_ID,
		attendance_date: date,
		status,
		overtime_hours,
		...extra,
	};
}

function input(overrides: Partial<CompanySheetInput> = {}): CompanySheetInput {
	return {
		month: MONTH,
		current_date: CURRENT_DATE,
		slips: [slip()],
		attendance: { state: 'loaded', records: [] },
		holidays: { state: 'loaded', holidays: [] },
		employment: [EMPLOYMENT_FULL_MONTH],
		...overrides,
	};
}

function build(overrides: Partial<CompanySheetInput> = {}) {
	return buildCompanySheet(input(overrides));
}

function buckets(row: CompanySheetRow) {
	if (row.attendance.state !== 'available') {
		throw new Error(`attendance unavailable: ${row.attendance.reason}`);
	}
	return row.attendance.buckets;
}

function allDates(month: string): string[] {
	const [year, monthNumber] = month.slice(0, 7).split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return Array.from(
		{ length: lastDay },
		(_, index) => `${month.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`
	);
}

function everyDate(
	month: string,
	overrides: Record<string, Partial<CompanySheetAttendanceRecord>> = {}
) {
	return allDates(month).map((date) =>
		record(date, 'P', null, overrides[date] ?? {})
	);
}

const EXPECTED_LABELS = [
	'Employee Code',
	'Full Name',
	'Designation',
	'UAN',
	'PF No.',
	'ESIC No.',
	'Total Days',
	'Days Present',
	'Days Paid',
	'LWP Days',
	'Leave',
	'WeekOff',
	'Paid Holiday',
	'OT Hours',
	'BASIC',
	'DA',
	'HRA',
	'CONVEYANCE ALLOWANCE',
	'CALL ALLOWANCE',
	'OTHER ALLOWANCE',
	'PAID HOLIDAY AMOUNT',
	'BONUS',
	'OT RATE',
	'INCENTIVE',
	'BASIC Arrears',
	'DA Arrears',
	'HRA Arrears',
	'CALW Arrears',
	'CALALW Arrears',
	'OTHALW Arrears',
	'PHA Arrears',
	'BONUS Arrears',
	'OT Arrears',
	'INCENTIVE Arrears',
	'GROSS',
	'EBONUS',
	'EMPRPF',
	'PAI',
	'RATE',
	'EC',
	'EPFWAGE',
	'PROVIDENT FUND',
	'PF DIFFERENCE AMOUNT',
	'ESIC',
	'PROFESSIONAL TAX',
	'LOAN',
	'ADVANCE',
	'TAX DEDUCTED AT SOURCE',
	'RETENTION AMOUNT',
	'TOTAL DED',
	'NET SAL',
] as const;

const EXPECTED_IDS = [
	'employee_code',
	'full_name',
	'designation',
	'uan',
	'pf_no',
	'esic_no',
	'total_days',
	'days_present',
	'days_paid',
	'lwp_days',
	'leave',
	'week_off',
	'paid_holiday',
	'ot_hours',
	'basic',
	'da',
	'hra',
	'conveyance_allowance',
	'call_allowance',
	'other_allowance',
	'paid_holiday_amount',
	'bonus',
	'ot_rate',
	'incentive',
	'basic_arrears',
	'da_arrears',
	'hra_arrears',
	'calw_arrears',
	'calalw_arrears',
	'othalw_arrears',
	'pha_arrears',
	'bonus_arrears',
	'ot_arrears',
	'incentive_arrears',
	'gross',
	'ebonus',
	'emprpf',
	'pai',
	'rate',
	'ec',
	'epfwage',
	'provident_fund',
	'pf_difference_amount',
	'esic',
	'professional_tax',
	'loan',
	'advance',
	'tax_deducted_at_source',
	'retention_amount',
	'total_ded',
	'net_sal',
] as const;

describe('company-sheet column catalog', () => {
	it('publishes the approved 51 captions in order with stable identifiers', () => {
		expect(COMPANY_SHEET_COLUMNS.map((column) => column.label)).toEqual(
			EXPECTED_LABELS
		);
		expect(COMPANY_SHEET_COLUMNS.map((column) => column.id)).toEqual(
			EXPECTED_IDS
		);
		expect(new Set(COMPANY_SHEET_COLUMNS.map((column) => column.id)).size).toBe(
			51
		);

		const row = build().rows[0];
		expect(Object.keys(row.cells).sort()).toEqual([...EXPECTED_IDS].sort());
	});

	it('rejects a month or current date that cannot anchor the calendar', () => {
		expect(() => build({ month: '2026-13-01' })).toThrow();
		expect(() => build({ current_date: '2026-02-30' })).toThrow();
	});
});

describe('calendar total days', () => {
	it.each([
		['2028-02-01', 29],
		['2026-02-01', 28],
		['2026-04-01', 30],
		['2026-01-01', 31],
	])('uses the calendar length of %s', (month, totalDays) => {
		const result = build({
			month,
			current_date: `${month.slice(0, 7)}-01`,
			slips: [slip({ month })],
		});

		expect(result.total_days).toBe(totalDays);
		expect(result.rows[0].cells.total_days).toEqual({
			state: 'number',
			value: totalDays,
		});
		expect(buckets(result.rows[0]).total_days).toBe(totalDays);
		expect(buckets(result.rows[0]).reconciliation.calendar_balanced).toBe(true);
		expect(buckets(result.rows[0]).reconciliation.paid_balanced).toBe(true);
	});
});

describe('attendance classification', () => {
	it('allocates every status category once, including half days and invalid evidence', () => {
		const result = build({
			attendance: {
				state: 'loaded',
				records: [
					record('2026-02-02', 'P'),
					record('2026-02-03', 'OT'),
					record('2026-02-04', 'HD'),
					record('2026-02-05', 'PL'),
					record('2026-02-06', 'CL'),
					record('2026-02-07', 'SL'),
					record('2026-02-09', 'EL'),
					record('2026-02-10', 'UL'),
					record('2026-02-11', 'LWP'),
					record('2026-02-12', 'A'),
					record('2026-02-13', 'H'),
					record('2026-02-16', 'WO'),
					record('2026-02-17', 'ZZ'),
				],
			},
			holidays: {
				state: 'loaded',
				holidays: [{ date: '2026-02-18' }],
			},
		});
		const row = result.rows[0];
		const summary = buckets(row);

		expect(summary).toMatchObject({
			total_days: 28,
			present: 2.5,
			absent: 1.5,
			half_days: 1,
			paid_leave: 4,
			unpaid_leave: 2,
			holidays: 2,
			weekly_off: 7,
			unrecorded: 9,
			upcoming_unrecorded: 0,
			outside_employment: 0,
			invalid_status: 1,
			days_paid: 15.5,
			lwp_days: 3.5,
		});
		expect(summary.paid_leave_by_code).toEqual({
			PL: 1,
			CL: 1,
			SL: 1,
			EL: 1,
		});
		expect(summary.unpaid_leave_by_code).toEqual({ LWP: 1, UL: 1 });
		expect(summary.reconciliation).toEqual({
			calendar_balanced: true,
			paid_balanced: true,
		});

		expect(row.cells.days_present).toEqual({ state: 'number', value: 2.5 });
		expect(row.cells.days_paid).toEqual({ state: 'number', value: 15.5 });
		expect(row.cells.lwp_days).toEqual({ state: 'number', value: 3.5 });
		expect(row.cells.leave).toEqual({ state: 'number', value: 4 });
		expect(row.cells.week_off).toEqual({ state: 'number', value: 7 });
		expect(row.cells.paid_holiday).toEqual({ state: 'number', value: 2 });
		expect(row.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'invalid_attendance_status',
					dates: ['2026-02-17'],
				}),
			])
		);
	});

	it('splits a half day across Present and Absent without double counting', () => {
		const result = build({
			attendance: {
				state: 'loaded',
				records: everyDate(MONTH, { '2026-02-10': { status: 'HD' } }),
			},
		});
		const summary = buckets(result.rows[0]);

		expect(summary).toMatchObject({
			present: 27.5,
			absent: 0.5,
			half_days: 1,
			days_paid: 27.5,
			lwp_days: 0.5,
			unrecorded: 0,
			weekly_off: 0,
			holidays: 0,
			outside_employment: 0,
		});
		expect(summary.reconciliation).toEqual({
			calendar_balanced: true,
			paid_balanced: true,
		});
	});

	it('lets a recorded status override holidays, weekly offs, and stale flags', () => {
		const result = build({
			attendance: {
				state: 'loaded',
				records: everyDate(MONTH, {
					'2026-02-01': { status: 'P', is_weekly_off: 1 },
					'2026-02-08': { status: 'PL', is_holiday: 1 },
					'2026-02-14': { status: 'H', is_weekly_off: 1 },
					'2026-02-15': { status: 'A', is_holiday: 1 },
				}),
			},
			holidays: {
				state: 'loaded',
				holidays: [{ date: '2026-02-15' }],
			},
		});
		const summary = buckets(result.rows[0]);

		expect(summary).toMatchObject({
			present: 25,
			absent: 1,
			paid_leave: 1,
			holidays: 1,
			weekly_off: 0,
			unrecorded: 0,
			outside_employment: 0,
		});
		expect(summary.reconciliation.calendar_balanced).toBe(true);
		expect(summary.reconciliation.paid_balanced).toBe(true);
	});

	it('counts a holiday that overlaps a weekly off once, as a holiday', () => {
		const result = build({
			holidays: {
				state: 'loaded',
				holidays: [{ date: '2026-02-15' }],
			},
		});
		const summary = buckets(result.rows[0]);

		expect(summary.holidays).toBe(1);
		expect(summary.weekly_off).toBe(5);
		expect(summary.unrecorded).toBe(22);
		expect(summary.reconciliation.calendar_balanced).toBe(true);
	});

	it('uses Sundays and only the second/fourth Saturdays as weekly offs', () => {
		const february = buckets(build().rows[0]);
		expect(february.weekly_off).toBe(6);
		expect(february.unrecorded).toBe(22);

		const august = build({
			month: '2026-08-01',
			slips: [slip({ month: '2026-08-01' })],
			current_date: '2026-08-31',
		});
		const augustBuckets = buckets(august.rows[0]);
		expect(augustBuckets.weekly_off).toBe(7);
		expect(augustBuckets.unrecorded).toBe(24);
	});

	it('treats missing past and future working dates as Unrecorded, not Absent', () => {
		const result = build({ current_date: '2026-02-10' });
		const summary = buckets(result.rows[0]);

		expect(summary).toMatchObject({
			present: 0,
			absent: 0,
			paid_leave: 0,
			unpaid_leave: 0,
			weekly_off: 6,
			holidays: 0,
			unrecorded: 22,
			upcoming_unrecorded: 14,
			days_paid: 6,
			lwp_days: 0,
		});
		expect(summary.reconciliation).toEqual({
			calendar_balanced: true,
			paid_balanced: true,
		});
	});

	it('reports a successful empty attendance read differently from a failed one', () => {
		const empty = build();
		expect(empty.rows[0].attendance.state).toBe('available');
		expect(buckets(empty.rows[0]).unrecorded).toBe(22);

		const failed = build({
			attendance: { state: 'error', message: 'attendance read failed' },
		});
		const failedRow = failed.rows[0];
		expect(failedRow.attendance).toMatchObject({
			state: 'unavailable',
			reason: 'attendance_source_error',
		});
		expect(failedRow.cells.days_present).toEqual({
			state: 'not_available',
			reason: 'attendance_source_error',
		});
		expect(failedRow.cells.ot_hours).toEqual({
			state: 'not_available',
			reason: 'attendance_source_error',
		});
		expect(failedRow.cells.total_days).toEqual({ state: 'number', value: 28 });
		expect(failedRow.cells.gross).toEqual({ state: 'number', value: 49000 });
		expect(failed.sources.attendance.state).toBe('error');
		expect(failed.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'attendance_source_error' }),
			])
		);
	});

	it('marks attendance unavailable when holiday evidence cannot be trusted', () => {
		const result = build({
			holidays: { state: 'error', message: 'holiday read failed' },
		});
		const row = result.rows[0];

		expect(row.attendance).toMatchObject({
			state: 'unavailable',
			reason: 'holiday_source_error',
		});
		expect(row.cells.days_paid).toEqual({
			state: 'not_available',
			reason: 'holiday_source_error',
		});
		expect(row.cells.net_sal).toEqual({ state: 'number', value: 42615 });
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'holiday_source_error' }),
			])
		);
	});

	it('ignores optional and inactive holidays unless an explicit H status records them', () => {
		const automatic = build({
			holidays: {
				state: 'loaded',
				holidays: [
					{ date: '2026-02-18', is_optional: 1 },
					{ date: '2026-02-19', is_active: 0 },
					{ date: '2026-02-20' },
				],
			},
		});
		const automaticBuckets = buckets(automatic.rows[0]);
		expect(automaticBuckets.holidays).toBe(1);
		expect(automaticBuckets.weekly_off).toBe(6);
		expect(automaticBuckets.unrecorded).toBe(21);
		expect(automatic.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'optional_holidays_ignored',
					dates: ['2026-02-18'],
				}),
			])
		);

		const explicit = build({
			attendance: {
				state: 'loaded',
				records: [record('2026-02-18', 'H')],
			},
			holidays: {
				state: 'loaded',
				holidays: [{ date: '2026-02-18', is_optional: 1 }],
			},
		});
		expect(buckets(explicit.rows[0]).holidays).toBe(1);
	});
});

describe('employment boundaries', () => {
	it('counts mid-month joining and inclusive exit dates, keeping outside dates separate', () => {
		const result = build({
			employment: [
				{
					employee_id: EMPLOYEE_ID,
					status: 'active',
					joining_date: '2026-02-10',
					hire_date: null,
					exit_date: '2026-02-20',
				},
			],
			attendance: {
				state: 'loaded',
				records: [
					record('2026-02-09', 'P'),
					record('2026-02-20', 'P'),
					record('2026-02-21', 'A'),
				],
			},
		});
		const summary = buckets(result.rows[0]);

		expect(summary).toMatchObject({
			present: 1,
			absent: 0,
			weekly_off: 2,
			unrecorded: 8,
			outside_employment: 17,
			days_paid: 3,
			lwp_days: 0,
		});
		expect(summary.reconciliation).toEqual({
			calendar_balanced: true,
			paid_balanced: true,
		});
		expect(result.rows[0].issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'attendance_outside_employment',
					dates: ['2026-02-09', '2026-02-21'],
				}),
			])
		);
	});

	it('keeps an open-ended active employment valid', () => {
		const result = build({
			employment: [
				{
					employee_id: EMPLOYEE_ID,
					status: 'active',
					joining_date: '2020-01-01',
					hire_date: null,
					exit_date: null,
				},
			],
		});
		expect(result.rows[0].attendance.state).toBe('available');
		expect(buckets(result.rows[0]).outside_employment).toBe(0);
	});

	it('falls back to hire date when joining date is absent', () => {
		const result = build({
			employment: [
				{
					employee_id: EMPLOYEE_ID,
					status: 'active',
					joining_date: null,
					hire_date: '2026-01-15',
					exit_date: null,
				},
			],
		});
		expect(result.rows[0].attendance.state).toBe('available');
		expect(buckets(result.rows[0]).outside_employment).toBe(0);
	});

	it('marks attendance unavailable, without inventing dates, when employment evidence is incomplete or inconsistent', () => {
		const cases = [
			{
				label: 'inactive without dates',
				employment: {
					employee_id: EMPLOYEE_ID,
					status: 'inactive',
					joining_date: null,
					hire_date: null,
					exit_date: null,
				},
				code: 'employment_dates_missing',
			},
			{
				label: 'impossible joining date',
				employment: {
					employee_id: EMPLOYEE_ID,
					status: 'active',
					joining_date: '2026-02-30',
					hire_date: null,
					exit_date: null,
				},
				code: 'employment_dates_invalid',
			},
			{
				label: 'inverted employment window',
				employment: {
					employee_id: EMPLOYEE_ID,
					status: 'active',
					joining_date: '2026-02-20',
					hire_date: null,
					exit_date: '2026-02-10',
				},
				code: 'employment_dates_invalid',
			},
			{
				label: 'terminated without exit date',
				employment: {
					employee_id: EMPLOYEE_ID,
					status: 'terminated',
					joining_date: '2026-01-01',
					hire_date: null,
					exit_date: null,
				},
				code: 'employment_dates_missing',
			},
		] as const;

		for (const testCase of cases) {
			const result = build({ employment: [testCase.employment] });
			const row = result.rows[0];

			expect(row.attendance, testCase.label).toMatchObject({
				state: 'unavailable',
				reason: 'employment_unavailable',
			});
			expect(row.cells.days_present, testCase.label).toEqual({
				state: 'not_available',
				reason: 'employment_unavailable',
			});
			expect(row.cells.total_days, testCase.label).toEqual({
				state: 'number',
				value: 28,
			});
			expect(row.cells.gross, testCase.label).toEqual({
				state: 'number',
				value: 49000,
			});
			expect(row.issues, testCase.label).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: testCase.code }),
				])
			);
		}
	});
});

describe('overtime and live attendance', () => {
	it('counts OT status once as Present and applies the payability gate to OT hours only', () => {
		const result = build({
			attendance: {
				state: 'loaded',
				records: everyDate(MONTH, {
					'2026-02-02': { overtime_hours: 3 },
					'2026-02-03': { status: 'OT', overtime_hours: 2 },
					'2026-02-04': { overtime_hours: 2 },
					'2026-02-05': { overtime_hours: 2.5 },
					'2026-02-06': { status: 'HD', overtime_hours: 6 },
				}),
			},
		});
		const summary = buckets(result.rows[0]);

		expect(summary).toMatchObject({
			present: 27.5,
			absent: 0.5,
			days_paid: 27.5,
			ot_hours: 11.5,
		});
		expect(result.rows[0].cells.ot_hours).toEqual({
			state: 'number',
			value: 11.5,
		});
		expect(result.rows[0].cells.ot_rate).toEqual({
			state: 'not_available',
			reason: 'unsupported_mapping',
		});

		const control = build({
			attendance: {
				state: 'loaded',
				records: everyDate(MONTH, {
					'2026-02-03': { status: 'OT' },
					'2026-02-06': { status: 'HD' },
				}),
			},
		});
		const controlSummary = buckets(control.rows[0]);
		expect(controlSummary.ot_hours).toBe(0);
		expect(controlSummary.present).toBe(summary.present);
		expect(controlSummary.days_paid).toBe(summary.days_paid);
		for (const column of COMPANY_SHEET_COLUMNS) {
			if (column.kind !== 'money') continue;
			expect(result.rows[0].cells[column.id], column.id).toEqual(
				control.rows[0].cells[column.id]
			);
		}
	});

	it('lets current attendance change between reads without changing snapshot money', () => {
		const first = build({
			attendance: {
				state: 'loaded',
				records: [record('2026-02-02', 'P')],
			},
		});
		const second = build({
			attendance: {
				state: 'loaded',
				records: [record('2026-02-02', 'A')],
			},
		});

		expect(first.rows[0].cells.days_present).toEqual({
			state: 'number',
			value: 1,
		});
		expect(second.rows[0].cells.days_present).toEqual({
			state: 'number',
			value: 0,
		});
		expect(second.rows[0].cells.days_paid).not.toEqual(
			first.rows[0].cells.days_paid
		);
		for (const column of COMPANY_SHEET_COLUMNS) {
			if (column.kind !== 'money') continue;
			expect(second.rows[0].cells[column.id], column.id).toEqual(
				first.rows[0].cells[column.id]
			);
		}
	});
});

describe('financial snapshot mapping', () => {
	it('reads Designation from position and the business Employee Code, never lookalike fields', () => {
		const result = build({
			slips: [
				slip({
					employee_code: 'EMP-042',
					position: null,
					designation: 'Grade Manager',
					device_code: 'BIO-999',
					biometric_code: 'BIO-888',
				} as CompanySheetSlipInput),
			],
		});
		const row = result.rows[0];

		expect(row.cells.employee_code).toEqual({
			state: 'text',
			value: 'EMP-042',
		});
		expect(row.cells.designation).toEqual({
			state: 'not_available',
			reason: 'not_recorded',
		});
	});

	it('keeps normalized Basic/DA, ignores a later profile revision, and never invents Loan/Advance splits', () => {
		const revised = {
			...slip(),
			basic: 27000,
			da: 3000,
			profile_basic: 18000,
			profile_basic_plus_da: 123456,
			gross: 999999,
			loan: 5000,
			advance: 1000,
		} as CompanySheetSlipInput;
		const result = build({ slips: [revised] });
		const row = result.rows[0];

		expect(row.cells.basic).toEqual({ state: 'number', value: 27000 });
		expect(row.cells.da).toEqual({ state: 'number', value: 3000 });
		expect(row.cells.gross).toEqual({ state: 'number', value: 49000 });
		expect(row.cells.loan).toEqual({
			state: 'not_available',
			reason: 'unsupported_mapping',
		});
		expect(row.cells.advance).toEqual({
			state: 'not_available',
			reason: 'unsupported_mapping',
		});

		const repeated = build({ slips: [revised] });
		expect(repeated.rows[0].cells.basic).toEqual(row.cells.basic);
		expect(repeated.rows[0].cells.da).toEqual(row.cells.da);
	});

	it('distinguishes genuine zero, missing value, unsupported mapping, and unavailable evidence', () => {
		const result = build({
			slips: [
				slip({
					hra: 0,
					bonus: null,
					pt: 0,
					uan: '',
					total_earnings: 0,
				} as CompanySheetSlipInput),
			],
			attendance: { state: 'error', message: 'unavailable' },
		});
		const row = result.rows[0];

		expect(row.cells.hra).toEqual({ state: 'number', value: 0 });
		expect(row.cells.professional_tax).toEqual({
			state: 'number',
			value: 0,
		});
		expect(row.cells.gross).toEqual({ state: 'number', value: 0 });
		expect(row.cells.bonus).toEqual({
			state: 'not_available',
			reason: 'not_recorded',
		});
		expect(row.cells.uan).toEqual({
			state: 'not_available',
			reason: 'not_recorded',
		});
		expect(row.cells.paid_holiday_amount).toEqual({
			state: 'not_available',
			reason: 'unsupported_mapping',
		});
		expect(row.cells.days_present).toEqual({
			state: 'not_available',
			reason: 'attendance_source_error',
		});
	});

	it('does not guess mappings for unknown company abbreviations', () => {
		const result = build({
			slips: [
				{
					...slip(),
					ebonus: 1,
					emprpf: 2,
					pai: 3,
					rate: 4,
					ec: 5,
					epfwage: 6,
					pf_difference_amount: 7,
					basic_arrears: 8,
					da_arrears: 9,
					hra_arrears: 10,
					calw_arrears: 11,
					calalw_arrears: 12,
					othalw_arrears: 13,
					pha_arrears: 14,
					bonus_arrears: 15,
					ot_arrears: 16,
					incentive_arrears: 17,
					paid_holiday_amount: 18,
					ot_rate: 19,
					loan: 20,
					advance: 21,
				} as CompanySheetSlipInput,
			],
		});
		const row = result.rows[0];

		for (const id of [
			'ebonus',
			'emprpf',
			'pai',
			'rate',
			'ec',
			'epfwage',
			'pf_difference_amount',
			'basic_arrears',
			'da_arrears',
			'hra_arrears',
			'calw_arrears',
			'calalw_arrears',
			'othalw_arrears',
			'pha_arrears',
			'bonus_arrears',
			'ot_arrears',
			'incentive_arrears',
			'paid_holiday_amount',
			'ot_rate',
			'loan',
			'advance',
		] as const) {
			expect(row.cells[id], id).toEqual({
				state: 'not_available',
				reason: 'unsupported_mapping',
			});
		}
	});

	it('keeps stored totals authoritative and warns instead of manufacturing balancing amounts', () => {
		const result = build({
			slips: [
				slip({
					total_earnings: 60000,
					total_deductions: 7000,
					net_pay: 53000,
				}),
			],
		});
		const row = result.rows[0];

		expect(row.cells.gross).toEqual({ state: 'number', value: 60000 });
		expect(row.cells.total_ded).toEqual({ state: 'number', value: 7000 });
		expect(row.cells.net_sal).toEqual({ state: 'number', value: 53000 });
		expect(row.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'earnings_reconciliation_gap',
					difference: 11000,
				}),
				expect.objectContaining({
					code: 'deductions_reconciliation_gap',
					difference: 615,
				}),
			])
		);
		expect(row.deduction_details).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: expect.stringContaining('adjust') }),
			])
		);
	});

	it('shows extra recorded deductions in details and explains combined Loan/Advance', () => {
		const result = build();
		const row = result.rows[0];
		const details = new Map(
			row.deduction_details.map((detail) => [detail.id, detail])
		);

		expect(details.get('mlwf')).toMatchObject({
			amount: 25,
			state: 'recorded',
			in_company_columns: false,
		});
		expect(details.get('lwf')).toMatchObject({
			amount: 10,
			state: 'recorded',
			in_company_columns: false,
		});
		expect(details.get('other_deductions')).toMatchObject({
			amount: 3000,
			state: 'recorded',
			in_company_columns: false,
		});
		expect(details.get('other_deductions')?.note).toMatch(/loan|advance/i);
		expect(details.get('lop_deduction')).toMatchObject({
			amount: 100,
			state: 'recorded',
			in_company_columns: false,
		});
		expect(details.get('professional_tax')).toMatchObject({
			amount: 200,
			state: 'recorded',
			in_company_columns: true,
		});
		expect(row.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'loan_advance_split_unavailable' }),
			])
		);
	});
});

describe('row population', () => {
	it('keeps one row per input Payroll Slip and ignores attendance-only Employees', () => {
		const result = build({
			slips: [
				slip(),
				slip({
					id: 102,
					employee_id: OTHER_EMPLOYEE_ID,
					employee_name: 'Bilal Khan',
					employee_code: 'EMP-043',
				}),
			],
			employment: [
				EMPLOYMENT_FULL_MONTH,
				{ ...EMPLOYMENT_FULL_MONTH, employee_id: OTHER_EMPLOYEE_ID },
			],
			attendance: {
				state: 'loaded',
				records: [
					record('2026-02-02', 'P'),
					record('2026-02-02', 'P'),
					{
						employee_id: 999,
						attendance_date: '2026-02-02',
						status: 'P',
						overtime_hours: null,
					},
				],
			},
		});

		expect(result.rows).toHaveLength(2);
		expect(result.rows.map((row) => row.slip_id)).toEqual([101, 102]);
		expect(result.rows.map((row) => row.employee_id)).toEqual([
			EMPLOYEE_ID,
			OTHER_EMPLOYEE_ID,
		]);
		expect(result.rows[0].issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'attendance_duplicate_date',
					dates: ['2026-02-02'],
				}),
			])
		);
	});

	it('keeps a mismatched slip visible and discloses the month mismatch', () => {
		const result = build({
			slips: [slip({ month: '2026-03-01' })],
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'slip_month_mismatch' }),
			])
		);
	});
});
