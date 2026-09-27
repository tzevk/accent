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

describe('attendance punch merge (ADR-0007)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			response: null,
		});
	});

	it('merges punch-derived times into stored days and returns punchDays', async () => {
		// Call 1: attendance records (one stored P day for emp 12).
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					id: 1,
					employee_id: 12,
					attendance_date: '2026-08-12',
					status: 'P',
					overtime_hours: 0,
					is_weekly_off: 0,
					is_holiday: 0,
					remarks: null,
					in_time: '09:00:00',
					out_time: '17:00:00',
					idle_time: 0,
					employee_code: 'EMP-010',
					first_name: 'Priya',
					last_name: 'P',
					department: 'Ops',
				},
			],
			[],
		]);
		// Call 2: mapped punches for the month — blank directions on a
		// face-scan unit, 09:15 → 19:45 (10.5h worked, 2.5h past the gate).
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					employee_id: 12,
					log_date: '2026-08-12 19:45:00',
					direction: null,
				},
				{
					employee_id: 12,
					log_date: '2026-08-12 09:15:00',
					direction: null,
				},
			],
			[],
		]);

		const response = await GET(
			new Request('http://localhost/api/attendance?month=2026-08')
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		// Stored day gets device times, not its stale stored ones.
		const day = body.summary[0].days['2026-08-12'];
		expect(day.in_time).toBe('09:15');
		expect(day.out_time).toBe('19:45');
		// P day: derived OT wins — 10.5h − 8 = 2.5h past the 2h gate.
		expect(day.overtime_hours).toBe(2.5);
		// punchDays feeds client-side prefill for empty cells + Fill Present.
		expect(body.punchDays['12']['2026-08-12']).toEqual({
			in_time: '09:15',
			out_time: '19:45',
			overtime_hours: 2.5,
		});
		// Activity-day machinery is gone (replaced by punches, Q10).
		expect(body.activityDays).toBeUndefined();
		// GET stays read-only: only SELECTs, no INSERT/UPDATE.
		for (const [sql] of mocks.mockExecute.mock.calls) {
			expect(String(sql).trim().toUpperCase()).not.toMatch(
				/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/
			);
		}
	});

	it('never derives OT on an authored Half Day and flags nothing extra', async () => {
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					id: 2,
					employee_id: 13,
					attendance_date: '2026-08-13',
					status: 'HD',
					overtime_hours: 0,
					is_weekly_off: 0,
					is_holiday: 0,
					remarks: null,
					in_time: null,
					out_time: null,
					idle_time: 0,
					employee_code: 'EMP-011',
					first_name: 'Arjun',
					last_name: 'A',
					department: 'Ops',
				},
			],
			[],
		]);
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					employee_id: 13,
					log_date: '2026-08-13 09:00:00',
					direction: 'in',
				},
				{
					employee_id: 13,
					log_date: '2026-08-13 19:00:00',
					direction: 'out',
				},
			],
			[],
		]);

		const response = await GET(
			new Request('http://localhost/api/attendance?month=2026-08')
		);
		const body = await response.json();
		const day = body.summary[0].days['2026-08-13'];
		// Times merge (device observability kept)…
		expect(day.in_time).toBe('09:00');
		expect(day.out_time).toBe('19:00');
		// …but HR's half-day intent wins on hours/OT (ADR-0007): no derived
		// overtime_hours on HD, so the summary credits 4h, never 10h+.
		expect(day.overtime_hours).toBe(0);
		// punchDays still carries its own derived OT for empty-cell prefill
		// logic — but HD is authored, so client never prefills from it here.
		expect(body.punchDays['13']['2026-08-13'].in_time).toBe('09:00');
	});

	it('returns an empty punchDays map when attendance_logs has no rows', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce([[], []])
			.mockResolvedValueOnce([[], []]);

		const response = await GET(
			new Request('http://localhost/api/attendance?month=2026-08')
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.punchDays).toEqual({});
		expect(body.activityDays).toBeUndefined();
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
