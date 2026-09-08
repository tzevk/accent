import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockQuery: vi.fn(),
	mockRelease: vi.fn(),
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { EMPLOYEES: 'employees' },
	PERMISSIONS: { READ: 'read', UPDATE: 'update' },
}));

const { GET, POST } = await import('@/app/api/attendance/route');

const db = {
	execute: mocks.mockExecute,
	query: mocks.mockQuery,
	release: mocks.mockRelease,
};

describe('attendance activity-day lookup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			response: null,
		});
	});

	it('returns only same-month daily activity dates by employee', async () => {
		mocks.mockExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([
			[
				{
					employee_id: 12,
					daily_entries: JSON.stringify([
						{ date: '2026-08-10', hours: 8 },
						{ date: '2026-09-01', hours: 8 },
					]),
				},
				{
					employee_id: 13,
					daily_entries: [{ date: '2026-08-11', hours: 4 }],
				},
				{ employee_id: 14, daily_entries: 'invalid JSON' },
			],
		]);

		const response = await GET(
			new Request('http://localhost/api/attendance?month=2026-08')
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.activityDays).toEqual({
			'12': { '2026-08-10': true },
			'13': { '2026-08-11': true },
		});
		expect(mocks.mockExecute.mock.calls[1][0]).toContain(
			"uaa.status <> 'Cancelled'"
		);
	});
});

describe('attendance bulk save Holiday flag', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			response: null,
		});
		mocks.mockQuery.mockResolvedValue([{}]);
		mocks.mockExecute.mockResolvedValue([[]]);
	});

	it('persists is_holiday=1 for Holiday saves', async () => {
		const response = await POST(
			new Request('http://localhost/api/attendance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					attendance_records: [
						{
							employee_id: 1,
							attendance_date: '2026-08-15',
							status: 'H',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 1,
						},
					],
					month: '2026-08',
				}),
			})
		);
		const body = await response.json();
		expect(body.success).toBe(true);
		const [sql, params] = mocks.mockQuery.mock.calls[0];
		expect(sql).toContain('is_holiday');
		// values order: employee_id, date, status, ot, weekly_off, holiday, remarks, in, out, idle
		expect(params[2]).toBe('H');
		expect(params[5]).toBe(1);
	});

	it('stores is_holiday=0 for non-Holiday saves', async () => {
		const response = await POST(
			new Request('http://localhost/api/attendance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					attendance_records: [
						{
							employee_id: 1,
							attendance_date: '2026-08-16',
							status: 'P',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
					],
					month: '2026-08',
				}),
			})
		);
		const body = await response.json();
		expect(body.success).toBe(true);
		const [, params] = mocks.mockQuery.mock.calls[0];
		expect(params[2]).toBe('P');
		expect(params[5]).toBe(0);
	});
});

describe('attendance bulk save Sandwich auto-convert (#234)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			response: null,
		});
		mocks.mockQuery.mockResolvedValue([{}]);
		mocks.mockExecute.mockResolvedValue([[]]);
	});

	function savedStatuses() {
		const [, params] = mocks.mockQuery.mock.calls[0] as [string, unknown[]];
		const statuses: string[] = [];
		for (let i = 2; i < params.length; i += 10)
			statuses.push(params[i] as string);
		return { params: params as unknown[], statuses };
	}

	it('converts a bracketed Weekly Off to the applied leave type', async () => {
		const response = await POST(
			new Request('http://localhost/api/attendance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					attendance_records: [
						{
							employee_id: 1,
							attendance_date: '2026-05-09',
							status: 'CL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
						{
							employee_id: 1,
							attendance_date: '2026-05-10',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
						{
							employee_id: 1,
							attendance_date: '2026-05-11',
							status: 'CL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
					],
					month: '2026-05',
				}),
			})
		);
		const body = await response.json();
		expect(body.success).toBe(true);
		const { params, statuses } = savedStatuses();
		// Persisted row for the Sunday carries the leave code, not WO.
		expect(statuses).toEqual(['CL', 'CL', 'CL']);
		// Converted flags clear: weekly_off index 4 per record, holiday index 5.
		expect(params[4]).toBe(0);
		expect(params[5]).toBe(0);
		expect(params[14]).toBe(0);
		expect(params[15]).toBe(0);
		expect(body.sandwichConverted).toEqual([
			{
				employee_id: 1,
				attendance_date: '2026-05-10',
				from: 'WO',
				to: 'CL',
			},
		]);
	});

	it('keeps unsandwiched Weekly Off and Holiday cells untouched', async () => {
		const response = await POST(
			new Request('http://localhost/api/attendance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					attendance_records: [
						{
							employee_id: 1,
							attendance_date: '2026-05-08',
							status: 'CL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
						{
							employee_id: 1,
							attendance_date: '2026-05-09',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
						{
							employee_id: 1,
							attendance_date: '2026-05-10',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
					],
					month: '2026-05',
				}),
			})
		);
		const body = await response.json();
		expect(body.success).toBe(true);
		const { statuses } = savedStatuses();
		expect(statuses).toEqual(['CL', 'WO', 'WO']);
		expect(body.sandwichConverted).toEqual([]);
	});

	it('converts multi-day WO/H runs bracketed by leave', async () => {
		const response = await POST(
			new Request('http://localhost/api/attendance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					attendance_records: [
						{
							employee_id: 7,
							attendance_date: '2026-05-08',
							status: 'PL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
						{
							employee_id: 7,
							attendance_date: '2026-05-09',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
						{
							employee_id: 7,
							attendance_date: '2026-05-10',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
						{
							employee_id: 7,
							attendance_date: '2026-05-11',
							status: 'H',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 1,
						},
						{
							employee_id: 7,
							attendance_date: '2026-05-12',
							status: 'PL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
					],
					month: '2026-05',
				}),
			})
		);
		const body = await response.json();
		expect(body.success).toBe(true);
		const { statuses } = savedStatuses();
		expect(statuses).toEqual(['PL', 'PL', 'PL', 'PL', 'PL']);
		expect(body.sandwichConverted).toHaveLength(3);
	});

	it('isolates Sandwich runs per employee', async () => {
		const response = await POST(
			new Request('http://localhost/api/attendance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					attendance_records: [
						{
							employee_id: 1,
							attendance_date: '2026-05-09',
							status: 'CL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
						{
							employee_id: 1,
							attendance_date: '2026-05-10',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
						{
							employee_id: 1,
							attendance_date: '2026-05-11',
							status: 'CL',
							overtime_hours: 0,
							is_weekly_off: 0,
							is_holiday: 0,
						},
						{
							employee_id: 2,
							attendance_date: '2026-05-10',
							status: 'WO',
							overtime_hours: 0,
							is_weekly_off: 1,
							is_holiday: 0,
						},
					],
					month: '2026-05',
				}),
			})
		);
		const body = await response.json();
		expect(body.success).toBe(true);
		const { statuses } = savedStatuses();
		expect(statuses).toEqual(['CL', 'CL', 'CL', 'WO']);
		expect(body.sandwichConverted).toEqual([
			{
				employee_id: 1,
				attendance_date: '2026-05-10',
				from: 'WO',
				to: 'CL',
			},
		]);
	});
});
