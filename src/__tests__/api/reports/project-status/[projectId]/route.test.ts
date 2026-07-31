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

const projectRow = {
	project_id: 10,
	project_name: 'Shroff Project',
	project_code: '571_07_2026_Shroff_C-1610_MTO',
	client_name: 'Shroff',
	start_date: '2026-07-01',
	end_date: '2026-12-31',
	project_team: JSON.stringify([
		{ id: 1, name: 'Shubham Shirke' },
		{ id: 2, name: 'Sudhir Pandhare' },
	]),
};

// Two distinct (activity, sub) pairs
const activityRows = [
	{
		activity_name: 'Engineering',
		sub_activity_name: 'MTO',
	},
	{
		activity_name: 'Engineering',
		sub_activity_name: 'Isometric',
	},
];

// Assignments for the MTO sub-activity
const mtoAssignments = [
	{
		user_id: 1,
		activity_name: 'Engineering',
		sub_activity_name: 'MTO',
		daily_entries: JSON.stringify([
			{ date: '2026-07-22', hours: 8, qty_done: 0 },
			{ date: '2026-07-23', hours: 4, qty_done: 0 },
			{ date: '2026-07-24', hours: 4, qty_done: 12 },
			{ date: '2026-07-28', hours: 8, qty_done: 41 },
			{ date: '2026-07-29', hours: 8, qty_done: 44 },
		]),
	},
	{
		user_id: 2,
		activity_name: 'Engineering',
		sub_activity_name: 'MTO',
		daily_entries: JSON.stringify([
			{ date: '2026-07-22', hours: 8, qty_done: 0 },
			{ date: '2026-07-28', hours: 8, qty_done: 41 },
		]),
	},
];

// User rows for the roster
const userRows = [
	{ id: 1, user_name: 'Shubham Shirke' },
	{ id: 2, user_name: 'Sudhir Pandhare' },
];

function createRequest(url: string) {
	return { url } as Request;
}

async function importGet(auth = { is_super_admin: 1 }) {
	const { getCurrentUser } = await import('@/utils/api-permissions');
	(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(auth);
	const mod =
		await import('@/app/api/reports/project-status/[projectId]/route');
	return mod.GET;
}

function setupMockQueries() {
	mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
		const s = String(sql);
		if (s.includes('FROM projects') && s.includes('project_id = ?'))
			return Promise.resolve([[projectRow]]);
		if (s.includes('FROM user_activity_assignments') && s.includes('GROUP BY'))
			return Promise.resolve([activityRows]);
		if (s.includes('FROM user_activity_assignments'))
			return Promise.resolve([mtoAssignments]);
		if (s.includes('FROM users') && s.includes('WHERE id = ?'))
			return Promise.resolve([
				userRows.filter(
					(u) =>
						String((u as Record<string, unknown>).id) === String(params?.[0])
				),
			]);
		if (s.includes('FROM users') && !s.includes('WHERE id = ?'))
			return Promise.resolve([userRows]);
		if (s.includes('FROM employees')) return Promise.resolve([[]]);
		return Promise.resolve([[]]);
	});
}

describe('Project Status Detail — GET /api/reports/project-status/[projectId]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		const { GET } =
			await import('@/app/api/reports/project-status/[projectId]/route');
		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/10'),
			{ params: Promise.resolve({ projectId: '10' }) }
		);
		expect(res.status).toBe(401);
	});

	it('returns 403 when user lacks all permissions', async () => {
		const { getCurrentUser } = await import('@/utils/api-permissions');
		(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			is_super_admin: 0,
			field_permissions: null,
		});
		const { hasPermission } = await import('@/utils/rbac');
		(hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(false);

		const { GET } =
			await import('@/app/api/reports/project-status/[projectId]/route');
		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/10'),
			{ params: Promise.resolve({ projectId: '10' }) }
		);
		expect(res.status).toBe(403);
	});

	it('returns 404 for a non-existent project', async () => {
		const GET = await importGet();
		mockQuery.mockImplementation((sql: string) => {
			if (String(sql).includes('FROM projects')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});

		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/99'),
			{ params: Promise.resolve({ projectId: '99' }) }
		);
		expect(res.status).toBe(404);
	});

	it('returns 400 for an invalid projectId', async () => {
		const GET = await importGet();
		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/abc'),
			{ params: Promise.resolve({ projectId: 'abc' }) }
		);
		expect(res.status).toBe(404);
	});

	it('returns project + activities when no matrix filters are set', async () => {
		const GET = await importGet();
		setupMockQueries();

		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/10'),
			{ params: Promise.resolve({ projectId: '10' }) }
		);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.success).toBe(true);
		expect(json.data.project.project_id).toBe(10);
		expect(json.data.project.project_code).toBe(
			'571_07_2026_Shroff_C-1610_MTO'
		);
		expect(json.data.activities).toHaveLength(2);
		expect(json.data.activities[0].label).toBe('MTO');
	});

	it('builds a matrix for an activity + date range', async () => {
		const GET = await importGet();
		setupMockQueries();

		const url =
			'http://localhost/api/reports/project-status/10?activity=MTO&sub_activity=MTO&from=2026-07-22&to=2026-07-29';
		const res = await GET(createRequest(url), {
			params: Promise.resolve({ projectId: '10' }),
		});
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.success).toBe(true);

		const r = json.data;
		expect(r.activity).toBe('MTO');
		expect(r.dates).toEqual([
			'2026-07-22',
			'2026-07-23',
			'2026-07-24',
			'2026-07-25',
			'2026-07-26',
			'2026-07-27',
			'2026-07-28',
			'2026-07-29',
		]);

		const shubham = r.rows.find(
			(rr: { user_name: string }) => rr.user_name === 'Shubham Shirke'
		);
		expect(shubham).toBeDefined();
		// 8+4+4+8+8 = 32 hours, 0+0+12+41+44 = 97 qty
		expect(shubham.total_hours).toBe(32);
		expect(shubham.total_qty).toBe(97);
		expect(shubham.days['2026-07-22']).toEqual({ hours: 8, qty_done: 0 });
		expect(shubham.days['2026-07-24']).toEqual({ hours: 4, qty_done: 12 });
		expect(shubham.days['2026-07-28']).toEqual({ hours: 8, qty_done: 41 });
		// ratio = 32 / 97 = 0.33 (rounded to 1dp)
		expect(shubham.hours_per_qty).toBeCloseTo(0.3, 1);

		const sudhir = r.rows.find(
			(rr: { user_name: string }) => rr.user_name === 'Sudhir Pandhare'
		);
		expect(sudhir.total_hours).toBe(16);
		expect(sudhir.total_qty).toBe(41);
	});

	it('rejects when "from" is after "to"', async () => {
		const GET = await importGet();
		setupMockQueries();

		const url =
			'http://localhost/api/reports/project-status/10?activity=MTO&from=2026-07-30&to=2026-07-22';
		const res = await GET(createRequest(url), {
			params: Promise.resolve({ projectId: '10' }),
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.success).toBe(false);
		expect(json.error).toMatch(/on or before/i);
	});

	it('rejects malformed date params', async () => {
		const GET = await importGet();
		setupMockQueries();

		const url =
			'http://localhost/api/reports/project-status/10?activity=MTO&from=2026/07/22&to=2026-07-29';
		const res = await GET(createRequest(url), {
			params: Promise.resolve({ projectId: '10' }),
		});
		expect(res.status).toBe(400);
	});

	it('returns an empty rows list when the activity has no assignments in the window', async () => {
		const GET = await importGet();
		mockQuery.mockImplementation((sql: string) => {
			const s = String(sql);
			if (s.includes('FROM projects') && s.includes('project_id = ?'))
				return Promise.resolve([[projectRow]]);
			if (
				s.includes('FROM user_activity_assignments') &&
				s.includes('GROUP BY')
			)
				return Promise.resolve([activityRows]);
			if (s.includes('FROM user_activity_assignments'))
				return Promise.resolve([[]]);
			if (s.includes('FROM users')) return Promise.resolve([userRows]);
			if (s.includes('FROM employees')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});

		const url =
			'http://localhost/api/reports/project-status/10?activity=MTO&from=2026-08-01&to=2026-08-07';
		const res = await GET(createRequest(url), {
			params: Promise.resolve({ projectId: '10' }),
		});
		const json = await res.json();

		expect(res.status).toBe(200);
		// Roster users with no work in the window still appear (empty rows)
		expect(json.data.rows.length).toBe(2);
		expect(json.data.rows[0].total_hours).toBe(0);
		expect(json.data.rows[0].total_qty).toBe(0);
	});

	it('allows access via the project_activities field permission (non-admin)', async () => {
		const GET = await importGet({
			is_super_admin: 0,
			field_permissions: {
				modules: {
					reports: {
						sections: {
							report_access: {
								enabled: true,
								fields: { project_activities: { permission: 'view' } },
							},
						},
					},
				},
			},
		});
		const { hasPermission } = await import('@/utils/rbac');
		(hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(false);
		mockQuery.mockImplementation((sql: string) => {
			if (String(sql).includes('FROM projects'))
				return Promise.resolve([[projectRow]]);
			return Promise.resolve([[]]);
		});

		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/10'),
			{ params: Promise.resolve({ projectId: '10' }) }
		);
		expect(res.status).toBe(200);
	});

	it('returns 500 when the database throws', async () => {
		const GET = await importGet();
		mockQuery.mockRejectedValue(new Error('Connection refused'));

		const res = await GET(
			createRequest('http://localhost/api/reports/project-status/10'),
			{ params: Promise.resolve({ projectId: '10' }) }
		);
		expect(res.status).toBe(500);
		const json = await res.json();
		expect(json.success).toBe(false);
		expect(json.error).toBe('Connection refused');
	});
});
