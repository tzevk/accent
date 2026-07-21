import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { PROPOSALS: 'proposals', PROJECTS: 'projects' },
	PERMISSIONS: {
		READ: 'read',
		UPDATE: 'update',
		DELETE: 'delete',
		APPROVE: 'approve',
	},
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: vi.fn().mockResolvedValue(new Set(['id', 'proposal_title'])),
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('id'),
}));

const {
	GET,
	PUT,
	DELETE: DELETE_,
} = await import('@/app/api/proposals/[id]/route');

function createRequest({
	method = 'GET',
	body = null,
	url = 'http://localhost/api/proposals/1',
} = {}) {
	const req = {
		url,
		method,
		headers: new Headers(),
	};
	if (body) {
		(req as any).json = vi.fn().mockResolvedValue(body);
	}
	return req;
}

const mockProposal = {
	id: 1,
	proposal_id: 'P-001',
	proposal_title: 'Test Proposal',
	client_name: 'Test Client',
	company_id: 10,
	description: 'Test description',
	status: 'DRAFT',
	budget: 100000,
	isDelete: 0,
	created_at: '2026-07-21T00:00:00.000Z',
	updated_at: '2026-07-21T00:00:00.000Z',
};

describe('Proposals [id] API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/proposals/[id]', () => {
		it('fetches proposal with isDelete filter', async () => {
			mockExecute.mockResolvedValueOnce([[mockProposal]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			const sql = mockExecute.mock.calls[0][0];
			expect(sql).toContain('isDelete = 0');
		});

		it('returns 404 for soft-deleted proposal', async () => {
			mockExecute.mockResolvedValueOnce([[]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '999' }),
			});
			expect(response.status).toBe(404);
		});
	});

	describe('PUT /api/proposals/[id]', () => {
		it('updates proposal with isDelete guard in WHERE clause', async () => {
			mockExecute
				.mockResolvedValueOnce([
					[{ COLUMN_NAME: 'proposal_title', CHARACTER_MAXIMUM_LENGTH: 255 }],
				])
				.mockResolvedValueOnce([{ affectedRows: 1 }]);

			const response = await PUT(
				createRequest({
					method: 'PUT',
					body: { proposal_title: 'Updated Title' },
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			const updateSql = mockExecute.mock.calls[1][0];
			expect(updateSql).toContain('isDelete = 0');
		});

		it('returns 404 when proposal is soft-deleted', async () => {
			mockExecute
				.mockResolvedValueOnce([
					[{ COLUMN_NAME: 'proposal_title', CHARACTER_MAXIMUM_LENGTH: 255 }],
				])
				.mockResolvedValueOnce([{ affectedRows: 0 }]);

			const response = await PUT(
				createRequest({
					method: 'PUT',
					body: { proposal_title: 'Updated Title' },
				}),
				{ params: Promise.resolve({ id: '999' }) }
			);
			expect(response.status).toBe(404);
		});
	});

	describe('DELETE /api/proposals/[id]', () => {
		it('soft-deletes proposal instead of hard delete', async () => {
			mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

			const response = await DELETE_(createRequest({ method: 'DELETE' }), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			const deleteSql = mockExecute.mock.calls[0][0];
			expect(deleteSql).toContain('SET isDelete = 1');
			expect(deleteSql).not.toContain('DELETE FROM');
		});
	});
});
