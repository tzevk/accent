import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + auth before dynamic import (Vitest hoists mocks).
const mockExecute = vi.fn();
const mockRelease = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		release: mockRelease,
	}),
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: vi.fn(),
}));

// Pass through the real window logic (null age → offline) without touching
// the logger's DB imports; boundaries are unit-tested elsewhere.
vi.mock('@/utils/activity-logger', () => ({
	getStatusFromActivity: vi.fn((ageSeconds, isIdle) =>
		ageSeconds == null ? 'offline' : isIdle ? 'idle' : 'online'
	),
}));

const { GET } = await import('@/app/api/user-status/route');
const { getCurrentUser } = await import('@/utils/api-permissions');
const { getStatusFromActivity } = await import('@/utils/activity-logger');

const admin = { id: 1, is_super_admin: true, role: null };
const regularUser = { id: 5, is_super_admin: false, role: { code: 'user' } };

const makeRequest = (url = 'http://localhost/api/user-status') =>
	new Request(url);

beforeEach(() => {
	mockExecute.mockReset();
	mockRelease.mockReset();
	vi.mocked(getCurrentUser).mockReset();
	vi.mocked(getStatusFromActivity).mockClear();
});

describe('GET /api/user-status — access control', () => {
	it('rejects unauthenticated requests', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(null);

		const res = await GET(makeRequest());
		expect(res.status).toBe(401);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('forbids non-admins from enumerating all users', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(regularUser);

		const res = await GET(makeRequest());
		expect(res.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('forbids non-admins from viewing another user', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(regularUser);

		const res = await GET(
			makeRequest('http://localhost/api/user-status?user_id=9')
		);
		expect(res.status).toBe(403);
	});

	it('allows non-admins to view their own status', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
		mockExecute
			.mockResolvedValueOnce([
				[{ user_id: 5, is_idle: null, seconds_since_activity: null }],
			])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([[]]);

		const res = await GET(
			makeRequest('http://localhost/api/user-status?user_id=5')
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data.user_id).toBe(5);
	});
});

describe('GET /api/user-status — all users', () => {
	const usersRows = [
		{
			user_id: 1,
			username: 'alice',
			full_name: 'Alice',
			email: 'alice@example.com',
			role_name: 'Admin',
			last_activity: null, // no presence row yet
			seconds_since_activity: null,
			is_idle: null,
			current_page: null,
		},
		{
			user_id: 2,
			username: 'bob',
			full_name: 'Bob',
			email: 'bob@example.com',
			role_name: 'Editor',
			seconds_since_activity: 30,
			is_idle: 1,
			current_page: '/dashboard',
		},
	];

	it('returns the full response shape with status from presence, not audit logs', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
		mockExecute
			.mockResolvedValueOnce([usersRows])
			.mockResolvedValueOnce([[]]) // user_daily_summary
			.mockResolvedValueOnce([[]]) // user_screen_time
			.mockResolvedValueOnce([[]]); // user_work_sessions

		const res = await GET(makeRequest());
		expect(res.status).toBe(200);
		const json = await res.json();

		expect(json.data).toHaveLength(2);
		expect(json.data[0]).toMatchObject({
			user_id: 1,
			username: 'alice',
			full_name: 'Alice',
			email: 'alice@example.com',
			role_name: 'Admin',
			status: 'offline', // no presence row
			last_activity: null,
			current_page: null,
		});
		expect(json.data[1].status).toBe('idle'); // is_idle propagated

		// Stats keys merged for every user.
		for (const u of json.data) {
			expect(u.total_screen_time_minutes).toBe(0);
			expect(u.activities_count).toBe(0);
			expect(u.productivity_score).toBe(0);
		}

		// Status derives from the presence join (DB-side recency age).
		expect(getStatusFromActivity).toHaveBeenCalledWith(null, null);
		expect(getStatusFromActivity).toHaveBeenCalledWith(30, 1);

		// Query must join user_presence, compute age in SQL, and never
		// aggregate the audit log or parse timestamps in JS.
		const usersQuery = mockExecute.mock.calls[0][0];
		expect(usersQuery).toContain('LEFT JOIN user_presence p');
		expect(usersQuery).toContain('LEFT JOIN roles_master r');
		expect(usersQuery).toContain('TIMESTAMPDIFF(SECOND, p.last_seen, NOW())');
		expect(usersQuery).not.toContain('GROUP BY');
		expect(usersQuery).not.toContain('MAX(');
		expect(usersQuery).not.toContain('user_activity_logs');
	});

	it('batches today stats into 3 queries regardless of user count', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
		mockExecute
			.mockResolvedValueOnce([usersRows])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([[]]);

		await GET(makeRequest());
		expect(mockExecute).toHaveBeenCalledTimes(4); // users + 3 stats queries
	});
});

describe('GET /api/user-status — single user', () => {
	it('computes session_duration only for online users and keeps work-session fields', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
		mockExecute.mockResolvedValueOnce([
			[
				{
					user_id: 2,
					username: 'bob',
					full_name: 'Bob',
					email: 'bob@example.com',
					role_name: 'Editor',
					seconds_since_activity: 30,
					is_idle: 0,
					current_page: '/leads',
					session_duration: 3600, // TIMESTAMPDIFF computed in SQL
				},
			],
		]);

		const res = await GET(
			makeRequest(
				'http://localhost/api/user-status?user_id=2&include_stats=false'
			)
		);
		const json = await res.json();

		expect(json.data.status).toBe('online');
		expect(json.data.session_duration).toBe(3600);
		expect(json.data.current_page).toBe('/leads');
		expect(mockExecute).toHaveBeenCalledTimes(1); // stats skipped

		// Recency + duration are computed DB-side, never parsed in JS.
		const query = mockExecute.mock.calls[0][0];
		expect(query).toContain('TIMESTAMPDIFF(SECOND, p.last_seen, NOW())');
		expect(query).toContain('TIMESTAMPDIFF(SECOND, session_start, NOW())');
		expect(query).not.toContain('Date.now');
	});

	it('rejects invalid user ids', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(admin);

		const res = await GET(
			makeRequest('http://localhost/api/user-status?user_id=abc')
		);
		expect(res.status).toBe(400);
	});
});
