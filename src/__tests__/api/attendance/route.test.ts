import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockRelease: vi.fn(),
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { EMPLOYEES: 'employees' },
	PERMISSIONS: { READ: 'read' },
}));

const { GET } = await import('@/app/api/attendance/route');

const db = {
	execute: mocks.mockExecute,
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
