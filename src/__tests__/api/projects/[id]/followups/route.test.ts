import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	end: vi.fn(),
	release: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const {
	GET,
	POST,
	PUT,
	DELETE: DELETE_,
} = await import('@/app/api/projects/[id]/followups/route');

function createRequest({
	method = 'GET',
	body = null,
	url = 'http://localhost/api/projects/1/followups',
	searchParams = '',
} = {}) {
	const req = {
		url: url + (searchParams ? `?${searchParams}` : ''),
		method,
		headers: new Headers(),
	};
	if (body) {
		(req as any).json = vi.fn().mockResolvedValue(body);
	}
	return req;
}

const mockFollowup = {
	id: 1,
	project_id: 1,
	follow_up_date: '2026-07-21',
	follow_up_type: 'Internal Review',
	description: 'Test follow-up',
	status: 'Scheduled',
	priority: 'Medium',
	milestone: null,
	responsible_person: null,
	action_items: null,
	outcome: null,
	next_action: null,
	next_follow_up_date: null,
	blockers: null,
	notes: null,
	logged_by: 'admin',
	created_by: 'admin',
	isDelete: 0,
	created_at: '2026-07-21T00:00:00.000Z',
	updated_at: '2026-07-21T00:00:00.000Z',
};

describe('Project Followups API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/projects/[id]/followups', () => {
		it('fetches followups filtered by isDelete', async () => {
			mockExecute.mockResolvedValueOnce([[mockFollowup]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			expect(json.data).toHaveLength(1);
			const sql = mockExecute.mock.calls[0][0];
			expect(sql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});

		it('excludes soft-deleted followups', async () => {
			mockExecute.mockResolvedValueOnce([[]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			expect(json.data).toHaveLength(0);
		});
	});

	describe('POST /api/projects/[id]/followups', () => {
		it('creates a follow-up', async () => {
			mockExecute.mockResolvedValueOnce([{ insertId: 2 }]);

			const response = await POST(
				createRequest({
					method: 'POST',
					body: {
						follow_up_date: '2026-07-21',
						description: 'Test follow-up',
					},
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			expect(json.id).toBe(2);
		});

		it('rejects unauthorized POST', async () => {
			const { ensurePermission } = await import('@/utils/api-permissions');
			ensurePermission.mockResolvedValueOnce(
				NextResponse.json(
					{ success: false, error: 'Forbidden' },
					{ status: 403 }
				)
			);

			const response = await POST(
				createRequest({
					method: 'POST',
					body: { follow_up_date: '2026-07-21', description: 'Test' },
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			expect(response.status).toBe(403);
		});
	});

	describe('PUT /api/projects/[id]/followups', () => {
		it('updates followup with isDelete guard in WHERE clause', async () => {
			mockExecute.mockResolvedValueOnce(undefined);

			const response = await PUT(
				createRequest({
					method: 'PUT',
					body: {
						id: 1,
						follow_up_date: '2026-07-22',
						description: 'Updated follow-up',
					},
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			const updateSql = mockExecute.mock.calls[0][0];
			expect(updateSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});

		it('rejects unauthorized PUT', async () => {
			const { ensurePermission } = await import('@/utils/api-permissions');
			ensurePermission.mockResolvedValueOnce(
				NextResponse.json(
					{ success: false, error: 'Forbidden' },
					{ status: 403 }
				)
			);

			const response = await PUT(
				createRequest({
					method: 'PUT',
					body: { id: 1, follow_up_date: '2026-07-22', description: 'Test' },
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			expect(response.status).toBe(403);
		});
	});

	describe('DELETE /api/projects/[id]/followups', () => {
		it('soft-deletes followup instead of hard delete', async () => {
			mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

			const response = await DELETE_(
				createRequest({
					method: 'DELETE',
					url: 'http://localhost/api/projects/1/followups?followup_id=1',
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			const deleteSql = mockExecute.mock.calls[0][0];
			expect(deleteSql).toContain('SET isDelete = 1');
			expect(deleteSql).not.toContain('DELETE FROM');
			expect(deleteSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});

		it('rejects unauthorized DELETE', async () => {
			const { ensurePermission } = await import('@/utils/api-permissions');
			ensurePermission.mockResolvedValueOnce(
				NextResponse.json(
					{ success: false, error: 'Forbidden' },
					{ status: 403 }
				)
			);

			const response = await DELETE_(
				createRequest({
					method: 'DELETE',
					url: 'http://localhost/api/projects/1/followups?followup_id=1',
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			expect(response.status).toBe(403);
		});
	});
});
