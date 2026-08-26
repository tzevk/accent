import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + auth BEFORE dynamic imports (Vitest hoists mocks)
const mockExecute = vi.fn();
const mockConn = { execute: mockExecute, release: vi.fn() };

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue(mockConn),
	withTransaction: vi.fn((fn) => fn(mockConn)),
}));

const mockEnsurePermission = vi
	.fn()
	.mockResolvedValue({ authorized: true, user: { id: 1 } });
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: (...args) => mockEnsurePermission(...args),
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

const { GET, POST } = await import('@/app/api/leaves/route');

describe('GET /api/leaves', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	it('scopes the list to the requester when they cannot approve', async () => {
		mockExecute.mockResolvedValue([
			[{ id: 4, status: 'pending', applicant_name: 'Self' }],
		]);
		const req = new Request('http://localhost/api/leaves');
		const res = await GET(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
		const [sql] = mockExecute.mock.calls[0];
		expect(sql).toContain('la.user_id = ?');
		expect(sql).toContain(
			'WHERE isDelete = 0'.replace('isDelete = 0', 'la.isDelete = 0')
		);
	});

	it('returns all applications for approvers', async () => {
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1, is_super_admin: true },
		});
		mockExecute.mockResolvedValue([[]]);
		const req = new Request('http://localhost/api/leaves');
		const res = await GET(req);
		expect(res.status).toBe(200);
		const [sql, params] = mockExecute.mock.calls[0];
		expect(sql).not.toContain('la.user_id = ?');
		expect(sql).toContain('LIMIT 50 OFFSET 0');
		// limit/offset are interpolated, NOT bound — extra bindings make MariaDB
		// silently return an empty result set
		expect(params).toEqual([]);
	});

	it('passes through 403 when read permission is missing', async () => {
		mockEnsurePermission.mockResolvedValue({
			authorized: false,
			response: new Response('Forbidden', { status: 403 }),
		});
		const req = new Request('http://localhost/api/leaves');
		const res = await GET(req);
		expect(res.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('POST /api/leaves', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	const validBody = {
		leave_type_id: 2,
		start_date: '2026-08-25',
		end_date: '2026-08-26',
		reason: 'Family function',
	};

	it('rejects invalid dates with 400 and never touches the DB', async () => {
		const req = new Request('http://localhost/api/leaves', {
			method: 'POST',
			body: JSON.stringify({ ...validBody, start_date: '25-08-2026' }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('rejects end_date before start_date with 400', async () => {
		const req = new Request('http://localhost/api/leaves', {
			method: 'POST',
			body: JSON.stringify({
				...validBody,
				end_date: '2026-08-24',
			}),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/on or after start_date/i);
	});

	it('rejects a half-day spanning multiple dates with 400', async () => {
		const req = new Request('http://localhost/api/leaves', {
			method: 'POST',
			body: JSON.stringify({ ...validBody, half_day: true }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
	});

	it('rejects overlapping pending/approved applications with 409', async () => {
		mockExecute.mockResolvedValueOnce([[{ id: 1, name: 'Casual Leave' }]]);
		mockExecute.mockResolvedValueOnce([[{ id: 99 }]]);
		const req = new Request('http://localhost/api/leaves', {
			method: 'POST',
			body: JSON.stringify(validBody),
		});
		const res = await POST(req);
		expect(res.status).toBe(409);
	});

	it('inserts a pending application with server-computed duration', async () => {
		mockExecute.mockResolvedValueOnce([[{ id: 1, name: 'Casual Leave' }]]);
		mockExecute.mockResolvedValueOnce([[]]); // overlap check
		mockExecute.mockResolvedValueOnce([{ insertId: 9 }]);
		const req = new Request('http://localhost/api/leaves', {
			method: 'POST',
			body: JSON.stringify(validBody),
		});
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.duration_days).toBe(2);
		expect(body.data.status).toBe('pending');

		const insertCall = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO leave_applications')
		);
		expect(insertCall).toBeTruthy();
		expect(String(insertCall[0])).toContain("'pending'");
		expect(insertCall[1][5]).toBe(2); // duration_days
		expect(insertCall[1][6]).toBe('Family function');
	});

	it('computes 0.5 days for a single-date half-day application', async () => {
		mockExecute.mockResolvedValueOnce([[{ id: 1, name: 'Casual Leave' }]]);
		mockExecute.mockResolvedValueOnce([[]]);
		mockExecute.mockResolvedValueOnce([{ insertId: 10 }]);
		const req = new Request('http://localhost/api/leaves', {
			method: 'POST',
			body: JSON.stringify({
				...validBody,
				end_date: '2026-08-25',
				half_day: true,
			}),
		});
		const res = await POST(req);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.data.duration_days).toBe(0.5);
	});
});
