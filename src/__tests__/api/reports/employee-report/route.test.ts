import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('@/utils/database', () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: vi.fn(),
}));

vi.mock('@/utils/rbac', () => ({
	hasPermission: vi.fn(),
}));

vi.mock('@/utils/permissions', () => ({
	RESOURCES: { REPORTS: 'reports' },
	PERMISSIONS: { READ: 'read' },
}));

const mockUsers = [
	{
		id: 1,
		full_name: 'Alice Sharma',
		username: 'alice',
		email: 'alice@ac.com',
	},
	{ id: 2, full_name: 'Bob Verma', username: 'bob', email: 'bob@ac.com' },
];

const mockEmployees = [
	{ id: 3, first_name: 'Charlie', last_name: 'Patel', email: 'charlie@ac.com' },
];

const mockProjectWithWork = {
	project_id: 10,
	project_code: 'P-010',
	project_name: 'Omega Plant',
	project_activities_list: JSON.stringify([
		{
			id: 'act-1',
			activity_name: 'Foundation Work',
			sub_activity_name: 'Excavation',
			assigned_users: [
				{
					user_id: 1,
					planned_hours: 12,
					daily_entries: [
						{ date: '2026-03-01', hours: 4, qty_done: 2 },
						{ date: '2026-03-02', hours: 8, qty_done: 3 },
					],
				},
			],
		},
	]),
};

const mockProjectNoActivities = {
	project_id: 30,
	project_code: 'P-030',
	project_name: 'Empty Project',
	project_activities_list: '[]',
};

function createRequest() {
	return { url: 'http://localhost/api/reports/employee-report' } as Request;
}

describe('Employee Report API — GET /api/reports/employee-report', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(response.status).toBe(401);
		expect(json.success).toBe(false);
		expect(json.error).toBe('Unauthorized');
	});

	it('returns 403 when user lacks all permissions', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 0,
			field_permissions: null,
		});

		const { hasPermission } = await import('@/utils/rbac');
		(hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(false);

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(response.status).toBe(403);
		expect(json.success).toBe(false);
		expect(json.error).toMatch(/permission/i);
	});

	it('returns 200 with all employees and their work rows', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users')) return Promise.resolve([mockUsers]);
			if (sql.includes('FROM employees'))
				return Promise.resolve([mockEmployees]);
			if (sql.includes('FROM projects'))
				return Promise.resolve([
					[mockProjectWithWork, mockProjectNoActivities],
				]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.length).toBe(3); // Alice (2 rows), Bob (0), Charlie (0)

		const alice = json.data.find((e: { user_id: string }) => e.user_id === '1');
		expect(alice).toBeDefined();
		expect(alice.user_name).toBe('Alice Sharma');
		expect(alice.rows.length).toBe(2);

		// Verify row shape
		expect(alice.rows[0]).toMatchObject({
			date: expect.any(String),
			project_code: 'P-010',
			activity_name: 'Foundation Work',
			sub_activity_name: 'Excavation',
			planned_hours: 12,
		});
		expect(alice.rows[0].hours).toBeGreaterThan(0);
		expect(alice.rows[0].qty_done).toBeGreaterThan(0);

		const bob = json.data.find((e: { user_id: string }) => e.user_id === '2');
		expect(bob.rows.length).toBe(0);

		const charlie = json.data.find(
			(e: { user_id: string }) => e.user_id === '3'
		);
		expect(charlie.rows.length).toBe(0);
	});

	it('includes employees with zero assignments (empty rows)', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users'))
				return Promise.resolve([
					[{ id: 100, full_name: 'Idle User', email: 'idle@ac.com' }],
				]);
			if (sql.includes('FROM employees')) return Promise.resolve([[]]);
			if (sql.includes('FROM projects')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.length).toBe(1);
		expect(json.data[0].user_name).toBe('Idle User');
		expect(json.data[0].rows).toEqual([]);
	});

	it('handles missing employees table gracefully', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users')) return Promise.resolve([mockUsers]);
			if (sql.includes('FROM employees')) {
				return Promise.reject(
					new Error("Table 'testdb.employees' doesn't exist")
				);
			}
			if (sql.includes('FROM projects')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.length).toBe(2);
	});

	it('handles malformed project_activities_list JSON', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		const badProject = {
			project_id: 99,
			project_code: 'P-099',
			project_activities_list: '{invalid json',
		};

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users'))
				return Promise.resolve([
					[{ id: 1, full_name: 'Alice', email: 'a@ac.com' }],
				]);
			if (sql.includes('FROM employees')) return Promise.resolve([[]]);
			if (sql.includes('FROM projects')) return Promise.resolve([[badProject]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.length).toBe(1);
		expect(json.data[0].rows).toEqual([]);
	});

	it('returns correct meta counts', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users'))
				return Promise.resolve([
					[
						{ id: 1, full_name: 'A' },
						{ id: 2, full_name: 'B' },
					],
				]);
			if (sql.includes('FROM employees'))
				return Promise.resolve([[{ id: 3, first_name: 'C' }]]);
			if (sql.includes('FROM projects'))
				return Promise.resolve([[mockProjectWithWork]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.meta.total_employees).toBe(3);
		expect(json.meta.employees_with_work).toBe(1);
		expect(json.meta.total_rows).toBe(2);
	});

	it('returns 500 on database error', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		mockQuery.mockRejectedValue(new Error('Connection refused'));

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(response.status).toBe(500);
		expect(json.success).toBe(false);
		expect(json.error).toBe('Connection refused');
	});

	it('allows access with reports:read permission (non-admin)', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 0,
			field_permissions: null,
		});

		const { hasPermission } = await import('@/utils/rbac');
		(hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users')) return Promise.resolve([[]]);
			if (sql.includes('FROM employees')) return Promise.resolve([[]]);
			if (sql.includes('FROM projects')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
	});

	it('allows access with project_activities field permission', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 0,
			field_permissions: {
				modules: {
					reports: {
						sections: {
							report_access: {
								enabled: true,
								fields: {
									project_activities: { permission: 'view' },
								},
							},
						},
					},
				},
			},
		});

		const { hasPermission } = await import('@/utils/rbac');
		(hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(false);

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users')) return Promise.resolve([[]]);
			if (sql.includes('FROM employees')) return Promise.resolve([[]]);
			if (sql.includes('FROM projects')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
	});

	it('normalizes project_name from name column when project_name is missing', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 1,
		});

		const projectWithoutProjectName = {
			project_id: 40,
			project_code: 'P-040',
			name: 'From Name Column',
			project_activities_list: '[]',
		};

		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM users')) return Promise.resolve([[]]);
			if (sql.includes('FROM employees')) return Promise.resolve([[]]);
			if (sql.includes('FROM projects'))
				return Promise.resolve([[projectWithoutProjectName]]);
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/reports/employee-report/route');
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
	});
});
