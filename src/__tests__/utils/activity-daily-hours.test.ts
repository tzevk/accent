import { describe, it, expect, vi } from 'vitest';
import {
	MAX_DAY_HOURS,
	parseDailyEntries,
	sumHoursByDate,
	mergeHoursByDate,
	fetchExistingDayHours,
	validateDayHours,
} from '@/utils/activity-daily-hours';

describe('parseDailyEntries', () => {
	it('parses JSON strings and passes arrays through', () => {
		expect(parseDailyEntries('[{"date":"2026-08-07","hours":8}]')).toEqual([
			{ date: '2026-08-07', hours: 8 },
		]);
		expect(parseDailyEntries([{ date: '2026-08-07', hours: 8 }])).toEqual([
			{ date: '2026-08-07', hours: 8 },
		]);
	});

	it('returns [] for null, empty, malformed, and non-array payloads', () => {
		expect(parseDailyEntries(null)).toEqual([]);
		expect(parseDailyEntries(undefined)).toEqual([]);
		expect(parseDailyEntries('')).toEqual([]);
		expect(parseDailyEntries('{invalid json')).toEqual([]);
		expect(parseDailyEntries('{"a":1}')).toEqual([]);
		expect(parseDailyEntries('not an array')).toEqual([]);
	});
});

describe('sumHoursByDate', () => {
	it('sums hours per date across entries', () => {
		const entries = [
			{ date: '2026-08-07', hours: 10 },
			{ date: '2026-08-07', hours: 8 },
			{ date: '2026-08-08', hours: 4 },
		];
		expect(sumHoursByDate(entries)).toEqual({
			'2026-08-07': 18,
			'2026-08-08': 4,
		});
	});

	it('ignores non-numeric, zero, negative hours and missing dates', () => {
		expect(
			sumHoursByDate([
				{ date: '2026-08-07', hours: '8' },
				{ date: '2026-08-07', hours: 0 },
				{ date: '2026-08-07', hours: -2 },
				{ date: '2026-08-07', hours: 'abc' },
				{ date: '', hours: 8 },
				{ hours: 8 },
				null,
			])
		).toEqual({ '2026-08-07': 8 });
	});
});

describe('mergeHoursByDate', () => {
	it('adds later maps into the first', () => {
		expect(
			mergeHoursByDate(
				{ '2026-08-07': 10 },
				{ '2026-08-07': 8, '2026-08-08': 4 }
			)
		).toEqual({ '2026-08-07': 18, '2026-08-08': 4 });
	});
});

describe('fetchExistingDayHours', () => {
	const db = {
		execute: vi.fn(),
	};

	it('sums the user hours per date across all assignments', async () => {
		db.execute.mockResolvedValueOnce([
			[
				{
					id: 'a1',
					project_id: 1,
					activity_id: 'x',
					daily_entries: '[{"date":"2026-08-07","hours":8}]',
				},
				{
					id: 'a2',
					project_id: 1,
					activity_id: 'y',
					daily_entries: '[{"date":"2026-08-07","hours":10}]',
				},
				{ id: 'a3', project_id: 2, activity_id: 'z', daily_entries: null },
			],
			undefined,
		]);
		const byDate = await fetchExistingDayHours(db as never, 42);
		expect(db.execute).toHaveBeenCalledWith(
			expect.stringContaining(
				'SELECT id, project_id, activity_id, daily_entries'
			),
			[42]
		);
		expect(byDate).toEqual({ '2026-08-07': 18 });
	});

	it('excludes the assignment being replaced (by id or key)', async () => {
		const rows = [
			{
				id: 'row-1',
				project_id: 5,
				activity_id: 'a5',
				daily_entries: '[{"date":"2026-08-07","hours":10}]',
			},
			{
				id: 'row-2',
				project_id: 6,
				activity_id: 'a6',
				daily_entries: '[{"date":"2026-08-07","hours":2}]',
			},
		];
		db.execute.mockResolvedValueOnce([rows, undefined]); // byId call
		const byId = await fetchExistingDayHours(db as never, 42, {
			excludeAssignmentIds: ['row-1'],
		});
		expect(byId).toEqual({ '2026-08-07': 2 });

		db.execute.mockResolvedValueOnce([rows, undefined]); // byKey call
		const byKey = await fetchExistingDayHours(db as never, 42, {
			excludeAssignmentKeys: ['5-a5'],
		});
		expect(byKey).toEqual({ '2026-08-07': 2 });
	});
});

describe('validateDayHours', () => {
	it('returns null when within the cap', () => {
		expect(
			validateDayHours([{ date: '2026-08-07', hours: 8 }], {
				'2026-08-07': 4,
			})
		).toBeNull();
		expect(validateDayHours([{ date: '2026-08-07', hours: 10 }])).toBeNull();
		expect(validateDayHours([], {})).toBeNull();
	});

	it('rejects a day whose total exceeds MAX_DAY_HOURS', () => {
		const message = validateDayHours([{ date: '2026-08-07', hours: 8 }], {
			'2026-08-07': 10,
		});
		expect(message).not.toBeNull();
		expect(String(message)).toContain('2026-08-07');
		expect(String(message)).toContain(String(MAX_DAY_HOURS));
		expect(String(message)).toContain('18');
	});

	it('allows exactly MAX_DAY_HOURS and sums multi-entry payloads', () => {
		expect(
			validateDayHours(
				[
					{ date: '2026-08-07', hours: 6 },
					{ date: '2026-08-07', hours: 6 },
				],
				{}
			)
		).toBeNull();
		expect(
			validateDayHours(
				[
					{ date: '2026-08-07', hours: 6 },
					{ date: '2026-08-07', hours: 7 },
				],
				{}
			)
		).not.toBeNull();
	});
});
