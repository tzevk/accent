import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';
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

const { POST } = await import('@/app/api/payroll/runs/mark-paid/route');

const grant = grantFor(mocks.mockEnsurePermission);

const FINALIZED_RUN = {
	id: 7,
	month: 8,
	year: 2026,
	run_number: 1,
	status: 'finalized',
};

/** A slip of the month, with the payment columns the batch reads. */
const slip = (overrides: Record<string, unknown>) => ({
	id: 1,
	employee_id: 11,
	payment_status: 'pending',
	payment_date: null,
	payment_reference: null,
	...overrides,
});

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/runs/mark-paid', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

/** The audit entries the route wrote, with their columns named. */
const auditRows = () => payrollAuditRows(mocks.mockExecute);

const updates = () =>
	mocks.mockExecute.mock.calls.filter(([sql]) =>
		String(sql).includes('UPDATE payroll_slips')
	);

/** Queue the run lookup and the month's slips, in the order the route asks. */
const monthOf = (run: unknown, slips: unknown[]) => {
	mocks.mockExecute
		.mockResolvedValueOnce([[run], undefined])
		.mockResolvedValueOnce([slips, undefined]);
};

describe('payroll mark-paid API — bulk payment for a finalized month (issue #245)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
		// The performer the audit entries are attributed to.
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 5, is_super_admin: true },
		});
	});

	it('denies a caller without payroll:update', async () => {
		grant('payroll:read');

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a request without a month', async () => {
		const res = await POST(jsonRequest({ payment_date: '2026-08-31' }));

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a request without a payment date', async () => {
		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/payment date/i);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a payment date that is not a real calendar date', async () => {
		for (const payment_date of ['24-08-2026', '2026-8-1', '2026-02-31']) {
			vi.resetAllMocks();
			mocks.mockDbConnect.mockResolvedValue({
				execute: mocks.mockExecute,
				release: vi.fn(),
			});
			mocks.mockEnsurePermission.mockResolvedValue({
				authorized: true,
				user: { id: 5, is_super_admin: true },
			});

			const res = await POST(
				jsonRequest({ month: '2026-08-01', payment_date })
			);

			expect(res.status, payment_date).toBe(400);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		}
	});

	it('refuses a month that has no Payroll Run yet', async () => {
		mocks.mockExecute.mockResolvedValue([[], undefined]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(updates()).toHaveLength(0);
	});

	it('refuses a month whose run is not finalized', async () => {
		monthOf({ ...FINALIZED_RUN, status: 'draft' }, [slip({})]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/not finalized/i);
		expect(updates()).toHaveLength(0);
		expect(auditRows()).toHaveLength(0);
	});

	it('marks every slip of the month paid in one action, auditing each one', async () => {
		monthOf(FINALIZED_RUN, [
			slip({ id: 1, employee_id: 11, payment_status: 'pending' }),
			slip({ id: 2, employee_id: 12, payment_status: 'processed' }),
		]);

		const res = await POST(
			jsonRequest({
				month: '2026-08-01',
				payment_date: '2026-08-31',
				payment_reference: 'NEFT-BATCH-42',
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toEqual({
			updated: 2,
			already_paid: 0,
			total_slips: 2,
			is_paid: true,
		});

		// One write for the whole batch, scoped to the month (both Employee Type
		// streams — a run pays both), carrying the batch date and reference.
		expect(updates()).toHaveLength(1);
		expect(updates()[0][1]).toEqual([
			'2026-08-31',
			'NEFT-BATCH-42',
			'2026-08-01',
		]);

		// One entry per slip, so a batch is still traceable slip by slip.
		const audits = auditRows();
		expect(audits).toHaveLength(2);
		for (const audit of audits) {
			expect(audit).toMatchObject({
				entityType: 'payroll_slip',
				action: 'update',
				performedBy: 5,
				month: 8,
				year: 2026,
			});
			expect(audit.newValues).toMatchObject({ payment_status: 'paid' });
		}
		expect(audits.map((audit) => audit.entityId)).toEqual([1, 2]);
		expect(audits.map((audit) => audit.employeeId)).toEqual([11, 12]);
	});

	it('binds a null reference when none was supplied so each slip keeps its own', async () => {
		monthOf(FINALIZED_RUN, [slip({ payment_status: 'pending' })]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(200);
		// The statement's COALESCE is what turns this null into "leave the
		// column alone"; binding anything else would wipe recorded references.
		expect(updates()[0][1]).toEqual(['2026-08-31', null, '2026-08-01']);
	});

	it('leaves a slip already paid on that date alone', async () => {
		monthOf(FINALIZED_RUN, [
			slip({ id: 1, employee_id: 11, payment_status: 'pending' }),
			slip({
				id: 2,
				employee_id: 12,
				payment_status: 'paid',
				payment_date: '2026-08-31',
				payment_reference: 'NEFT-BATCH-42',
			}),
		]);

		const res = await POST(
			jsonRequest({
				month: '2026-08-01',
				payment_date: '2026-08-31',
				payment_reference: 'NEFT-BATCH-42',
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual({
			updated: 1,
			already_paid: 1,
			total_slips: 2,
			is_paid: true,
		});
		// Re-running the batch must not manufacture history for a slip that was
		// already paid on that date.
		const audits = auditRows();
		expect(audits).toHaveLength(1);
		expect(audits[0].entityId).toBe(1);
	});

	it('corrects the date of a slip that is paid on a different day', async () => {
		monthOf(FINALIZED_RUN, [
			slip({
				id: 2,
				employee_id: 12,
				payment_status: 'paid',
				payment_date: '2026-08-15',
			}),
		]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.updated).toBe(1);
		const audits = auditRows();
		expect(audits).toHaveLength(1);
		// The pre-write row is what the entry displaced, not what the caller said.
		expect(audits[0].oldValues).toMatchObject({ payment_date: '2026-08-15' });
	});

	it('refuses when the run stops being finalized before the write lands', async () => {
		monthOf(FINALIZED_RUN, [slip({ payment_status: 'pending' })]);
		mocks.mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		// The guarded UPDATE matched nothing: a concurrent reopen got there first,
		// so no slip of the now-draft month was paid and nothing is attributed.
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/not finalized/i);
		expect(auditRows()).toHaveLength(0);
	});

	it('reports a finalized month with no slips without writing anything', async () => {
		monthOf(FINALIZED_RUN, []);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual({
			updated: 0,
			already_paid: 0,
			total_slips: 0,
			is_paid: false,
		});
		expect(updates()).toHaveLength(0);
		expect(auditRows()).toHaveLength(0);
	});

	it('normalises a short month form before it reaches the queries', async () => {
		monthOf(FINALIZED_RUN, [slip({ payment_status: 'pending' })]);

		const res = await POST(
			jsonRequest({ month: '2026-08', payment_date: '2026-08-31' })
		);

		expect(res.status).toBe(200);
		// '2026-08' would never match payroll_slips.month (a DATE), so the route
		// must compare the normalised first of the month.
		expect(updates()[0][1]).toContain('2026-08-01');
	});
});
