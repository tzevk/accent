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

const { GET, DELETE } = await import('@/app/api/payroll/slips/route');

const grant = grantFor(mocks.mockEnsurePermission);

/** SQL strings the route handed to the mocked connection, in call order. */
const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

const slipped = (rows: unknown[]) => [rows, undefined];

/** UPDATE/DELETE result: mysql2 hands back a ResultSetHeader, not rows. */
const affected = (count: number) => [{ affectedRows: count }, undefined];

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
