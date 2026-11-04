import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCurrentUser = vi.fn();
const mockHasPermission = vi.fn();
const mockWithDb = vi.fn();
const mockExecute = vi.fn();

vi.mock('@/utils/database', () => ({
	withDb: mockWithDb,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
	RESOURCES: { USERS: 'users' },
	PERMISSIONS: { READ: 'read' },
}));

vi.mock('@/utils/rbac', () => ({
	hasPermission: mockHasPermission,
}));

const { GET } = await import(
	'@/app/api/admin/project-lead-access-review/route'
);

const leadProject = {
	project_team: JSON.stringify([
		{ id: 7, email: 'lead@example.com', role: 'Project Lead' },
	]),
};
const memberProject = {
	project_team: JSON.stringify([
		{ id: 8, email: 'member@example.com', role: 'Team Member' },
	]),
};

const users = [
	{
		user_id: 7,
		full_name: 'Lead User',
		email: 'lead@example.com',
		role_name: 'Employee',
		permissions: JSON.stringify(['projects:update']),
		field_permissions: null,
		is_super_admin: 0,
		role_permissions: '[]',
	},
	{
		user_id: 8,
		full_name: 'Member User',
		email: 'member@example.com',
		role_name: 'Employee',
		permissions: JSON.stringify(['projects:update']),
		field_permissions: null,
		is_super_admin: 0,
		role_permissions: '[]',
	},
];

function request() {
	return new Request(
		'http://localhost/api/admin/project-lead-access-review'
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockWithDb.mockImplementation(
		(fn: (db: { execute: typeof mockExecute }) => unknown) =>
			fn({ execute: mockExecute })
	);
	mockExecute.mockImplementation(async (sql: string) => {
		if (sql.includes('FROM users')) return [users, []];
		if (sql.includes('FROM projects')) {
			return [[leadProject, memberProject], []];
		}
		return [[], []];
	});
	mockHasPermission.mockReturnValue(false);
});

describe('GET /api/admin/project-lead-access-review', () => {
	it('returns 401 without a session and never queries the database', async () => {
		mockGetCurrentUser.mockResolvedValue(null);

		const response = await GET(request());

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			success: false,
			error: 'Unauthorized',
		});
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('returns 403 when the caller cannot read users', async () => {
		mockGetCurrentUser.mockResolvedValue({ id: 1, is_super_admin: 0 });

		const response = await GET(request());

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			success: false,
			error: 'Forbidden',
		});
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('returns the read-only review list to a users:read holder', async () => {
		mockGetCurrentUser.mockResolvedValue({ id: 1, is_super_admin: 0 });
		mockHasPermission.mockReturnValue(true);

		const response = await GET(request());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: [
				{
					user_id: 7,
					full_name: 'Lead User',
					email: 'lead@example.com',
					role_name: 'Employee',
					project_count: 1,
					led_project_count: 1,
				},
			],
		});
	});

	it('allows a super admin', async () => {
		mockGetCurrentUser.mockResolvedValue({ id: 1, is_super_admin: 1 });

		const response = await GET(request());

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
	});
});
