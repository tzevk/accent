import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const { mockRequireProjectAccess } = vi.hoisted(() => ({
	mockRequireProjectAccess: vi.fn(),
}));

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return {
		...actual,
		requireProjectAccess: mockRequireProjectAccess,
	};
});

const { GET } = await import('@/app/api/projects/[id]/work-logs/route');

const project = {
	id: 10,
	project_id: 10,
	project_code: 'CODE-10',
};

const db = { execute: mockExecute, release: mockRelease };

function grantAccess(read: boolean) {
	mockRequireProjectAccess.mockResolvedValue({
		user: { id: 42, email: 'member@example.com' },
		project,
		rights: {
			canOpen: true,
			canContribute: true,
			isMember: true,
			isLead: false,
			sections: { project_activity: { read, edit: false } },
		},
		leadPolicy: { sections: {} },
		db,
		ownsDb: false,
	});
}

function params() {
	return { params: Promise.resolve({ id: 'PRJ-10' }) };
}

function request(): Request {
	return new Request(
		'http://localhost/api/projects/10/work-logs?start_date=2026-01-01&end_date=2026-01-31'
	);
}

describe('GET /api/projects/[id]/work-logs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([[]]);
	});

	it('returns day-wise logs for a readable activity section', async () => {
		grantAccess(true);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.project_id).toBe(10);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('FROM logged_activity_assignments'),
			[10]
		);
	});

	it('uses effective Work Period entries instead of stale assignment totals', async () => {
		grantAccess(true);
		mockExecute.mockResolvedValue([
			[
				{
					id: 'assignment-1',
					user_id: 42,
					activity_name: 'Engineering',
					discipline_name: 'Civil',
					daily_entries: JSON.stringify([
						{ date: '2026-01-10', hours: 2.5, qty_done: 7 },
					]),
					work_period_entries: '[]',
					actual_hours: 999,
					qty_completed: 999,
					full_name: 'Member',
				},
			],
		]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.total_logs).toBe(1);
		expect(body.data.total_qty).toBe(7);
		expect(body.data.users[0].total_time_minutes).toBe(150);
		expect(body.data.users[0].dates[0]).toMatchObject({
			date: '2026-01-10',
			day_time_minutes: 150,
			day_qty_total: 7,
		});
	});

	it('denies work logs when project_activity is not readable', async () => {
		grantAccess(false);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe(
			'You do not have permission to access this project'
		);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});
