import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockEnd = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
}));

const { GET } = await import('@/app/api/users/[id]/projects/route');

const member = {
	id: 42,
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

const assignedRow = {
	project_id: 10,
	project_name: 'Alpha Project',
	project_code: 'CODE-10',
	project_status: 'Ongoing',
	project_start_date: '2026-01-01',
	project_end_date: '2026-12-31',
	project_team: JSON.stringify([{ user_id: 42, role: 'Team Member' }]),
	budget: '1000',
	project_value: '5000',
	cost_to_company: '4000',
	profitability_estimate: '20',
	actual_profit_loss: '500',
};

function request(): Request {
	return new Request('http://localhost/api/users/42/projects');
}

function params(id = '42') {
	return { params: Promise.resolve({ id }) };
}

function mockDbFor(rows: unknown[], activityRows: unknown[] = []) {
	mockExecute.mockImplementation(async (sql: string) => {
		if (/SHOW TABLES/i.test(sql)) {
			return [[{ table_name: 'user_activity_assignments' }], []];
		}
		if (/INNER JOIN user_activity_assignments/i.test(sql)) {
			return [rows, []];
		}
		if (/FROM logged_activity_assignments uaa/i.test(sql)) {
			return [activityRows, []];
		}
		return [[], []];
	});
}

describe('GET /api/users/[id]/projects', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			end: mockEnd,
		});
		mockGetCurrentUser.mockResolvedValue(member);
		mockDbFor([assignedRow]);
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request(), params());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('refuses another user projects without super admin', async () => {
		const response = await GET(request(), params('7'));

		expect(response.status).toBe(403);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('omits protected amounts and the former budget alias', async () => {
		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.projects).toHaveLength(1);
		const [project] = body.data.projects;
		expect(project.project_name).toBe('Alpha Project');
		expect(Object.hasOwn(project, 'project_estimated_hours')).toBe(false);
		for (const column of [
			'budget',
			'project_value',
			'cost_to_company',
			'profitability_estimate',
			'actual_profit_loss',
		]) {
			expect(Object.hasOwn(project, column)).toBe(false);
		}
		expect(Object.hasOwn(project, 'project_team')).toBe(false);
	});

	it('keeps the amounts for a super admin', async () => {
		mockGetCurrentUser.mockResolvedValue({
			...member,
			is_super_admin: 1,
		});

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		const [project] = body.data.projects;
		expect(project.budget).toBe('1000');
		expect(project.project_value).toBe('5000');
		expect(project.cost_to_company).toBe('4000');
		expect(project.profitability_estimate).toBe('20');
		expect(project.actual_profit_loss).toBe('500');
	});

	it('drops a project reached only through an activity assignment', async () => {
		mockDbFor([
			{
				...assignedRow,
				project_team: JSON.stringify([{ user_id: 7, role: 'Team Member' }]),
			},
		]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.projects).toHaveLength(0);
	});

	it('decodes effective entries and returns the projected completion date', async () => {
		mockDbFor(
			[assignedRow],
			[
				{
					id: 'assignment-work-period',
					activity_name: 'Implementation',
					status: 'In Progress',
					actual_completion_date: '2026-10-28T18:00:00.000Z',
					estimated_hours: '6',
					daily_entries: JSON.stringify([
						{ date: '2026-10-26', hours: 2 },
						{ date: '2026-10-27', hours: '3' },
					]),
					work_period_entries: JSON.stringify([
						{ date: '2026-10-27', hours: 3 },
					]),
					actual_hours: '99',
				},
				{
					id: 'assignment-legacy',
					activity_name: 'Historical work',
					status: 'Completed',
					completion_date: null,
					estimated_hours: '2',
					daily_entries: JSON.stringify([{ date: '2026-10-25', hours: 4 }]),
					work_period_entries: null,
					actual_hours: '7.5',
				},
			]
		);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		const [project] = body.data.projects;
		expect(project.activities[0]).toMatchObject({
			activity_name: 'Implementation',
			actual_completion_date: '2026-10-28T18:00:00.000Z',
			actual_manhours: 5,
		});
		expect(project.activities[1].actual_manhours).toBe(7.5);
		expect(project.totalActualHours).toBe(12.5);
		expect(body.data.stats.totalActualHours).toBe(12.5);
	});

	it('does not revive a stale aggregate when effective entries are malformed', async () => {
		mockDbFor(
			[assignedRow],
			[
				{
					id: 'assignment-malformed',
					activity_name: 'Malformed projection',
					status: 'In Progress',
					estimated_hours: '1',
					daily_entries: '{invalid json',
					work_period_entries: '[]',
					actual_hours: '99',
				},
			]
		);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.projects[0].activities[0].actual_manhours).toBe(0);
		expect(body.data.stats.totalActualHours).toBe(0);
	});
});
