import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectAccessModule from '@/utils/project-access';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTableColumns = vi.fn();
const mockHasUserProjectAssignment = vi.fn();

const mockDb = {
	execute: mockExecute,
	release: mockRelease,
};

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: { READ: 'read', UPDATE: 'update', CLOSE: 'close' },
}));

// Activity assignment remains available to reporting code, but workspace
// entry must never consult it.
vi.mock('@/utils/project-access', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectAccessModule>();
	return { ...actual, hasUserProjectAssignment: mockHasUserProjectAssignment };
});

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: mockGetTableColumns,
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('project_id'),
	invalidateCache: vi.fn(),
	hasColumn: vi.fn().mockResolvedValue(true),
}));

const { GET } = await import('@/app/api/projects/[id]/route');

const project = {
	id: 10,
	project_id: 'PRJ-10',
	project_code: 'CODE-10',
	name: 'Alpha Project',
	status: 'Ongoing',
	priority: 'HIGH',
	project_team: JSON.stringify([{ user_id: 42, role: 'Team Member' }]),
	scope_of_work: 'Visible scope',
	description: 'Internal notes',
	budget: '1000',
	project_value: '5000',
	project_activities_list: JSON.stringify([{ name: 'Design' }]),
};

const member = {
	id: 42,
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

function request(): Request {
	return new Request('http://localhost/api/projects/PRJ-10', { method: 'GET' });
}

function params(id = 'PRJ-10') {
	return { params: Promise.resolve({ id }) };
}

describe('GET /api/projects/[id] project-rights sweep', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(member);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockExecute.mockResolvedValue([[project], []]);
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request(), params());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies a non-member with the same body as an unknown identifier', async () => {
		mockGetCurrentUser.mockResolvedValue({
			...member,
			id: 99,
			email: 'outsider@example.com',
		});
		// The assignment table would report this user as assigned if asked.
		mockHasUserProjectAssignment.mockResolvedValue(true);
		const denied = await GET(request(), params());
		const deniedBody = await denied.json();

		mockExecute.mockResolvedValueOnce([[], []]);
		const missing = await GET(request(), params('missing-project'));
		const missingBody = await missing.json();

		expect(denied.status).toBe(403);
		expect(missing.status).toBe(403);
		expect(deniedBody).toEqual(missingBody);
		expect(deniedBody.success).toBe(false);
		expect(deniedBody).not.toHaveProperty('data');
		expect(missingBody.error).toBe(
			'You do not have permission to access this project'
		);
		expect(mockHasUserProjectAssignment).not.toHaveBeenCalled();
	});

	it('allows a team member and returns filtered data plus rights', async () => {
		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.rights.canOpen).toBe(true);
		expect(body.rights.isMember).toBe(true);
		expect(body.rights.readableSections).toContain('scope');
		expect(body.rights.readableSections).not.toContain('project_details');
		expect(body.data.name).toBe('Alpha Project');
		expect(body.data.scope_of_work).toBe('Visible scope');
		expect(body.data.description).toBeUndefined();
		expect(body.data.budget).toBeUndefined();
		expect(body.data.project_value).toBeUndefined();
	});

	it('omits the activity payload when the activity section is unreadable', async () => {
		mockExecute.mockResolvedValueOnce([[project], []]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data).not.toHaveProperty('project_activities');
		expect(body.data).not.toHaveProperty('project_activities_list');
	});
});
