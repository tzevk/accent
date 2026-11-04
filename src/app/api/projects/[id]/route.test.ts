import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectAccessModule from '@/utils/project-access';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTableColumns = vi.fn();
const mockHasUserProjectAssignment = vi.fn();
const mockLoadLeadPolicy = vi.fn();

const mockDb = {
	execute: mockExecute,
	release: mockRelease,
};

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return { ...actual, loadLeadPolicy: mockLoadLeadPolicy };
});

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

const { GET, PUT } = await import('@/app/api/projects/[id]/route');

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
		mockLoadLeadPolicy.mockResolvedValue({ sections: {} });
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

	it('removes read for a hidden section and edit for a view-only section', async () => {
		mockGetCurrentUser.mockResolvedValue(lead);
		mockLoadLeadPolicy.mockResolvedValue({
			sections: { project_details: 'hidden', scope: 'view' },
		});
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.rights.sections.project_details).toEqual({
			read: false,
			edit: false,
		});
		expect(body.rights.readableSections).not.toContain('project_details');
		expect(body.rights.sections.scope).toEqual({ read: true, edit: false });
		expect(body.rights.editableSections).not.toContain('scope');
		expect(body.data.description).toBeUndefined();
	});
});

const lead = {
	...member,
	id: 7,
	email: 'lead@example.com',
	field_permissions: {},
};

const leadProject = {
	...project,
	project_team: JSON.stringify([{ user_id: 7, role: 'Project Lead' }]),
};

const commercialEditor = {
	...lead,
	field_permissions: {
		modules: {
			projects: {
				enabled: true,
				sections: {
					commercial: {
						enabled: true,
						fields: {
							budget: { permission: 'edit' },
						},
					},
				},
			},
		},
	},
};

function putRequest(body: unknown): Request {
	return new Request('http://localhost/api/projects/PRJ-10', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('PUT /api/projects/[id] section-scoped saves', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(lead);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockLoadLeadPolicy.mockResolvedValue({ sections: {} });
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await PUT(
			putRequest({ section: 'scope', values: { scope_of_work: 'x' } }),
			params()
		);

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('updates only the named section columns for a lead', async () => {
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(
			putRequest({
				section: 'project_details',
				values: { name: 'Renamed', priority: 'LOW' },
			}),
			params()
		);

		expect(response.status).toBe(200);
		const [sql, queryParams] = mockExecute.mock.calls[1];
		expect(sql).toMatch(/^UPDATE projects SET name = \?, priority = \?/);
		expect(sql).toContain('WHERE id = ? AND isDelete = 0');
		expect(sql).not.toContain('project_team');
		expect(sql).not.toContain('budget');
		expect(queryParams).toEqual(['Renamed', 'LOW', 10]);
	});

	it('returns the generic 403 for an unknown project, never 404', async () => {
		mockExecute.mockResolvedValueOnce([[], []]);

		const response = await PUT(
			putRequest({ section: 'scope', values: { scope_of_work: 'x' } }),
			params('missing-project')
		);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe(
			'You do not have permission to access this project'
		);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('refuses a section the actor cannot edit', async () => {
		mockGetCurrentUser.mockResolvedValue(member);
		mockExecute.mockResolvedValueOnce([[project], []]);

		const response = await PUT(
			putRequest({ section: 'scope', values: { scope_of_work: 'x' } }),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('rejects a field outside the named section', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({
				section: 'project_details',
				values: { scope_of_work: 'not mine' },
			}),
			params()
		);

		expect(response.status).toBe(400);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('rejects a protected commercial column in a work section', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({
				section: 'project_details',
				values: { budget: 1000 },
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.code).toBe('PROTECTED_FIELD');
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('rejects the old whole-form payload without a section', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({ name: 'Legacy save', priority: 'HIGH' }),
			params()
		);

		expect(response.status).toBe(400);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('never writes the team column through a project save', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({
				section: 'project_team',
				values: { project_team: [] },
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.code).toBe('SECTION_NOT_WRITABLE');
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('requires commercial field edit rights for a commercial write', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const denied = await PUT(
			putRequest({ section: 'commercial', values: { budget: 1000 } }),
			params()
		);

		expect(denied.status).toBe(403);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('leaves the stored amount untouched when a commercial write is refused', async () => {
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		await PUT(
			putRequest({ section: 'commercial', values: { budget: 1000 } }),
			params()
		);

		const updates = mockExecute.mock.calls.filter(([sql]) =>
			String(sql).startsWith('UPDATE projects')
		);
		expect(updates).toHaveLength(0);
	});

	it('rejects a commercial write that includes a column the actor cannot edit', async () => {
		mockGetCurrentUser.mockResolvedValue(commercialEditor);
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({
				section: 'commercial',
				values: { budget: 1000, project_value: 9000 },
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.code).toBe('PROTECTED_FIELD');
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('persists only the permitted commercial columns', async () => {
		mockGetCurrentUser.mockResolvedValue(commercialEditor);
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(
			putRequest({ section: 'commercial', values: { budget: 1000 } }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.updated).toEqual(['budget']);
		const [sql, queryParams] = mockExecute.mock.calls[1];
		expect(sql).toMatch(/^UPDATE projects SET budget = \?/);
		expect(sql).not.toContain('project_value');
		expect(sql).not.toContain('cost_to_company');
		expect(queryParams).toEqual([1000, 10]);
	});

	it('persists a commercial column the actor may edit', async () => {
		mockGetCurrentUser.mockResolvedValue(commercialEditor);
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(
			putRequest({ section: 'commercial', values: { budget: 1000 } }),
			params()
		);

		expect(response.status).toBe(200);
		const [sql, queryParams] = mockExecute.mock.calls[1];
		expect(sql).toMatch(/^UPDATE projects SET budget = \?/);
		expect(sql).toContain('WHERE id = ? AND isDelete = 0');
		expect(queryParams).toEqual([1000, 10]);
	});

	it('refuses a section save from an assign-only team manager', async () => {
		// Team-management authority is not project content authority: the
		// same user who may change the team cannot save a work section.
		mockGetCurrentUser.mockResolvedValue({
			...member,
			id: 99,
			email: 'assigner@example.com',
			merged_permissions: ['projects:assign'],
			field_permissions: {
				projectScopes: { projects: { assign: 'all' } },
			},
		});
		mockExecute.mockResolvedValueOnce([[project], []]);

		const response = await PUT(
			putRequest({ section: 'scope', values: { scope_of_work: 'x' } }),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('serializes list columns for the named section only', async () => {
		mockExecute
			.mockResolvedValueOnce([[leadProject], []])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const response = await PUT(
			putRequest({
				section: 'documents_issued',
				values: {
					documents_issued_list: [{ document_number: 'D-1' }],
				},
			}),
			params()
		);

		expect(response.status).toBe(200);
		const [sql, queryParams] = mockExecute.mock.calls[1];
		expect(sql).toMatch(/^UPDATE projects SET documents_issued_list = \?/);
		expect(queryParams[0]).toBe('[{"document_number":"D-1"}]');
		expect(queryParams[1]).toBe(10);
	});

	it('refuses a direct section save the shared policy hides', async () => {
		mockLoadLeadPolicy.mockResolvedValue({
			sections: { scope: 'hidden' },
		});
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({ section: 'scope', values: { scope_of_work: 'x' } }),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('refuses a direct section save the shared policy makes read-only', async () => {
		mockLoadLeadPolicy.mockResolvedValue({
			sections: { project_details: 'view' },
		});
		mockExecute.mockResolvedValueOnce([[leadProject], []]);

		const response = await PUT(
			putRequest({ section: 'project_details', values: { name: 'Renamed' } }),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});
});
