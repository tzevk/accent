import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockEnsurePermission = vi.fn();
const mockGetTableColumns = vi.fn();

const mockDb = {
	execute: mockExecute,
	release: mockRelease,
};

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
	ensurePermission: mockEnsurePermission,
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
		CLOSE: 'close',
	},
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: mockGetTableColumns,
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('project_id'),
	hasColumn: vi.fn().mockResolvedValue(true),
	invalidateCache: vi.fn(),
}));

const route = await import('@/app/api/projects/route');

const project = {
	project_id: 10,
	project_code: 'CODE-10',
	name: 'Alpha Project',
	status: 'Ongoing',
	project_team: JSON.stringify([{ user_id: 7, role: 'Project Lead' }]),
};

const lead = {
	id: 7,
	email: 'lead@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

const withDelete = {
	...lead,
	merged_permissions: ['projects:delete'],
	field_permissions: {
		projectScopes: { projects: { delete: 'all' } },
	},
};

function deleteRequest(id = 'PRJ-10'): Request {
	return new Request(`http://localhost/api/projects?id=${id}`, {
		method: 'DELETE',
	});
}

function updateCalls() {
	return mockExecute.mock.calls.filter(([sql]) =>
		String(sql).startsWith('UPDATE projects')
	);
}

describe('DELETE /api/projects collection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(lead);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'project_code', 'project_team'])
		);
	});

	it('requires a project id', async () => {
		const response = await route.DELETE(deleteRequest(''));

		expect(response.status).toBe(400);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await route.DELETE(deleteRequest());

		expect(response.status).toBe(401);
	});

	it('denies a lead-only user and mutates nothing', async () => {
		mockExecute.mockResolvedValueOnce([[project], []]);

		const response = await route.DELETE(deleteRequest());
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe(
			'You do not have permission to access this project'
		);
		expect(updateCalls()).toHaveLength(0);
	});

	it('denies an unknown target with the same 403', async () => {
		mockExecute.mockResolvedValueOnce([[], []]);

		const response = await route.DELETE(deleteRequest('missing'));

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('soft-deletes the resolved baseline row with a delete grant', async () => {
		mockGetCurrentUser.mockResolvedValue(withDelete);
		mockExecute
			.mockResolvedValueOnce([[project], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await route.DELETE(deleteRequest());

		expect(response.status).toBe(200);
		const [sql, queryParams] = updateCalls()[0];
		expect(sql).toBe(
			'UPDATE projects SET isDelete = 1 WHERE project_id = ? AND isDelete = 0'
		);
		expect(queryParams).toEqual([10]);
	});

	it('soft-deletes the runtime variant row by id', async () => {
		mockGetCurrentUser.mockResolvedValue(withDelete);
		mockGetTableColumns.mockResolvedValue(
			new Set(['id', 'project_id', 'project_code'])
		);
		mockExecute
			.mockResolvedValueOnce([[{ ...project, id: 77 }], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await route.DELETE(deleteRequest());

		expect(response.status).toBe(200);
		const [sql, queryParams] = updateCalls()[0];
		expect(sql).toBe(
			'UPDATE projects SET isDelete = 1 WHERE id = ? AND isDelete = 0'
		);
		expect(queryParams).toEqual([77]);
	});
});

describe('collection lifecycle writes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(lead);
	});

	it('no longer exports an unrestricted whole-project PUT', () => {
		expect(route.PUT).toBeUndefined();
	});

	it('requires projects:create and denies a lead-only user', async () => {
		mockEnsurePermission.mockResolvedValue(
			Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
		);

		const response = await route.POST(
			new Request('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'New Project' }),
			})
		);

		expect(response.status).toBe(403);
		expect(mockEnsurePermission).toHaveBeenCalledWith(
			expect.any(Request),
			'projects',
			'create'
		);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});
