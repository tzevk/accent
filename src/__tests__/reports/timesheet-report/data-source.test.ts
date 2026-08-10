import { describe, it, expect } from 'vitest';
import {
	statusKind,
	hoursForStatus,
	weekdayFor,
	dayTypeFor,
	buildDays,
	buildSummary,
	monthLabel,
	buildProjectRows,
	computeMonthlyHours,
	buildScreenTime,
} from '@/app/reports/timesheet-report/data-source';

describe('statusKind', () => {
	it('classifies working statuses', () => {
		expect(statusKind('P')).toBe('present');
		expect(statusKind('p')).toBe('present');
		expect(statusKind('OT')).toBe('present'); // OT days still count as present
		expect(statusKind('HD')).toBe('half_day');
	});

	it('classifies non-working statuses', () => {
		expect(statusKind('WO')).toBe('weekly_off');
		expect(statusKind('H')).toBe('holiday');
		expect(statusKind('A')).toBe('absent');
		expect(statusKind('PL')).toBe('leave');
		expect(statusKind('CL')).toBe('leave');
		expect(statusKind('SL')).toBe('leave');
		expect(statusKind('LWP')).toBe('leave');
	});

	it('falls back for empty or unknown values', () => {
		expect(statusKind(null)).toBe('other');
		expect(statusKind(undefined)).toBe('other');
		expect(statusKind('')).toBe('other');
		expect(statusKind('XYZ')).toBe('other');
	});
});

describe('hoursForStatus', () => {
	it('credits the standard working hours for present days', () => {
		expect(hoursForStatus('P')).toBe(8);
		expect(hoursForStatus('OT')).toBe(8);
	});

	it('credits half-day hours for half days', () => {
		expect(hoursForStatus('HD')).toBe(4);
	});

	it('credits zero for non-working days', () => {
		expect(hoursForStatus('WO')).toBe(0);
		expect(hoursForStatus('H')).toBe(0);
		expect(hoursForStatus('A')).toBe(0);
		expect(hoursForStatus('PL')).toBe(0);
		expect(hoursForStatus(null)).toBe(0);
	});

	it('honours custom settings', () => {
		expect(
			hoursForStatus('P', { standard_working_hours: 9, half_day_hours: 4.5 })
		).toBe(9);
		expect(
			hoursForStatus('HD', { standard_working_hours: 9, half_day_hours: 4.5 })
		).toBe(4.5);
	});
});

describe('weekdayFor', () => {
	it('resolves weekdays from YYYY-MM-DD', () => {
		expect(weekdayFor('2026-05-01')).toBe('Fri'); // matches the reference timesheet
		expect(weekdayFor('2026-05-03')).toBe('Sun');
		expect(weekdayFor('2026-05-25')).toBe('Mon');
		expect(weekdayFor('2026-03-28')).toBe('Sat');
		expect(weekdayFor('bogus')).toBe('');
	});
});

describe('dayTypeFor', () => {
	it('gives holidays priority over weekly offs', () => {
		expect(dayTypeFor('2026-05-01', new Set(['2026-05-01']), false)).toBe(
			'holiday'
		);
		expect(dayTypeFor('2026-05-02', new Set(['2026-05-01']), true)).toBe(
			'weekly_off'
		);
		expect(dayTypeFor('2026-05-04', new Set(), false)).toBe('working');
	});
});

describe('buildDays', () => {
	const holidays = [{ name: 'Maharashtra Day', date: '2026-05-01' }];

	it('always emits every day of the month, with null status when absent', () => {
		const days = buildDays('2026-05', [], holidays);
		expect(days).toHaveLength(31);
		expect(days[0]).toMatchObject({
			date: '2026-05-01',
			day: 1,
			weekday: 'Fri',
			status: null,
		});
		expect(days[30]).toMatchObject({
			date: '2026-05-31',
			day: 31,
			weekday: 'Sun',
		});
	});

	it('maps attendance rows onto the grid with hours and day types', () => {
		const rows = [
			{
				date: '2026-05-01',
				status: 'H',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 1,
			},
			{
				date: '2026-05-02',
				status: 'WO',
				overtime_hours: 0,
				is_weekly_off: 1,
				is_holiday: 0,
			},
			{
				date: '2026-05-04',
				status: 'P',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-05-05',
				status: 'OT',
				overtime_hours: 1.5,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-05-06',
				status: 'HD',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
		];
		const days = buildDays('2026-05', rows, holidays);
		expect(days[0]).toMatchObject({
			status: 'H',
			day_type: 'holiday',
			hours: 0,
			holiday_name: 'Maharashtra Day',
		});
		expect(days[1]).toMatchObject({
			status: 'WO',
			day_type: 'weekly_off',
			hours: 0,
		});
		expect(days[3]).toMatchObject({
			status: 'P',
			day_type: 'working',
			hours: 8,
		});
		expect(days[4]).toMatchObject({
			status: 'OT',
			day_type: 'working',
			hours: 8,
			overtime_hours: 1.5,
		});
		expect(days[5]).toMatchObject({
			status: 'HD',
			day_type: 'working',
			hours: 4,
		});
	});

	it('treats unrecorded Saturdays/Sundays as weekly offs (template weekend)', () => {
		const days = buildDays('2026-05', [], holidays);
		expect(days[1]).toMatchObject({ status: null, day_type: 'weekly_off' }); // May 2, Sat
		expect(days[9]).toMatchObject({ status: null, day_type: 'weekly_off' }); // May 10, Sun
		expect(days[30]).toMatchObject({ status: null, day_type: 'weekly_off' }); // May 31, Sun
		// Unrecorded weekdays stay working.
		expect(days[3]).toMatchObject({ status: null, day_type: 'working' }); // May 4, Mon
	});

	it('respects recorded attendance over the weekend rule', () => {
		const rows = [
			{
				date: '2026-05-03',
				status: 'P',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			}, // Sunday, present
			{
				date: '2026-05-02',
				status: 'WO',
				overtime_hours: 0,
				is_weekly_off: 1,
				is_holiday: 0,
			},
			{
				date: '2026-05-08',
				status: 'WO',
				overtime_hours: 0,
				is_weekly_off: 1,
				is_holiday: 0,
			}, // Friday, company off
		];
		const days = buildDays('2026-05', rows, holidays);
		expect(days[2]).toMatchObject({
			status: 'P',
			day_type: 'working',
			hours: 8,
		}); // recorded Sunday P wins
		expect(days[1]).toMatchObject({ status: 'WO', day_type: 'weekly_off' });
		expect(days[7]).toMatchObject({ status: 'WO', day_type: 'weekly_off' }); // flagged Friday
	});

	it('returns [] for a malformed month', () => {
		expect(buildDays('not-a-month', [], [])).toEqual([]);
	});
});

describe('buildSummary', () => {
	it('aggregates counts and hours from the day matrix', () => {
		const rows = [
			{
				date: '2026-03-01',
				status: 'P',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-03-02',
				status: 'P',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-03-03',
				status: 'HD',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-03-04',
				status: 'WO',
				overtime_hours: 0,
				is_weekly_off: 1,
				is_holiday: 0,
			},
			{
				date: '2026-03-05',
				status: 'H',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 1,
			},
			{
				date: '2026-03-06',
				status: 'A',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-03-07',
				status: 'PL',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-03-08',
				status: 'OT',
				overtime_hours: 2,
				is_weekly_off: 0,
				is_holiday: 0,
			},
		];
		const days = buildDays('2026-03', rows, [
			{ name: 'Holi', date: '2026-03-05' },
		]);
		const summary = buildSummary(days);
		expect(summary.present_days).toBe(3); // P + P + OT
		expect(summary.half_days).toBe(1);
		expect(summary.weekly_offs).toBe(1);
		expect(summary.holidays).toBe(1);
		expect(summary.absent_days).toBe(1);
		expect(summary.leave_days).toBe(1);
		expect(summary.standard_hours).toBe(8 + 8 + 4 + 8);
		expect(summary.overtime_hours).toBe(2);
		expect(summary.total_hours).toBe(8 + 8 + 4 + 8 + 2);
	});

	it('handles an empty month', () => {
		const summary = buildSummary([]);
		expect(summary).toMatchObject({
			present_days: 0,
			half_days: 0,
			weekly_offs: 0,
			holidays: 0,
			absent_days: 0,
			leave_days: 0,
			standard_hours: 0,
			overtime_hours: 0,
			total_hours: 0,
		});
	});
});

describe('monthLabel', () => {
	it('formats YYYY-MM into "Month Year"', () => {
		expect(monthLabel('2026-05')).toBe('May 2026');
		expect(monthLabel('2026-01')).toBe('January 2026');
		expect(monthLabel('2026-13')).toBe('2026-13');
		expect(monthLabel('bogus')).toBe('bogus');
	});
});

describe('buildProjectRows', () => {
	const raw = [
		{
			project_id: 25,
			project_code: '25',
			project_name: '',
			activity_name: 'PID Markup',
			discipline_name: null,
			status: 'In Progress',
			estimated_hours: 10,
			actual_hours: 25,
			qty_assigned: 0,
			qty_completed: 0,
			start_date: null,
			due_date: '2026-04-30',
			daily_entries: JSON.stringify([
				{ date: '2026-04-13', qty_done: 0, hours: 8 },
				{ date: '2026-04-14', qty_done: 0, hours: 9 },
				{ date: '2026-04-14', qty_done: 0, hours: 1 }, // duplicate date sums
				{ date: '2026-05-02', qty_done: 0, hours: 8 }, // outside month
				{ date: '2026-04-15', qty_done: 0, hours: 0 }, // zero hours ignored
			]),
		},
		{
			project_id: 27,
			project_code: '553_03_2026',
			project_name: '',
			activity_name: 'Tank Data Sheet',
			discipline_name: null,
			status: 'On Hold',
			estimated_hours: 0,
			actual_hours: 0,
			qty_assigned: 0,
			qty_completed: 0,
			start_date: null,
			due_date: null,
			daily_entries: '[]', // no entries → empty row
		},
	];

	it('parses daily_entries into per-day hours, month-filtered', () => {
		const rows = buildProjectRows(raw, '2026-04');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			project_code: '25',
			activity_name: 'PID Markup',
			days: { '2026-04-13': 8, '2026-04-14': 10 },
			total_hours: 18,
		});
		expect(rows[1]).toMatchObject({
			project_code: '553_03_2026',
			days: {},
			total_hours: 0,
		});
	});

	it('handles malformed JSON and non-array payloads', () => {
		const bad = [{ ...raw[0], daily_entries: 'not json', project_code: 'X' }];
		const rows = buildProjectRows(bad, '2026-04');
		expect(rows[0].days).toEqual({});
		expect(rows[0].total_hours).toBe(0);

		const nullish = [{ ...raw[0], daily_entries: null, project_code: 'Y' }];
		expect(buildProjectRows(nullish, '2026-04')[0].days).toEqual({});
	});

	it('treats a malformed month as matching nothing', () => {
		const rows = buildProjectRows(raw, 'bogus');
		expect(rows[0].days).toEqual({});
	});
});

describe('computeMonthlyHours', () => {
	const days = buildDays(
		'2026-04',
		[
			{
				date: '2026-04-01',
				status: 'P',
				overtime_hours: 0,
				is_weekly_off: 0,
				is_holiday: 0,
			},
			{
				date: '2026-04-02',
				status: 'P',
				overtime_hours: 2,
				is_weekly_off: 0,
				is_holiday: 0,
			},
		],
		[],
		{ standard_working_hours: 8, half_day_hours: 4 }
	);

	it('prefers logged project hours when present', () => {
		const projects = [
			{
				project_id: 1,
				project_code: 'A',
				project_name: '',
				activity_name: 'X',
				discipline_name: null,
				status: null,
				estimated_hours: 0,
				actual_hours: 0,
				qty_assigned: 0,
				qty_completed: 0,
				start_date: null,
				due_date: null,
				days: { '2026-04-01': 6.5 },
				total_hours: 6.5,
			},
		];
		const hours = computeMonthlyHours(projects, days);
		expect(hours.source).toBe('project');
		expect(hours.daily).toEqual({ '2026-04-01': 6.5 });
		expect(hours.normal).toBe(6.5);
		expect(hours.overtime).toBe(2);
		expect(hours.total).toBe(8.5);
	});

	it('falls back to attendance-derived hours without project log', () => {
		const hours = computeMonthlyHours([], days);
		expect(hours.source).toBe('attendance');
		expect(hours.daily).toEqual({ '2026-04-01': 8, '2026-04-02': 8 });
		expect(hours.normal).toBe(16);
		expect(hours.overtime).toBe(2);
		expect(hours.total).toBe(18);
	});

	it('sums overlapping project days across rows', () => {
		const projects = [
			{
				project_id: 1,
				project_code: 'A',
				project_name: '',
				activity_name: 'X',
				discipline_name: null,
				status: null,
				estimated_hours: 0,
				actual_hours: 0,
				qty_assigned: 0,
				qty_completed: 0,
				start_date: null,
				due_date: null,
				days: { '2026-04-01': 4 },
				total_hours: 4,
			},
			{
				project_id: 2,
				project_code: 'B',
				project_name: '',
				activity_name: 'Y',
				discipline_name: null,
				status: null,
				estimated_hours: 0,
				actual_hours: 0,
				qty_assigned: 0,
				qty_completed: 0,
				start_date: null,
				due_date: null,
				days: { '2026-04-01': 4.5 },
				total_hours: 4.5,
			},
		];
		const hours = computeMonthlyHours(projects, days);
		expect(hours.daily['2026-04-01']).toBe(8.5);
		expect(hours.normal).toBe(8.5);
	});
});

describe('buildScreenTime', () => {
	it('aggregates active/idle seconds per day across linked users, month-filtered', () => {
		const rows = [
			{ date: '2026-08-10', active_time_seconds: 171, idle_time_seconds: 45 },
			{ date: '2026-08-10', active_time_seconds: 60, idle_time_seconds: 0 }, // second account
			{ date: '2026-08-09', active_time_seconds: 3600, idle_time_seconds: 300 },
			{ date: '2026-09-01', active_time_seconds: 9999, idle_time_seconds: 0 }, // outside month
			{ date: '2026-08-08', active_time_seconds: 0, idle_time_seconds: 120 }, // idle only, no active
		];
		const st = buildScreenTime(rows, '2026-08');
		expect(st.days).toEqual({ '2026-08-10': 231, '2026-08-09': 3600 });
		expect(st.total_active_sec).toBe(231 + 3600);
		expect(st.total_idle_sec).toBe(45 + 300 + 120);
		expect(st.present).toBe(true);
	});

	it('reports not present when there is no active time', () => {
		const st = buildScreenTime(
			[{ date: '2026-08-10', active_time_seconds: 0, idle_time_seconds: 500 }],
			'2026-08'
		);
		expect(st.days).toEqual({});
		expect(st.present).toBe(false);
		expect(st.total_active_sec).toBe(0);
		expect(st.total_idle_sec).toBe(500);
	});

	it('handles empty input and malformed months', () => {
		expect(buildScreenTime([], '2026-08')).toMatchObject({
			days: {},
			total_active_sec: 0,
			present: false,
		});
		expect(
			buildScreenTime(
				[{ date: '2026-08-10', active_time_seconds: 60 }],
				'bogus'
			).present
		).toBe(false);
	});
});
