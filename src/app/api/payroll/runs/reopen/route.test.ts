import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';
import { isRunLocked } from '@/app/api/payroll/_lib/payroll-run';
import { payrollAuditRows } from '../../audit-rows';

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

const { POST } = await import('@/app/api/payroll/runs/reopen/route');

const grant = grantFor(mocks.mockEnsurePermission);

/** The run Finalize signed off: finalized, with the numbers it locked in. */
const FINALIZED_RUN = {
	id: 7,
	month: 8,
	year: 2026,
	run_number: 1,
	status: 'finalized',
	finalized_by: 5,
	finalized_at: '2026-09-01 10:00:00',
	total_employees: 2,
	total_gross: '79405.46',
	total_deductions: '200.30',
	total_net_pay: '79205.16',
	total_employer_contribution: '300.00',
};

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/runs/reopen', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

const updates = () =>
	mocks.mockExecute.mock.calls.filter(([sql]) =>
		String(sql).includes('UPDATE payroll_runs')
	);

/** The audit entries the route wrote, with their columns named. */
const audits = () => payrollAuditRows(mocks.mockExecute);

/** A session that holds payroll:update — super-admin unless told otherwise. */
const signIn = (isSuperAdmin: boolean) => {
	mocks.mockEnsurePermission.mockResolvedValue({
		authorized: true,
		user: { id: 5, is_super_admin: isSuperAdmin },
	});
};

describe('payroll reopen API — unlocking a finalized month (issue #244)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
		signIn(true);
	});

	it('denies a caller without payroll:update', async () => {
		grant('payroll:read');

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('refuses a non-super-admin even with payroll:update', async () => {
		signIn(false);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/super-admin/i);
		// Identity decides this, so the database is never even consulted.
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(updates()).toHaveLength(0);
		expect(audits()).toHaveLength(0);
	});

	it('rejects a request without a month', async () => {
		const res = await POST(jsonRequest({}));

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('refuses a month that has no Payroll Run yet', async () => {
		mocks.mockExecute.mockResolvedValue([[], undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(updates()).toHaveLength(0);
	});

	it('refuses a run that is not finalized', async () => {
		mocks.mockExecute.mockResolvedValue([
			[{ ...FINALIZED_RUN, status: 'draft' }],
			undefined,
		]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/not finalized/i);
		expect(updates()).toHaveLength(0);
		expect(audits()).toHaveLength(0);
	});

	it('refuses while any slip of the month is paid', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[FINALIZED_RUN], undefined])
			.mockResolvedValueOnce([
				[
					{ id: 1, employee_id: 11, payment_status: 'paid' },
					{ id: 2, employee_id: 12, payment_status: 'processed' },
				],
				undefined,
			]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/already paid/i);
		expect(body.error).toMatch(/permanent/i);
		expect(body.paid_slips).toBe(1);
		expect(updates()).toHaveLength(0);
		expect(audits()).toHaveLength(0);
	});

	it('returns a finalized run with no paid slips to draft, audit-logged', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[FINALIZED_RUN], undefined])
			.mockResolvedValueOnce([
				[
					{ id: 1, employee_id: 11, payment_status: 'pending' },
					{ id: 2, employee_id: 12, payment_status: 'hold' },
				],
				undefined,
			])
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toMatchObject({
			id: 7,
			status: 'draft',
			finalized_by: null,
			finalized_at: null,
			total_net_pay: 0,
		});
		// The lock the generate route consults is released — that is what makes
		// the next Generate succeed.
		expect(isRunLocked(body.data)).toBe(false);

		expect(updates()).toHaveLength(1);
		expect(updates()[0][1]).toEqual([7, 'finalized', 'paid', '2026-08-01']);

		const [audit] = audits();
		expect(audit).toMatchObject({
			entityType: 'payroll_run',
			entityId: 7,
			action: 'reopen',
			payrollRunId: 7,
			month: 8,
			year: 2026,
			performedBy: 5,
		});
		// Old values keep what the reopen displaced — the signed-off totals and
		// the performer who signed them — and new values say draft.
		expect(audit.oldValues).toMatchObject({
			status: 'finalized',
			total_net_pay: '79205.16',
		});
		expect(audit.newValues).toMatchObject({ status: 'draft' });
	});

	it('reopens a run left at the legacy stored `paid` status', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ ...FINALIZED_RUN, status: 'paid' }],
				undefined,
			])
			.mockResolvedValueOnce([[], undefined])
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		// The stored status is not the truth — the slips are — so a locked month
		// nobody paid is still recoverable instead of stranding its slips.
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.status).toBe('draft');
	});

	it('refuses when a slip is paid while the reopen is in flight', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[FINALIZED_RUN], undefined]) // the run lookup
			.mockResolvedValueOnce([[], undefined]) // no paid slip yet
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]) // the guard blocked it
			.mockResolvedValueOnce([[FINALIZED_RUN], undefined]) // re-read: still finalized
			.mockResolvedValueOnce([[{ id: 1, payment_status: 'paid' }], undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		// The payment landed between the check and the transition, so the month
		// became permanent in that window — and it must be reported as such.
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/already paid/i);
		expect(body.paid_slips).toBe(1);
		expect(audits()).toHaveLength(0);
	});

	it('reports the conflict when a concurrent request reopened the run first', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[FINALIZED_RUN], undefined])
			.mockResolvedValueOnce([[], undefined])
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/another request/i);
		// Nothing transitioned, so nothing is attributed.
		expect(audits()).toHaveLength(0);
	});
});
