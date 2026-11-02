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

interface SessionRow {
	start_ms: unknown;
	end_ms: unknown;
	start_label: unknown;
	end_label: unknown;
	end_source: unknown;
	status: unknown;
	as_of_ms: unknown;
}

interface PunchRow {
	employee_code: string;
	log_date: string;
	employee_id: number | null;
}

// Production 2026-10-26 evidence: Work Session starts 09:06:11, ends 04:07:37
// the same day, end_source=beacon. Epochs are DECIMAL strings, exactly what
// mysql2 hands back for UNIX_TIMESTAMP(...)*1000.
const START_MS = Date.UTC(2026, 9, 26, 9, 6, 11);
const END_MS = Date.UTC(2026, 9, 26, 4, 7, 37);
const AS_OF_MS = Date.UTC(2026, 9, 26, 18, 30, 0, 123);

const REVERSED_ROW: SessionRow = {
	start_ms: String(START_MS),
	end_ms: String(END_MS),
	start_label: '09:06',
	end_label: '04:07',
	end_source: 'beacon',
	status: 'ended',
	as_of_ms: String(AS_OF_MS),
};

let sessionRows: SessionRow[] = [REVERSED_ROW];
let sessionQueryFails = false;
let punchRows: PunchRow[] = [];

function result<T>(rows: T[]): [T[], []] {
	return [rows, []];
}

/** Route a single mock query to its canned rows. */
function answer(sql: unknown): Promise<[unknown[], []]> | null {
	const text = String(sql);
	if (text.includes('FROM user_work_sessions')) {
		if (sessionQueryFails) {
			return Promise.reject(new Error('connection lost'));
		}
		// The old latest-end lookup predates the epoch read and sees no
		// rows; the contract query reads every row of the day at once.
		if (!text.includes('UNIX_TIMESTAMP')) {
			return Promise.resolve(result([]));
		}
		return Promise.resolve(result(sessionRows));
	}
	if (text.includes('INFORMATION_SCHEMA')) {
		return Promise.resolve(result([{ COLUMN_NAME: 'end_source' }]));
	}
	if (text.includes('FROM users WHERE id')) {
		return Promise.resolve(result([{ employee_id: 7 }]));
	}
	if (text.includes('FROM attendance_logs')) {
		return Promise.resolve(result(punchRows));
	}
	if (text.includes('DATE_FORMAT(CURDATE()')) {
		return Promise.resolve(result([{ today: '2026-10-26' }]));
	}
	if (text.includes('overtime_hours')) {
		return Promise.resolve(result([{ overtime_hours: 0 }]));
	}
	if (text.includes('FROM attendance') && text.includes('in_time')) {
		return Promise.resolve(result([{ in_time: '09:00:00', out_time: null }]));
	}
	if (text.includes('user_screen_time')) {
		return Promise.resolve(result([{ idle_time_minutes: 5 }]));
	}
	if (text.includes('days_present')) {
		return Promise.resolve(
			result([{ days_present: 1, weekly_off: 0, holidays: 0 }])
		);
	}
	if (text.includes('SHOW TABLES')) {
		return Promise.resolve(result([]));
	}
	return null;
}

async function attendance(userId = '42'): Promise<{
	status: number;
	body: { success: boolean; data?: Record<string, unknown> };
}> {
	const response = await GET(
		new Request(`http://localhost/api/users/${userId}/attendance`),
		{ params: Promise.resolve({ id: userId }) }
	);
	return { status: response.status, body: await response.json() };
}

describe('GET /api/users/[id]/attendance — work session contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			is_super_admin: false,
		});
		sessionRows = [REVERSED_ROW];
		sessionQueryFails = false;
		punchRows = [];
		mocks.mockExecute.mockImplementation((sql: unknown) => {
			return answer(sql) ?? Promise.resolve(result([] as unknown[]));
		});
	});

	it('surfaces the reversed 09:06/04:07 session as invalid with no invented duration', async () => {
		const { status, body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(status).toBe(200);
		expect(data.sessionStartTime).toBe('09:06');
		expect(data.sessionTimeInvalid).toBe(true);
		expect(data.sessionElapsedMinutes).toBeNull();
		expect(data.sessionEndTime).toBeNull();
		expect(data.sessionEndSource).toBeNull();
		expect(data.sessionActive).toBe(false);
		expect(data.sessionAsOf).toBe(AS_OF_MS);
		// The old claimed-login fields are gone with the contract.
		expect(data.loginTime).toBeUndefined();
		expect(data.logoutTime).toBeUndefined();
		expect(data.endSource).toBeUndefined();
	});

	it('unions a closed span with the active one and suppresses the old end', async () => {
		// 31 finished minutes plus a session open since 18:15, read at the
		// 18:30 snapshot: 46 observed minutes with no end to report.
		sessionRows = [
			{
				start_ms: String(Date.UTC(2026, 9, 26, 9, 6, 11)),
				end_ms: String(Date.UTC(2026, 9, 26, 9, 37, 11)),
				start_label: '09:06',
				end_label: '09:37',
				end_source: 'logout',
				status: 'ended',
				as_of_ms: String(AS_OF_MS),
			},
			{
				start_ms: String(Date.UTC(2026, 9, 26, 18, 15, 0)),
				end_ms: null,
				start_label: '18:15',
				end_label: null,
				end_source: null,
				status: 'active',
				as_of_ms: String(AS_OF_MS),
			},
		];

		const { body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(data.sessionActive).toBe(true);
		expect(data.sessionTimeInvalid).toBe(false);
		expect(data.sessionElapsedMinutes).toBe(46);
		expect(data.sessionEndTime).toBeNull();
		expect(data.sessionEndSource).toBeNull();
		expect(data.sessionStartTime).toBe('09:06');
		expect(data.sessionAsOf).toBe(AS_OF_MS);
	});

	it('exposes a lone First Punch as Punch In while Punch Out stays null', async () => {
		// One 09:07 device event: proof of presence for the In tile, but no
		// pair, so the Out tile shows nothing rather than a zero span.
		punchRows = [
			{
				employee_code: 'EMP-007',
				log_date: '2026-10-26 09:07:00',
				employee_id: 7,
			},
		];

		const { body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(data.punchCount).toBe(1);
		expect(data.punchComputable).toBe(false);
		expect(data.punchInTime).toBe('09:07');
		expect(data.punchOutTime).toBeNull();
	});

	it('answers an unavailable snapshot when the session query fails', async () => {
		sessionQueryFails = true;

		const { status, body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(status).toBe(200);
		expect(data.sessionStartTime).toBeNull();
		expect(data.sessionEndTime).toBeNull();
		expect(data.sessionEndSource).toBeNull();
		expect(data.sessionElapsedMinutes).toBeNull();
		expect(data.sessionAsOf).toBeNull();
		expect(data.sessionActive).toBe(false);
		expect(data.sessionTimeInvalid).toBe(false);
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
});
