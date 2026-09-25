import { describe, it, expect, vi, beforeEach } from 'vitest';
import { grantFor } from '../test-perms';

// Mock DB and RBAC BEFORE dynamic route import (Vitest hoists vi.mock).
const mockExecute = vi.fn();
// Hoisted so the audit tests at the bottom can re-pin the permission gate.
const mockEnsurePermission = vi.hoisted(() => vi.fn());
vi.mock('@/utils/database', () => ({
	// The DA writers run in a transaction, so the mocked connection carries the
	// full transaction surface, not just execute().
	dbConnect: vi.fn(async () => ({
		execute: mockExecute,
		beginTransaction: vi.fn(),
		commit: vi.fn(),
		rollback: vi.fn(),
		release: vi.fn(),
	})),
}));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const list = await import('@/app/api/payroll/da-schedule/route');
const current = await import('@/app/api/payroll/da-schedule/current/route');

/** All SQL strings passed to db.execute so far. */
function executedSql(): string[] {
	return mockExecute.mock.calls.map((call) => String(call[0]));
}

describe('da-schedule API reads/writes canonical Component Rates only', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockExecute.mockResolvedValue([[], undefined]);
		mockEnsurePermission.mockResolvedValue({ authorized: true });
	});

	it('GET lists DA rates from payroll_schedules', async () => {
		mockExecute.mockResolvedValue([
			[
				{
					id: 3,
					da_amount: 2500,
					effective_from: '2026-04-01',
					effective_to: null,
					is_active: 1,
				},
			],
			undefined,
		]);

		const res = await list.GET(
			new Request('http://localhost/api/payroll/da-schedule')
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		// External contract: the DA page reads data[].da_amount.
		expect(body.data[0]).toMatchObject({ da_amount: 2500, is_active: 1 });
		expect(executedSql()[0]).toContain('FROM payroll_schedules');
		expect(executedSql()[0]).toContain("'da'");
		expect(executedSql().some((sql) => sql.includes('da_schedule'))).toBe(
			false
		);
	});

	it('POST inserts a fixed Component Rate row scoped to DA', async () => {
		mockExecute
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined])
			.mockResolvedValueOnce([{ insertId: 11 }, undefined]);

		const res = await list.POST(
			new Request('http://localhost/api/payroll/da-schedule', {
				method: 'POST',
				body: JSON.stringify({
					da_amount: 2500,
					effective_from: '2026-04-01',
					is_active: true,
				}),
			})
		);

		expect(res.status).toBe(201);
		const sql = executedSql();
		// Deactivating siblings must not touch other component types.
		expect(sql[0]).toContain('UPDATE payroll_schedules');
		expect(sql[0]).toContain("component_type = 'da'");
		expect(sql[1]).toContain('INSERT INTO payroll_schedules');
		expect(sql[1]).toContain("'da'");
		expect(sql[1]).toContain("'fixed'");
		expect(sql.some((s) => s.includes('da_schedule'))).toBe(false);
	});

	it('POST rejects a missing DA amount before touching the DB', async () => {
		const res = await list.POST(
			new Request('http://localhost/api/payroll/da-schedule', {
				method: 'POST',
				body: JSON.stringify({ effective_from: '2026-04-01' }),
			})
		);

		expect(res.status).toBe(400);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('PUT updates only DA rows of payroll_schedules', async () => {
		mockExecute
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined])
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]) // the pre-write read (issue #243)
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

		const res = await list.PUT(
			new Request('http://localhost/api/payroll/da-schedule', {
				method: 'PUT',
				body: JSON.stringify({ id: 3, da_amount: 2600, is_active: true }),
			})
		);

		expect(res.status).toBe(200);
		const sql = executedSql();
		expect(sql[0]).toContain("component_type = 'da'");
		expect(sql[1]).toContain('SELECT'); // the row as it stood before the write
		expect(sql[2]).toContain('UPDATE payroll_schedules');
		expect(sql[2]).toContain("component_type = 'da'");
		expect(sql[2]).toContain('value = COALESCE');
		expect(sql.some((s) => s.includes('da_schedule'))).toBe(false);
	});

	it('DELETE removes only a DA row of payroll_schedules', async () => {
		const res = await list.DELETE(
			new Request('http://localhost/api/payroll/da-schedule?id=3', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(200);
		const sql = executedSql();
		// sql[0] is now the pre-delete read (issue #243).
		const deleteSql = sql.find((s) =>
			s.includes('DELETE FROM payroll_schedules')
		);
		expect(deleteSql).toContain("component_type = 'da'");
		expect(sql.some((s) => s.includes('da_schedule'))).toBe(false);
	});

	it('current returns the active DA rate aliased to da_amount', async () => {
		mockExecute.mockResolvedValue([
			[
				{
					value_type: 'fixed',
					value: '2500.00',
					effective_from: '2026-04-01',
					effective_to: null,
				},
			],
			undefined,
		]);

		const res = await current.GET(
			new Request('http://localhost/api/payroll/da-schedule/current')
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toMatchObject({ da_amount: 2500 });
		expect(executedSql()[0]).toContain('FROM payroll_schedules');
		expect(executedSql()[0]).toContain("'da'");
		// "current" must honour the requested date's effective window —
		// an expired or future-dated row is not current (issue #239 fix).
		expect(executedSql()[0]).toContain('effective_from <= ?');
		expect(executedSql()[0]).toContain('effective_to IS NULL OR');
		expect(executedSql().some((sql) => sql.includes('da_schedule'))).toBe(
			false
		);
	});

	it('current reports zero when no DA Component Rate exists', async () => {
		mockExecute.mockResolvedValue([[], undefined]);

		const res = await current.GET(
			new Request('http://localhost/api/payroll/da-schedule/current')
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.da_amount).toBe(0);
		expect(executedSql()[0]).toContain('FROM payroll_schedules');
	});
});

describe('DA rates API — DA edits are Component Rate audits (issue #243)', () => {
	const grant = grantFor(mockEnsurePermission);

	/**
	 * `grant()` authorizes without a user, and the audit trail must name a real
	 * performer — so give the mocked gate a session user for the write tests.
	 */
	const signedInAs = (id: number) =>
		mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id },
		}));

	/** The DA rate row as it stood before the edit. */
	const PRIOR_DA = {
		id: 31,
		component_type: 'da',
		value_type: 'fixed',
		value: '2500.00',
		effective_from: '2026-01-01',
		effective_to: null,
		is_active: 1,
		remarks: null,
		created_at: '2026-01-01 09:00:00',
		updated_at: '2026-01-01 09:00:00',
	};

	const write = (method: string, body: unknown) =>
		new Request('http://localhost/api/payroll/da-schedule', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});

	const auditInsert = () =>
		mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
		);

	beforeEach(() => {
		mockExecute.mockReset();
		mockExecute.mockResolvedValue([[], undefined]);
	});

	it('denies a caller without payroll:create', async () => {
		grant('payroll:read');

		const res = await list.POST(write('POST', { da_amount: 2600 }));

		expect(res.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('audits a new DA rate as a Component Rate create', async () => {
		grant('payroll:create');
		signedInAs(5);
		mockExecute.mockResolvedValueOnce([
			{ insertId: 31, affectedRows: 1 },
			undefined,
		]);

		const res = await list.POST(
			write('POST', {
				da_amount: 2600,
				effective_from: '2026-09-01',
				remarks: 'October DA revision',
			})
		);

		expect(res.status).toBe(201);
		const insert = auditInsert();
		expect(insert).toBeDefined();
		const [sql, params] = insert!;
		expect(String(sql)).toContain('performed_by');
		expect(params[0]).toBe('component_rate');
		expect(params[1]).toBe(31); // the inserted payroll_schedules row
		expect(params[3]).toBe('create');
		expect(JSON.parse(params[5] as string)).toMatchObject({
			component_type: 'da',
			value_type: 'fixed',
			value: 2600,
			effective_from: '2026-09-01',
			remarks: 'October DA revision',
		});
		expect(params[9]).toBe(5);
	});

	it('audits an edit with the DA rate it displaced', async () => {
		grant('payroll:update');
		signedInAs(5);
		mockExecute
			.mockResolvedValueOnce([{ affectedRows: 3 }, undefined]) // is_active: siblings go off
			.mockResolvedValueOnce([[PRIOR_DA], undefined]) // read before the UPDATE
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

		const res = await list.PUT(
			write('PUT', { id: 31, da_amount: 2750, is_active: true })
		);

		expect(res.status).toBe(200);
		const [, params] = auditInsert()!;
		expect(params[0]).toBe('component_rate');
		expect(params[1]).toBe(31);
		expect(params[3]).toBe('update');
		expect(JSON.parse(params[4] as string)).toEqual({
			id: 31,
			component_type: 'da',
			value_type: 'fixed',
			value: '2500.00',
			effective_from: '2026-01-01',
			effective_to: null,
			is_active: 1,
			remarks: null,
		});
		expect(JSON.parse(params[5] as string)).toEqual({
			value: 2750,
			is_active: 1,
		});
		expect(params[9]).toBe(5);
	});

	it('writes no entry when the DA id matched no row', async () => {
		grant('payroll:update');
		signedInAs(5);
		mockExecute
			.mockResolvedValueOnce([[], undefined])
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

		const res = await list.PUT(write('PUT', { id: 999, da_amount: 2750 }));

		// The route's response contract is unchanged; it simply has nothing to
		// attribute.
		expect(res.status).toBe(200);
		expect(auditInsert()).toBeUndefined();
	});

	it('audits the DA rate it deleted', async () => {
		grant('payroll:delete');
		signedInAs(5);
		mockExecute
			.mockResolvedValueOnce([[PRIOR_DA], undefined]) // read before the DELETE
			.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

		const res = await list.DELETE(
			new Request('http://localhost/api/payroll/da-schedule?id=31', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(200);
		const [, params] = auditInsert()!;
		expect(params[0]).toBe('component_rate');
		expect(params[1]).toBe(31);
		expect(params[3]).toBe('delete');
		expect(JSON.parse(params[4] as string)).toMatchObject({
			value: '2500.00',
		});
		expect(params[5]).toBeNull();
		expect(params[9]).toBe(5);
	});

	it('writes no entry for a delete that removed nothing', async () => {
		grant('payroll:delete');
		signedInAs(5);
		mockExecute
			.mockResolvedValueOnce([[], undefined]) // not a DA rate row
			.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

		const res = await list.DELETE(
			new Request('http://localhost/api/payroll/da-schedule?id=999', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(200);
		expect(auditInsert()).toBeUndefined();
	});

	it('still creates the DA rate when the audit write fails', async () => {
		grant('payroll:create');
		signedInAs(5);
		mockExecute.mockResolvedValueOnce([
			{ insertId: 31, affectedRows: 1 },
			undefined,
		]);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockExecute.mockImplementation(async (sql: string) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
				? Promise.reject(new Error('payroll_audit_logs is missing'))
				: [[], undefined]
		);

		const res = await list.POST(
			write('POST', { da_amount: 2600, effective_from: '2026-09-01' })
		);

		const body = await res.json();
		expect(res.status).toBe(201);
		expect(body.success).toBe(true);
		expect(body.id).toBe(31);
		expect(auditInsert()).toBeDefined();
		errorSpy.mockRestore();
	});
});
