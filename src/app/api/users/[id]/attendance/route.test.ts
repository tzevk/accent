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

// Loaded after the mocks are registered: a static import would bind the real
// pool and the real permission module before the factories run.
const { GET } = await import('@/app/api/users/[id]/attendance/route');

const db = {
	execute: mocks.mockExecute,
	release: mocks.mockRelease,
};

interface EmployeeClockRow {
	employee_id: number | null;
	month_start: string;
	next_month_start: string;
	days_in_month: number;
	current_month: string;
	current_year: number;
}

interface AttendanceRecordRow {
	attendance_date: string;
	status: string | null;
	in_time: string | null;
	out_time: string | null;
	overtime_hours: number | string | null;
}

interface PunchRow {
	employee_id: number;
	log_date: string;
	direction: string | null;
}

interface LeaveRow {
	total_leaves: number | string;
	used_leaves: number | string;
}

interface AccessRow {
	login_time: string | null;
	logout_time: string | null;
	access_date: string | null;
}

interface AttendanceData {
	idleTime: number;
	loginTime: string | null;
	logoutTime: string | null;
	accessStatus: 'ok' | 'error';
	accessDate: string | null;
	currentMonth: string | null;
	daysInMonth: number | null;
	daysPresent: number | null;
	overtimeHours: number | null;
	leaves: { total: number; used: number; balance: number } | null;
}

interface AttendanceResponse {
	success: boolean;
	data?: AttendanceData;
	error?: string;
}

function linkedClock(
	overrides: Partial<EmployeeClockRow> = {}
): EmployeeClockRow {
	return {
		employee_id: 12,
		month_start: '2026-10-01',
		next_month_start: '2026-11-01',
		days_in_month: 31,
		current_month: 'October 2026',
		current_year: 2026,
		...overrides,
	};
}

let clockRows: EmployeeClockRow[];
let attendanceRows: AttendanceRecordRow[];
let punchRows: PunchRow[];
let leaveRows: LeaveRow[];
let accessRows: AccessRow[];
let screenRows: Array<{ idle_time_minutes: number | string | null }>;
let employeeContextQueryFails: boolean;
let attendanceQueryFails: boolean;
let punchQueryFails: boolean;
let leaveQueryFails: boolean;
let accessQueryFails: boolean;
let screenQueryFails: boolean;

function result<T>(rows: T[]): [T[], []] {
	return [rows, []];
}

/** Route each database-boundary query to its canned rows. */
function answer(sql: unknown): Promise<[unknown[], []]> {
	const text = String(sql);
	if (text.includes('LEFT JOIN employees')) {
		return employeeContextQueryFails
			? Promise.reject(new Error('employee link unavailable'))
			: Promise.resolve(result(clockRows));
	}
	if (text.includes('FROM employee_attendance')) {
		return attendanceQueryFails
			? Promise.reject(new Error('attendance unavailable'))
			: Promise.resolve(result(attendanceRows));
	}
	if (text.includes('FROM attendance_logs')) {
		return punchQueryFails
			? Promise.reject(new Error('punches unavailable'))
			: Promise.resolve(result(punchRows));
	}
	if (text.includes('FROM employee_leaves')) {
		return leaveQueryFails
			? Promise.reject(new Error('leaves unavailable'))
			: Promise.resolve(result(leaveRows));
	}
	if (text.includes('FROM user_screen_time')) {
		return screenQueryFails
			? Promise.reject(new Error('screen time unavailable'))
			: Promise.resolve(result(screenRows));
	}
	if (text.includes('FROM user_activity_logs')) {
		return accessQueryFails
			? Promise.reject(new Error('connection lost'))
			: Promise.resolve(result(accessRows));
	}
	return Promise.resolve(result([]));
}

function callsFor(fragment: string): Array<{ sql: string; params: unknown[] }> {
	const calls = mocks.mockExecute.mock.calls as Array<[unknown, unknown[]]>;
	return calls
		.filter(([sql]) => String(sql).includes(fragment))
		.map(([sql, params]) => ({
			sql: String(sql),
			params,
		}));
}

async function attendance(userId = '42'): Promise<{
	status: number;
	body: AttendanceResponse;
}> {
	const response = await GET(
		new Request(`http://localhost/api/users/${userId}/attendance`),
		{ params: Promise.resolve({ id: userId }) }
	);
	return {
		status: response.status,
		body: (await response.json()) as AttendanceResponse,
	};
}

describe('GET /api/users/[id]/attendance — shared dashboard contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			is_super_admin: false,
		});
		clockRows = [linkedClock()];
		attendanceRows = [];
		punchRows = [];
		leaveRows = [{ total_leaves: 24, used_leaves: 0 }];
		accessRows = [
			{
				login_time: '09:06',
				logout_time: '18:11',
				access_date: '2026-10-26',
			},
		];
		screenRows = [{ idle_time_minutes: 5 }];
		employeeContextQueryFails = false;
		attendanceQueryFails = false;
		punchQueryFails = false;
		leaveQueryFails = false;
		accessQueryFails = false;
		screenQueryFails = false;
		mocks.mockExecute.mockImplementation((sql: unknown) => answer(sql));
	});

	it('keeps CRM Log In independent and omits legacy attendance fields', async () => {
		const { status, body } = await attendance();
		const data = body.data as AttendanceData;

		expect(status).toBe(200);
		expect(body.success).toBe(true);
		expect(data).toEqual({
			idleTime: 5,
			loginTime: '09:06',
			logoutTime: '18:11',
			accessStatus: 'ok',
			accessDate: '2026-10-26',
			currentMonth: 'October 2026',
			daysInMonth: 31,
			daysPresent: 0,
			overtimeHours: 0,
			leaves: { total: 24, used: 0, balance: 24 },
		});
		expect(data).not.toHaveProperty('inTime');
		expect(data).not.toHaveProperty('outTime');
		expect(data).not.toHaveProperty('weeklyOff');
		expect(data).not.toHaveProperty('holidays');
		expect(data).not.toHaveProperty('sessionStartTime');
		expect(data).not.toHaveProperty('sessionEndTime');
		expect(data).not.toHaveProperty('sessionEndSource');
		expect(data).not.toHaveProperty('sessionElapsedMinutes');
		expect(data).not.toHaveProperty('sessionAsOf');
		expect(data).not.toHaveProperty('sessionActive');
		expect(data).not.toHaveProperty('sessionTimeInvalid');
		expect(data).not.toHaveProperty('punchInTime');
		expect(data).not.toHaveProperty('punchOutTime');
		expect(data).not.toHaveProperty('punchCount');
		expect(data).not.toHaveProperty('punchComputable');
		expect(data).not.toHaveProperty('punchEmployeeId');

		for (const { sql } of callsFor('')) {
			expect(sql).not.toMatch(/\bSHOW\s+TABLES\b/i);
			expect(sql).not.toMatch(/\bdays_active\b/i);
			expect(sql).not.toMatch(/\bFROM\s+attendance\b/i);
		}
		expect(mocks.mockDbConnect).toHaveBeenCalledTimes(1);
		expect(mocks.mockRelease).toHaveBeenCalledTimes(1);
	});

	it('keeps a later relogin from replacing the earlier first entry', async () => {
		accessRows = [
			{
				login_time: '09:06',
				logout_time: '19:42',
				access_date: '2026-10-26',
			},
		];

		const first = await attendance();
		const second = await attendance();

		expect(first.body.data?.loginTime).toBe('09:06');
		expect(second.body.data?.loginTime).toBe('09:06');
		expect(second.body.data?.logoutTime).toBe('19:42');
	});

	it('answers an empty app-access day with null clocks and ok status', async () => {
		accessRows = [
			{ login_time: null, logout_time: null, access_date: '2026-10-26' },
		];

		const { status, body } = await attendance();
		const data = body.data as AttendanceData;

		expect(status).toBe(200);
		expect(data.loginTime).toBeNull();
		expect(data.logoutTime).toBeNull();
		expect(data.accessStatus).toBe('ok');
		expect(data.accessDate).toBe('2026-10-26');
		expect(data.idleTime).toBe(5);
	});

	it('answers null clocks with error status when only app access fails', async () => {
		accessQueryFails = true;

		const { status, body } = await attendance();
		const data = body.data as AttendanceData;

		expect(status).toBe(200);
		expect(data.loginTime).toBeNull();
		expect(data.logoutTime).toBeNull();
		expect(data.accessStatus).toBe('error');
		expect(data.accessDate).toBeNull();
		expect(data.idleTime).toBe(5);
		expect(data.daysPresent).toBe(0);
	});

	it('denies other-user data to a non-admin without touching the database', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 7,
			is_super_admin: false,
		});

		const { status } = await attendance('42');

		expect(status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockExecute).not.toHaveBeenCalled();
		expect(mocks.mockRelease).not.toHaveBeenCalled();
	});

	it('denies unauthenticated requests without touching the database', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue(null);

		const { status } = await attendance('42');

		expect(status).toBe(401);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockExecute).not.toHaveBeenCalled();
	});

	it('uses the admin target user link rather than the actor employee', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 7,
			employee_id: 99,
			is_super_admin: true,
		});
		attendanceRows = [
			{
				attendance_date: '2026-10-01',
				status: 'P',
				in_time: '09:00:00',
				out_time: '17:00:00',
				overtime_hours: 0,
			},
		];
		punchRows = [
			{ employee_id: 12, log_date: '2026-10-01 09:00:00', direction: 'in' },
			{
				employee_id: 12,
				log_date: '2026-10-01 20:00:00',
				direction: 'out',
			},
		];

		const { status, body } = await attendance('42');

		expect(status).toBe(200);
		expect(body.data?.daysPresent).toBe(1);
		expect(body.data?.overtimeHours).toBe(3);
		expect(callsFor('LEFT JOIN employees')[0].params).toEqual([42]);
		expect(callsFor('FROM employee_attendance')[0].params).toEqual([
			12,
			'2026-10-01',
			'2026-11-01',
		]);
		expect(callsFor('FROM attendance_logs')[0].params).toEqual([
			12,
			'2026-10-01',
			'2026-11-01',
		]);
		expect(callsFor('FROM user_activity_logs')[0].params).toEqual([42]);
		expect(callsFor('FROM user_screen_time')[0].params).toEqual([42]);
	});

	it('derives Present and Payable OT from owned P/HD/OT/A records and device Punches', async () => {
		attendanceRows = [
			{
				attendance_date: '2026-10-01',
				status: 'P',
				in_time: '09:00:00',
				out_time: '17:00:00',
				overtime_hours: 0,
			},
			{
				attendance_date: '2026-10-02',
				status: 'HD',
				in_time: '09:00:00',
				out_time: '13:00:00',
				overtime_hours: 1.5,
			},
			{
				attendance_date: '2026-10-03',
				status: 'OT',
				in_time: '09:00:00',
				out_time: '17:00:00',
				overtime_hours: 1.5,
			},
			{
				attendance_date: '2026-10-04',
				status: 'A',
				in_time: '09:00:00',
				out_time: '17:00:00',
				overtime_hours: 2.1,
			},
		];
		punchRows = [
			{ employee_id: 12, log_date: '2026-10-01 09:00:00', direction: 'in' },
			{
				employee_id: 12,
				log_date: '2026-10-01 20:00:00',
				direction: 'out',
			},
			{ employee_id: 12, log_date: '2026-10-02 09:00:00', direction: 'in' },
			{
				employee_id: 12,
				log_date: '2026-10-02 21:00:00',
				direction: 'out',
			},
			{ employee_id: 12, log_date: '2026-10-04 09:00:00', direction: 'in' },
			{
				employee_id: 12,
				log_date: '2026-10-04 17:00:00',
				direction: 'out',
			},
		];

		const { body } = await attendance();

		// P + OT are Present. HD and A are not. The P day's 3h device OT
		// replaces stale stored time; HD keeps its sub-gate authored OT;
		// the OT day's stored 1.5h and the A day's replaced 2.1h do not pay.
		expect(body.data?.daysPresent).toBe(2);
		expect(body.data?.overtimeHours).toBe(3);
		expect(body.data?.daysInMonth).toBe(31);
	});

	it('does not turn Punch-only days into Present attendance records', async () => {
		punchRows = [
			{ employee_id: 12, log_date: '2026-10-05 09:00:00', direction: 'in' },
			{
				employee_id: 12,
				log_date: '2026-10-05 19:00:00',
				direction: 'out',
			},
		];

		const { body } = await attendance();

		expect(body.data?.daysPresent).toBe(0);
		expect(body.data?.overtimeHours).toBe(0);
	});

	it('reports a linked empty month as zero rather than unavailable', async () => {
		const { body } = await attendance();

		expect(body.data?.daysPresent).toBe(0);
		expect(body.data?.overtimeHours).toBe(0);
		expect(body.data?.leaves).toEqual({ total: 24, used: 0, balance: 24 });
	});

	it('keeps CRM Log In available without a live linked Employee', async () => {
		clockRows = [linkedClock({ employee_id: null })];
		attendanceRows = [
			{
				attendance_date: '2026-10-01',
				status: 'P',
				in_time: '09:00:00',
				out_time: '17:00:00',
				overtime_hours: 0,
			},
		];
		punchRows = [
			{ employee_id: 12, log_date: '2026-10-01 09:00:00', direction: 'in' },
		];

		const { status, body } = await attendance();

		expect(status).toBe(200);
		expect(body.data?.loginTime).toBe('09:06');
		expect(body.data?.logoutTime).toBe('18:11');
		expect(body.data?.accessStatus).toBe('ok');
		expect(body.data?.idleTime).toBe(5);
		expect(body.data?.daysPresent).toBeNull();
		expect(body.data?.overtimeHours).toBeNull();
		expect(body.data?.leaves).toBeNull();
		expect(callsFor('FROM employee_attendance')).toHaveLength(0);
		expect(callsFor('FROM attendance_logs')).toHaveLength(0);
		expect(callsFor('FROM employee_leaves')).toHaveLength(0);

		const [linkQuery] = callsFor('LEFT JOIN employees');
		expect(linkQuery.params).toEqual([42]);
		expect(linkQuery.sql).toMatch(/e\.id\s*=\s*u\.employee_id/i);
		expect(linkQuery.sql).toMatch(/e\.isDelete\s*=\s*0/i);
		expect(linkQuery.sql).toMatch(/u\.id\s*=\s*\?/i);
	});

	it('uses the DB month boundaries and day count across a year boundary', async () => {
		clockRows = [
			linkedClock({
				month_start: '2026-12-01',
				next_month_start: '2027-01-01',
				current_month: 'December 2026',
				current_year: 2026,
			}),
		];

		const { body } = await attendance();

		expect(body.data?.currentMonth).toBe('December 2026');
		expect(body.data?.daysInMonth).toBe(31);
		expect(callsFor('FROM employee_attendance')[0].params).toEqual([
			12,
			'2026-12-01',
			'2027-01-01',
		]);
		expect(callsFor('FROM attendance_logs')[0].params).toEqual([
			12,
			'2026-12-01',
			'2027-01-01',
		]);
		expect(callsFor('FROM employee_leaves')[0].params).toEqual([12, 2026]);
		expect(callsFor('FROM employee_attendance')[0].sql).toMatch(
			/attendance_date\s*>=\s*\?\s+AND\s+attendance_date\s*<\s*\?/i
		);
		expect(callsFor('FROM attendance_logs')[0].sql).toMatch(
			/log_date\s*>=\s*\?\s+AND\s+log_date\s*<\s*\?/i
		);
	});

	it('leaves attendance unavailable without an activity fallback when the monthly record read fails', async () => {
		attendanceQueryFails = true;
		leaveRows = [{ total_leaves: 24, used_leaves: 2 }];

		const { status, body } = await attendance();

		expect(status).toBe(200);
		expect(body.data?.daysPresent).toBeNull();
		expect(body.data?.overtimeHours).toBeNull();
		expect(body.data?.leaves).toEqual({ total: 24, used: 2, balance: 22 });
		expect(body.data?.loginTime).toBe('09:06');
		expect(body.data?.idleTime).toBe(5);
		expect(callsFor('days_active')).toHaveLength(0);
	});

	it('leaves attendance unavailable when the monthly Punch read fails', async () => {
		punchQueryFails = true;
		attendanceRows = [
			{
				attendance_date: '2026-10-01',
				status: 'P',
				in_time: '09:00:00',
				out_time: '17:00:00',
				overtime_hours: 0,
			},
		];

		const { body } = await attendance();

		expect(body.data?.daysPresent).toBeNull();
		expect(body.data?.overtimeHours).toBeNull();
		expect(body.data?.loginTime).toBe('09:06');
	});

	it('keeps CRM data available when the employee link read fails', async () => {
		employeeContextQueryFails = true;

		const { status, body } = await attendance();

		expect(status).toBe(200);
		expect(body.data?.loginTime).toBe('09:06');
		expect(body.data?.accessStatus).toBe('ok');
		expect(body.data?.idleTime).toBe(5);
		expect(body.data?.currentMonth).toBeNull();
		expect(body.data?.daysInMonth).toBeNull();
		expect(body.data?.daysPresent).toBeNull();
		expect(body.data?.overtimeHours).toBeNull();
		expect(body.data?.leaves).toBeNull();
		expect(mocks.mockRelease).toHaveBeenCalledTimes(1);
	});

	it('reports unavailable leaves rather than inventing a balance when their read fails', async () => {
		leaveQueryFails = true;

		const { body } = await attendance();

		expect(body.data?.daysPresent).toBe(0);
		expect(body.data?.overtimeHours).toBe(0);
		expect(body.data?.leaves).toBeNull();
	});

	it('keeps idleTime numeric and preserves its zero fallback when screen time fails', async () => {
		screenQueryFails = true;

		const { body } = await attendance();

		expect(body.data?.idleTime).toBe(0);
		expect(body.data?.loginTime).toBe('09:06');
		expect(body.data?.daysPresent).toBe(0);
	});
});
