import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentUser } from '@/utils/api-permissions';

const mockQuery = vi.fn();

vi.mock('@/utils/database', () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: vi.fn(),
}));

/** The day the whole suite reads as today. */
const TODAY = '2026-10-13';

/** The route's payload, as far as these tests read it. */
interface SummaryBody {
	success: boolean;
	error?: string;
	data?: {
		window: string;
		period: { start: string; end: string; label: string };
		kpis: Record<string, { total: number; delta: number }>;
		sales: {
			buckets: { name: string; count: number; value: number }[];
			total: { count: number; value: number };
			conversion: { count: number; value: number };
			unmapped: { count: number; value: number; statuses: string[] };
		};
		utilization: {
			totals: Record<string, number | null>;
			rows: {
				employeeId: number;
				name: string;
				logged: number;
				capacity: number;
				percent: number | null;
				band: string | null;
			}[];
		};
		projects: { id: string; name: string; logged: number }[];
		trend: {
			label: string;
			logged: number;
			capacity: number;
			partial: boolean;
		}[];
	};
	_meta?: { queryTimeMs: number };
}

/** One `daily_entries` payload, as mysql2 hands it back. */
function entries(hoursByDate: Record<string, number>): string {
	return JSON.stringify(
		Object.entries(hoursByDate).map(([date, hours]) => ({ date, hours }))
	);
}

function kpiRow(total: number, last7: number, previous7: number) {
	return [{ total, last_7: last7, previous_7: previous7 }];
}

/**
 * The live Payroll directory, plus one Contract employee the roster drops.
 *
 * An active employee's window is closed by the last day the roster can place
 * them on, and recorded Logged Hours count as that evidence — so the fixture
 * states the open end explicitly (`exit_date`) instead of leaving the window
 * to end at each employee's last logged day.
 */
const mockEmployees = [
	{
		id: 1,
		employee_id: 'E-001',
		name: 'Asha Rao',
		email: 'asha@accent.test',
		username: 'asha',
		department: 'Civil',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2024-01-01',
		hire_date: null,
		exit_date: '2030-01-01',
	},
	{
		id: 2,
		employee_id: 'E-002',
		name: 'Bilal Khan',
		email: 'bilal@accent.test',
		username: 'bilal',
		department: 'Civil',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2024-01-01',
		hire_date: null,
		exit_date: '2030-01-01',
	},
	// Joins late in the viewed month: a partial window, and off the roster of
	// any month that ends before 2026-10-20.
	{
		id: 3,
		employee_id: 'E-003',
		name: 'Chetan Iyer',
		email: 'chetan@accent.test',
		username: 'chetan',
		department: 'Structures',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2026-10-20',
		hire_date: null,
		exit_date: '2030-01-01',
	},
	{
		id: 4,
		employee_id: 'E-004',
		name: 'Divya Menon',
		email: 'divya@accent.test',
		username: 'divya',
		department: 'Structures',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2024-01-01',
		hire_date: null,
		exit_date: '2030-01-01',
	},
	{
		id: 5,
		employee_id: 'E-005',
		name: 'Esha Nair',
		email: 'esha@accent.test',
		username: 'esha',
		department: 'Structures',
		employee_type: 'Contract',
		status: 'active',
		joining_date: '2024-01-01',
		hire_date: null,
		exit_date: '2030-01-01',
	},
	// A one-day window that lands on a Sunday: on the roster, with no capacity
	// basis at all — the null-percent case.
	{
		id: 6,
		employee_id: 'E-006',
		name: 'Farah Qureshi',
		email: 'farah@accent.test',
		username: 'farah',
		department: 'Structures',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2026-10-04',
		hire_date: null,
		exit_date: '2026-10-04',
	},
];

const mockUsers = [
	{ id: 1, employee_id: 1, email: 'asha@accent.test', username: 'asha' },
	{ id: 2, employee_id: 2, email: 'bilal@accent.test', username: 'bilal' },
];

const mockSalaryProfiles = [
	{
		employee_id: 1,
		gross: '0',
		gross_salary: '20000',
		employer_cost: '22000',
		hourly_rate: '0',
		daily_rate: '0',
		std_hours_per_day: '8',
		std_working_days: '26',
		salary_type: 'monthly',
		tds_percentage: '10',
		effective_from: '2026-01-01',
		effective_to: null,
	},
];

/** October 2026: 24 working days once the Sunday/2nd-4th-Saturday offs and this holiday are out. */
const mockHolidays = [{ date: '2026-10-15', is_optional: 0 }];

/** One half-day credits 4 hours instead of 8. */
const mockAttendance = [
	{ employee_id: 1, date: '2026-10-05', status: 'HD', is_weekly_off: 0 },
];

const mockAssignments = [
	{
		user_id: 1,
		employee_id: 1,
		daily_entries: entries({
			'2026-04-27': 8,
			'2026-05-01': 16,
			'2026-10-01': 8,
			'2026-10-02': 8,
			'2026-10-06': 24,
			'2026-10-07': 24,
			'2026-10-13': 24,
			'2026-10-14': 24,
			'2026-10-20': 24,
			'2026-10-21': 24,
			'2026-10-26': 24,
			'2026-10-27': 16,
		}),
	},
	{
		user_id: 2,
		employee_id: 2,
		daily_entries: entries({ '2026-05-02': 4, '2026-10-02': 8 }),
	},
	{
		user_id: 3,
		employee_id: 3,
		daily_entries: entries({ '2026-10-21': 40, '2026-10-26': 36 }),
	},
];

/** Proposals by status: the four canonical buckets, `converted` and a blank. */
const mockSalesRows = [
	{ status: 'pending', count: 3, amount: '150000.50' },
	{ status: 'approved', count: 2, amount: '90000.25' },
	{ status: 'draft', count: 1, amount: '10000' },
	{ status: 'rejected', count: 1, amount: '5000' },
	{ status: 'converted', count: 2, amount: '25000' },
	{ status: '', count: 1, amount: '1000' },
];

const mockProjectRows = [
	{
		project_id: 10,
		daily_entries: entries({ '2026-10-01': 8, '2026-10-02': 8 }),
		project_code: 'P-010',
		project_title: 'Omega Plant',
		project_name: 'omega plant',
	},
	{
		project_id: 20,
		daily_entries: entries({ '2026-10-05': 6 }),
		project_code: 'P-020',
		project_title: null,
		project_name: 'Beta Bridge',
	},
	// Nothing logged in October, so it drops out of the list.
	{
		project_id: 30,
		daily_entries: entries({ '2026-09-30': 8 }),
		project_code: 'P-030',
		project_title: null,
		project_name: 'Gamma Mill',
	},
	{
		project_id: 40,
		daily_entries: entries({ '2026-05-01': 5, '2026-10-13': 4 }),
		project_code: 'P-040',
		project_title: null,
		project_name: 'Delta Yard',
	},
	// Hours with no project have no id or name to list.
	{
		project_id: null,
		daily_entries: entries({ '2026-10-03': 8 }),
		project_code: null,
		project_title: null,
		project_name: null,
	},
];

function mockDb() {
	mockQuery.mockImplementation((sql: string) => {
		// The employment window's evidence queries come back empty, so every
		// member's window is the joining date.
		if (sql.includes('MIN(attendance_date)')) return Promise.resolve([[]]);
		if (sql.includes('MIN(st.date)')) return Promise.resolve([[]]);
		if (sql.includes('MIN(l.created_at)')) return Promise.resolve([[]]);
		if (sql.includes('FROM employees')) return Promise.resolve([mockEmployees]);
		if (sql.includes('FROM users')) return Promise.resolve([mockUsers]);
		if (sql.includes('FROM employee_salary_profile'))
			return Promise.resolve([mockSalaryProfiles]);
		if (sql.includes('FROM holiday_master'))
			return Promise.resolve([mockHolidays]);
		if (sql.includes('FROM employee_attendance'))
			return Promise.resolve([mockAttendance]);
		if (sql.includes('uaa.project_id'))
			return Promise.resolve([mockProjectRows]);
		if (sql.includes('FROM user_activity_assignments'))
			return Promise.resolve([mockAssignments]);
		// The dashboard's own queries.
		if (sql.includes('proposal_value')) return Promise.resolve([mockSalesRows]);
		if (sql.includes('FROM leads'))
			// A true zero stays 0, and its delta is 0 too.
			return Promise.resolve([kpiRow(0, 0, 0)]);
		if (sql.includes('FROM proposals'))
			return Promise.resolve([kpiRow(12, 3, 1)]);
		if (sql.includes('FROM companies'))
			return Promise.resolve([kpiRow(45, 0, 0)]);
		if (sql.includes('FROM projects'))
			return Promise.resolve([kpiRow(9, 4, 4)]);
		return Promise.resolve([[]]);
	});
}

function signIn(isSuperAdmin: boolean | number): void {
	vi.mocked(getCurrentUser).mockResolvedValue({
		id: isSuperAdmin ? 1 : 2,
		username: isSuperAdmin ? 'root' : 'viewer',
		is_super_admin: isSuperAdmin,
	});
}

function summaryRequest(query = ''): Request {
	return {
		url: `http://localhost/api/admin/dashboard-summary${query}`,
	} as Request;
}

// The route is imported after the mocked modules so its whole graph sees the
// mocked `query` and the mocked auth gate.
async function loadSummary(query = ''): Promise<{
	status: number;
	body: SummaryBody;
}> {
	const { GET } = await import('@/app/api/admin/dashboard-summary/route');
	const response = await GET(summaryRequest(query));
	const body = (await response.json()) as SummaryBody;
	return { status: response.status, body };
}

/** Sum one trend field over its buckets. */
function sumBuckets(
	points: { logged: number; capacity: number }[],
	key: 'logged' | 'capacity'
) {
	return points.reduce((sum, point) => sum + point[key], 0);
}

describe('GET /api/admin/dashboard-summary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
		mockDb();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 401 without a session', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(null);

		const { status, body } = await loadSummary();

		expect(status).toBe(401);
		expect(body).toEqual({ success: false, error: 'Unauthorized' });
	});

	it('returns 403 for a signed-in user who is not a super admin', async () => {
		signIn(0);

		const { status, body } = await loadSummary();

		expect(status).toBe(403);
		expect(body).toEqual({ success: false, error: 'Forbidden' });
	});

	it('returns 400 for an unknown window', async () => {
		signIn(1);

		const { status, body } = await loadSummary('?window=day');

		expect(status).toBe(400);
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/window/i);
	});

	it('defaults to the current month', async () => {
		signIn(1);

		const { status, body } = await loadSummary();

		expect(status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.data.window).toBe('month');
		expect(body.data.period).toEqual({
			start: '2026-10-01',
			end: '2026-10-31',
			label: 'This month',
		});
		expect(typeof body._meta.queryTimeMs).toBe('number');
	});

	it('reads the last 7 days for the week window', async () => {
		signIn(1);

		const { status, body } = await loadSummary('?window=week');

		expect(status).toBe(200);
		expect(body.data.window).toBe('week');
		expect(body.data.period).toEqual({
			start: '2026-10-07',
			end: '2026-10-13',
			label: 'Last 7 days',
		});
	});

	it('caches privately for 30 seconds', async () => {
		signIn(1);

		const { GET } = await import('@/app/api/admin/dashboard-summary/route');
		const response = await GET(summaryRequest());

		expect(response.headers.get('Cache-Control')).toBe(
			'private, max-age=30, stale-while-revalidate=60'
		);
	});

	it('renders a zero delta and a true zero total as 0', async () => {
		signIn(1);

		const { body } = await loadSummary();

		expect(body.data.kpis.leads).toEqual({ total: 0, delta: 0 });
		expect(body.data.kpis.companies).toEqual({ total: 45, delta: 0 });
		expect(body.data.kpis.projects).toEqual({ total: 9, delta: 0 });
		expect(body.data.kpis.proposals).toEqual({ total: 12, delta: 2 });
	});

	it('zero-fills every sales bucket, prices Rejected, and keeps unmapped statuses in the total', async () => {
		signIn(1);

		const { body } = await loadSummary();
		const sales = body.data.sales;

		expect(sales.buckets).toEqual([
			{ name: 'Pending', count: 3, value: 150000.5 },
			{ name: 'Approved', count: 2, value: 90000.25 },
			{ name: 'Draft', count: 1, value: 10000 },
			{ name: 'Rejected', count: 1, value: 5000 },
		]);
		// The total is every proposal in the window, `converted` and the blank
		// included, so the four buckets alone do not foot to it.
		expect(sales.total).toEqual({ count: 10, value: 281000.75 });
		expect(sales.unmapped).toEqual({
			count: 3,
			value: 26000,
			statuses: ['converted'],
		});
		// Approved over every proposal: 2 of 10, and 90000.25 of 281000.75.
		expect(sales.conversion).toEqual({ count: 20, value: 32 });
	});

	it('lists the top projects by logged hours and drops zero-hour and project-less rows', async () => {
		signIn(1);

		const { body } = await loadSummary();

		expect(body.data.projects).toEqual([
			{ id: '10', name: 'Omega Plant', logged: 16 },
			{ id: '20', name: 'Beta Bridge', logged: 6 },
			{ id: '40', name: 'Delta Yard', logged: 4 },
		]);
	});

	it('scopes the project hours to the week window', async () => {
		signIn(1);

		const { body } = await loadSummary('?window=week');

		expect(body.data.projects).toEqual([
			{ id: '40', name: 'Delta Yard', logged: 4 },
		]);
	});

	it('maps the utilization rows, bands and disclosure', async () => {
		signIn(1);

		const { body } = await loadSummary();
		const utilization = body.data.utilization;

		// The roster is October's: five members, one Contract exclusion.
		expect(utilization.totals.headcount).toBe(5);
		expect(utilization.totals.excluded).toBe(1);
		// Zero logged hours is missing evidence, not a verdict.
		expect(utilization.totals.noLogged).toBe(2);
		expect(utilization.totals.noCapacity).toBe(1);
		expect(utilization.totals.logged).toBe(284);
		expect(utilization.totals.capacity).toBe(652);
		expect(utilization.totals.percent).toBe(43.56);

		// No-capacity rows stay off the list; it reads ascending by percent.
		expect(utilization.rows).toEqual([
			{
				employeeId: 4,
				name: 'Divya Menon',
				logged: 0,
				capacity: 192,
				percent: 0,
				band: 'under',
			},
			{
				employeeId: 2,
				name: 'Bilal Khan',
				logged: 8,
				capacity: 192,
				percent: 4.17,
				band: 'under',
			},
			{
				employeeId: 3,
				name: 'Chetan Iyer',
				logged: 76,
				capacity: 80,
				percent: 95,
				band: 'healthy',
			},
			{
				employeeId: 1,
				name: 'Asha Rao',
				logged: 200,
				capacity: 188,
				percent: 106.38,
				band: 'over',
			},
		]);
	});

	it('keeps the month trend footing to the month totals', async () => {
		signIn(1);

		const { body } = await loadSummary();
		const trend = body.data.trend;

		expect(trend.map((point: { label: string }) => point.label)).toEqual([
			'2026-10-01',
			'2026-10-05',
			'2026-10-12',
			'2026-10-19',
			'2026-10-26',
		]);
		// The week holding today is unfinished, and the last one runs past the
		// month end.
		expect(trend.map((point: { partial: boolean }) => point.partial)).toEqual([
			false,
			false,
			true,
			false,
			true,
		]);
		expect(sumBuckets(trend, 'logged')).toBe(
			body.data.utilization.totals.logged
		);
		expect(sumBuckets(trend, 'capacity')).toBe(
			body.data.utilization.totals.capacity
		);
		expect(trend[4]).toEqual({
			label: '2026-10-26',
			logged: 76,
			capacity: 192,
			partial: true,
		});
	});

	it('keeps the week trend footing to the week totals', async () => {
		signIn(1);

		const { body } = await loadSummary('?window=week');
		const trend = body.data.trend;

		expect(trend.map((point: { label: string }) => point.label)).toEqual([
			'2026-10-07',
			'2026-10-08',
			'2026-10-09',
			'2026-10-10',
			'2026-10-11',
			'2026-10-12',
			'2026-10-13',
		]);
		// Only today's bucket is unfinished; the two weekly-off days credit no
		// capacity at all.
		expect(trend.map((point: { partial: boolean }) => point.partial)).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
			true,
		]);
		expect(trend[3].capacity).toBe(0);
		expect(trend[4].capacity).toBe(0);
		expect(sumBuckets(trend, 'logged')).toBe(
			body.data.utilization.totals.logged
		);
		expect(sumBuckets(trend, 'capacity')).toBe(
			body.data.utilization.totals.capacity
		);
	});

	it('reads a week that reaches into the previous month on the current month roster', async () => {
		signIn(1);
		// 2026-05-03 is a Sunday, so the week runs 2026-04-27 to 2026-05-03.
		vi.setSystemTime(new Date('2026-05-03T09:00:00'));

		const { status, body } = await loadSummary('?window=week');

		expect(status).toBe(200);
		expect(body.data.period).toEqual({
			start: '2026-04-27',
			end: '2026-05-03',
			label: 'Last 7 days',
		});
		// May's roster holds Asha, Bilal and Divya. Chetan's window starts in
		// October, Farah's is a single October Sunday and Esha is a Contract
		// employee, so none of them is on the range's end-month roster.
		expect(body.data.utilization.totals.headcount).toBe(3);
		expect(body.data.utilization.totals.excluded).toBe(1);
		// Hours from both months count: 8h on 04-27, 16h on 05-01 and 4h on 05-02.
		expect(body.data.utilization.totals.logged).toBe(28);
		// Capacity is 6 working days, Farah's Sunday window excluded.
		expect(body.data.utilization.totals.capacity).toBe(144);
		expect(sumBuckets(body.data.trend, 'logged')).toBe(28);
		expect(sumBuckets(body.data.trend, 'capacity')).toBe(144);
		expect(body.data.projects).toEqual([
			{ id: '40', name: 'Delta Yard', logged: 5 },
		]);
	});
});
