import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockGetCurrentUser: vi.fn(),
	mockExecute: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.mockGetCurrentUser,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { GET } = await import('@/app/api/me/payslips/pdf/route');

/** The signed-in employee: session user 9 is linked to Employee 41. */
const SESSION_USER = { id: 9, employee_id: 41, username: 'asha' };

const slipped = (rows: unknown[]) => [rows, undefined];

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

/** The one statement that reads Payroll Slips, with the bindings it was given. */
const slipQuery = () =>
	mocks.mockExecute.mock.calls.find(([sql]) =>
		String(sql).includes('FROM payroll_slips')
	) as [string, unknown[]];

/** One row of the shape bulk-pdf hands the shared renderer. */
const SLIP = {
	id: 5,
	month: '2026-07-01',
	employee_id: 41,
	employee_name: 'Asha Rao',
	department: 'Engineering',
	designation: 'Engineer',
	joining_date: '2024-04-01',
	standard_working_days: 26,
	payable_days: 26,
	basic: '30000.00',
	da: '0.00',
	hra: '10000.00',
	conveyance: '5000.00',
	call_allowance: '5000.00',
	other_allowances: '0.00',
	bonus: '0.00',
	incentive: '0.00',
	ot_rate: '0.00',
	pf_employee: '3600.00',
	esic_employee: '0.00',
	pt: '200.00',
	loan: '0.00',
	advance: '0.00',
	tds: '0.00',
	retention: '0.00',
	mlwf: '20.00',
	total_earnings: '50000.00',
	total_deductions: '3820.00',
	net_pay: '46180.00',
};

const request = (query: string) =>
	new Request(`http://localhost/api/me/payslips/pdf${query}`);

describe('my Payroll Slip PDF API — session identity and the publish rule (issue #247)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockGetCurrentUser.mockResolvedValue(SESSION_USER);
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('401s an unauthenticated caller without touching the database', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue(null);

		const res = await GET(request('?month=2026-07'));

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			error: 'Unauthorized',
		});
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('renders the caller’s own slip as a PDF, scoped to the session employee and a visible month', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ employee_id: 41 }])) // users → Employee
			.mockResolvedValueOnce(slipped([SLIP])) // the slip
			.mockResolvedValueOnce(slipped([])); // scheduled DA

		const res = await GET(request('?month=2026-07'));

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(res.headers.get('content-disposition')).toContain(
			'Payroll_Slip_Asha_Rao_2026-07.pdf'
		);

		// A real document, not an empty body: jsPDF writes the %PDF header.
		const pdf = Buffer.from(await res.arrayBuffer());
		expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
		expect(pdf.length).toBeGreaterThan(1000);

		const [slipSql, slipParams] = slipQuery();
		expect(slipSql).toContain('ps.employee_id = ?');
		expect(slipSql).toContain('ps.month = ?');
		expect(slipParams[0]).toBe(41);
		// 'YYYY-MM' normalises to the stored first-of-month date.
		expect(slipParams[1]).toBe('2026-07-01');
		// And the month must be published: no run row, or a finalized/paid run.
		expect(slipSql).toContain('LEFT JOIN payroll_runs pr');
		expect(slipSql).toContain('pr.id IS NULL');
		expect(slipParams).toContain('finalized');
		expect(slipParams).toContain('paid');
		expect(slipParams).not.toContain('draft');
	});

	it('ignores an employee_id in the query string and never renders another employee’s slip', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ employee_id: 41 }]))
			.mockResolvedValueOnce(slipped([SLIP]))
			.mockResolvedValueOnce(slipped([]));

		const res = await GET(request('?month=2026-07&employee_id=99'));

		expect(res.status).toBe(200);
		expect(res.headers.get('content-disposition')).toContain('Asha_Rao');

		const [slipSql, slipParams] = slipQuery();
		expect(slipParams[0]).toBe(41);
		expect(slipParams).not.toContain(99);
		expect(slipParams).not.toContain('99');
		expect(slipSql).not.toContain('ps.id = ?');
	});

	it('404s a month whose slip the publish rule hides', async () => {
		// A draft run makes the slip query return nothing, exactly as the SQL
		// predicate would.
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ employee_id: 41 }]))
			.mockResolvedValueOnce(slipped([]));

		const res = await GET(request('?month=2026-08'));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(res.headers.get('content-type')).toContain('application/json');
	});

	it('404s a login with no linked Employee record, without reading any slip', async () => {
		mocks.mockExecute.mockResolvedValueOnce(slipped([{ employee_id: null }]));

		const res = await GET(request('?month=2026-07'));

		expect(res.status).toBe(404);
		expect(statements().some((sql) => sql.includes('FROM payroll_slips'))).toBe(
			false
		);
	});

	it('400s a missing or unparseable month', async () => {
		const missing = await GET(request(''));
		expect(missing.status).toBe(400);

		const nonsense = await GET(request('?month=last-month'));
		expect(nonsense.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});
});
