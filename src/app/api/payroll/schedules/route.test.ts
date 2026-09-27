import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: {
		PAYROLL: 'payroll',
		SETTINGS: 'settings',
		EMPLOYEES: 'employees',
	},
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { GET, POST, PUT, DELETE } =
	await import('@/app/api/payroll/schedules/route');

const grant = grantFor(mocks.mockEnsurePermission);

const db = {
	query: vi.fn(),
	execute: vi.fn(),
	beginTransaction: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	end: vi.fn(),
};

const jsonRequest = (method: string, body: unknown) =>
	new Request('http://localhost/api/payroll/schedules', {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

describe('payroll component schedules API — PAYROLL permission (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	describe('GET', () => {
		it('denies a settings-only caller — RBAC consults payroll, not settings', async () => {
			grant('settings:read');

			const res = await GET(
				new Request('http://localhost/api/payroll/schedules')
			);

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:read', async () => {
			grant('payroll:read');
			db.query.mockResolvedValue([[{ id: 1, component_type: 'pt' }], []]);

			const res = await GET(
				new Request('http://localhost/api/payroll/schedules')
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data).toHaveLength(1);
		});
	});

	describe('POST', () => {
		it('denies a settings-only caller', async () => {
			grant('settings:create');

			const res = await POST(
				jsonRequest('POST', {
					component_type: 'pt',
					value_type: 'fixed',
					value: 200,
					effective_from: '2026-04-01',
				})
			);

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:create', async () => {
			grant('payroll:create');
			db.query.mockResolvedValue([{ insertId: 7 }, []]);

			const res = await POST(
				jsonRequest('POST', {
					component_type: 'pt',
					value_type: 'fixed',
					value: 200,
					effective_from: '2026-04-01',
				})
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.id).toBe(7);
		});
	});

	describe('PUT', () => {
		it('denies a settings-only caller', async () => {
			grant('settings:update');

			const res = await PUT(jsonRequest('PUT', { id: 1, value: 250 }));

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:update', async () => {
			grant('payroll:update');
			db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

			const res = await PUT(jsonRequest('PUT', { id: 1, value: 250 }));

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	describe('DELETE', () => {
		it('denies a settings-only caller', async () => {
			grant('settings:delete');

			const res = await DELETE(
				new Request('http://localhost/api/payroll/schedules?id=1', {
					method: 'DELETE',
				})
			);

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:delete', async () => {
			grant('payroll:delete');
			db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

			const res = await DELETE(
				new Request('http://localhost/api/payroll/schedules?id=1', {
					method: 'DELETE',
				})
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});
});

describe('component rates API — rate edits are audited (issue #243)', () => {
	/**
	 * `grant()` authorizes without a user, and the audit trail must name a real
	 * performer — so give the mocked gate a session user for the write tests.
	 */
	const signedInAs = (id: number) =>
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id },
		}));

	/** The rate as it stood before the edit. */
	const PRIOR_RATE = {
		id: 21,
		component_type: 'da',
		value_type: 'fixed',
		value: '2500.00',
		effective_from: '2026-01-01',
		effective_to: null,
		is_active: 1,
		min_salary: null,
		max_salary: null,
		remarks: null,
		created_at: '2026-01-01 09:00:00',
		updated_at: '2026-01-01 09:00:00',
	};

	const rows = (result: unknown[]) => [result, undefined];

	const auditInsert = () =>
		db.execute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
		);

	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		db.query.mockResolvedValue([[], undefined]);
		db.execute.mockResolvedValue([[], undefined]);
	});

	it('denies a caller without payroll:create', async () => {
		grant('payroll:read');

		const res = await POST(
			jsonRequest('POST', {
				component_type: 'da',
				value_type: 'fixed',
				value: 2500,
				effective_from: '2026-09-01',
			})
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('audits a new Component Rate, attributed to the session user', async () => {
		grant('payroll:create');
		signedInAs(4);
		db.query.mockResolvedValueOnce(rows({ insertId: 21, affectedRows: 1 }));

		const res = await POST(
			jsonRequest('POST', {
				component_type: 'bonus',
				value_type: 'percentage',
				value: 8.33,
				effective_from: '2026-09-01',
			})
		);

		expect(res.status).toBe(200);
		const insert = auditInsert();
		expect(insert).toBeDefined();
		const [sql, params] = insert!;
		expect(String(sql)).toContain('performed_by');
		expect(params[0]).toBe('component_rate');
		expect(params[1]).toBe(21); // the inserted row
		expect(params[3]).toBe('create');
		expect(params[4]).toBeNull(); // a create displaces nothing
		expect(JSON.parse(params[5] as string)).toMatchObject({
			component_type: 'bonus',
			value_type: 'percentage',
			value: 8.33,
			effective_from: '2026-09-01',
		});
		expect(params[9]).toBe(4);
	});

	it('audits an edit with the rate it displaced', async () => {
		grant('payroll:update');
		signedInAs(4);
		db.query
			.mockResolvedValueOnce(rows([PRIOR_RATE])) // read before the UPDATE
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));

		const res = await PUT(jsonRequest('PUT', { id: 21, value: '2600.00' }));

		expect(res.status).toBe(200);
		const [, params] = auditInsert()!;
		expect(params[0]).toBe('component_rate');
		expect(params[1]).toBe(21);
		expect(params[3]).toBe('update');
		expect(JSON.parse(params[4] as string)).toEqual({
			id: 21,
			component_type: 'da',
			value_type: 'fixed',
			value: '2500.00',
			effective_from: '2026-01-01',
			effective_to: null,
			is_active: 1,
			min_salary: null,
			max_salary: null,
			remarks: null,
		});
		expect(JSON.parse(params[5] as string)).toEqual({ value: '2600.00' });
		expect(params[9]).toBe(4);
	});

	it('audits an edit only after the transaction has committed', async () => {
		grant('payroll:update');
		signedInAs(4);
		db.query
			.mockResolvedValueOnce(rows([PRIOR_RATE]))
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));

		await PUT(jsonRequest('PUT', { id: 21, value: '2600.00' }));

		// The audit write must never sit inside the transaction, where a failure
		// of the log would cost the rate change itself.
		expect(db.beginTransaction).toHaveBeenCalledTimes(1);
		expect(db.commit).toHaveBeenCalledTimes(1);
		expect(db.commit.mock.invocationCallOrder[0]).toBeLessThan(
			db.execute.mock.invocationCallOrder[0]
		);
	});

	it('keeps the committed rate when the audit write fails', async () => {
		grant('payroll:update');
		signedInAs(4);
		db.query
			.mockResolvedValueOnce(rows([PRIOR_RATE]))
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		db.execute.mockRejectedValue(new Error('payroll_audit_logs is missing'));

		const res = await PUT(jsonRequest('PUT', { id: 21, value: '2600.00' }));

		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.message).toMatch(/updated successfully/i);
		// The rate is committed and never rolled back on account of the log.
		expect(db.commit).toHaveBeenCalledTimes(1);
		expect(db.rollback).not.toHaveBeenCalled();
		expect(auditInsert()).toBeDefined();
		errorSpy.mockRestore();
	});

	it('leaves the audit trail alone when the id matched no rate', async () => {
		grant('payroll:update');
		signedInAs(4);
		db.query
			.mockResolvedValueOnce(rows([]))
			.mockResolvedValueOnce(rows({ affectedRows: 0 }));

		const res = await PUT(jsonRequest('PUT', { id: 999, value: '2600.00' }));

		expect(res.status).toBe(404);
		expect(db.rollback).toHaveBeenCalledTimes(1);
		expect(auditInsert()).toBeUndefined();
	});

	it('audits a deleted Component Rate', async () => {
		grant('payroll:delete');
		signedInAs(4);
		db.query
			.mockResolvedValueOnce(rows([PRIOR_RATE])) // read before the DELETE
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));

		const res = await DELETE(
			new Request('http://localhost/api/payroll/schedules?id=21', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(200);
		const [, params] = auditInsert()!;
		expect(params[0]).toBe('component_rate');
		expect(params[1]).toBe('21');
		expect(params[3]).toBe('delete');
		expect(JSON.parse(params[4] as string)).toMatchObject({
			value: '2500.00',
			component_type: 'da',
		});
		expect(params[5]).toBeNull();
		expect(params[9]).toBe(4);
	});
});
