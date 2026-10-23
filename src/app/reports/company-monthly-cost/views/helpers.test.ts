import { describe, it, expect } from 'vitest';
import { expenditureMonths } from '@/app/reports/company-monthly-cost/views/helpers';

/**
 * The Company Expenditure picker's months, newest first. Expected values are
 * literal month lists, never recomputed the way the helper computes them.
 */

describe('expenditureMonths', () => {
	it('offers the elapsed months of the current financial year when no month carries cost', () => {
		expect(
			expenditureMonths({ sourceMonths: [], currentMonth: '2026-10' })
		).toEqual([
			'2026-10',
			'2026-09',
			'2026-08',
			'2026-07',
			'2026-06',
			'2026-05',
			'2026-04',
		]);
	});

	it('rolls the financial year over at April: January stays in the year that started the April before', () => {
		expect(
			expenditureMonths({ sourceMonths: [], currentMonth: '2026-01' })
		).toEqual([
			'2026-01',
			'2025-12',
			'2025-11',
			'2025-10',
			'2025-09',
			'2025-08',
			'2025-07',
			'2025-06',
			'2025-05',
			'2025-04',
		]);
	});

	it('offers only April when the current month is the first of a financial year', () => {
		expect(
			expenditureMonths({ sourceMonths: [], currentMonth: '2026-04' })
		).toEqual(['2026-04']);
	});

	it('exposes the full financial year of a historical selection alongside the current one', () => {
		const months = expenditureMonths({
			sourceMonths: [],
			currentMonth: '2026-10',
			selectedMonth: '2026-01',
		});
		expect(months).toEqual([
			'2026-10',
			'2026-09',
			'2026-08',
			'2026-07',
			'2026-06',
			'2026-05',
			'2026-04',
			'2026-03',
			'2026-02',
			'2026-01',
			'2025-12',
			'2025-11',
			'2025-10',
			'2025-09',
			'2025-08',
			'2025-07',
			'2025-06',
			'2025-05',
			'2025-04',
		]);
	});

	it('adds no further year when the selection is inside the current financial year', () => {
		expect(
			expenditureMonths({
				sourceMonths: [],
				currentMonth: '2026-10',
				selectedMonth: '2026-05',
			})
		).toEqual([
			'2026-10',
			'2026-09',
			'2026-08',
			'2026-07',
			'2026-06',
			'2026-05',
			'2026-04',
		]);
	});

	it('keeps every month that carries cost, however old, deduplicated and newest first', () => {
		expect(
			expenditureMonths({
				sourceMonths: ['2026-08', '2022-05', '2026-08'],
				currentMonth: '2026-10',
				selectedMonth: '2026-09',
			})
		).toEqual([
			'2026-10',
			'2026-09',
			'2026-08',
			'2026-07',
			'2026-06',
			'2026-05',
			'2026-04',
			'2022-05',
		]);
	});

	it('generates no future month', () => {
		const months = expenditureMonths({
			sourceMonths: [],
			currentMonth: '2026-10',
		});
		expect(months).not.toContain('2026-11');
		expect(months).not.toContain('2026-12');
		expect(months).not.toContain('2027-01');
	});

	it('still preserves an explicit future source month or selection instead of dropping it', () => {
		const months = expenditureMonths({
			sourceMonths: ['2026-12'],
			currentMonth: '2026-10',
			selectedMonth: '2026-11',
		});
		expect(months.slice(0, 2)).toEqual(['2026-12', '2026-11']);
	});

	it('returns only the explicit months when the current month is missing', () => {
		expect(
			expenditureMonths({
				sourceMonths: ['2022-05'],
				currentMonth: null,
				selectedMonth: '2022-06',
			})
		).toEqual(['2022-06', '2022-05']);
		expect(
			expenditureMonths({
				sourceMonths: ['2020-01'],
				selectedMonth: '2026-01',
			})
		).toEqual(['2026-01', '2020-01']);
	});

	it('returns only the explicit months when the current month is not a calendar month', () => {
		expect(
			expenditureMonths({
				sourceMonths: ['2022-05'],
				currentMonth: 'not-a-month',
				selectedMonth: '2022-06',
			})
		).toEqual(['2022-06', '2022-05']);
	});
});
