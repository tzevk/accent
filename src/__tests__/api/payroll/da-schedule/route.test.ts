import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and RBAC BEFORE dynamic route import (Vitest hoists vi.mock).
const mockExecute = vi.fn();
vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn(async () => ({ execute: mockExecute, release: vi.fn() })),
	withDb: vi.fn(),
	query: vi.fn(),
}));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn().mockResolvedValue({ authorized: true }),
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
		expect(sql[1]).toContain('UPDATE payroll_schedules');
		expect(sql[1]).toContain("component_type = 'da'");
		expect(sql[1]).toContain('value = COALESCE');
		expect(sql.some((s) => s.includes('da_schedule'))).toBe(false);
	});

	it('DELETE removes only a DA row of payroll_schedules', async () => {
		const res = await list.DELETE(
			new Request('http://localhost/api/payroll/da-schedule?id=3', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(200);
		const sql = executedSql()[0];
		expect(sql).toContain('DELETE FROM payroll_schedules');
		expect(sql).toContain("component_type = 'da'");
		expect(sql.includes('da_schedule')).toBe(false);
	});

	it('current returns the active DA rate aliased to da_amount', async () => {
		mockExecute.mockResolvedValue([
			[
				{
					da_amount: 2500,
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
