import { describe, it, expect } from 'vitest';
import { buildStats } from '@/app/reports/attendance-report/data-source';
import {
	MOCK_MONTH,
	mockArData,
	mockMonth,
	mockMonthResponse,
	mockMetaResponse,
} from '@/app/reports/attendance-report/mock-data';

/**
 * The fixture's promises, held. Two are structural (the grid and the
 * drill-down agree; the stats strip agrees with the real aggregator) and the
 * rest pin the scenario the month declares. Expected values are literals from
 * the spec, never recomputed the way the builder computes them.
 */

const data = mockMonth();

/** The bucket the page builds for one employee-day, from the month's Punches. */
function punchesFor(employeeId: number, date: string) {
	return data.punches.filter(
		(punch) => punch.employee_id === employeeId && punch.date === date
	);
}

describe('mockMonth', () => {
	it('holds every date of the month as a column, in order', () => {
		expect(data.days).toHaveLength(31);
		expect(data.days[0]).toBe('2026-08-01');
		expect(data.days[30]).toBe('2026-08-31');
		expect([...data.days].sort()).toEqual(data.days);
	});

	it('gives every employee one cell per day, so a quiet month is not a short one', () => {
		for (const employee of data.employees) {
			expect(employee.cells).toHaveLength(data.days.length);
			expect(employee.cells.map((cell) => cell.date)).toEqual(data.days);
		}
	});

	it('agrees with the drill-down on every punch count', () => {
		for (const employee of data.employees) {
			for (const cell of employee.cells) {
				expect(cell.punch_count).toBe(
					punchesFor(employee.id, cell.date).length
				);
			}
		}
	});

	it('counts a row total as the sum of its cells', () => {
		for (const employee of data.employees) {
			const summed = employee.cells.reduce(
				(total, cell) => total + cell.punch_count,
				0
			);
			expect(employee.punch_count).toBe(summed);
		}
	});

	it('publishes the stats the real route would publish', () => {
		expect(data.stats).toEqual(buildStats(data.punches));
	});

	it('lists each device serial once, sorted', () => {
		const distinct = [
			...new Set(data.punches.map((p) => p.serial_number)),
		].sort();
		expect(data.devices).toEqual(distinct);
		expect(data.devices).toHaveLength(4);
	});

	it('keeps every punch inside the declared month', () => {
		for (const punch of data.punches) {
			expect(punch.date.slice(0, 7)).toBe(MOCK_MONTH);
			expect(punch.log_date).toBe(`${punch.date} ${punch.time}`);
		}
	});
});

describe('mockMonth scenario', () => {
	const byId = (id: number) => data.employees.find((e) => e.id === id)!;
	const cellOf = (id: number, date: string) =>
		byId(id).cells.find((cell) => cell.date === date)!;

	it('shows a night shift that ends on the next day clock', () => {
		const night = cellOf(102, '2026-08-11');
		expect(night.first_punch).toBe('22:00');
		expect(night.last_punch).toBe('00:30');
		expect(night.last_punch_next_day).toBe(true);
		expect(night.punch_count).toBe(1);
	});

	it('leaves the day the merge emptied with no endpoints of its own', () => {
		const emptied = cellOf(102, '2026-08-12');
		expect(emptied.first_punch).toBeNull();
		expect(emptied.last_punch).toBeNull();
		expect(emptied.punch_count).toBe(1);
		expect(emptied.status).toBe('HD');
	});

	it('gives a lone punch an arrival and no departure', () => {
		const lone = cellOf(101, '2026-08-13');
		expect(lone.first_punch).toBe('09:15');
		expect(lone.last_punch).toBeNull();
		expect(lone.status).toBeNull();
	});

	it('keeps a middle tap inside the day span without moving an endpoint', () => {
		const middle = cellOf(101, '2026-08-05');
		expect(middle.punch_count).toBe(3);
		expect(middle.first_punch).toBe('09:05');
		expect(middle.last_punch).toBe('17:42');
	});

	it('carries an unenrolled employee with a row and no punches', () => {
		const unenrolled = byId(106);
		expect(unenrolled.smartoffice_code).toBeNull();
		expect(unenrolled.punch_count).toBe(0);
		expect(unenrolled.cells.every((cell) => cell.punch_count === 0)).toBe(true);
	});

	it('leaves a directionless day counted, with no direction to show', () => {
		const rows = punchesFor(103, '2026-08-18');
		expect(rows).toHaveLength(2);
		expect(rows.map((punch) => punch.direction)).toEqual([
			'unknown',
			'unknown',
		]);
		expect(cellOf(103, '2026-08-18').punch_count).toBe(2);
	});

	it('pools a two-device day into one employee-day', () => {
		const rows = punchesFor(103, '2026-08-25');
		expect(rows.map((punch) => punch.serial_number)).toEqual([
			'AA00000000000002',
			'AA00000000000002',
		]);
		expect(new Set(rows.map((punch) => punch.serial_number)).size).toBe(1);
	});

	it('puts effort on the holiday for one employee and not the other', () => {
		// Katherine works the non-optional holiday, so her cell does not mute;
		// Ada records nothing on it, so hers does. The muting rule itself is
		// proven in cell-status.test.ts — this pins only what the fixture declares.
		expect(cellOf(104, '2026-08-15').punch_count).toBe(2);
		expect(cellOf(104, '2026-08-15').logged_hours).toBe(8);
		expect(cellOf(101, '2026-08-15').punch_count).toBe(0);
		expect(cellOf(101, '2026-08-15').logged_hours).toBeNull();
	});

	it('reports an unmapped device code under a code no employee holds', () => {
		const unmapped = data.punches.filter((punch) => punch.employee_id === null);
		expect(unmapped).toHaveLength(3);
		expect(unmapped.map((punch) => punch.date)).toEqual([
			'2026-08-04',
			'2026-08-04',
			'2026-08-24',
		]);
		expect(unmapped.every((punch) => punch.employee_code === 'SO-999')).toBe(
			true
		);
		expect(data.stats.unmapped_punches).toBe(3);
	});
});

describe('mockArData', () => {
	it('builds the day states a caller declares, and defaults the rest', () => {
		const built = mockArData({
			month: '2026-02',
			employees: [
				{
					id: 1,
					employee_id: 'EMP100',
					name: 'Test Person',
					days: {
						'2026-02-02': { punches: ['09:00'], in: '09:00', out: null },
						// Outside the month: ignored, never rendered.
						'2026-03-01': { punches: ['09:00'] },
					},
				},
			],
		});

		expect(built.days).toHaveLength(28);
		const cells = built.employees[0].cells;
		expect(cells).toHaveLength(28);
		expect(cells[1].first_punch).toBe('09:00');
		expect(cells[1].last_punch).toBeNull();
		expect(built.punches).toHaveLength(1);
	});

	it('rejects a month it cannot turn into columns', () => {
		expect(() => mockArData({ month: 'August', employees: [] })).toThrow(
			/YYYY-MM/
		);
	});

	it('reports an unmapped device code as excluded from every employee', () => {
		const built = mockArData({
			month: '2026-08',
			employees: [],
			unmappedCodes: [
				{ code: 'SO-777', serial: 'CC1', times: { '2026-08-03': ['08:00'] } },
			],
		});

		expect(built.stats.total_punches).toBe(1);
		expect(built.stats.mapped_punches).toBe(0);
		expect(built.stats.unmapped_punches).toBe(1);
		expect(built.punches[0].employee_id).toBeNull();
		expect(built.punches[0].employee_code).toBe('SO-777');
	});
});

describe('envelopes', () => {
	it('answers the meta probe with the month and no matrix', () => {
		const response = mockMetaResponse();
		expect(response.success).toBe(true);
		expect(response.meta).toEqual({ latest_month: MOCK_MONTH, has_data: true });
		expect(response.data).toBeUndefined();
	});

	it('answers a month request with the whole matrix', () => {
		const response = mockMonthResponse();
		expect(response.success).toBe(true);
		expect(response.data?.month).toBe(MOCK_MONTH);
		expect(response.meta?.latest_month).toBe(MOCK_MONTH);
	});
});
