import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

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

const { GET, PUT, DELETE } = await import('@/app/api/payroll/slips/route');

const grant = grantFor(mocks.mockEnsurePermission);

/** SQL strings the route handed to the mocked connection, in call order. */
const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

const slipped = (rows: unknown[]) => [rows, undefined];

/** UPDATE/DELETE result: mysql2 hands back a ResultSetHeader, not rows. */
const affected = (count: number) => [{ affectedRows: count }, undefined];

/** The INSERT the route made into payroll_audit_logs, or undefined if none. */
const auditInsert = () =>
	mocks.mockExecute.mock.calls.find(([sql]) =>
		String(sql).includes('INSERT INTO payroll_audit_logs')
	);

describe('payroll slips API — single-slip read (issue #240)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('denies a caller without payroll:read', async () => {
		grant('employees:read');

		const res = await GET(new Request('http://localhost/api/payroll/slips'));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('returns the slip whose id was asked for, and no other slip', async () => {
		grant('payroll:read');
		const slip = {
			id: 42,
			month: '2026-08-01',
			employee_id: 7,
			employee_name: 'Asha Rao',
			net_pay: '48250.00',
		};
		mocks.mockExecute.mockResolvedValue([[slip], undefined]);

		const res = await GET(
			new Request('http://localhost/api/payroll/slips?id=42')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].id).toBe(42);
		// The id must reach the query — otherwise the route would return the
		// whole table and the caller's slip id would be ignored.
		const [sql, params] = mocks.mockExecute.mock.calls[0];
		expect(String(sql)).toContain('ps.id = ?');
		expect(params).toContain('42');
	});

	it('resolves the month-scheduled DA when only a slip id is given', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					{
						id: 42,
						month: '2026-08-01',
						employee_id: 7,
						name: 'Asha Rao',
						profile_basic: 60000,
						basic: 50000,
						da_used: 0,
					},
				],
				undefined,
			])
			.mockResolvedValueOnce([
				[{ value_type: 'fixed', value: 2500 }],
				undefined,
			]);

		const res = await GET(
			new Request('http://localhost/api/payroll/slips?id=42')
		);

		const body = await res.json();
		// Same normalization the month listing applies: Basic/DA must not depend
		// on whether the caller asked by id or by month.
		expect(body.data[0].da).toBe(2500);
		expect(body.data[0].basic).toBe(57500);
		const daLookup = mocks.mockExecute.mock.calls[1];
		expect(String(daLookup[0])).toContain('FROM payroll_schedules');
		expect(daLookup[1]).toContain('2026-08-01');
	});

	it('still lists a month when no id is given', async () => {
		grant('payroll:read');
		mocks.mockExecute.mockResolvedValue([
			[
				{ id: 1, month: '2026-08-01' },
				{ id: 2, month: '2026-08-01' },
			],
			undefined,
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/slips?month=2026-08-01')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		const [sql, params] = mocks.mockExecute.mock.calls[0];
		expect(String(sql)).toContain('ps.month = ?');
		expect(String(sql)).not.toContain('ps.id = ?');
		expect(params).toContain('2026-08-01');
	});
});

describe('payroll slips API — deletion cannot strip a locked month (issue #242)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	const deleteRequest = (query: string) =>
		new Request(`http://localhost/api/payroll/slips${query}`, {
			method: 'DELETE',
		});

	const DRAFT_RUN = {
		id: 7,
		month: 8,
		year: 2026,
		run_number: 1,
		status: 'draft',
	};

	it('denies a caller without payroll:delete', async () => {
		grant('payroll:read');

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('deletes a slip whose month has no Payroll Run', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ month: '2026-08-01' }])) // the slip
			.mockResolvedValueOnce(slipped([])) // month was never generated
			.mockResolvedValueOnce(affected(1));

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(true);
	});

	it('deletes a slip whose month is still a draft run', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ month: '2026-08-01' }]))
			.mockResolvedValueOnce(slipped([DRAFT_RUN]))
			.mockResolvedValueOnce(affected(1));

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(200);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(true);
	});

	it('refuses to delete a slip in a finalized month', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ month: '2026-08-01' }]))
			.mockResolvedValueOnce(slipped([{ ...DRAFT_RUN, status: 'finalized' }]));

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/locked/i);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(false);
	});

	it('404s a slip id that does not exist, without deleting', async () => {
		grant('payroll:delete');
		mocks.mockExecute.mockResolvedValueOnce(slipped([]));

		const res = await DELETE(deleteRequest('?id=999'));

		expect(res.status).toBe(404);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(false);
	});

	it('refuses the bulk wipe while any month is locked', async () => {
		grant('payroll:delete');
		mocks.mockExecute.mockResolvedValueOnce(
			slipped([{ ...DRAFT_RUN, status: 'finalized' }])
		);

		const res = await DELETE(deleteRequest('?all=true'));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/locked/i);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(false);
	});

	it('allows the bulk wipe when no month is locked', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([])) // no locked run anywhere
			.mockResolvedValueOnce(affected(4));

		const res = await DELETE(deleteRequest('?all=true'));

		expect(res.status).toBe(200);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(true);
	});
});

describe('payroll slips API — payment changes are audited (issue #243)', () => {
	/**
	 * `grant()` authorizes without a user, and the audit trail must name a real
	 * performer — so give the mocked gate a session user for the write tests.
	 */
	const signedInAs = (id: number) =>
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id },
		}));

	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	const putRequest = (body: unknown) =>
		new Request('http://localhost/api/payroll/slips', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});

	/** The slip as it stood before the payment change. */
	const PENDING_SLIP = {
		id: 42,
		employee_id: 7,
		month: '2026-08-01',
		payment_status: 'pending',
		payment_date: null,
		payment_reference: null,
		remarks: null,
		created_at: '2026-08-02 10:00:00',
		updated_at: '2026-08-02 10:00:00',
	};

	it('records who marked a slip paid, and the payment state it displaced', async () => {
		grant('payroll:update');
		signedInAs(12);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([PENDING_SLIP]))
			.mockResolvedValueOnce(affected(1));

		const res = await PUT(
			putRequest({
				id: 42,
				payment_status: 'paid',
				payment_date: '2026-09-05',
				payment_reference: 'NEFT/9911',
			})
		);

		expect(res.status).toBe(200);
		const insert = auditInsert();
		expect(insert).toBeDefined();
		const [, params] = insert!;
		expect(params[0]).toBe('payroll_slip');
		expect(params[1]).toBe(42);
		expect(params[2]).toBe(7); // the employee the slip belongs to
		expect(params[3]).toBe('update');
		// The row is read before the write, so old_values is the real prior state
		// — minus the row's own history columns.
		expect(JSON.parse(params[4] as string)).toEqual({
			id: 42,
			employee_id: 7,
			month: '2026-08-01',
			payment_status: 'pending',
			payment_date: null,
			payment_reference: null,
			remarks: null,
		});
		expect(JSON.parse(params[5] as string)).toEqual({
			payment_status: 'paid',
			payment_date: '2026-09-05',
			payment_reference: 'NEFT/9911',
		});
		expect(params[7]).toBe(8); // month
		expect(params[8]).toBe(2026); // year
		expect(params[9]).toBe(12); // the session user
	});

	it('writes nothing when the slip id matched no row', async () => {
		grant('payroll:update');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([]))
			.mockResolvedValueOnce(affected(0));

		const res = await PUT(putRequest({ id: 999, payment_status: 'paid' }));

		// The response contract is unchanged, and an entry pointing at a row that
		// was never written would be a lie.
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(auditInsert()).toBeUndefined();
	});

	it('still updates the slip when the audit write fails', async () => {
		grant('payroll:update');
		signedInAs(12);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([PENDING_SLIP]))
			.mockResolvedValueOnce(affected(1));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mocks.mockExecute.mockImplementation(async (sql: string) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
				? Promise.reject(new Error('payroll_audit_logs is missing'))
				: [[], undefined]
		);

		const res = await PUT(putRequest({ id: 42, payment_status: 'paid' }));

		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.message).toMatch(/updated successfully/i);
		expect(auditInsert()).toBeDefined();
		errorSpy.mockRestore();
	});

	/**
	 * The audit tests above send payment_date and payment_reference, but the one
	 * caller in the app (the Reports edit form, src/app/reports/page.jsx) sends
	 * only { id, payment_status, remarks }. Those two fields then arrive
	 * undefined, and mysql2's execute() rejects ANY undefined binding with
	 * "Bind parameters must not contain undefined" — so the request 500ed before
	 * the audit INSERT above could ever run. Mocking db.execute hid it, because
	 * the mock never inspects the bindings.
	 */
	it('accepts the edit form body, whose omitted payment fields are not undefined bindings', async () => {
		grant('payroll:update');
		signedInAs(12);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([PENDING_SLIP]))
			.mockResolvedValueOnce(affected(1));

		const res = await PUT(
			putRequest({ id: 42, payment_status: 'paid', remarks: 'paid by NEFT' })
		);

		expect(res.status).toBe(200);

		const update = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('UPDATE payroll_slips')
		);
		expect(update).toBeDefined();
		const [sql, params] = update!;

		// The exact failure mysql2 would raise, prevented at the binding site.
		expect(
			(params as unknown[]).filter((value) => value === undefined)
		).toEqual([]);
		// An omitted field must mean "leave it alone". Binding NULL without the
		// COALESCE would wipe a recorded payment_date on a status-only edit.
		expect(String(sql)).toContain('payment_date = COALESCE(?, payment_date)');
		expect(String(sql)).toContain(
			'payment_reference = COALESCE(?, payment_reference)'
		);
		expect((params as unknown[])[1]).toBeNull();
		expect((params as unknown[])[2]).toBeNull();

		// And the entry the criterion is about does fire for that body.
		expect(auditInsert()).toBeDefined();
	});
});
