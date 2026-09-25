import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { POST } = await import('@/app/api/payroll/runs/finalize/route');

const grant = grantFor(mocks.mockEnsurePermission);

const DRAFT_RUN = {
	id: 7,
	month: 8,
	year: 2026,
	run_number: 1,
	status: 'draft',
};

/** The two slips the month carries: 48000.00 and 31405.46 gross. */
const MONTH_SLIPS = [
	{
		gross: '48000.00',
		total_deductions: '200.10',
		net_pay: '47799.90',
		total_employer_contributions: '150.00',
	},
	{
		gross: '31405.46',
		total_deductions: '0.20',
		net_pay: '31405.26',
		total_employer_contributions: '150.00',
	},
];

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/runs/finalize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

/** The INSERT the route made into payroll_audit_logs, or undefined if none. */
const auditInsert = () =>
	mocks.mockExecute.mock.calls.find(([sql]) =>
		String(sql).includes('INSERT INTO payroll_audit_logs')
	);

describe('payroll finalize API — completeness gate and run lock (issue #242)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('denies a caller without payroll:update', async () => {
		grant('payroll:read');

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a request without a month', async () => {
		grant('payroll:update');

		const res = await POST(jsonRequest({}));

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('refuses a month that has no Payroll Run yet', async () => {
		grant('payroll:update');
		mocks.mockExecute.mockResolvedValue([[], undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('refuses a month whose run is already finalized', async () => {
		grant('payroll:update');
		mocks.mockExecute.mockResolvedValue([
			[{ ...DRAFT_RUN, status: 'finalized' }],
			undefined,
		]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/already finalized/i);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('names every employee missing a Payroll Slip', async () => {
		grant('payroll:update');
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([
				[
					{ employee_id: 11, employee_code: 'EMP011', name: 'Asha Rao' },
					{ employee_id: 12, employee_code: 'EMP012', name: 'Ravi Kumar' },
				],
				undefined,
			]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toContain('Asha Rao (EMP011)');
		expect(body.error).toContain('Ravi Kumar (EMP012)');
		expect(body.missing_employees).toEqual([
			{ employee_id: 11, employee_code: 'EMP011', name: 'Asha Rao' },
			{ employee_id: 12, employee_code: 'EMP012', name: 'Ravi Kumar' },
		]);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('names Payroll/Contract employees with no Salary Profile separately from missing slips', async () => {
		grant('payroll:update');
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([
				[{ employee_id: 11, employee_code: 'EMP011', name: 'Asha Rao' }],
				undefined,
			])
			.mockResolvedValueOnce([
				[
					{
						employee_id: 13,
						employee_code: 'EMP013',
						employee_type: 'Contract',
						name: 'Meera Nair',
					},
				],
				undefined,
			]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		// Both populations are named, and the profile-less one says which fix
		// applies — Generate cannot create their slip.
		expect(body.error).toContain('Asha Rao (EMP011)');
		expect(body.error).toContain('Meera Nair (EMP013)');
		expect(body.error).toMatch(/no Salary Profile/);
		expect(body.missing_employees).toEqual([
			{ employee_id: 11, employee_code: 'EMP011', name: 'Asha Rao' },
		]);
		expect(body.employees_without_profiles).toEqual([
			{
				employee_id: 13,
				employee_code: 'EMP013',
				employee_type: 'Contract',
				name: 'Meera Nair',
			},
		]);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('refuses a month when an active Payroll/Contract employee has no Salary Profile', async () => {
		grant('payroll:update');
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([[], undefined]) // everyone who is payable has a slip
			.mockResolvedValueOnce([
				[
					{
						employee_id: 14,
						employee_code: 'EMP014',
						employee_type: 'Payroll',
						name: 'New Joiner',
					},
				],
				undefined,
			]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/no Salary Profile/);
		expect(body.error).toContain('New Joiner (EMP014)');
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('flips the run to finalized and records headcount and money totals', async () => {
		grant('payroll:update');
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id: 9 },
		}));
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined]) // the month's run
			.mockResolvedValueOnce([[], undefined]) // nobody missing a slip
			.mockResolvedValueOnce([[], undefined]) // nobody typed Payroll/Contract without a profile
			.mockResolvedValueOnce([MONTH_SLIPS, undefined]) // the month's slips
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // UPDATE

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe('finalized');
		expect(body.data.finalized_by).toBe(9);
		expect(body.data.total_employees).toBe(2);
		// Decimal sums: 48000.00 + 31405.46 and 200.10 + 0.20. Float addition
		// yields 79405.45999999999 / 200.29999999999998, so these assertions
		// prove the money library.
		expect(body.data.total_gross).toBe(79405.46);
		expect(body.data.total_deductions).toBe(200.3);
		expect(body.data.total_net_pay).toBe(79205.16);
		expect(body.data.total_employer_contribution).toBe(300);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(true);
	});

	it('excludes soft-deleted employees from both gate queries', async () => {
		// Employee deletion is soft: it sets isDelete and leaves status 'active'.
		// Without the predicate a deleted employee with a live profile would block
		// Finalize forever and be named as missing.
		grant('payroll:update');
		mocks.mockExecute.mockResolvedValueOnce([[DRAFT_RUN], undefined]);

		await POST(jsonRequest({ month: '2026-08-01' }));

		const gateStatements = statements().filter((sql) =>
			sql.includes('FROM employees')
		);
		expect(gateStatements).toHaveLength(2);
		for (const sql of gateStatements) {
			expect(sql).toContain('isDelete = 0');
		}
	});

	it('normalises a short YYYY-MM month before comparing against slip months', async () => {
		// payroll_slips.month is a DATE, so an unnormalised '2026-08' would match no
		// slip and report every profiled employee as missing.
		grant('payroll:update');
		mocks.mockExecute.mockResolvedValueOnce([[DRAFT_RUN], undefined]);

		const res = await POST(jsonRequest({ month: '2026-08' }));

		expect(res.status).not.toBe(400);
		const gateCalls = mocks.mockExecute.mock.calls.filter(([sql]) =>
			String(sql).includes('FROM employees')
		);
		expect(gateCalls).toHaveLength(2);
		for (const [, params] of gateCalls) {
			expect(params).toContain('2026-08-01');
		}
	});

	it('reports a conflict when another request finalized the run first', async () => {
		grant('payroll:update');
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([[], undefined]) // nobody missing a slip
			.mockResolvedValueOnce([[], undefined]) // nobody without a profile
			.mockResolvedValueOnce([MONTH_SLIPS, undefined])
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]); // UPDATE matched nothing

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/finalized by another request/i);
		// The transition is guarded, so a losing racer cannot overwrite the winner's
		// finalized_by/at and totals.
		expect(statements().some((sql) => sql.includes("status = 'draft'"))).toBe(
			true
		);
	});
});

describe('payroll finalize API — the transition is audited (issue #243)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	/** The happy path: the run, both gates, the month's slips, the UPDATE. */
	const finalizeRun = () => {
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id: 9 },
		}));
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([[], undefined])
			.mockResolvedValueOnce([[], undefined])
			.mockResolvedValueOnce([MONTH_SLIPS, undefined])
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
	};

	it('records who finalized the run, and the totals they signed off', async () => {
		grant('payroll:update');
		finalizeRun();

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(200);
		const insert = auditInsert();
		expect(insert).toBeDefined();
		const [sql, params] = insert!;
		// performed_at is deliberately absent from the column list: the column's
		// current_timestamp() default is the timestamp, so the entry is stamped by
		// the database rather than by an app clock.
		expect(String(sql)).toContain('performed_by');
		expect(String(sql)).not.toContain('performed_at');
		expect(params[0]).toBe('payroll_run');
		expect(params[1]).toBe(7);
		expect(params[2]).toBeNull(); // a run is not one employee
		expect(params[3]).toBe('finalize');
		expect(JSON.parse(params[4] as string)).toEqual({ status: 'draft' });
		expect(JSON.parse(params[5] as string)).toEqual({
			status: 'finalized',
			total_employees: 2,
			total_gross: 79405.46,
			total_deductions: 200.3,
			total_net_pay: 79205.16,
			total_employer_contribution: 300,
		});
		expect(params[6]).toBe(7); // payroll_run_id
		expect(params[7]).toBe(8); // month
		expect(params[8]).toBe(2026); // year
		// The performer is the authenticated session user.
		expect(params[9]).toBe(9);
	});

	it('still finalizes when the audit write fails', async () => {
		// An audit row that cannot be written must not cost the caller the
		// finalize they asked for — or the lock it put on the month.
		grant('payroll:update');
		finalizeRun();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mocks.mockExecute.mockImplementation(async (sql: string) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
				? Promise.reject(new Error('payroll_audit_logs is missing'))
				: [[], undefined]
		);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.data.status).toBe('finalized');
		expect(body.data.total_net_pay).toBe(79205.16);
		// The failure really happened (the INSERT was attempted) and the helper
		// owned it.
		expect(auditInsert()).toBeDefined();
		expect(errorSpy).toHaveBeenCalledWith(
			'Payroll audit log write failed:',
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});
});
