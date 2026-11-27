import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('@/utils/database', () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

import { fetchProjectStatusData } from './data-source';

describe('fetchProjectStatusData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps legacy aggregate quantities and derives Work Period quantities from effective entries', async () => {
		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM projects p')) {
				return Promise.resolve([
					[
						{
							project_id: 10,
							start_date: '2026-10-01',
							project_name: 'Legacy Project',
							project_code: 'P-010',
							client_name: 'Client',
							target_qty: 20,
							isDelete: 0,
						},
						{
							project_id: 20,
							start_date: '2026-09-01',
							project_name: 'Work Period Project',
							project_code: 'P-020',
							client_name: 'Client',
							target_qty: 20,
							isDelete: 0,
						},
					],
				]);
			}
			if (sql.includes('FROM logged_activity_assignments')) {
				return Promise.resolve([
					[
						{
							project_id: 10,
							user_id: 1,
							qty_completed: 7,
							work_period_entries: null,
							daily_entries: JSON.stringify([
								{ date: '2026-10-01', hours: 1, qty_done: 99 },
							]),
						},
						{
							project_id: 20,
							user_id: 2,
							qty_completed: 1,
							work_period_entries: '[]',
							daily_entries: JSON.stringify([
								{ date: '2026-10-01', hours: 2, qty_done: 2 },
								{ date: '2026-10-02', hours: 3, qty_done: 3 },
							]),
						},
					],
				]);
			}
			return Promise.resolve([[]]);
		});

		const rows = await fetchProjectStatusData();

		expect(rows).toEqual([
			{
				project_id: 10,
				project_name: 'Legacy Project',
				project_code: 'P-010',
				client_name: 'Client',
				people_assigned: 1,
				target_qty: 20,
				actual_qty: 7,
				balance: 13,
			},
			{
				project_id: 20,
				project_name: 'Work Period Project',
				project_code: 'P-020',
				client_name: 'Client',
				people_assigned: 1,
				target_qty: 20,
				actual_qty: 5,
				balance: 15,
			},
		]);
	});
});
