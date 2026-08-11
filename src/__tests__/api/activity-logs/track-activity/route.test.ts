import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + auth + logger before dynamic import (Vitest hoists mocks).
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

const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockUpdateScreenTime = vi.fn().mockResolvedValue(undefined);
const mockUpdateUserPresence = vi.fn().mockResolvedValue(undefined);

vi.mock('@/utils/activity-logger', () => ({
	logActivity: (...args) => mockLogActivity(...args),
	updateScreenTime: (...args) => mockUpdateScreenTime(...args),
	updateUserPresence: (...args) => mockUpdateUserPresence(...args),
}));

const { POST } = await import('@/app/api/activity-logs/track-activity/route');
const { getCurrentUser } = await import('@/utils/api-permissions');

const makeRequest = (
	body,
	url = 'http://localhost/api/activity-logs/track-activity'
) =>
	new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

beforeEach(() => {
	mockExecute.mockReset();
	mockRelease.mockReset();
	vi.mocked(getCurrentUser).mockReset();
	mockLogActivity.mockClear();
	mockUpdateScreenTime.mockClear();
	mockUpdateUserPresence.mockClear();
});

describe('POST /api/activity-logs/track-activity — auth', () => {
	it('rejects unauthenticated requests', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(null);

		const res = await POST(makeRequest({ actionType: 'other' }));
		expect(res.status).toBe(401);
		expect(mockLogActivity).not.toHaveBeenCalled();
	});

	it('accepts ANY authenticated user — including users with empty permissions', async () => {
		// Regression: the endpoint previously required PROFILE:read, which
		// 403'd users with empty permission arrays (e.g. role-less employees),
		// so their heartbeats/presence silently never arrived.
		vi.mocked(getCurrentUser).mockResolvedValue({
			id: 24,
			is_super_admin: false,
			role: null,
		});

		const res = await POST(
			makeRequest({
				actionType: 'other',
				resourceType: 'heartbeat',
				description: 'Session heartbeat',
				details: { isIdle: false, currentPage: '/dashboard' },
			})
		);
		expect(res.status).toBe(200);
		expect(mockLogActivity).toHaveBeenCalledTimes(1);
		expect(mockUpdateUserPresence).toHaveBeenCalledWith(24, {
			isIdle: false,
			currentPage: '/dashboard',
		});
	});

	it('always attributes activity to the session user, never the payload', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue({ id: 24 });

		// Client payload claims userId 999 — must be ignored.
		const res = await POST(
			makeRequest({
				userId: 999,
				actionType: 'status_change',
				resourceType: 'session',
				details: { status: 'idle' },
			})
		);
		expect(res.status).toBe(200);
		expect(mockUpdateUserPresence).toHaveBeenCalledWith(24, {
			isIdle: true,
			currentPage: null,
		});
		expect(mockUpdateUserPresence).not.toHaveBeenCalledWith(
			999,
			expect.anything()
		);
	});

	it('processes batched activities in order', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue({ id: 24 });

		const res = await POST(
			makeRequest({
				batch: true,
				activities: [
					{
						actionType: 'status_change',
						resourceType: 'session',
						details: { status: 'active' },
					},
					{
						actionType: 'view_page',
						resourceType: 'page',
						details: { page: '/leads', to: '/projects' },
					},
				],
			})
		);
		expect(res.status).toBe(200);
		expect(mockLogActivity).toHaveBeenCalledTimes(2);
		expect(mockUpdateUserPresence).toHaveBeenNthCalledWith(1, 24, {
			isIdle: false,
			currentPage: null,
		});
		expect(mockUpdateUserPresence).toHaveBeenNthCalledWith(2, 24, {
			isIdle: null,
			currentPage: '/projects', // `to` (destination) preferred over `page`
		});
	});
});
