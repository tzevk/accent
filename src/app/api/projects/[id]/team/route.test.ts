import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRightsModule from '@/lib/project-rights';
import type {
	ProjectRights,
	ResolveProjectRightsInput,
} from '@/lib/project-rights/policy';

const mockExecute = vi.fn();
const mockBeginTransaction = vi.fn();
const mockCommit = vi.fn();
const mockRollback = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTableColumns = vi.fn();
const mockLogActivity = vi.fn();
const { mockLoadLeadPolicy } = vi.hoisted(() => ({
	mockLoadLeadPolicy: vi.fn(),
}));

const mockDb = {
	execute: mockExecute,
	beginTransaction: mockBeginTransaction,
	commit: mockCommit,
	rollback: mockRollback,
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
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: mockLogActivity,
}));

// The stored policy is exercised by the admin route and the loader's own
// tests; here the loader seam returns the default so the DB double can stay
// focused on the team row.
vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return { ...actual, loadLeadPolicy: mockLoadLeadPolicy };
});

// Policy decisions stay real; only the lead-designation authority can be
// narrowed for the refusal test, mirroring a policy that separates the two.
let rightsOverride:
	| ((rights: ProjectRights) => ProjectRights)
	| null = null;

vi.mock('@/lib/project-rights/policy', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/lib/project-rights/policy')>();
	return {
		...actual,
		resolveProjectRights: (input: ResolveProjectRightsInput) => {
			const rights = actual.resolveProjectRights(input);
			return rightsOverride ? rightsOverride(rights) : rights;
		},
	};
});

const { POST } = await import('@/app/api/projects/[id]/team/route');

const STORED_TEAM = [
	{
		id: 42,
		employee_id: 'E42',
		name: 'Member',
		email: 'member@example.com',
		role: 'Team Member',
	},
	{
		id: 43,
		employee_id: 'E43',
		name: 'Lead',
		email: 'lead@example.com',
		role: 'Project Lead',
	},
];

const project = {
	id: 10,
	project_id: 'PRJ-10',
	project_code: 'CODE-10',
	name: 'Alpha Project',
	status: 'Ongoing',
	project_team: JSON.stringify(STORED_TEAM),
};

const assignManager = {
	id: 99,
	email: 'assigner@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: ['projects:assign'],
	field_permissions: { projectScopes: { projects: { assign: 'all' } } },
};

const updateOnly = {
	id: 42,
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: ['projects:update'],
	field_permissions: { projectScopes: { projects: { update: 'assigned' } } },
};

function request(body: unknown): Request {
	return new Request('http://localhost/api/projects/PRJ-10/team', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

function params(id = 'PRJ-10') {
	return { params: Promise.resolve({ id }) };
}

function mockStoredTeam(team: unknown = STORED_TEAM) {
	mockExecute
		.mockResolvedValueOnce([[project], []])
		.mockResolvedValueOnce([[{ project_team: JSON.stringify(team) }], []])
		.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
}

describe('POST /api/projects/[id]/team', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockReset();
		rightsOverride = null;
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(assignManager);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockBeginTransaction.mockResolvedValue(undefined);
		mockCommit.mockResolvedValue(undefined);
		mockRollback.mockResolvedValue(undefined);
		mockLogActivity.mockResolvedValue(undefined);
		mockLoadLeadPolicy.mockResolvedValue({ sections: {} });
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await POST(
			request({
				operation: 'add_member',
				member: { id: 44, email: 'new@example.com', name: 'New' },
			}),
			params()
		);

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('lets an assign-only manager add a member and returns fresh rights', async () => {
		mockStoredTeam();

		const response = await POST(
			request({
				operation: 'add_member',
				member: {
					id: 44,
					employee_id: 'E44',
					name: 'Newcomer',
					email: 'newcomer@example.com',
					role: 'Engineer',
				},
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.data.project_team).toHaveLength(3);
		expect(body.data.project_team[2]).toMatchObject({
			id: 44,
			role: 'Engineer',
		});
		expect(body.data.rights.canManageTeam).toBe(true);
		expect(body.data.rights.sections.project_team.read).toBe(true);

		expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
		expect(mockCommit).toHaveBeenCalledTimes(1);
		expect(mockRollback).not.toHaveBeenCalled();

		const updateCall = mockExecute.mock.calls[2];
		expect(updateCall[0]).toBe(
			'UPDATE projects SET project_team = ? WHERE id = ? AND isDelete = 0'
		);
		expect(updateCall[1][1]).toBe(10);
		expect(JSON.parse(updateCall[1][0])).toHaveLength(3);

		expect(mockLogActivity).toHaveBeenCalledTimes(1);
		const logged = mockLogActivity.mock.calls[0][0];
		expect(logged).toMatchObject({
			userId: 99,
			actionType: 'update',
			resourceType: 'project',
			resourceId: '10',
		});
		expect(logged.details).toMatchObject({
			operation: 'add_member',
			before: STORED_TEAM,
		});
		expect(logged.details.after).toHaveLength(3);
		expect(logged.details.member).toMatchObject({ id: 44 });
		expect(logged.request).toBeDefined();
	});

	it('refuses a manager whose authority was revoked before the row lock', async () => {
		// A is lead in the row the access helper read. B removes A and commits
		// before A's request locks; the locked team no longer contains A.
		const lead = {
			...assignManager,
			id: 43,
			email: 'lead@example.com',
			merged_permissions: [],
			field_permissions: {},
		};
		mockGetCurrentUser.mockResolvedValue(lead);
		mockExecute
			.mockResolvedValueOnce([[project], []])
			.mockResolvedValueOnce([
				[
					{
						project_team: JSON.stringify([
							{
								id: 42,
								email: 'member@example.com',
								role: 'Team Member',
							},
						]),
					},
				],
				[],
			]);

		const response = await POST(
			request({
				operation: 'add_member',
				member: { id: 44, email: 'new@example.com', name: 'New' },
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe(
			'You do not have permission to access this project'
		);
		expect(mockRollback).toHaveBeenCalledTimes(1);
		expect(mockCommit).not.toHaveBeenCalled();
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE projects')
			)
		).toBe(false);
	});

	it('refuses a project-team write for an update-only user', async () => {
		mockGetCurrentUser.mockResolvedValue(updateOnly);
		mockExecute.mockResolvedValueOnce([[project], []]);

		const response = await POST(
			request({ operation: 'remove_member', memberId: 43 }),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockBeginTransaction).not.toHaveBeenCalled();
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it.each([
		['missing operation', {}],
		['unknown operation', { operation: 'replace_team' }],
		['missing member', { operation: 'add_member' }],
		['missing memberId', { operation: 'remove_member' }],
		['missing role', { operation: 'update_role', memberId: 42 }],
		[
			'project content field',
			{
				operation: 'add_member',
				member: { id: 44, email: 'new@example.com' },
				values: { name: 'Injected name' },
			},
		],
	])('returns 400 for %s', async (_label, body) => {
		mockExecute.mockResolvedValueOnce([[project], []]);

		const response = await POST(request(body), params());

		expect(response.status).toBe(400);
		expect(mockBeginTransaction).not.toHaveBeenCalled();
	});

	it('returns 409 with the typed code and rolls back', async () => {
		mockStoredTeam();

		const response = await POST(
			request({ operation: 'remove_member', memberId: 999 }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.code).toBe('MEMBER_NOT_IN_TEAM');
		expect(mockRollback).toHaveBeenCalledTimes(1);
		expect(mockCommit).not.toHaveBeenCalled();
		// No UPDATE statement ever ran.
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE projects')
			)
		).toBe(false);
	});

	it('refuses a duplicate member', async () => {
		mockExecute
			.mockResolvedValueOnce([[project], []])
			.mockResolvedValueOnce([[{ project_team: JSON.stringify(STORED_TEAM) }], []]);

		const response = await POST(
			request({
				operation: 'add_member',
				member: { id: 42, email: 'member@example.com', name: 'Member' },
			}),
			params()
		);

		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe('MEMBER_ALREADY_IN_TEAM');
	});

	it('refuses an invalid role', async () => {
		mockExecute
			.mockResolvedValueOnce([[project], []])
			.mockResolvedValueOnce([[{ project_team: JSON.stringify(STORED_TEAM) }], []]);

		const response = await POST(
			request({ operation: 'update_role', memberId: 42, role: 'manager' }),
			params()
		);

		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe('INVALID_ROLE');
	});

	it('changes one role and writes only the team column', async () => {
		mockStoredTeam();

		const response = await POST(
			request({ operation: 'update_role', memberId: 42, role: 'Designer' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.project_team[0]).toEqual({
			...STORED_TEAM[0],
			role: 'Designer',
		});
		expect(body.data.project_team[1]).toEqual(STORED_TEAM[1]);

		const [sql, queryParams] = mockExecute.mock.calls[2];
		expect(sql).toBe(
			'UPDATE projects SET project_team = ? WHERE id = ? AND isDelete = 0'
		);
		expect(sql).not.toContain('name');
		expect(sql).not.toContain('status');
		expect(sql).not.toContain('budget');
		expect(JSON.parse(queryParams[0])).toHaveLength(2);
		expect(queryParams[1]).toBe(10);
	});

	it('refuses a lead change when lead authority is missing', async () => {
		rightsOverride = (rights) => ({
			...rights,
			canManageTeam: true,
			canChangeLeadDesignation: false,
		});
		mockExecute
			.mockResolvedValueOnce([[project], []])
			.mockResolvedValueOnce([[{ project_team: JSON.stringify(STORED_TEAM) }], []]);

		const response = await POST(
			request({ operation: 'update_role', memberId: 42, role: 'Project Lead' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.code).toBe('LEAD_CHANGE_NOT_ALLOWED');
		expect(mockRollback).toHaveBeenCalledTimes(1);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE projects')
			)
		).toBe(false);
	});

	const leadUser = {
		id: 43,
		email: 'lead@example.com',
		is_super_admin: 0,
		permissions: [],
		role_permissions: [],
		merged_permissions: [],
		field_permissions: {},
	};

	it('enforces the last-lead rule for a direct request', async () => {
		mockGetCurrentUser.mockResolvedValue(leadUser);
		mockStoredTeam();

		const response = await POST(
			request({ operation: 'remove_member', memberId: 43 }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.code).toBe('LAST_LEAD_REQUIRES_REPLACEMENT');
		expect(body.error).toContain('at least one Project Lead');
		expect(mockRollback).toHaveBeenCalledTimes(1);
		expect(mockCommit).not.toHaveBeenCalled();
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE projects')
			)
		).toBe(false);
	});

	it('refuses self-demotion of the final lead without a replacement', async () => {
		mockGetCurrentUser.mockResolvedValue(leadUser);
		mockStoredTeam();

		const response = await POST(
			request({ operation: 'update_role', memberId: 43, role: 'Engineer' }),
			params()
		);

		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe(
			'LAST_LEAD_REQUIRES_REPLACEMENT'
		);
	});

	it('promotes a named replacement and returns the exact lead set', async () => {
		mockGetCurrentUser.mockResolvedValue(leadUser);
		mockStoredTeam();

		const response = await POST(
			request({
				operation: 'remove_member',
				memberId: 43,
				replacementLeadId: 42,
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.data.project_team).toEqual([
			{ ...STORED_TEAM[0], role: 'Project Lead' },
		]);
		expect(mockCommit).toHaveBeenCalledTimes(1);

		// The replacement is written in the same team update.
		const updateCall = mockExecute.mock.calls[2];
		expect(JSON.parse(updateCall[1][0])).toEqual([
			{ ...STORED_TEAM[0], role: 'Project Lead' },
		]);
	});

	it('refuses a replacement who is not another current member', async () => {
		mockGetCurrentUser.mockResolvedValue(leadUser);
		mockStoredTeam();

		const response = await POST(
			request({
				operation: 'remove_member',
				memberId: 43,
				replacementLeadId: 43,
			}),
			params()
		);

		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe('REPLACEMENT_NOT_IN_TEAM');
	});

	it('lets explicit assign authority clear the final lead', async () => {
		mockStoredTeam();

		const response = await POST(
			request({ operation: 'remove_member', memberId: 43 }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.project_team).toEqual([STORED_TEAM[0]]);
		expect(body.data.project_team.some((m) => m.role === 'Project Lead')).toBe(
			false
		);
	});

	it('sees the updated stored team on a second locked read', async () => {
		const twoLeads = [
			STORED_TEAM[0],
			STORED_TEAM[1],
			{
				id: 45,
				name: 'Second Lead',
				email: 'lead2@example.com',
				role: 'Project Lead',
			},
		];
		mockGetCurrentUser.mockResolvedValue(leadUser);
		mockExecute
			.mockResolvedValueOnce([
				[{ ...project, project_team: JSON.stringify(twoLeads) }],
				[],
			])
			.mockResolvedValueOnce([
				[{ project_team: JSON.stringify(twoLeads) }],
				[],
			])
			.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

		const first = await POST(
			request({ operation: 'remove_member', memberId: 45 }),
			params()
		);
		const firstBody = await first.json();

		expect(first.status).toBe(200);
		expect(firstBody.data.project_team).toHaveLength(2);
		expect(
			firstBody.data.project_team.filter((m) => m.role === 'Project Lead')
		).toHaveLength(1);

		// The second removal re-reads the stored team under the lock, so the
		// remaining lead is now the final one and cannot be removed bare.
		const storedAfterFirst = firstBody.data.project_team;
		mockExecute.mockReset();
		mockExecute
			.mockResolvedValueOnce([
				[
					{
						...project,
						project_team: JSON.stringify(storedAfterFirst),
					},
				],
				[],
			])
			.mockResolvedValueOnce([
				[{ project_team: JSON.stringify(storedAfterFirst) }],
				[],
			]);

		const second = await POST(
			request({ operation: 'remove_member', memberId: 43 }),
			params()
		);
		const secondBody = await second.json();

		expect(second.status).toBe(409);
		expect(secondBody.code).toBe('LAST_LEAD_REQUIRES_REPLACEMENT');
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE projects')
			)
		).toBe(false);
	});

	it('removes a member by writing only project_team and keeping history', async () => {
		mockStoredTeam();

		const response = await POST(
			request({ operation: 'remove_member', memberId: 42 }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.project_team).toEqual([STORED_TEAM[1]]);

		const writes = mockExecute.mock.calls.filter(([sql]) =>
			/^(UPDATE|INSERT|DELETE)\b/i.test(String(sql))
		);
		expect(writes).toHaveLength(1);
		expect(writes[0][0]).toBe(
			'UPDATE projects SET project_team = ? WHERE id = ? AND isDelete = 0'
		);
		// Historical assignment rows, list entries, and authorship stay as
		// reporting evidence; removal only edits the stored team.
		for (const [sql] of mockExecute.mock.calls) {
			expect(String(sql)).not.toContain('user_activity_assignments');
			expect(String(sql)).not.toContain('_list');
		}
	});
});
