import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockRelease: vi.fn(),
	mockDbConnect: vi.fn(),
	mockGetCurrentUser: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.mockGetCurrentUser,
}));

const { GET } = await import('@/app/api/users/[id]/activity-assignments/route');

const db = {
	execute: mocks.mockExecute,
	release: mocks.mockRelease,
};

function request() {
	return new Request('http://localhost/api/users/42/activity-assignments');
}

function params() {
	return { params: Promise.resolve({ id: '42' }) };
}

describe('user activity assignments project discovery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'Member@Example.com',
			is_super_admin: 0,
		});
	});

	it('returns an email-matched team project without activity rows', async () => {
		mocks.mockExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([
			[
				{
					project_id: 10,
					project_name: 'Email Team Project',
					project_code: 'P-010',
					project_status: 'Active',
					start_date: '2026-08-01',
					end_date: '2026-09-01',
					project_team: JSON.stringify([{ email: 'member@example.com' }]),
				},
			],
		]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments).toEqual([]);
		expect(body.data.emptyProjects).toEqual([
			{
				project_id: 10,
				project_name: 'Email Team Project',
				project_code: 'P-010',
				project_status: 'Active',
				project_start_date: '2026-08-01',
				project_end_date: '2026-09-01',
			},
		]);
		expect(body.data.accessibleProjects).toEqual(body.data.emptyProjects);
	});

	it('returns an assignment project even when the team JSON is absent', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					{
						project_id: 11,
						project_name: 'Assigned Project',
						project_code: 'P-011',
						project_status: 'Active',
						project_start_date: '2026-08-02',
						project_end_date: '2026-09-02',
						activity_id: 'activity-11',
						activity_name: 'Assigned activity',
						status: 'Not Started',
						estimated_hours: 4,
					},
				],
			])
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.accessibleProjects).toEqual([
			{
				project_id: 11,
				project_name: 'Assigned Project',
				project_code: 'P-011',
				project_status: 'Active',
				project_start_date: '2026-08-02',
				project_end_date: '2026-09-02',
			},
		]);
		expect(body.data.emptyProjects).toEqual([]);
	});
});
