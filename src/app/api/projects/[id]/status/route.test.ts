import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
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
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: mockGetTableColumns,
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('project_id'),
	invalidateCache: vi.fn(),
	hasColumn: vi
		.fn()
		.mockImplementation(async (_db: unknown, _table: string, column: string) =>
			column === 'status'
		),
}));

const { PUT } = await import('@/app/api/projects/[id]/status/route');

const leadProject = {
	project_id: 10,
	project_code: 'CODE-10',
	name: 'Alpha Project',
	status: 'Ongoing',
	project_team: JSON.stringify([{ user_id: 7, role: 'Project Lead' }]),
};

const completedProject = {
	...leadProject,
	status: 'Completed',
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

const closer = {
	...lead,
	merged_permissions: ['projects:close'],
	field_permissions: {
		projectScopes: { projects: { close: 'all' } },
	},
};

const reopener = {
	...lead,
	merged_permissions: ['projects:reopen'],
	field_permissions: {
		projectScopes: { projects: { reopen: 'all' } },
	},
};

const reopenOnly = {
	...reopener,
	id: 99,
	email: 'reopen@example.com',
};

const statusEditor = {
	...lead,
	field_permissions: {
		projectScopes: { projects: { update: 'all' } },
	},
	merged_permissions: ['projects:update'],
};

function statusRequest(status: unknown): Request {
	return new Request('http://localhost/api/projects/PRJ-10/status', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ status }),
	});
}

function params(id = 'PRJ-10') {
	return { params: Promise.resolve({ id }) };
}

function updateCalls() {
	return mockExecute.mock.calls.filter(([sql]) =>
		String(sql).startsWith('UPDATE projects')
	);
}

describe('PUT /api/projects/[id]/status lifecycle authority', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(lead);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'project_code', 'project_team'])
		);
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await PUT(statusRequest('completed'), params());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a missing status with 400', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(statusRequest(''), params());

		expect(response.status).toBe(400);
		expect(updateCalls()).toHaveLength(0);
	});

	it('denies a lead-only close and leaves state unchanged', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(statusRequest('completed'), params());
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe(
			'You do not have permission to access this project'
		);
		expect(updateCalls()).toHaveLength(0);
	});

	it('denies a lead-only reopen and leaves state unchanged', async () => {
		mockExecute.mockResolvedValueOnce([[completedProject], []]);

		const response = await PUT(statusRequest('active'), params());

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('does not let a general update grant close or reopen', async () => {
		mockGetCurrentUser.mockResolvedValue(statusEditor);
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const close = await PUT(statusRequest('completed'), params());
		mockExecute.mockResolvedValueOnce([[completedProject], []]);
		const reopen = await PUT(statusRequest('active'), params());

		expect(close.status).toBe(403);
		expect(reopen.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('closes with a close grant', async () => {
		mockGetCurrentUser.mockResolvedValue(closer);
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(statusRequest('completed'), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		const [sql, queryParams] = updateCalls()[0];
		expect(sql).toContain('status = ?');
		expect(sql).toContain('WHERE project_id = ? AND isDelete = 0');
		expect(queryParams).toEqual(['completed', 10]);
	});

	it('reopens with a reopen grant', async () => {
		mockGetCurrentUser.mockResolvedValue(reopener);
		mockExecute
			.mockResolvedValueOnce([[completedProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(statusRequest('active'), params());

		expect(response.status).toBe(200);
		const [sql, queryParams] = updateCalls()[0];
		expect(queryParams).toEqual(['active', 10]);
		expect(sql).toContain('WHERE project_id = ? AND isDelete = 0');
	});

	it('does not let a close grant reopen', async () => {
		mockGetCurrentUser.mockResolvedValue(closer);
		mockExecute.mockResolvedValueOnce([[completedProject], []]);

		const response = await PUT(statusRequest('active'), params());

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('does not let a reopen grant close', async () => {
		mockGetCurrentUser.mockResolvedValue(reopener);
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(statusRequest('completed'), params());

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('does not let a lifecycle grant move an ordinary board column', async () => {
		mockGetCurrentUser.mockResolvedValue(reopenOnly);
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(statusRequest('cancelled'), params());

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('does not let project-details edit move a completed project to a board column', async () => {
		mockGetCurrentUser.mockResolvedValue(lead);
		mockExecute.mockResolvedValueOnce([[completedProject], []]);

		const response = await PUT(statusRequest('planning'), params());

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('moves a completed project to planning only with reopen authority', async () => {
		mockGetCurrentUser.mockResolvedValue(reopenOnly);
		mockExecute
			.mockResolvedValueOnce([[completedProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(statusRequest('planning'), params());

		expect(response.status).toBe(200);
		expect(updateCalls()[0][1]).toEqual(['planning', 10]);
	});

	it('moves an ordinary board column with project-details edit authority', async () => {
		mockGetCurrentUser.mockResolvedValue(statusEditor);
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(statusRequest('planning'), params());

		expect(response.status).toBe(200);
		const [sql, queryParams] = updateCalls()[0];
		expect(sql).toContain('status = ?');
		expect(queryParams).toEqual(['planning', 10]);
	});

	it('lets a lead move an ordinary board column without a lifecycle grant', async () => {
		mockGetCurrentUser.mockResolvedValue(lead);
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(statusRequest('in-progress'), params());

		expect(response.status).toBe(200);
		expect(updateCalls()[0][1]).toEqual(['in-progress', 10]);
	});

	it('updates the runtime variant row by id', async () => {
		mockGetCurrentUser.mockResolvedValue(closer);
		mockGetTableColumns.mockResolvedValue(
			new Set(['id', 'project_id', 'project_code'])
		);
		mockExecute
			.mockResolvedValueOnce([[{ ...leadProject, id: 77 }], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(statusRequest('completed'), params());

		expect(response.status).toBe(200);
		const [sql, queryParams] = updateCalls()[0];
		expect(sql).toContain('WHERE id = ? AND isDelete = 0');
		expect(queryParams).toEqual(['completed', 77]);
	});

	it('denies an unknown project with the generic 403', async () => {
		mockExecute.mockResolvedValueOnce([[], []]);

		const response = await PUT(statusRequest('completed'), params('missing'));

		expect(response.status).toBe(403);
		expect(updateCalls()).toHaveLength(0);
	});

	it('returns 403 when the mutation affects no row', async () => {
		mockGetCurrentUser.mockResolvedValue(closer);
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

		const response = await PUT(statusRequest('completed'), params());

		expect(response.status).toBe(403);
	});
});
