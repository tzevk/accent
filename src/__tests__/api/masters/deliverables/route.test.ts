import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + auth BEFORE dynamic imports (Vitest hoists mocks)
const mockExecute = vi.fn();
vi.mock('@/utils/database', () => ({
	dbConnect: vi
		.fn()
		.mockResolvedValue({ execute: mockExecute, release: vi.fn() }),
}));

const mockEnsurePermission = vi
	.fn()
	.mockResolvedValue({ authorized: true, user: { id: 1 } });
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: (...args) => mockEnsurePermission(...args),
	RESOURCES: { DELIVERABLES: 'deliverables' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn(),
}));

const { GET, POST } = await import('@/app/api/masters/deliverables/route');
const { PUT, DELETE } =
	await import('@/app/api/masters/deliverables/[id]/route');

describe('GET /api/masters/deliverables', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	it('returns the active deliverables list', async () => {
		mockExecute.mockResolvedValue([
			[{ id: 1, deliverable_name: 'Process Design Basis' }],
		]);
		const req = new Request('http://localhost/api/masters/deliverables');
		const res = await GET(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].deliverable_name).toBe('Process Design Basis');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('WHERE isDelete = 0')
		);
	});

	it('passes through 403 when read permission is missing', async () => {
		mockEnsurePermission.mockResolvedValue({
			authorized: false,
			response: new Response('Forbidden', { status: 403 }),
		});
		const req = new Request('http://localhost/api/masters/deliverables');
		const res = await GET(req);
		expect(res.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('POST /api/masters/deliverables', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	it('rejects a blank deliverable name with 400', async () => {
		const req = new Request('http://localhost/api/masters/deliverables', {
			method: 'POST',
			body: JSON.stringify({ deliverable_name: '   ' }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe('Deliverable name is required');
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('inserts a deliverable and returns the new id', async () => {
		mockExecute.mockResolvedValue([{ insertId: 7 }]);
		const req = new Request('http://localhost/api/masters/deliverables', {
			method: 'POST',
			body: JSON.stringify({ deliverable_name: 'Heat & Mass Balance' }),
		});
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toEqual({
			id: 7,
			deliverable_name: 'Heat & Mass Balance',
		});
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO deliverables_master'),
			['Heat & Mass Balance']
		);
	});
});

describe('PUT /api/masters/deliverables/[id]', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	it('returns 404 when the deliverable does not exist', async () => {
		mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
		const req = new Request('http://localhost/api/masters/deliverables/99', {
			method: 'PUT',
			body: JSON.stringify({ deliverable_name: 'Renamed' }),
		});
		const res = await PUT(req, { params: Promise.resolve({ id: '99' }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe('Deliverable not found');
	});

	it('updates the deliverable name', async () => {
		mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
		const req = new Request('http://localhost/api/masters/deliverables/7', {
			method: 'PUT',
			body: JSON.stringify({ deliverable_name: 'Renamed Deliverable' }),
		});
		const res = await PUT(req, { params: Promise.resolve({ id: '7' }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.deliverable_name).toBe('Renamed Deliverable');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('UPDATE deliverables_master'),
			['Renamed Deliverable', '7']
		);
	});

	it('rejects a blank name with 400', async () => {
		const req = new Request('http://localhost/api/masters/deliverables/7', {
			method: 'PUT',
			body: JSON.stringify({ deliverable_name: '' }),
		});
		const res = await PUT(req, { params: Promise.resolve({ id: '7' }) });
		expect(res.status).toBe(400);
	});
});

describe('DELETE /api/masters/deliverables/[id]', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockEnsurePermission.mockReset();
		mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	it('soft-deletes the deliverable', async () => {
		mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
		const req = new Request('http://localhost/api/masters/deliverables/7', {
			method: 'DELETE',
		});
		const res = await DELETE(req, { params: Promise.resolve({ id: '7' }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining(
				'isDelete = 1, deleted_at = NOW(), deleted_by = ?'
			),
			[1, '7']
		);
	});

	it('returns 404 when the deliverable does not exist', async () => {
		mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
		const req = new Request('http://localhost/api/masters/deliverables/99', {
			method: 'DELETE',
		});
		const res = await DELETE(req, { params: Promise.resolve({ id: '99' }) });
		expect(res.status).toBe(404);
	});

	it('passes through 403 when delete permission is missing', async () => {
		mockEnsurePermission.mockResolvedValue({
			authorized: false,
			response: new Response('Forbidden', { status: 403 }),
		});
		const req = new Request('http://localhost/api/masters/deliverables/7', {
			method: 'DELETE',
		});
		const res = await DELETE(req, { params: Promise.resolve({ id: '7' }) });
		expect(res.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});
