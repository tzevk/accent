import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockRelease: vi.fn(),
	mockBeginTransaction: vi.fn().mockResolvedValue(undefined),
	mockCommit: vi.fn().mockResolvedValue(undefined),
	mockRollback: vi.fn().mockResolvedValue(undefined),
	mockDbConnect: vi.fn(),
	mockGetCurrentUser: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.mockGetCurrentUser,
}));

const activityAssignmentsRoute =
	await import('@/app/api/users/[id]/activity-assignments/route');
const { GET } = activityAssignmentsRoute;

const db = {
	execute: mocks.mockExecute,
	release: mocks.mockRelease,
	beginTransaction: mocks.mockBeginTransaction,
	commit: mocks.mockCommit,
	rollback: mocks.mockRollback,
};

function request() {
	return new Request('http://localhost/api/users/42/activity-assignments');
}

function params() {
	return { params: Promise.resolve({ id: '42' }) };
}

describe('user activity assignments project discovery', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'Member@Example.com',
			is_super_admin: 0,
		});
	});

	it('returns an email-matched team project without activity rows', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([[{ last_activity_logged_at: null }]])
			.mockResolvedValueOnce([
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
			.mockResolvedValueOnce([[{ last_activity_logged_at: null }]])
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

	it('returns 401 before opening a database connection without a session', async () => {
		mocks.mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(401);
		expect(body).toEqual({ success: false, error: 'Unauthorized' });
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('refuses a non-admin viewer another user assignments', async () => {
		const response = await GET(request(), {
			params: Promise.resolve({ id: '7' }),
		});
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body).toEqual({ success: false, error: 'Forbidden' });
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});
});

describe('user activity assignments lastActivityLoggedAt', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
		});
	});

	function assignmentRow(overrides: Record<string, unknown>) {
		return {
			project_id: 11,
			project_name: 'Assigned Project',
			project_code: 'P-011',
			project_status: 'Active',
			project_start_date: '2026-08-02',
			project_end_date: '2026-09-02',
			activity_id: 'activity-11',
			activity_name: 'Assigned activity',
			status: 'In Progress',
			estimated_hours: 4,
			...overrides,
		};
	}

	function evidenceRows(lastActivityLoggedAt: unknown) {
		return [[{ last_activity_logged_at: lastActivityLoggedAt }]];
	}

	it('reads the latest self save from activity-log evidence', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[assignmentRow({})]])
			.mockResolvedValueOnce(evidenceRows(1791970200000))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.lastActivityLoggedAt).toBe(1791970200000);

		const evidenceCall = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('FROM user_activity_logs')
		);
		expect(evidenceCall).toBeDefined();
		expect(evidenceCall[1][0]).toBe(42);
		expect(evidenceCall[1][1]).toBe('project_activity_save');
	});

	it('accepts a string epoch from the evidence read', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[assignmentRow({})]])
			.mockResolvedValueOnce(evidenceRows('1791917100000'))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.lastActivityLoggedAt).toBe(1791917100000);
	});

	it('ignores a manager-touched assignment without matching evidence', async () => {
		// The assignment row carries a fresh updated_at (manager edit) but
		// the user has no self-save evidence: the timer stays unknown.
		mocks.mockExecute
			.mockResolvedValueOnce([
				[assignmentRow({ updated_at: '2026-10-14 09:30:00' })],
			])
			.mockResolvedValueOnce(evidenceRows(null))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments).toHaveLength(1);
		expect(body.data.lastActivityLoggedAt).toBeNull();
	});

	it('returns null when the user has no assignments and no evidence', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce(evidenceRows(null))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments).toEqual([]);
		expect(body.data.lastActivityLoggedAt).toBeNull();
	});

	it('returns null when the evidence value is not a usable epoch', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[assignmentRow({})]])
			.mockResolvedValueOnce(evidenceRows('not-an-epoch'))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.lastActivityLoggedAt).toBeNull();
	});

	it('fails the request when the evidence read fails', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[assignmentRow({})]])
			.mockRejectedValueOnce(new Error('evidence read down'));

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.success).toBe(false);
		expect(mocks.mockRelease).toHaveBeenCalled();
	});

	it('returns effective Work Period entries beside independently parsed legacy entries', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					assignmentRow({
						daily_entries: JSON.stringify([
							{ date: '2026-10-26', qty_done: 1, hours: 2 },
							{ date: '2026-10-27', qty_done: 2, hours: '3' },
						]),
						legacy_daily_entries: JSON.stringify([
							{
								date: '2026-10-25',
								qty_done: 4,
								hours: 7,
								remarks: 'Historical duration',
								isLocked: true,
							},
						]),
						work_period_entries: JSON.stringify([
							{ date: '2026-10-26', qty_done: 1, hours: 2 },
							{ date: '2026-10-27', qty_done: 2, hours: 3 },
						]),
						actual_hours: 99,
					}),
				],
			])
			.mockResolvedValueOnce(evidenceRows(null))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments[0].daily_entries).toEqual([
			{ date: '2026-10-26', qty_done: 1, hours: 2 },
			{ date: '2026-10-27', qty_done: 2, hours: '3' },
		]);
		expect(body.data.assignments[0].legacy_daily_entries).toEqual([
			{
				date: '2026-10-25',
				qty_done: 4,
				hours: 7,
				remarks: 'Historical duration',
				isLocked: true,
			},
		]);
		expect(body.data.assignments[0].actual_hours).toBe(5);
		expect(body.data.stats.totalActualHours).toBe(5);
	});

	it('does not let malformed legacy JSON hide effective entries or totals', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					assignmentRow({
						daily_entries: JSON.stringify([
							{ date: '2026-10-26', qty_done: 1, hours: 2 },
						]),
						work_period_entries: JSON.stringify([
							{ date: '2026-10-26', qty_done: 1, hours: 2 },
						]),
						actual_hours: 99,
					}),
				],
			])
			.mockResolvedValueOnce(evidenceRows(null))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments[0].daily_entries).toEqual([
			{ date: '2026-10-26', qty_done: 1, hours: 2 },
		]);
		expect(body.data.assignments[0].legacy_daily_entries).toEqual([]);
		expect(body.data.assignments[0].actual_hours).toBe(2);
		expect(body.data.stats.totalActualHours).toBe(2);
	});

	it('keeps valid legacy history readable when effective JSON is malformed', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					assignmentRow({
						daily_entries: '{invalid json',
						legacy_daily_entries: JSON.stringify([
							{ date: '2026-10-25', qty_done: 4, hours: 7 },
						]),
						work_period_entries: '[]',
						actual_hours: 99,
					}),
				],
			])
			.mockResolvedValueOnce(evidenceRows(null))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments[0].daily_entries).toEqual([]);
		expect(body.data.assignments[0].legacy_daily_entries).toEqual([
			{ date: '2026-10-25', qty_done: 4, hours: 7 },
		]);
		expect(body.data.assignments[0].actual_hours).toBe(0);
		expect(body.data.stats.totalActualHours).toBe(0);
	});

	it('preserves the legacy aggregate display when no Work Period projection exists', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					assignmentRow({
						daily_entries: '[]',
						legacy_daily_entries: '[]',
						work_period_entries: null,
						actual_hours: 7,
					}),
				],
			])
			.mockResolvedValueOnce(evidenceRows(null))
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments[0].daily_entries).toEqual([]);
		expect(body.data.assignments[0].legacy_daily_entries).toEqual([]);
		expect(body.data.assignments[0].actual_hours).toBe(7);
		expect(body.data.stats.totalActualHours).toBe(7);
	});
});

describe('legacy self-service assignment writes', () => {
	it('does not expose PUT, PATCH, or DELETE bypasses', () => {
		expect('PUT' in activityAssignmentsRoute).toBe(false);
		expect('PATCH' in activityAssignmentsRoute).toBe(false);
		expect('DELETE' in activityAssignmentsRoute).toBe(false);
	});
});

describe('activity assignment requires project team membership', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
		});
	});

	it('keeps an existing assignment readable after membership is removed', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					{
						project_id: 11,
						project_name: 'Historical Project',
						project_code: 'P-011',
						project_status: 'Active',
						activity_id: 'legacy-activity',
						activity_name: 'Legacy work',
						status: 'In Progress',
						estimated_hours: 2,
					},
				],
			])
			.mockResolvedValueOnce([[{ last_activity_logged_at: null }]])
			.mockResolvedValueOnce([[]]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.assignments).toHaveLength(1);
		expect(body.data.assignments[0].activity_name).toBe('Legacy work');
	});
});
