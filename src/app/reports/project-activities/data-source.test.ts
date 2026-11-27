import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('@/utils/database', () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

import { fetchProjectActivitiesData } from './data-source';

describe('fetchProjectActivitiesData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('preserves legacy assignment totals but replaces stale Work Period aggregates with effective totals', async () => {
		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('FROM projects p')) {
				return Promise.resolve([
					[
						{
							project_id: 10,
							project_name: 'Project',
							project_code: 'P-010',
						},
					],
				]);
			}
			if (sql.includes('FROM users')) {
				return Promise.resolve([
					[
						{ id: 1, full_name: 'Legacy User' },
						{ id: 3, full_name: 'Invalid Entry User' },
						{ id: 2, full_name: 'Work Period User' },
					],
				]);
			}
			if (sql.includes('FROM employees')) return Promise.resolve([[]]);
			if (sql.includes('FROM project_activities')) return Promise.resolve([[]]);
			if (sql.includes('FROM logged_activity_assignments')) {
				return Promise.resolve([
					[
						{
							project_id: 10,
							activity_id: 7,
							activity_name: 'Engineering',
							user_id: 1,
							description: 'Legacy assignment',
							qty_assigned: 20,
							qty_completed: 11,
							actual_hours: 12,
							work_period_entries: null,
							daily_entries: JSON.stringify([
								{ date: '2026-10-01', hours: 4, qty_done: 3 },
							]),
						},
						{
							project_id: 10,
							activity_id: 7,
							activity_name: 'Engineering',
							user_id: 2,
							qty_completed: 999,
							actual_hours: 999,
							work_period_entries: '[]',
							daily_entries: JSON.stringify([
								{ date: '2026-10-01', hours: 6, qty_done: 5 },
							]),
						},
						{
							project_id: 10,
							activity_id: 7,
							activity_name: 'Engineering',
							user_id: 3,
							qty_completed: 999,
							actual_hours: 999,
							work_period_entries: '[]',
							daily_entries: JSON.stringify([
								{ date: 'invalid', hours: 100 },
								{ date: '2026-10-01', hours: -2 },
								{ date: '2026-10-02', hours: 0 },
								{ date: '2026-10-03', hours: '1.25' },
							]),
						},
					],
				]);
			}
			return Promise.resolve([[]]);
		});

		const projects = await fetchProjectActivitiesData();

		expect(projects).toHaveLength(1);
		const members = projects[0].activities[0].members!;
		const legacy = members.find((member) => member.user_id === '1');
		const workPeriod = members.find((member) => member.user_id === '2');
		const invalidEntry = members.find((member) => member.user_id === '3');

		expect(legacy).toMatchObject({
			description: 'Legacy assignment',
			qty_assigned: 20,
			qty_completed: 11,
			actual_hours: 12,
		});
		expect(workPeriod).toMatchObject({ qty_completed: 5, actual_hours: 6 });
		expect(invalidEntry).toMatchObject({
			qty_completed: 0,
			actual_hours: 1.25,
		});
	});
});
