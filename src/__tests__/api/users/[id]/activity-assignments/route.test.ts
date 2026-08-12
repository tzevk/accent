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

const { GET, PUT, PATCH, DELETE } =
	await import('@/app/api/users/[id]/activity-assignments/route');

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

describe('user activity assignments PUT', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
		});
	});

	function putRequest(body: Record<string, unknown>) {
		return new Request('http://localhost/api/users/42/activity-assignments', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	it('preserves extra daily_entries fields (isLocked) when updating', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[{ id: 'row-1' }]]) // existing assignment
			.mockResolvedValueOnce([[]]) // day-hours lookup: no other assignments
			.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

		const response = await PUT(
			putRequest({
				project_id: '1',
				activity_id: 'a1',
				daily_entries: [
					{ date: '2026-08-10', qty_done: '2', hours: '8', isLocked: true },
				],
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);

		const updateCall = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).startsWith('UPDATE user_activity_assignments')
		);
		expect(updateCall).toBeDefined();
		const stored = JSON.parse(updateCall[1][0]);
		expect(stored).toEqual([
			{
				date: '2026-08-10',
				qty_done: 2,
				hours: 8,
				isLocked: true,
				remarks: '',
			},
		]);
	});

	it('rejects daily_entries that push a calendar day over the 12h cap', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[{ id: 'row-1' }]]) // existing assignment
			// Another assignment already logged 10h on the same date; the
			// update's own row (row-1) is excluded because it is replaced.
			.mockResolvedValueOnce([
				[
					{
						id: 'row-2',
						project_id: 9,
						activity_id: 'a9',
						daily_entries: JSON.stringify([
							{ date: '2026-08-10', hours: 10, qty_done: 5 },
						]),
					},
				],
			]);

		const response = await PUT(
			putRequest({
				project_id: '1',
				activity_id: 'a1',
				daily_entries: [{ date: '2026-08-10', qty_done: '1', hours: '8' }],
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.success).toBe(false);
		expect(String(body.error)).toContain('2026-08-10');
		expect(
			mocks.mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE user_activity_assignments')
			)
		).toBe(false); // nothing was written
	});
});

describe('user activity assignments PATCH (self-service add)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
		});
	});

	function patchRequest(body: Record<string, unknown>) {
		return new Request('http://localhost/api/users/42/activity-assignments', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	it('logs the entered manhours as the day entry and links employee_id', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ project_id: 1, project_activities_list: '[]' }],
			]) // project lookup
			.mockResolvedValueOnce([[]]) // day-hours lookup: nothing logged yet
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // blob UPDATE
			.mockResolvedValueOnce([[{ employee_id: 87 }]]) // login link
			.mockResolvedValueOnce([{ affectedRows: 1 }]); // normalized INSERT

		const response = await PATCH(
			patchRequest({
				project_id: '1',
				discipline_name: 'Structural',
				activity_name: 'RCC Check',
				manhours_assigned: '8',
				qty_completed: '1',
				due_date: '2026-08-20',
				status: 'Not Started',
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);

		// Blob: planned_hours set and the day entry logged.
		const blobUpdate = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).startsWith('UPDATE projects SET project_activities_list')
		);
		expect(blobUpdate).toBeDefined();
		const blob = JSON.parse(blobUpdate[1][0]);
		expect(blob[0].assigned_users[0].planned_hours).toBe(8);
		expect(blob[0].assigned_users[0].daily_entries).toEqual([
			{ date: '2026-08-20', qty_done: 1, hours: 8, remarks: '' },
		]);

		// Normalized row: employee_id linked, estimated_hours set, the
		// day entry stored.
		const insert = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_activity_assignments')
		);
		expect(insert).toBeDefined();
		const insertParams = insert[1];
		expect(insertParams[2]).toBe(87); // employee_id
		expect(insertParams[12]).toBe(8); // estimated_hours
		expect(JSON.parse(insertParams[20])).toEqual([
			{ date: '2026-08-20', qty_done: 1, hours: 8, remarks: '' },
		]);
	});

	it('keeps the daily entry date when no due date is given', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ project_id: 1, project_activities_list: '[]' }],
			]) // project lookup
			.mockResolvedValueOnce([[]]) // day-hours lookup: nothing logged yet
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // blob UPDATE
			.mockResolvedValueOnce([[{ employee_id: null }]]) // no login link
			.mockResolvedValueOnce([{ affectedRows: 1 }]); // normalized INSERT

		const response = await PATCH(
			patchRequest({
				project_id: '1',
				discipline_name: 'Structural',
				activity_name: 'RCC Check',
				manhours_assigned: '6',
				qty_completed: '2',
				status: 'Not Started',
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);

		const insert = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_activity_assignments')
		);
		const entry = JSON.parse(insert[1][20])[0];
		expect(entry.hours).toBe(6);
		expect(entry.qty_done).toBe(2);
		expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // today fallback
		expect(insert[1][2]).toBeNull(); // employee_id null when unlinked
	});

	it('rejects a self-service entry that exceeds the user daily hours', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ project_id: 1, project_activities_list: '[]' }],
			]) // project lookup
			// Already logged 10h on 2026-08-20 across other assignments.
			.mockResolvedValueOnce([
				[
					{
						id: 'r1',
						project_id: 3,
						activity_id: 'a3',
						daily_entries: JSON.stringify([
							{ date: '2026-08-20', hours: 10, qty_done: 3 },
						]),
					},
				],
			]); // day-hours lookup

		const response = await PATCH(
			patchRequest({
				project_id: '1',
				discipline_name: 'Structural',
				activity_name: 'RCC Check',
				manhours_assigned: '8',
				qty_completed: '1',
				due_date: '2026-08-20',
				status: 'Not Started',
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.success).toBe(false);
		expect(String(body.error)).toContain('2026-08-20');
		// Nothing was written anywhere: no blob UPDATE, no normalized INSERT.
		expect(
			mocks.mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE projects SET project_activities_list')
			)
		).toBe(false);
		expect(
			mocks.mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO user_activity_assignments')
			)
		).toBe(false);
	});
});

describe('user activity assignments DELETE', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
		});
	});

	function deleteRequest(body: Record<string, unknown>) {
		return new Request('http://localhost/api/users/42/activity-assignments', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	it('removes the user from the project blob so saves do not resurrect it', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // DELETE row
			.mockResolvedValueOnce([
				[
					{
						project_activities_list: JSON.stringify([
							{
								id: 'a1',
								activity_name: 'RCC Check',
								assigned_users: [{ user_id: 42 }, { user_id: 7 }],
							},
						]),
					},
				],
			]) // blob SELECT
			.mockResolvedValueOnce([{ affectedRows: 1 }]); // blob UPDATE

		const response = await DELETE(
			deleteRequest({ project_id: '1', activity_id: 'a1' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);

		const blobUpdate = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).startsWith('UPDATE projects SET project_activities_list')
		);
		expect(blobUpdate).toBeDefined();
		const blob = JSON.parse(blobUpdate[1][0]);
		expect(blob[0].assigned_users).toEqual([{ user_id: 7 }]);
	});

	it('drops an activity whose last assignee is deleted', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // DELETE row
			.mockResolvedValueOnce([
				[
					{
						project_activities_list: JSON.stringify([
							{
								id: 'a1',
								activity_name: 'RCC Check',
								assigned_users: [{ user_id: 42 }],
							},
						]),
					},
				],
			]) // blob SELECT
			.mockResolvedValueOnce([{ affectedRows: 1 }]); // blob UPDATE

		const response = await DELETE(
			deleteRequest({ project_id: '1', activity_id: 'a1' }),
			params()
		);

		expect(response.status).toBe(200);

		const blobUpdate = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).startsWith('UPDATE projects SET project_activities_list')
		);
		const blob = JSON.parse(blobUpdate[1][0]);
		expect(blob).toEqual([]);
	});

	it('returns 404 and leaves the blob untouched when no row exists', async () => {
		mocks.mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }]);

		const response = await DELETE(
			deleteRequest({ project_id: '1', activity_id: 'a1' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.success).toBe(false);
		// Only the DELETE was issued — no blob SELECT/UPDATE.
		expect(mocks.mockExecute.mock.calls).toHaveLength(1);
	});
});
