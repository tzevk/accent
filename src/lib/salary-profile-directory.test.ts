import { describe, expect, it } from 'vitest';
import {
	buildSalaryDirectory,
	buildSalaryProfileBatch,
	loadSalaryProfileDirectory,
	loadSalaryProfileResolution,
	parseSalaryBatchQuery,
	parseSalaryDirectoryQuery,
	parseSalaryResolveQuery,
	serverSalaryDate,
	type SalaryDirectoryBuildInput,
	type SalaryDirectoryDb,
	type SalaryDirectoryEmployeeRow,
	type SalaryPeriod,
	type SalaryProfileDirectoryResult,
} from './salary-profile-directory';
import type { SalaryUseEvidence } from './salary-profile-store';
import type { SalaryProfileRow } from './salary-profile-timeline';

type TestEmployee = Omit<SalaryDirectoryEmployeeRow, 'id'> & { id: number };

const employee = (
	id: number,
	code: string,
	first: string,
	last: string,
	employee_type: string | null,
	status: string | null = 'active',
	joining_date: string | null = '2024-01-01',
	hire_date: string | null = '2024-01-01',
	exit_date: string | null = null
): TestEmployee => ({
	id,
	employee_id: code,
	first_name: first,
	last_name: last,
	department: id === 7 ? 'Engineering' : 'Operations',
	employee_type,
	status,
	joining_date,
	hire_date,
	exit_date,
});

const employees: SalaryDirectoryEmployeeRow[] = [
	// Employee Type "Contract" must not move this monthly-paid person out of
	// the Payroll stream.
	employee(1, 'E-001', 'Ada', 'Lovelace', 'Contract'),
	employee(2, 'E-002', 'Grace', 'Hopper', 'Payroll'),
	employee(3, 'E-003', 'Alan', 'Turing', 'Payroll'),
	// A leaver with recorded salary history remains reviewable.
	employee(
		4,
		'E-004',
		'Katherine',
		'Johnson',
		'Payroll',
		'terminated',
		null,
		null,
		'2025-01-31'
	),
	employee(5, 'E-005', 'No', 'Profile', 'Payroll'),
	employee(7, 'E-007', 'Legacy', 'Only', 'Payroll'),
	employee(8, 'E-008', 'Future', 'Joiner', 'Payroll', 'active', '2027-01-01'),
	employee(9, 'E-009', 'Zero', 'Ctc', 'Payroll'),
	employee(10, 'E-010', 'Broken', 'Ctc', 'Payroll'),
	employee(11, 'E-011', 'Cancelled', 'Only', 'Payroll'),
	employee(12, 'E-012', 'Mid', 'Joiner', 'Payroll', 'active', '2026-11-20'),
	employee(13, 'E-013', 'Ambig', 'Use', 'Payroll'),
	employee(14, 'E-014', 'Contract', 'Paid', 'Payroll'),
	employee(15, 'E-015', 'Merge', 'Fallback', 'Payroll'),
];

const profile = (
	id: number,
	employee_id: number,
	effective_from: string,
	values: Partial<SalaryProfileRow> = {},
	effective_to: string | null = null
): SalaryProfileRow => ({
	id,
	employee_id,
	effective_from,
	effective_to,
	is_active: 1,
	cancelled_at: null,
	salary_type: 'monthly',
	...values,
});

const canonical: SalaryProfileRow[] = [
	profile(100, 1, '2024-01-01', { employer_cost: 50000 }),
	// Future-only: must never price 2026-11.
	profile(101, 2, '2026-12-01', { employer_cost: 60000 }),
	// Overlapping covering agreements are ambiguous, never newest-wins.
	profile(102, 3, '2024-01-01', { employer_cost: 70000 }),
	profile(103, 3, '2025-01-01', { employer_cost: 71000 }),
	profile(104, 4, '2024-01-01', { employer_cost: 40000 }),
	// A home for the future joiner's Dec agreement.
	profile(105, 8, '2026-12-01', { employer_cost: 80000 }),
	profile(106, 9, '2024-01-01', { employer_cost: 0, gross_salary: 25000 }),
	profile(107, 10, '2024-01-01', { employer_cost: 'not-a-number' }),
	profile(108, 11, '2024-01-01', {
		is_active: 0,
		cancelled_at: '2026-01-01 10:00:00',
	}),
	profile(109, 12, '2026-11-20', { employer_cost: 30000 }),
	profile(110, 13, '2024-01-01', { employer_cost: 45000 }),
	profile(111, 14, '2024-01-01', {
		salary_type: 'contract',
		employer_cost: 100000,
	}),
	// No canonical CTC: the period-effective legacy gross may be disclosed.
	profile(112, 15, '2024-01-01', {}),
];

const legacy: SalaryProfileRow[] = [
	{
		id: 500,
		employee_id: 1,
		effective_from: '2024-01-01',
		effective_to: null,
		is_active: 1,
		salary_type: 'monthly',
		gross_salary: 48000,
		pay_type: 'monthly',
	},
	{
		id: 501,
		employee_id: 3,
		effective_from: '2024-01-01',
		effective_to: null,
		is_active: 1,
		salary_type: 'monthly',
		gross_salary: 69000,
		pay_type: 'monthly',
	},
	{
		id: 502,
		employee_id: 7,
		effective_from: '2025-01-01',
		effective_to: null,
		is_active: 1,
		salary_type: 'monthly',
		gross_salary: 30000,
		pay_type: 'monthly',
	},
	{
		id: 503,
		employee_id: 8,
		effective_from: '2026-12-01',
		effective_to: null,
		is_active: 1,
		salary_type: 'monthly',
		gross_salary: 81000,
		pay_type: 'monthly',
	},
	{
		id: 504,
		employee_id: 11,
		effective_from: '2024-01-01',
		effective_to: null,
		is_active: 0,
		salary_type: 'monthly',
		gross_salary: 1000,
		pay_type: 'monthly',
	},
	{
		id: 505,
		employee_id: 15,
		effective_from: '2024-01-01',
		effective_to: null,
		is_active: 1,
		salary_type: 'monthly',
		gross_salary: 26000,
		pay_type: 'monthly',
	},
];

const timelineVersions = new Map<number, number>([
	[1, 3],
	[9, 2],
]);

let nextUseId = 1;
const payrollUse = (
	employee_id: number,
	agreement_id: number | null,
	agreement_source: SalaryUseEvidence['agreement_source'],
	month: string | null,
	is_ambiguous = false
): SalaryUseEvidence => ({
	id: nextUseId++,
	employee_id,
	month,
	agreement_id,
	agreement_source,
	evidence: is_ambiguous ? 'legacy_audit' : 'payroll_generation',
	is_ambiguous,
	evidence_context: null,
	first_used_by: null,
	first_used_at: '2026-10-01 10:00:00',
});

const useEvidence: SalaryUseEvidence[] = [
	payrollUse(1, 100, 'employee_salary_profile', '2026-10-01'),
	// Then 1 has a protected month; 13's prior use cannot be tied to one
	// agreement/month and must stay visible as ambiguity.
	payrollUse(13, null, null, null, true),
];

const datePeriod = (date: string): SalaryPeriod => ({
	kind: 'date',
	date,
	month: null,
	start: date,
	end: date,
});

const monthPeriod = (month: string, end: string): SalaryPeriod => ({
	kind: 'month',
	date: null,
	month,
	start: month,
	end,
});

const build = (
	period: SalaryPeriod,
	overrides: Partial<
		Pick<SalaryDirectoryBuildInput, 'search' | 'stream' | 'page' | 'limit'>
	> = {}
) =>
	buildSalaryDirectory({
		employees,
		canonical,
		legacy,
		timelineVersions,
		useEvidence,
		period,
		...overrides,
	});

const rowFor = (result: SalaryProfileDirectoryResult, id: number) => {
	const row = result.data.find((entry) => entry.id === id);
	if (!row) throw new Error(`Missing directory row for Employee ${id}`);
	return row;
};

describe('salary profile directory — requested period, not newest history', () => {
	it('keeps a future-only Employee in the missing filter instead of pricing the past', () => {
		const result = build(datePeriod('2026-11-15'), { stream: 'missing' });
		const ids = result.data.map((row) => row.id);

		expect(ids).toContain(2);
		expect(ids).toContain(5);
		expect(ids).toContain(11);

		const grace = rowFor(build(datePeriod('2026-11-15')), 2);
		expect(grace.state).toBe('unavailable');
		expect(grace.has_agreement).toBe(false);
		expect(grace.agreement).toBeNull();
	});

	it('reports overlapping covering agreements as ambiguous without choosing one', () => {
		const row = rowFor(build(datePeriod('2026-11-15')), 3);

		expect(row.state).toBe('ambiguous');
		expect(row.agreement).toBeNull();
		expect(row.conflict_ids).toEqual([102, 103]);
		expect(row.conflict_source).toBe('employee_salary_profile');
	});

	it('does not let a covering legacy row hide canonical ambiguity', () => {
		const row = rowFor(build(datePeriod('2026-11-15')), 3);

		expect(row.state).toBe('ambiguous');
		expect(row.agreement).toBeNull();
		expect(row.conflict_source).toBe('employee_salary_profile');
	});

	it('excludes cancelled and inactive agreements', () => {
		const row = rowFor(build(datePeriod('2026-11-15')), 11);

		expect(row.state).toBe('unavailable');
		expect(row.agreement).toBeNull();
	});

	it('keeps history-bearing leavers visible', () => {
		const result = build(datePeriod('2026-11-15'));
		const row = rowFor(result, 4);

		expect(row.status).toBe('terminated');
		expect(row.state).toBe('selected');
		expect(row.agreement?.agreement_id).toBe(104);
	});

	it('filters by Salary Type stream, never Employee Type', () => {
		const payroll = build(datePeriod('2026-11-15'), { stream: 'payroll' });
		const contract = build(datePeriod('2026-11-15'), { stream: 'contract' });

		// Employee Type is Contract, but the monthly Salary Type is Payroll.
		expect(payroll.data.map((row) => row.id)).toContain(1);
		expect(contract.data.map((row) => row.id)).not.toContain(1);
		expect(contract.data.map((row) => row.id)).toEqual([14]);
		expect(rowFor(payroll, 1).agreement?.pay_stream).toBe('payroll');
		expect(rowFor(contract, 14).agreement?.pay_stream).toBe('contract');
	});

	it('keeps Employees without any agreement discoverable in the list', () => {
		const result = build(datePeriod('2026-11-15'), { stream: 'missing' });

		expect(rowFor(result, 5).state).toBe('unavailable');
	});

	it('does not count ambiguous history as a missing profile', () => {
		const missing = build(datePeriod('2026-11-15'), { stream: 'missing' });

		expect(missing.data.map((row) => row.id)).not.toContain(3);
		expect(missing.counts.ambiguous).toBe(1);
	});

	it('uses a covering legacy agreement as a disclosed fallback', () => {
		const row = rowFor(build(datePeriod('2026-11-15')), 7);

		expect(row.state).toBe('selected');
		expect(row.agreement).toMatchObject({
			agreement_id: 502,
			source: 'salary_structures',
			pay_stream: 'payroll',
		});
		expect(row.agreement?.ctc).toMatchObject({
			status: 'resolved',
			amount: 30000,
			source: 'gross_salary',
			legacy_fallback: true,
		});
	});

	it('discloses period-effective legacy CTC for a canonical agreement without one', () => {
		const row = rowFor(build(datePeriod('2026-11-15')), 15);

		expect(row.agreement).toMatchObject({
			agreement_id: 112,
			source: 'employee_salary_profile',
		});
		expect(row.agreement?.ctc).toMatchObject({
			status: 'resolved',
			amount: 26000,
			source: 'gross_salary',
			legacy_fallback: true,
		});
	});

	it('preserves an explicit zero CTC and discloses invalid CTC', () => {
		const result = build(datePeriod('2026-11-15'));
		const zero = rowFor(result, 9).agreement?.ctc;
		const invalid = rowFor(result, 10).agreement?.ctc;

		expect(zero).toEqual({
			status: 'resolved',
			amount: 0,
			source: 'employer_cost',
			legacy_fallback: false,
			invalid_reason: null,
		});
		expect(invalid).toEqual({
			status: 'invalid',
			amount: null,
			source: 'employer_cost',
			legacy_fallback: false,
			invalid_reason: 'not-finite',
		});
	});

	it('exposes source-qualified use state and timeline versions', () => {
		const result = build(datePeriod('2026-11-15'));

		expect(rowFor(result, 1).agreement?.used).toBe(true);
		expect(rowFor(result, 1).timeline_version).toBe(3);
		expect(rowFor(result, 13).use_ambiguous).toBe(true);
		expect(rowFor(result, 13).use_unknown_history).toBe(true);
		expect(rowFor(result, 5).timeline_version).toBe(0);
	});

	it('never anchors an old month into a later joining date', () => {
		const december = build(monthPeriod('2026-12-01', '2026-12-31'));
		const joiner = rowFor(december, 8);

		expect(joiner.state).toBe('unavailable');
		expect(joiner.agreement).toBeNull();
		expect(joiner.anchor).toBe('2026-12-01');
	});

	it('uses the joining date as the anchor for a mid-month joiner', () => {
		const november = build(monthPeriod('2026-11-01', '2026-11-30'));
		const joiner = rowFor(november, 12);

		expect(joiner.anchor).toBe('2026-11-20');
		expect(joiner.state).toBe('selected');
		expect(joiner.agreement?.agreement_id).toBe(109);
	});

	it('searches the minimal identity projection', () => {
		const byName = build(datePeriod('2026-11-15'), { search: 'turing' });
		const byCode = build(datePeriod('2026-11-15'), { search: 'E-007' });
		const byDepartment = build(datePeriod('2026-11-15'), {
			search: 'engineering',
		});

		expect(byName.data.map((row) => row.id)).toEqual([3]);
		expect(byCode.data.map((row) => row.id)).toEqual([7]);
		expect(byDepartment.data.map((row) => row.id)).toEqual([7]);
	});

	it('paginates a stable name-then-id order and counts the search scope', () => {
		const page = build(datePeriod('2026-11-15'), { page: 2, limit: 3 });

		expect(page.total).toBe(14);
		expect(page.data.map((row) => row.id)).toEqual([10, 11, 14]);
		expect(page.counts).toEqual({
			total: 14,
			payroll: 7,
			contract: 1,
			missing: 5,
			ambiguous: 1,
		});
	});
});

describe('salary profile batch and resolve projection', () => {
	it('returns requested-period state for every requested Employee', () => {
		const result = buildSalaryProfileBatch({
			employees,
			canonical,
			legacy,
			timelineVersions,
			useEvidence,
			period: datePeriod('2026-11-15'),
			requestedIds: [1, 2, 3, 5],
		});

		expect(result.data['1']).toMatchObject({
			state: 'selected',
			agreement_id: 100,
			pay_stream: 'payroll',
		});
		expect(result.data['2']).toMatchObject({
			state: 'unavailable',
			agreement_id: null,
			profile: null,
		});
		expect(result.data['3']).toMatchObject({
			state: 'ambiguous',
			agreement_id: null,
			conflict_ids: [102, 103],
			profile: null,
		});
		expect(result.data['5'].state).toBe('unavailable');
		expect(result.missing_ids).toEqual([]);
	});

	it('reports requested ids that are not live Employees', () => {
		const result = buildSalaryProfileBatch({
			employees,
			canonical,
			legacy,
			period: datePeriod('2026-11-15'),
			requestedIds: [1, 99],
		});

		expect(result.missing_ids).toEqual([99]);
	});

	it('returns an explicit unavailable result instead of newest history', () => {
		const result = buildSalaryProfileBatch({
			employees,
			canonical,
			legacy,
			period: monthPeriod('2026-11-01', '2026-11-30'),
			requestedIds: [2],
			full: true,
		});

		expect(result.data['2']).toMatchObject({
			state: 'unavailable',
			salary_type: null,
			agreement_id: null,
			profile: null,
		});
		expect(result.period.kind).toBe('month');
	});

	it('resolves the requested period through the producer reads', async () => {
		const fake = new FakeSalaryDirectoryDb({
			employees: [
				{ ...employee(2, 'E-002', 'Grace', 'Hopper', 'Payroll'), isDelete: 0 },
			],
			canonical: [profile(101, 2, '2026-12-01', { employer_cost: 60000 })],
			legacy: [],
			timelines: [],
			uses: [],
		});

		const resolution = await loadSalaryProfileResolution(
			fake,
			2,
			parseSalaryResolveQuery(new URLSearchParams({ date: '2026-11-15' }))
		);

		expect(resolution).toMatchObject({
			employee_id: 2,
			state: 'unavailable',
			anchor: '2026-11-15',
			agreement_id: null,
			profile: null,
		});
		expect(resolution?.employee.full_name).toBe('Grace Hopper');
	});

	it('returns an explicit ambiguous resolve instead of choosing one agreement', async () => {
		const fake = new FakeSalaryDirectoryDb({
			employees: [
				{ ...employee(3, 'E-003', 'Alan', 'Turing', 'Payroll'), isDelete: 0 },
			],
			canonical: [
				profile(102, 3, '2024-01-01', { employer_cost: 70000 }),
				profile(103, 3, '2025-01-01', { employer_cost: 71000 }),
			],
			legacy: [],
			timelines: [],
			uses: [],
		});

		const resolution = await loadSalaryProfileResolution(
			fake,
			3,
			parseSalaryResolveQuery(new URLSearchParams({ date: '2026-11-15' }))
		);

		expect(resolution).toMatchObject({
			employee_id: 3,
			state: 'ambiguous',
			agreement_id: null,
			conflict_ids: [102, 103],
			conflict_source: 'employee_salary_profile',
			profile: null,
		});
	});
});

describe('salary profile directory query parsing', () => {
	it('defaults to a timezone-stable server date', () => {
		const now = new Date('2026-11-15T23:30:00.000Z');

		expect(serverSalaryDate(now)).toBe('2026-11-15');
		const query = parseSalaryDirectoryQuery(new URLSearchParams(), now);
		expect(query.period.kind).toBe('date');
		expect(query.period.date).toBe('2026-11-15');
		expect(query.page).toBe(1);
		expect(query.limit).toBe(25);
	});

	it('rejects invalid dates, months and both period inputs', () => {
		expect(() =>
			parseSalaryDirectoryQuery(new URLSearchParams({ date: '2026-02-31' }))
		).toThrow(/date/i);
		expect(() =>
			parseSalaryDirectoryQuery(
				new URLSearchParams({ date: '2026-11-15', month: '2026-11' })
			)
		).toThrow(/both|date|month/i);
		expect(() =>
			parseSalaryDirectoryQuery(new URLSearchParams({ month: '2026-13' }))
		).toThrow(/month/i);
	});

	it('rejects invalid filters and pagination', () => {
		expect(() =>
			parseSalaryDirectoryQuery(new URLSearchParams({ stream: 'other' }))
		).toThrow(/stream/i);

		expect(
			parseSalaryDirectoryQuery(new URLSearchParams({ stream: 'all' })).stream
		).toBe('all');

		expect(() =>
			parseSalaryDirectoryQuery(new URLSearchParams({ page: '0' }))
		).toThrow(/page/i);

		expect(() =>
			parseSalaryDirectoryQuery(new URLSearchParams({ limit: '101' }))
		).toThrow(/limit/i);
	});

	it('parses batch ids, month and the full flag', () => {
		const query = parseSalaryBatchQuery(
			new URLSearchParams({
				ids: '3,1,3',
				month: '2026-11',
				full: '1',
			})
		);

		expect(query.ids).toEqual([1, 3]);
		expect(query.full).toBe(true);
		expect(query.period.month).toBe('2026-11-01');
	});
});

type FakeEmployee = TestEmployee & {
	isDelete: number;
};

interface FakeDbOptions {
	employees: FakeEmployee[];
	canonical?: SalaryProfileRow[];
	legacy?: SalaryProfileRow[];
	timelines?: Array<{ employee_id: number; version: number }>;
	uses?: SalaryUseEvidence[];
}

class FakeSalaryDirectoryDb implements SalaryDirectoryDb {
	calls: Array<{
		sql: string;
		params: ReadonlyArray<string | number | boolean | null>;
	}> = [];

	constructor(private options: FakeDbOptions) {}

	async execute(
		sql: string,
		params: ReadonlyArray<string | number | boolean | null> = []
	): Promise<[unknown, unknown]> {
		this.calls.push({ sql, params });
		const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		const ids = params.filter(
			(value): value is number => typeof value === 'number'
		);

		if (text.includes('from employees')) {
			let rows = [...this.options.employees];
			if (text.includes('isdelete = 0')) {
				rows = rows.filter((row) => row.isDelete === 0);
			}
			if (text.includes('id in (')) {
				rows = rows.filter((row) => ids.includes(row.id));
			} else if (text.includes('where id = ?')) {
				rows = rows.filter((row) => row.id === Number(params[0]));
			}
			return [rows, []];
		}
		if (text.includes('from employee_salary_timelines')) {
			return [
				(this.options.timelines ?? []).filter((row) =>
					ids.includes(row.employee_id)
				),
				[],
			];
		}
		if (text.includes('from employee_salary_profile')) {
			return [this.options.canonical ?? [], []];
		}
		if (text.includes('from salary_structures')) {
			return [this.options.legacy ?? [], []];
		}
		if (text.includes('from employee_salary_payroll_use')) {
			return [this.options.uses ?? [], []];
		}
		throw new Error(`Unexpected SQL in directory fake: ${sql}`);
	}
}

describe('salary profile directory bulk loading', () => {
	it('bulk-reads live Employees and period agreements without per-person queries', async () => {
		const live = Array.from({ length: 20 }, (_, index) =>
			employee(
				index + 1,
				`E-${index + 1}`,
				`Person${index + 1}`,
				'Live',
				'Payroll'
			)
		);
		const fake = new FakeSalaryDirectoryDb({
			employees: [
				...live.map((row) => ({ ...row, isDelete: 0 })),
				{
					...employee(99, 'E-099', 'Deleted', 'Person', 'Payroll'),
					isDelete: 1,
				},
			],
			canonical: [
				profile(200, 2, '2026-12-01', { employer_cost: 60000 }),
				profile(201, 1, '2024-01-01', { employer_cost: 50000 }),
			],
			legacy: [],
			timelines: [{ employee_id: 1, version: 2 }],
			uses: [payrollUse(1, 201, 'employee_salary_profile', '2026-10-01')],
		});

		const result = await loadSalaryProfileDirectory(
			fake,
			parseSalaryDirectoryQuery(
				new URLSearchParams({ date: '2026-11-15', limit: '25' })
			)
		);

		expect(result.data).toHaveLength(20);
		expect(result.data.some((row) => row.id === 99)).toBe(false);
		expect(result.data.find((row) => row.id === 2)?.state).toBe('unavailable');
		expect(result.data.find((row) => row.id === 1)?.timeline_version).toBe(2);

		expect(fake.calls).toHaveLength(5);
		expect(fake.calls[0].sql).toContain('isDelete = 0');
		expect(fake.calls.some((call) => /max\s*\(/i.test(call.sql))).toBe(false);
	});
});
