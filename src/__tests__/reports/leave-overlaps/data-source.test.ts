import { describe, it, expect } from 'vitest';
import {
	buildMonthGrid,
	eligibleForOverlap,
	type OverlapApplication,
} from '@/app/reports/leave-overlaps/data-source';

const app = (overrides: Partial<OverlapApplication>): OverlapApplication => ({
	id: 1,
	user_id: 1,
	applicant_name: 'Test User',
	start_date: '2026-09-10',
	end_date: '2026-09-12',
	reason: 'Vacation',
	status: 'approved',
	...overrides,
});

describe('eligibleForOverlap', () => {
	it('counts pending and approved only', () => {
		expect(eligibleForOverlap('pending')).toBe(true);
		expect(eligibleForOverlap('approved')).toBe(true);
		expect(eligibleForOverlap('rejected')).toBe(false);
		expect(eligibleForOverlap('')).toBe(false);
	});
});

describe('buildMonthGrid', () => {
	it('flags days where two employees intersect and paints both cells', () => {
		const grid = buildMonthGrid(2026, 8, [
			app({
				id: 1,
				user_id: 1,
				applicant_name: 'Asha',
				start_date: '2026-09-10',
				end_date: '2026-09-12',
			}),
			app({
				id: 2,
				user_id: 2,
				applicant_name: 'Ravi',
				start_date: '2026-09-11',
				end_date: '2026-09-15',
			}),
		]);
		// September: day 11 -> index 10, day 12 -> index 11
		expect(grid.days[10]?.overlapping).toBe(true);
		expect(grid.days[10]?.overlapCount).toBe(2);
		expect(grid.days[9]?.overlapping).toBe(false);
		const asha = grid.rows.find((r) => r.userId === 1);
		expect(asha?.cells[10]?.status).toBe('approved');
		expect(asha?.cells[10]?.overlapping).toBe(true);
	});

	it('ignores rejected applications entirely', () => {
		const grid = buildMonthGrid(2026, 8, [
			app({ id: 1, user_id: 1, applicant_name: 'Asha', status: 'approved' }),
			app({ id: 2, user_id: 2, applicant_name: 'Ravi', status: 'rejected' }),
		]);
		expect(grid.days.some((d) => d.overlapping)).toBe(false);
		expect(grid.rows).toHaveLength(1);
	});

	it('clips month-spanning leaves and counts only clipped days', () => {
		const grid = buildMonthGrid(2026, 8, [
			app({
				id: 1,
				user_id: 1,
				applicant_name: 'Asha',
				start_date: '2026-08-30',
				end_date: '2026-09-02',
			}),
		]);
		expect(grid.rows[0]?.total).toBe(2);
		expect(grid.rows[0]?.cells[0]?.status).toBe('approved');
		expect(grid.rows[0]?.cells[2]?.status).toBe(null);
	});

	it('merges one employee into a single row with joined reasons', () => {
		const grid = buildMonthGrid(2026, 8, [
			app({
				id: 1,
				user_id: 1,
				applicant_name: 'Asha',
				start_date: '2026-09-03',
				end_date: '2026-09-04',
				reason: 'Trip',
			}),
			app({
				id: 2,
				user_id: 1,
				applicant_name: 'Asha',
				start_date: '2026-09-20',
				end_date: '2026-09-21',
				reason: 'Fever',
				status: 'pending',
			}),
		]);
		expect(grid.rows).toHaveLength(1);
		expect(grid.rows[0]?.total).toBe(4);
		expect(grid.rows[0]?.reasons).toBe('Trip; Fever');
		expect(grid.rows[0]?.cells[2]?.status).toBe('approved');
		expect(grid.rows[0]?.cells[19]?.status).toBe('pending');
	});

	it('omits employees with no leave in the month', () => {
		const grid = buildMonthGrid(2026, 8, [
			app({
				id: 1,
				user_id: 1,
				applicant_name: 'Asha',
				start_date: '2026-10-01',
				end_date: '2026-10-02',
			}),
		]);
		expect(grid.rows).toHaveLength(0);
		expect(grid.days).toHaveLength(30);
	});
});
