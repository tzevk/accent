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

const { GET } = await import('@/app/api/me/payslips/route');

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

const SLIP_ROWS = [
	{
		id: 2,
		month: '2026-07-01',
		net_pay: '48250.00',
		payment_status: 'pending',
		payment_date: null,
		employee_name: 'Asha Rao',
	},
	{
		id: 1,
		month: '2026-06-01',
		net_pay: '48250.00',
		payment_status: 'paid',
		payment_date: '2026-07-05',
		employee_name: 'Asha Rao',
	},
];

describe('my Payroll Slips API — identity comes from the session (issue #247)', () => {
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

		const res = await GET(new Request('http://localhost/api/me/payslips'));

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			error: 'Unauthorized',
		});
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('lists the caller’s own Payroll Slips for an employee holding no payroll permission', async () => {
		// This module has no ensurePermission to call: a normal employee holds no
		// payroll permission, which is the whole point of the self-service route.
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ employee_id: 41 }]))
			.mockResolvedValueOnce(slipped(SLIP_ROWS));

		const res = await GET(new Request('http://localhost/api/me/payslips'));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toEqual(SLIP_ROWS);

		// The link is read for the session user, and the slip query is scoped by
		// the Employee that link resolved to.
		const [usersSql, usersParams] = mocks.mockExecute.mock.calls[0];
		expect(String(usersSql)).toContain('FROM users');
		expect(usersParams).toEqual([9]);

		const [slipSql, slipParams] = slipQuery();
		expect(slipSql).toContain('ps.employee_id = ?');
		expect(slipParams[0]).toBe(41);
		expect(slipSql).toContain('ORDER BY ps.month DESC');
	});

	it('ignores an employee_id in the query string and returns only the caller’s rows', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ employee_id: 41 }]))
			.mockResolvedValueOnce(slipped([SLIP_ROWS[1]]));

		const res = await GET(
			new Request(
				'http://localhost/api/me/payslips?employee_id=99&id=7&month=2026-06-01'
			)
		);

		const body = await res.json();
		expect(body.data).toEqual([SLIP_ROWS[1]]);

		// Identity is proved on the bindings, not the response shape: 99 never
		// reaches SQL, and no query-string id becomes a filter of its own.
		const [slipSql, slipParams] = slipQuery();
		expect(slipParams[0]).toBe(41);
		expect(slipParams).not.toContain(99);
		expect(slipParams).not.toContain('99');
		expect(slipSql).not.toContain('ps.id = ?');
		expect(slipSql).not.toContain('ps.month = ?');
	});

	it('returns an empty list for a login with no linked Employee record', async () => {
		mocks.mockExecute.mockResolvedValueOnce(slipped([{ employee_id: null }]));

		const res = await GET(new Request('http://localhost/api/me/payslips'));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, data: [] });
		// Nothing to scope to, so Payroll Slips are never read at all.
		expect(statements().some((sql) => sql.includes('FROM payroll_slips'))).toBe(
			false
		);
	});
});

describe('my Payroll Slips API — the publish rule is a SQL predicate (issue #247)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockGetCurrentUser.mockResolvedValue(SESSION_USER);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ employee_id: 41 }]))
			.mockResolvedValueOnce(slipped(SLIP_ROWS));
	});

	it('publishes a month that has no Payroll Run row at all', async () => {
		const res = await GET(new Request('http://localhost/api/me/payslips'));

		expect(res.status).toBe(200);
		const [slipSql] = slipQuery();
		// The grandfathered branch: the month's run is absent, so the slip is the
		// employee's to see — no run row is created for history.
		expect(slipSql).toContain('LEFT JOIN payroll_runs pr');
		expect(slipSql).toContain(
			'pr.month = MONTH(ps.month) AND pr.year = YEAR(ps.month)'
		);
		expect(slipSql).toContain('pr.run_number = 1');
		expect(slipSql).toContain('pr.id IS NULL');
	});

	it('publishes a run that is finalized or paid, and never a draft one', async () => {
		await GET(new Request('http://localhost/api/me/payslips'));

		const [slipSql, slipParams] = slipQuery();
		expect(slipSql).toContain('pr.status IN (?, ?)');
		expect(slipParams).toContain('finalized');
		expect(slipParams).toContain('paid');
		// Provisional numbers must never reach an employee.
		expect(slipParams).not.toContain('draft');
		expect(slipParams).not.toContain('processing');
		expect(slipParams).not.toContain('cancelled');
	});
});
