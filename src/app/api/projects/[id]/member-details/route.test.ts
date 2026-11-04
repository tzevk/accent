import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectAccessModule from '@/utils/project-access';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockBeginTransaction = vi.fn();
const mockCommit = vi.fn();
const mockRollback = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockLogActivity = vi.fn();
const mockGetTableColumns = vi.fn();
const mockHasUserProjectAssignment = vi.fn();
const mockLoadLeadPolicy = vi.fn();

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

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return { ...actual, loadLeadPolicy: mockLoadLeadPolicy };
});

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: mockLogActivity,
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: mockGetTableColumns,
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('project_id'),
	invalidateCache: vi.fn(),
	hasColumn: vi.fn().mockResolvedValue(true),
}));

// Assignment lookup stays available to reporting code, but the route must
// never consult it when deciding workspace access.
vi.mock('@/utils/project-access', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectAccessModule>();
	return {
		...actual,
		hasUserProjectAssignment: mockHasUserProjectAssignment,
	};
});

const { GET, POST } =
	await import('@/app/api/projects/[id]/member-details/route');

const project = {
	id: 10,
	project_id: 'PRJ-10',
	project_code: 'CODE-10',
	project_team: JSON.stringify([{ user_id: 42, role: 'Team Member' }]),
	project_assumption_list: JSON.stringify([{ id: 'old-assumption' }]),
	project_query_log_list: JSON.stringify([{ id: 'old-query' }]),
	project_lessons_learnt_list: JSON.stringify([{ id: 'old-lesson' }]),
};

const member = {
	id: 42,
	full_name: 'Member Name',
	username: 'member',
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

function request(method: 'GET' | 'POST', body?: unknown): Request {
	return new Request('http://localhost/api/projects/PRJ-10/member-details', {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

function params() {
	return { params: Promise.resolve({ id: 'PRJ-10' }) };
}

describe('member project details API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockResolvedValue(member);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockExecute.mockResolvedValue([[project]]);
		mockHasUserProjectAssignment.mockResolvedValue(true);
		mockLogActivity.mockResolvedValue(undefined);
		mockLoadLeadPolicy.mockResolvedValue({ sections: {} });
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request('GET'), params());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an activity-assigned non-member without consulting the assignment', async () => {
		// The project has no membership row for this user, yet the assignment
		// table would say yes if anything asked it. Workspace access must not.
		mockGetCurrentUser.mockResolvedValue({
			...member,
			id: 99,
			email: 'assigned-only@example.com',
		});

		const response = await GET(request('GET'), params());
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body).toEqual({
			success: false,
			error: 'You do not have permission to access this project',
		});
		expect(body).not.toHaveProperty('data');
		expect(body).not.toHaveProperty('project');
		expect(mockHasUserProjectAssignment).not.toHaveBeenCalled();
	});

	it('allows a team member and returns the exact GET payload', async () => {
		mockExecute
			.mockResolvedValueOnce([[project]])
			.mockResolvedValueOnce([
				[{ id: 5, project_id: 10, description: 'Review' }],
			]);

		const response = await GET(request('GET'), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			success: true,
			data: {
				assumptions: [{ id: 'old-assumption' }],
				discussions: [{ id: 5, project_id: 10, description: 'Review' }],
				queryLog: [{ id: 'old-query' }],
				lessonsLearnt: [{ id: 'old-lesson' }],
			},
		});
		expect(mockHasUserProjectAssignment).not.toHaveBeenCalled();
	});

	it.each([
		['assumption', 'assumption_description'],
		['discussion', 'description'],
		['query_log', 'query_description'],
		['lessons_learnt', 'what_was_new'],
	] as const)('rejects an empty %s primary field', async (section, field) => {
		const response = await POST(
			request('POST', { section, entry: {} }),
			params()
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toContain(field);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it.each([
		{
			section: 'assumption' as const,
			field: 'assumption_description',
			value: 'New assumption',
			column: 'project_assumption_list',
			old: project.project_assumption_list,
		},
		{
			section: 'query_log' as const,
			field: 'query_description',
			value: 'New query',
			column: 'project_query_log_list',
			old: project.project_query_log_list,
		},
		{
			section: 'lessons_learnt' as const,
			field: 'what_was_new',
			value: 'New lesson',
			column: 'project_lessons_learnt_list',
			old: project.project_lessons_learnt_list,
		},
	])('appends only to the permitted $section JSON column', async (caseData) => {
		mockExecute
			.mockResolvedValueOnce([[project]])
			.mockResolvedValueOnce([[{ [caseData.column]: caseData.old }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await POST(
			request('POST', {
				section: caseData.section,
				entry: {
					[caseData.field]: `  ${caseData.value}  `,
					arbitrary: 'drop me',
				},
			}),
			params()
		);
		const body = await response.json();
		const updateCall = mockExecute.mock.calls[2];
		const updateSql = updateCall[0] as string;
		const savedEntries = JSON.parse(updateCall[1][0]);

		expect(response.status).toBe(200);
		expect(updateSql).toContain(`SET ${caseData.column}`);
		expect(updateSql).not.toContain('arbitrary');
		expect(savedEntries[0]).toEqual({
			id: `old-${caseData.section === 'assumption' ? 'assumption' : caseData.section === 'query_log' ? 'query' : 'lesson'}`,
		});
		expect(savedEntries[1][caseData.field]).toBe(caseData.value);
		expect(savedEntries[1].arbitrary).toBeUndefined();
		expect(mockBeginTransaction).toHaveBeenCalledOnce();
		expect(mockCommit).toHaveBeenCalledOnce();
		expect(mockLogActivity).toHaveBeenCalledOnce();
		expect(body.data.section).toBe(caseData.section);
	});

	it('inserts discussion against the numeric project row id', async () => {
		const insertedDiscussion = {
			id: 99,
			project_id: 10,
			description: 'Member discussion',
			follow_up_date: '2026-08-03',
			follow_up_type: 'Internal Review',
			status: 'Scheduled',
			priority: 'Medium',
			responsible_person: 'Project lead',
			logged_by: 'Member Name',
			created_by: 'Member Name',
		};
		mockExecute
			.mockResolvedValueOnce([[project]])
			.mockResolvedValueOnce([{ insertId: 99 }])
			.mockResolvedValueOnce([[insertedDiscussion]]);

		const response = await POST(
			request('POST', {
				section: 'discussion',
				entry: {
					description: ' Member discussion ',
					follow_up_date: '2026-08-03',
					responsible_person: 'Project lead',
				},
			}),
			params()
		);
		const body = await response.json();
		const insertCall = mockExecute.mock.calls[1];

		expect(response.status).toBe(200);
		expect(insertCall[0]).toContain('INSERT INTO project_followups');
		expect(insertCall[1][0]).toBe(10);
		expect(body.data.entry).toEqual(insertedDiscussion);
		expect(mockLogActivity).toHaveBeenCalledOnce();
	});
});
