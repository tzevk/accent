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
vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: vi
		.fn()
		.mockResolvedValue(
			new Set([
				'project_id',
				'id',
				'project_code',
				'project_team',
				'project_activities_list',
			])
		),
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('project_id'),
	hasColumn: vi.fn().mockResolvedValue(true),
	invalidateCache: vi.fn(),
}));

const { GET, PUT, PATCH, DELETE } =
	await import('@/app/api/users/[id]/activity-assignments/route');

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

/** The stored team contains the acting member, id 42. */
const PROJECT_TEAM = JSON.stringify([
	{ id: 42, email: 'member@example.com', role: 'Team Member' },
]);

function projectLookup(
	overrides: Record<string, unknown> = {}
): [Record<string, unknown>[]] {
	return [
		[
			{
				id: 1,
				project_id: '1',
				project_code: 'P-1',
				project_team: PROJECT_TEAM,
				project_activities_list: '[]',
				...overrides,
			},
		],
	];
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
});

describe('user activity assignments lastActivityLoggedAt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

	function markerInsert() {
		return mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_activity_logs')
		);
	}

	it('preserves extra daily_entries fields (isLocked) when updating', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]]) // existing assignment
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
			.mockResolvedValueOnce([{ insertId: 7 }]); // save marker

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

		// Self save commits assignment + evidence atomically.
		expect(mocks.mockBeginTransaction).toHaveBeenCalledTimes(1);
		expect(mocks.mockCommit).toHaveBeenCalledTimes(1);
		expect(mocks.mockRollback).not.toHaveBeenCalled();
	});

	it('records a self-save marker when the user updates their own assignment', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([{ insertId: 9 }]);

		const response = await PUT(
			putRequest({ project_id: '1', activity_id: 'a1', status: 'In Progress' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);

		const marker = markerInsert();
		expect(marker).toBeDefined();
		const markerParams = marker[1];
		expect(markerParams[0]).toBe(42); // actor, not the row owner
		expect(markerParams[1]).toBe('update');
		expect(markerParams[2]).toBe('project_activity_save');
		expect(markerParams[5]).toBe('success');
		expect(JSON.parse(markerParams[4])).toEqual({
			projectId: '1',
			activityId: 'a1',
		});
		expect(mocks.mockCommit).toHaveBeenCalledTimes(1);
		expect(mocks.mockRollback).not.toHaveBeenCalled();
	});

	it('records no marker when a super-admin edits another user', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 1,
			email: 'admin@example.com',
			is_super_admin: 1,
		});
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await PUT(
			putRequest({ project_id: '1', activity_id: 'a1', status: 'In Progress' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.affected_rows).toBe(1);
		expect(markerInsert()).toBeUndefined();
		expect(mocks.mockCommit).toHaveBeenCalledTimes(1);
		expect(mocks.mockRollback).not.toHaveBeenCalled();
	});

	it('writes no marker on a no-op update', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]]);

		const response = await PUT(
			putRequest({ project_id: '1', activity_id: 'a1' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.affected_rows).toBe(0);
		expect(markerInsert()).toBeUndefined();
		expect(mocks.mockBeginTransaction).not.toHaveBeenCalled();
		expect(mocks.mockRollback).not.toHaveBeenCalled();
	});

	it('writes no marker when the update touches no rows', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]])
			.mockResolvedValueOnce([{ affectedRows: 0 }]);

		const response = await PUT(
			putRequest({ project_id: '1', activity_id: 'a1', status: 'In Progress' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.affected_rows).toBe(0);
		expect(markerInsert()).toBeUndefined();
		expect(mocks.mockCommit).toHaveBeenCalledTimes(1);
	});

	it('rolls back the assignment write when the marker insert fails', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockRejectedValueOnce(new Error('marker insert down'));

		const response = await PUT(
			putRequest({ project_id: '1', activity_id: 'a1', status: 'In Progress' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.success).toBe(false);
		expect(mocks.mockRollback).toHaveBeenCalledTimes(1);
		expect(mocks.mockCommit).not.toHaveBeenCalled();
		expect(mocks.mockRelease).toHaveBeenCalled();
	});

	it('rolls back when the commit fails', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([[{ id: 'row-1' }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([{ insertId: 9 }]);
		mocks.mockCommit.mockRejectedValueOnce(new Error('commit down'));

		const response = await PUT(
			putRequest({ project_id: '1', activity_id: 'a1', status: 'In Progress' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.success).toBe(false);
		expect(mocks.mockRollback).toHaveBeenCalledTimes(1);
		expect(mocks.mockRelease).toHaveBeenCalled();
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

	function patchBody() {
		return {
			project_id: '1',
			discipline_name: 'Structural',
			activity_name: 'RCC Check',
			manhours_assigned: '8',
			qty_completed: '1',
			due_date: '2026-08-20',
			status: 'Not Started',
		};
	}

	function markerInsert() {
		return mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_activity_logs')
		);
	}

	it('logs the entered manhours as the day entry and links employee_id', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(projectLookup()) // project lookup
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // blob UPDATE
			.mockResolvedValueOnce([[{ employee_id: 87 }]]) // login link
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // normalized INSERT
			.mockResolvedValueOnce([{ insertId: 11 }]); // save marker

		const response = await PATCH(patchRequest(patchBody()), params());
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

		// Self-service add records a create marker and commits atomically.
		const marker = markerInsert();
		expect(marker).toBeDefined();
		expect(marker[1][0]).toBe(42);
		expect(marker[1][1]).toBe('create');
		expect(marker[1][2]).toBe('project_activity_save');
		expect(JSON.parse(marker[1][4])).toMatchObject({ projectId: '1' });
		expect(mocks.mockBeginTransaction).toHaveBeenCalledTimes(1);
		expect(mocks.mockCommit).toHaveBeenCalledTimes(1);
		expect(mocks.mockRollback).not.toHaveBeenCalled();
	});

	it('keeps the daily entry date when no due date is given', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(projectLookup()) // project lookup
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // blob UPDATE
			.mockResolvedValueOnce([[{ employee_id: null }]]) // no login link
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // normalized INSERT
			.mockResolvedValueOnce([{ insertId: 12 }]); // save marker

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

	it('allows planned hours for a multi-day activity', async () => {
		// The self-service add records PLANNED manhours for a whole activity;
		// multi-day tasks routinely exceed a single day's hours.
		mocks.mockExecute
			.mockResolvedValueOnce(projectLookup()) // project lookup
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // blob UPDATE
			.mockResolvedValueOnce([[{ employee_id: null }]]) // login link
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // normalized INSERT
			.mockResolvedValueOnce([{ insertId: 13 }]); // save marker

		const response = await PATCH(
			patchRequest({
				project_id: '1',
				discipline_name: 'Structural',
				activity_name: 'RCC Check',
				manhours_assigned: '24',
				qty_completed: '1',
				due_date: '2026-08-20',
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
		expect(insert).toBeDefined();
		expect(JSON.parse(insert[1][20])).toEqual([
			{ date: '2026-08-20', qty_done: 1, hours: 24, remarks: '' },
		]);
		// No per-date hours SELECT was issued.
		expect(
			mocks.mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('FROM user_activity_assignments')
			)
		).toBe(false);
	});

	it('records no marker when a super-admin adds for another user', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 1,
			email: 'admin@example.com',
			is_super_admin: 1,
		});
		mocks.mockExecute
			.mockResolvedValueOnce(projectLookup())
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[{ employee_id: 87 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await PATCH(patchRequest(patchBody()), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(markerInsert()).toBeUndefined();
		expect(mocks.mockCommit).toHaveBeenCalledTimes(1);
		expect(mocks.mockRollback).not.toHaveBeenCalled();
	});

	it('rolls back the save when the marker insert fails', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(projectLookup())
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[{ employee_id: 87 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockRejectedValueOnce(new Error('marker insert down'));

		const response = await PATCH(patchRequest(patchBody()), params());
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.success).toBe(false);
		expect(mocks.mockRollback).toHaveBeenCalledTimes(1);
		expect(mocks.mockCommit).not.toHaveBeenCalled();
		expect(mocks.mockRelease).toHaveBeenCalled();
	});

	it('rolls back when the commit fails after a save', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(projectLookup())
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[{ employee_id: 87 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([{ insertId: 14 }]);
		mocks.mockCommit.mockRejectedValueOnce(new Error('commit down'));

		const response = await PATCH(patchRequest(patchBody()), params());
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.success).toBe(false);
		expect(mocks.mockRollback).toHaveBeenCalledTimes(1);
		expect(mocks.mockRelease).toHaveBeenCalled();
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
			.mockResolvedValueOnce([...projectLookup()]) // project access
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
			.mockResolvedValueOnce([...projectLookup()]) // project access
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
		mocks.mockExecute
			.mockResolvedValueOnce([...projectLookup()]) // project access
			.mockResolvedValueOnce([{ affectedRows: 0 }]);

		const response = await DELETE(
			deleteRequest({ project_id: '1', activity_id: 'a1' }),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.success).toBe(false);
		// The access lookup and the DELETE only — no blob SELECT/UPDATE.
		expect(mocks.mockExecute.mock.calls).toHaveLength(2);
	});
});

describe('user activity assignments after team removal', () => {
	// The actor still owns the assignment rows, but the stored team no
	// longer contains them. Removal wins on the next request.
	const REMOVED_TEAM = JSON.stringify([
		{ id: 7, email: 'lead@example.com', role: 'Project Lead' },
	]);

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
		});
		mocks.mockExecute
			.mockReset()
			.mockResolvedValueOnce([
				...projectLookup({ project_team: REMOVED_TEAM }),
			]);
	});

	it.each(['PATCH', 'PUT', 'DELETE'] as const)(
		'denies %s without touching assignment or project rows',
		async (method) => {
			const writeBody = {
				project_id: '1',
				activity_id: 'a1',
				discipline_name: 'Structural',
				activity_name: 'RCC Check',
				status: 'In Progress',
			};
			const response = await (
				method === 'PATCH' ? PATCH : method === 'PUT' ? PUT : DELETE
			)(
				new Request('http://localhost/api/users/42/activity-assignments', {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(writeBody),
				}),
				params()
			);
			const body = await response.json();

			expect(response.status).toBe(403);
			expect(body).toEqual({
				success: false,
				error: 'You do not have permission to access this project',
			});
			expect(
				mocks.mockExecute.mock.calls.some(([sql]) =>
					/^(UPDATE|INSERT|DELETE)/i.test(String(sql))
				)
			).toBe(false);
			expect(mocks.mockBeginTransaction).not.toHaveBeenCalled();
		}
	);
});
