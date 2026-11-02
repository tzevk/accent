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

interface AccessRow {
	login_time: string | null;
	logout_time: string | null;
	access_date: string | null;
}

let accessRows: AccessRow[] = [
	{ login_time: '09:06', logout_time: '18:11', access_date: '2026-10-26' },
];
let accessQueryFails = false;

function result<T>(rows: T[]): [T[], []] {
	return [rows, []];
}

/** Route a single mock query to its canned rows. */
function answer(sql: unknown): Promise<[unknown[], []]> | null {
	const text = String(sql);
	if (text.includes('FROM user_activity_logs')) {
		if (text.includes('days_active')) {
			return Promise.resolve(result([]));
		}
		if (accessQueryFails) {
			return Promise.reject(new Error('connection lost'));
		}
		return Promise.resolve(result(accessRows));
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

describe('GET /api/users/[id]/attendance — app access contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
		mocks.mockGetCurrentUser.mockResolvedValue({
			id: 42,
			is_super_admin: false,
		});
		accessRows = [
			{
				login_time: '09:06',
				logout_time: '18:11',
				access_date: '2026-10-26',
			},
		];
		accessQueryFails = false;
		mocks.mockExecute.mockImplementation((sql: unknown) => {
			return answer(sql) ?? Promise.resolve(result([] as unknown[]));
		});
	});

	it('exposes first entry 09:06 and last contact 18:11 with no biometric lookup or legacy clocks', async () => {
		const { status, body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(status).toBe(200);
		expect(data.loginTime).toBe('09:06');
		expect(data.logoutTime).toBe('18:11');
		expect(data.accessStatus).toBe('ok');
		expect(data.accessDate).toBe('2026-10-26');
		expect(data.sessionStartTime).toBeUndefined();
		expect(data.sessionEndTime).toBeUndefined();
		expect(data.sessionEndSource).toBeUndefined();
		expect(data.sessionElapsedMinutes).toBeUndefined();
		expect(data.sessionAsOf).toBeUndefined();
		expect(data.sessionActive).toBeUndefined();
		expect(data.sessionTimeInvalid).toBeUndefined();
		expect(data.punchInTime).toBeUndefined();
		expect(data.punchOutTime).toBeUndefined();
		expect(data.punchCount).toBeUndefined();
		expect(data.punchComputable).toBeUndefined();
		expect(data.punchEmployeeId).toBeUndefined();
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

		expect((first.body.data as Record<string, unknown>).loginTime).toBe(
			'09:06'
		);
		expect((second.body.data as Record<string, unknown>).loginTime).toBe(
			'09:06'
		);
		expect((second.body.data as Record<string, unknown>).logoutTime).toBe(
			'19:42'
		);
	});

	it('answers an empty day with null clocks and ok status', async () => {
		accessRows = [
			{ login_time: null, logout_time: null, access_date: '2026-10-26' },
		];

		const { status, body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(status).toBe(200);
		expect(data.loginTime).toBeNull();
		expect(data.logoutTime).toBeNull();
		expect(data.accessStatus).toBe('ok');
		expect(data.accessDate).toBe('2026-10-26');
		expect(data.idleTime).toBe(5);
	});

	it('answers null clocks with error status when the access read fails', async () => {
		accessQueryFails = true;

		const { status, body } = await attendance();
		const data = body.data as Record<string, unknown>;

		expect(status).toBe(200);
		expect(data.loginTime).toBeNull();
		expect(data.logoutTime).toBeNull();
		expect(data.accessStatus).toBe('error');
		expect(data.accessDate).toBeNull();
		expect(data.idleTime).toBe(5);
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
