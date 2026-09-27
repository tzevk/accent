import { describe, it, expect } from 'vitest';
import {
	parseDailyEntries,
	sumMonthlyHours,
	monthLabel,
	monthToKey,
	getFinancialYear,
	formatFyLabel,
	parseProjectManhoursList,
	collectManhoursTabMonths,
	fyKeyToCalendarMonthMap,
	resolveMonthlySalary,
	resolveHourlyRate,
	pickActiveProfile,
	buildBillingRows,
	buildTotals,
	buildAnnualBillingRows,
	buildAnnualTotals,
	type SalaryProfile,
	type BillingEmployeeRow,
	type ProjectManhourTabRow,
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
		tds_percentage: 10,
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

describe('collectManhoursTabMonths', () => {
	it('maps year-less tab keys onto the FY calendar (Apr–Dec of fyYear)', () => {
		const entries: ProjectManhourTabRow[] = [
			{ monthly_hours: { apr: 10, may: '12' } },
		];
		expect(collectManhoursTabMonths(entries, 2026)).toEqual([
			'2026-04',
			'2026-05',
		]);
	});

	it('rolls Jan–Mar into the next calendar year', () => {
		const entries: ProjectManhourTabRow[] = [
			{ monthly_hours: { jan: 8, mar: '4.5' } },
		];
		expect(collectManhoursTabMonths(entries, 2026)).toEqual([
			'2027-01',
			'2027-03',
		]);
	});

	it('ignores blank/zero hours and unknown keys', () => {
		const entries: ProjectManhourTabRow[] = [
			{ monthly_hours: { apr: 0, may: '', jun: '0', bogus: 5 } },
			{ employee_name: 'No hours object' },
		];
		expect(collectManhoursTabMonths(entries, 2026)).toEqual([]);
	});

	it('dedupes months across rows and returns them sorted', () => {
		const entries: ProjectManhourTabRow[] = [
			{ monthly_hours: { apr: 2 } },
			{ monthly_hours: { APR: 3, dec: 1 } },
		];
		expect(collectManhoursTabMonths(entries, 2025)).toEqual([
			'2025-04',
			'2025-12',
		]);
	});

	it('exposes the same key→calendar mapping as the annual view', () => {
		const map = fyKeyToCalendarMonthMap(2026);
		expect(map.apr).toBe('2026-04');
		expect(map.dec).toBe('2026-12');
		expect(map.jan).toBe('2027-01');
		expect(map.mar).toBe('2027-03');
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

	it('groups hours by employee and computes charges, TDS, and net payable', () => {
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
			new Map(),
			'2026-04'
		);
		expect(rows).toHaveLength(2);

		// Alice: 8 + 8 + 4 = 20h; rate = 20000 / 208 = 96.15; amount = 1923.08
		const alice = rows.find((r) => r.employee_name === 'Alice')!;
		expect(alice.total_manhours).toBe(20);
		expect(alice.employee_charges).toBe(96.15);
		expect(alice.amount).toBe(1923.08);
		// TDS 10% of 1923.08 = 192.31; net = 1730.77; no accent rates → 0
		expect(alice.tds_rate).toBe(10);
		expect(alice.tds).toBe(192.31);
		expect(alice.net_payable).toBe(1730.77);
		expect(alice.accent_charges).toBe(0);
		expect(alice.accent_amount).toBe(0);
		expect(alice.pnl_after_deductions).toBe(-1730.77);
		expect(alice.pnl_tds).toBe(-1923.08);

		// Bob: 10h at 100/hr = 1000.00
		const bob = rows.find((r) => r.employee_name === 'Bob')!;
		expect(bob.total_manhours).toBe(10);
		expect(bob.amount).toBe(1000);
		expect(bob.tds).toBe(100);
		expect(bob.net_payable).toBe(900);
	});

	it('reproduces the template row: rates override salary, TDS at profile rate', () => {
		// The mock template row: 176h, company 430/hr, accent 480/hr,
		// TDS 10% → 75,680 / 7,568 / 68,112 / 84,480 / 16,368 / 8,800.
		const rows = buildBillingRows(
			[
				{
					id: 'm1',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 176 }]),
				},
			],
			employees,
			userToEmployee,
			contactMap,
			[
				profile({
					employee_id: 1,
					gross_salary: 20000,
					tds_percentage: 10,
				}),
			],
			new Map([[1, { rate_employee: 430, rate_client: 480 }]]),
			'2026-04'
		);
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.total_manhours).toBe(176);
		expect(row.employee_charges).toBe(430);
		expect(row.amount).toBe(75680);
		expect(row.tds).toBe(7568);
		expect(row.net_payable).toBe(68112);
		expect(row.accent_charges).toBe(480);
		expect(row.accent_amount).toBe(84480);
		expect(row.pnl_after_deductions).toBe(16368);
		expect(row.pnl_tds).toBe(8800);
	});

	it('uses the salary-derived rate when no project rate is configured', () => {
		const rows = buildBillingRows(
			[
				{
					id: 'n1',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 20 }]),
				},
			],
			employees,
			userToEmployee,
			contactMap,
			[profile({ employee_id: 1, tds_percentage: 5 })],
			new Map(),
			'2026-04'
		);
		expect(rows).toHaveLength(1);
		// 96.15 × 20 = 1923.08; TDS 5% = 96.15; net = 1826.93
		expect(rows[0].employee_charges).toBe(96.15);
		expect(rows[0].tds_rate).toBe(5);
		expect(rows[0].tds).toBe(96.15);
		expect(rows[0].net_payable).toBe(1826.93);
	});

	it('defaults TDS to 10% when the profile has no tds_percentage', () => {
		const rows = buildBillingRows(
			[
				{
					id: 'd1',
					user_id: 10,
					employee_id: null,
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 10 }]),
				},
			],
			employees,
			userToEmployee,
			contactMap,
			[profile({ employee_id: 1, tds_percentage: 0 })],
			new Map(),
			'2026-04'
		);
		expect(rows[0].tds_rate).toBe(10);
		expect(rows[0].tds).toBe(96.15); // 961.54 × 10% = 96.154 → 96.15
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
			new Map(),
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
			new Map(),
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
			new Map(),
			'2026-04'
		);
		expect(rows.map((r) => r.employee_name)).toEqual(['Alice', 'Bob']);
		expect(rows.map((r) => r.sr_no)).toEqual([1, 2]);
	});
});

describe('buildTotals', () => {
	const row = (
		overrides: Partial<BillingEmployeeRow> = {}
	): BillingEmployeeRow => ({
		sr_no: 1,
		employee_id: 1,
		employee_code: 'A',
		employee_name: 'A',
		designation: '',
		employee_charges: 0,
		total_manhours: 0,
		amount: 0,
		tds_rate: 10,
		tds: 0,
		net_payable: 0,
		accent_charges: 0,
		accent_amount: 0,
		pnl_after_deductions: 0,
		pnl_tds: 0,
		...overrides,
	});

	it('sums manhours and every money column', () => {
		const totals = buildTotals([
			row({
				total_manhours: 20,
				amount: 1923.08,
				tds: 192.31,
				net_payable: 1730.77,
				accent_amount: 2500,
				pnl_after_deductions: 769.23,
				pnl_tds: 576.92,
			}),
			row({
				total_manhours: 10,
				amount: 1000,
				tds: 100,
				net_payable: 900,
				accent_amount: 1200,
				pnl_after_deductions: 300,
				pnl_tds: 200,
			}),
		]);
		expect(totals).toEqual({
			total_manhours: 30,
			total_amount: 2923.08,
			total_tds: 292.31,
			total_net_payable: 2630.77,
			total_accent_amount: 3700,
			total_pnl_after_deductions: 1069.23,
			total_pnl_tds: 776.92,
		});
	});

	it('returns zeros for no rows', () => {
		expect(buildTotals([])).toEqual({
			total_manhours: 0,
			total_amount: 0,
			total_tds: 0,
			total_net_payable: 0,
			total_accent_amount: 0,
			total_pnl_after_deductions: 0,
			total_pnl_tds: 0,
		});
	});
});

describe('deputation & annual billing helpers', () => {
	it('monthToKey maps YYYY-MM to short month key', () => {
		expect(monthToKey('2026-05')).toBe('may');
		expect(monthToKey('2026-01')).toBe('jan');
		expect(monthToKey('2026-12')).toBe('dec');
		expect(monthToKey('invalid')).toBe('');
	});

	it('getFinancialYear determines FY start year', () => {
		expect(getFinancialYear(new Date('2026-05-15'))).toBe(2026);
		expect(getFinancialYear(new Date('2026-01-10'))).toBe(2025);
		expect(getFinancialYear(new Date('2026-03-31'))).toBe(2025);
		expect(getFinancialYear(new Date('2026-04-01'))).toBe(2026);
	});

	it('formatFyLabel formats FY string', () => {
		expect(formatFyLabel(2026)).toBe('FY 2026–27');
		expect(formatFyLabel(2025)).toBe('FY 2025–26');
	});

	it('parseProjectManhoursList parses JSON strings and arrays', () => {
		expect(
			parseProjectManhoursList('[{"id":1,"employee_name":"Uttam"}]')
		).toHaveLength(1);
		expect(
			parseProjectManhoursList([{ id: 1, employee_name: 'Uttam' }])
		).toHaveLength(1);
		expect(parseProjectManhoursList(null)).toEqual([]);
		expect(parseProjectManhoursList('not json')).toEqual([]);
	});

	it('normalizes legacy rate_company/rate_accent keys to rate_employee/rate_client', () => {
		const rows = parseProjectManhoursList(
			'[{"id":1,"employee_name":"Legacy","rate_company":"300","rate_accent":"400"},' +
				'{"id":2,"employee_name":"Current","rate_employee":"500","rate_client":"600"}]'
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			id: 1,
			employee_name: 'Legacy',
			rate_employee: '300',
			rate_client: '400',
		});
		expect(rows[1]).toEqual({
			id: 2,
			employee_name: 'Current',
			rate_employee: '500',
			rate_client: '600',
		});
	});
});

describe('buildBillingRows with Project Manhours tab (deputation resources)', () => {
	const employees = new Map([
		[
			118,
			{
				employee_id: 118,
				employee_code: 'EMP-118',
				name: 'Anil Shukla',
				designation: 'Senior Engineer',
			},
		],
	]);

	it('resolves hours and rates for both internal and external deputation members', () => {
		const tabEntries: ProjectManhourTabRow[] = [
			{
				id: 't1',
				employee_id: 'team:55',
				employee_name: 'Uttam Lad(Layout Engineer) Associates',
				salary_type: 'custom',
				rate_employee: '456',
				rate_client: '550',
				monthly_hours: { may: '200', jun: '150' },
			},
			{
				id: 't2',
				employee_id: '118',
				source_employee_id: 118,
				employee_name: 'Anil Shukla',
				salary_type: 'monthly',
				rate_employee: '350',
				rate_client: '450',
				monthly_hours: { may: '180' },
			},
		];

		const rows = buildBillingRows(
			[],
			employees,
			new Map(),
			new Map(),
			[],
			new Map(),
			'2026-05',
			tabEntries
		);

		expect(rows).toHaveLength(2);

		const anil = rows.find((r) => r.employee_name === 'Anil Shukla')!;
		expect(anil.employee_id).toBe(118);
		expect(anil.employee_code).toBe('EMP-118');
		expect(anil.total_manhours).toBe(180);
		expect(anil.employee_charges).toBe(350);
		expect(anil.amount).toBe(63000); // 180 * 350
		expect(anil.tds).toBe(6300); // 10% of 63000
		expect(anil.net_payable).toBe(56700);
		expect(anil.accent_charges).toBe(450);
		expect(anil.accent_amount).toBe(81000); // 180 * 450
		expect(anil.pnl_after_deductions).toBe(24300); // 81000 - 56700
		expect(anil.pnl_tds).toBe(18000); // 81000 - 63000

		const uttam = rows.find((r) => r.employee_name.includes('Uttam Lad'))!;
		expect(uttam.employee_id).toBeNull();
		expect(uttam.total_manhours).toBe(200);
		expect(uttam.employee_charges).toBe(456);
		expect(uttam.amount).toBe(91200); // 200 * 456
		expect(uttam.accent_charges).toBe(550);
		expect(uttam.accent_amount).toBe(110000); // 200 * 550
		expect(uttam.pnl_tds).toBe(18800); // 110000 - 91200
	});
});

describe('buildAnnualBillingRows & buildAnnualTotals', () => {
	it('constructs 12-month FY deputation matrix correctly', () => {
		const employees = new Map([
			[
				118,
				{
					employee_id: 118,
					employee_code: 'EMP-118',
					name: 'Anil Shukla',
					designation: 'Senior Engineer',
				},
			],
		]);

		const tabEntries: ProjectManhourTabRow[] = [
			{
				id: 't1',
				employee_id: 'team:55',
				employee_name: 'Uttam Lad',
				salary_type: 'custom',
				rate_employee: '400',
				rate_client: '500',
				monthly_hours: {
					apr: 100,
					may: 120,
					jun: 80,
					jul: 0,
					aug: 0,
					sep: 0,
					oct: 0,
					nov: 0,
					dec: 0,
					jan: 0,
					feb: 0,
					mar: 0,
				},
			},
			{
				id: 't2',
				employee_id: '118',
				source_employee_id: 118,
				employee_name: 'Anil Shukla',
				salary_type: 'monthly',
				rate_employee: '300',
				rate_client: '400',
				monthly_hours: {
					apr: 160,
					may: 160,
					jun: 160,
					jul: 160,
					aug: 160,
					sep: 160,
					oct: 160,
					nov: 160,
					dec: 160,
					jan: 160,
					feb: 160,
					mar: 160,
				},
			},
		];

		const rows = buildAnnualBillingRows(
			[],
			employees,
			new Map(),
			new Map(),
			[],
			tabEntries,
			2026
		);

		expect(rows).toHaveLength(2);

		const uttam = rows.find((r) => r.employee_name === 'Uttam Lad')!;
		expect(uttam.total_hours).toBe(300); // 100 + 120 + 80
		expect(uttam.company_cost).toBe(120000); // 300 * 400
		expect(uttam.accent_cost).toBe(150000); // 300 * 500
		expect(uttam.pnl).toBe(30000); // 150000 - 120000

		const anil = rows.find((r) => r.employee_name === 'Anil Shukla')!;
		expect(anil.total_hours).toBe(1920); // 160 * 12
		expect(anil.company_cost).toBe(576000); // 1920 * 300
		expect(anil.accent_cost).toBe(768000); // 1920 * 400
		expect(anil.pnl).toBe(192000);

		const totals = buildAnnualTotals(rows);
		expect(totals.total_hours).toBe(2220); // 300 + 1920
		expect(totals.total_company_cost).toBe(696000); // 120000 + 576000
		expect(totals.total_accent_cost).toBe(918000); // 150000 + 768000
		expect(totals.total_pnl).toBe(222000); // 30000 + 192000
		expect(totals.monthly_hours.apr).toBe(260); // 100 + 160
		expect(totals.monthly_hours.may).toBe(280); // 120 + 160
	});
});
