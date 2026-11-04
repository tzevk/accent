import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockEnd = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn().mockResolvedValue({ authorized: true }),
	getCurrentUser: mockGetCurrentUser,
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: { READ: 'read', UPDATE: 'update', DELETE: 'delete' },
}));
vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: vi
		.fn()
		.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		),
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('project_id'),
	hasColumn: vi.fn().mockResolvedValue(true),
	invalidateCache: vi.fn(),
}));

const { POST } = await import('@/app/api/projects/[id]/followups/route');

const member = {
	id: 42,
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

function projectRow(team: unknown) {
	return {
		id: 10,
		project_id: 'PRJ-10',
		project_code: 'CODE-10',
		project_team: JSON.stringify(team),
	};
}

function request(): Request {
	return new Request('http://localhost/api/projects/PRJ-10/followups', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			follow_up_date: '2026-08-03',
			description: 'Review the schedule',
		}),
	});
}

function params() {
	return { params: Promise.resolve({ id: 'PRJ-10' }) };
}

describe('POST /api/projects/[id]/followups contribution gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			end: mockEnd,
		});
		mockGetCurrentUser.mockResolvedValue(member);
	});

	it('accepts a discussion contribution from a team member', async () => {
		mockExecute
			.mockResolvedValueOnce([
				[projectRow([{ id: 42, role: 'Team Member' }])],
			])
			.mockResolvedValueOnce([{ insertId: 5 }]);

		const response = await POST(request(), params());

		expect(response.status).toBe(200);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO project_followups')
			)
		).toBe(true);
	});

	it('refuses a removed member and writes nothing', async () => {
		mockExecute.mockResolvedValueOnce([
			[projectRow([{ id: 43, role: 'Project Lead' }])],
		]);

		const response = await POST(request(), params());
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body).toEqual({
			success: false,
			error: 'You do not have permission to access this project',
		});
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('INSERT')
			)
		).toBe(false);
	});
});
