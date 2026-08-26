import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + auth BEFORE dynamic imports (Vitest hoists mocks)
const mockExecute = vi.fn();
const mockConn = { execute: mockExecute, release: vi.fn() };

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue(mockConn),
	withTransaction: vi.fn((fn) => fn(mockConn)),
}));

const mockEnsurePermission = vi.fn().mockResolvedValue({
	authorized: true,
	user: { id: 1, is_super_admin: true },
});
const mockGetCurrentUser = vi
	.fn()
	.mockResolvedValue({ id: 1, is_super_admin: true });
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: (...args) => mockEnsurePermission(...args),
	getCurrentUser: (...args) => mockGetCurrentUser(...args),
	RESOURCES: { LEAVES: 'leaves' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
		APPROVE: 'approve',
	},
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn(),
}));

const { PATCH, DELETE } = await import('@/app/api/leaves/[id]/route');

function appRow(overrides = {}) {
	return {
		id: 5,
		user_id: 2,
		leave_type_id: 1,
		start_date: '2026-08-25',
		end_date: '2026-08-26',
		half_day: 0,
		duration_days: 2,
		status: 'pending',
		reviewed_by: null,
		reviewed_at: null,
		review_notes: null,
		written_attendance: null,
		code: 'CL',
		is_paid: 1,
		requires_balance: 1,
		default_annual_quota: 12,
		employee_id: 3,
		...overrides,
	};
}

describe('PATCH /api/leaves/[id]', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1, is_super_admin: true },
		});
	});

	it('rejects a rejection without review_notes with 400', async () => {
		const req = new Request('http://localhost/api/leaves/5', {
			method: 'PATCH',
			body: JSON.stringify({ status: 'rejected' }),
		});
		const res = await PATCH(req, { params: Promise.resolve({ id: '5' }) });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/review_notes is required/i);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('approving writes attendance rows and the balance ledger inside the audit JSON', async () => {
		mockExecute.mockResolvedValueOnce([[appRow()]]); // loadApplication
		mockExecute.mockResolvedValue([[]]); // existing attendance / holidays / inserts / update

		const req = new Request('http://localhost/api/leaves/5', {
			method: 'PATCH',
			body: JSON.stringify({ status: 'approved', review_notes: 'Enjoy' }),
		});
		const res = await PATCH(req, { params: Promise.resolve({ id: '5' }) });

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe('approved');

		const sqls = mockExecute.mock.calls.map(([sql]) => String(sql));
		const attendanceWrites = sqls.filter((sql) =>
			sql.includes('INSERT INTO employee_attendance')
		);
		expect(attendanceWrites).toHaveLength(2); // two working days

		const ledgerWrite = sqls.find((sql) =>
			sql.includes('INSERT INTO employee_leaves')
		);
		expect(ledgerWrite).toBeTruthy();

		const updateCall = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('UPDATE leave_applications')
		);
		const audit = JSON.parse(updateCall[1][3]);
		expect(audit.attendance).toHaveLength(2);
		expect(audit.balances).toEqual([{ leave_type_id: 1, year: 2026, days: 2 }]);
	});

	it('returns 409 when the application is already in the requested status', async () => {
		mockExecute.mockResolvedValueOnce([[appRow({ status: 'approved' })]]);
		const req = new Request('http://localhost/api/leaves/5', {
			method: 'PATCH',
			body: JSON.stringify({ status: 'approved' }),
		});
		const res = await PATCH(req, { params: Promise.resolve({ id: '5' }) });
		expect(res.status).toBe(409);
	});

	it('rejecting an approved application reverts balances and attendance', async () => {
		mockExecute.mockResolvedValueOnce([
			[
				appRow({
					status: 'approved',
					written_attendance: JSON.stringify({
						attendance: [
							{ date: '2026-08-25', prev_status: null },
							{ date: '2026-08-26', prev_status: 'A' },
						],
						balances: [{ leave_type_id: 1, year: 2026, days: 2 }],
					}),
				}),
			],
		]);
		mockExecute.mockResolvedValue([[]]);

		const req = new Request('http://localhost/api/leaves/5', {
			method: 'PATCH',
			body: JSON.stringify({ status: 'rejected', review_notes: 'Peak season' }),
		});
		const res = await PATCH(req, { params: Promise.resolve({ id: '5' }) });

		expect(res.status).toBe(200);
		const sqls = mockExecute.mock.calls.map(([sql]) => String(sql));
		expect(
			sqls.filter((sql) => sql.includes('DELETE FROM employee_attendance'))
		).toHaveLength(1);
		expect(
			sqls.filter((sql) => sql.includes('UPDATE employee_attendance'))
		).toHaveLength(1);
		expect(
			sqls.filter((sql) => sql.includes('used_leaves = GREATEST'))
		).toHaveLength(1);
	});

	it('passes through 403 when approve permission is missing', async () => {
		mockEnsurePermission.mockResolvedValue({
			authorized: false,
			response: new Response('Forbidden', { status: 403 }),
		});
		const req = new Request('http://localhost/api/leaves/5', {
			method: 'PATCH',
			body: JSON.stringify({ status: 'approved' }),
		});
		const res = await PATCH(req, { params: Promise.resolve({ id: '5' }) });
		expect(res.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('DELETE /api/leaves/[id]', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockGetCurrentUser.mockReset();
		mockGetCurrentUser.mockResolvedValue({ id: 7 });
	});

	it('lets the owner withdraw their own pending application (soft delete)', async () => {
		mockExecute.mockResolvedValueOnce([[appRow({ user_id: 7 })]]); // loadApplication
		mockExecute.mockResolvedValue([[]]);

		const req = new Request('http://localhost/api/leaves/5', {
			method: 'DELETE',
		});
		const res = await DELETE(req, { params: Promise.resolve({ id: '5' }) });
		expect(res.status).toBe(200);

		const deleteSql = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('SET isDelete = 1')
		);
		expect(deleteSql).toBeTruthy();
	});

	it('blocks non-owner users without leaves:delete from withdrawing', async () => {
		mockExecute.mockResolvedValueOnce([[appRow({ user_id: 2 })]]);
		const req = new Request('http://localhost/api/leaves/5', {
			method: 'DELETE',
		});
		const res = await DELETE(req, { params: Promise.resolve({ id: '5' }) });
		expect(res.status).toBe(403);
	});
});
