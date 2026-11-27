import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiPermissions from '@/utils/api-permissions';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual = await importOriginal<typeof ApiPermissions>();
	return { ...actual, getCurrentUser: mockGetCurrentUser };
});

// Load after mocks so this HTTP contract receives the mocked dependencies.
const { GET } = await import('@/app/api/users/[id]/dashboard/route');
const legacyEntry = {
	date: '2026-10-25',
	hours: 7,
	remarks: 'Historical duration',
};
const workPeriodEntries = [
	{ date: '2026-10-26', hours: 2 },
	{ date: '2026-10-27', hours: '3' },
];
const effectiveEntries = JSON.stringify(workPeriodEntries);
const mergedEntries = JSON.stringify([legacyEntry, ...workPeriodEntries]);

describe('GET /api/users/[id]/dashboard Logged Hours', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			release: mockRelease,
		});
		mockGetCurrentUser.mockResolvedValue({
			id: 42,
			email: 'member@example.com',
			is_super_admin: 0,
			permissions: [],
			role_permissions: [],
			merged_permissions: [],
			field_permissions: {},
		});
	});

	it('uses effective totals in cards and decoded deadline rows', async () => {
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('GROUP BY status, priority')) {
				return [
					[
						{
							status: 'In Progress',
							priority: 'High',
							count: 3,
							total_estimated_hours: 10,
						},
					],
					[],
				];
			}
			if (sql.includes('as days_remaining')) {
				return [
					[
						{
							id: 'upcoming-work-period',
							status: 'In Progress',
							daily_entries: mergedEntries,
							legacy_daily_entries: JSON.stringify([legacyEntry]),
							work_period_entries: '[]',
							actual_hours: 99,
						},
					],
					[],
				];
			}
			if (sql.includes('COUNT(*) as total_active_activities')) {
				return [
					[
						{
							total_active_activities: 3,
							total_estimated_hours: 10,
							in_progress_hours: 10,
							avg_progress: 25,
						},
					],
					[],
				];
			}
			if (sql.includes('SELECT status, priority, daily_entries')) {
				return [
					[
						{
							status: 'In Progress',
							priority: 'High',
							daily_entries: effectiveEntries,
							work_period_entries: '[]',
							actual_hours: 99,
						},
						{
							status: 'In Progress',
							priority: 'High',
							daily_entries: JSON.stringify([{ date: '2026-10-24', hours: 4 }]),
							work_period_entries: null,
							actual_hours: '7.5',
						},
						{
							status: 'In Progress',
							priority: 'High',
							daily_entries: '{invalid json',
							work_period_entries: '[]',
							actual_hours: 99,
						},
					],
					[],
				];
			}
			return [[], []];
		});

		const response = await GET(
			new Request('http://localhost/api/users/42/dashboard'),
			{ params: Promise.resolve({ id: '42' }) }
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.activity_stats[0].total_actual_hours).toBe(12.5);
		expect(body.data.workload_summary.total_actual_hours).toBe(12.5);
		expect(body.data.upcoming_deadlines[0]).toMatchObject({
			actual_hours: 12,
			daily_entries: [
				legacyEntry,
				{ date: '2026-10-26', hours: 2 },
				{ date: '2026-10-27', hours: '3' },
			],
			legacy_daily_entries: [legacyEntry],
		});
		expect(mockRelease).toHaveBeenCalledOnce();
	});
});
