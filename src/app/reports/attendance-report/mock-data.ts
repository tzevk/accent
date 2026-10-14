/**
 * Attendance report fixtures — a full month of `ArData` with no database.
 *
 * What this is for: rendering and reasoning about the report without the
 * Smart Office webhook, and pinning the payload's internal agreements in a
 * test. It is a fixture. Nothing under `src/app/api/` reads it, and it is not
 * wired into the page.
 *
 * Two invariants the builder holds, because a fixture that breaks either is
 * worse than no fixture:
 *
 *  1. **The grid and the drill-down agree.** Every employee-day's
 *     `punch_count` equals the number of Punch rows this month carries for
 *     that Employee on that date — the bucket the page hands the cell modal.
 *  2. **`stats` matches what the real route publishes.** The aggregation is
 *     mirrored here rather than imported, because importing the data-source
 *     module pulls `@/utils/database` into whatever bundle reads this file.
 *     `mock-data.test.ts` asserts the mirror against `buildStats`, so the two
 *     cannot drift apart in silence.
 *
 * A day's Punch rows and the endpoints its cell shows are declared
 * separately on purpose. A cross-midnight night shift is stamped 22:00 on the
 * day it began and 00:30 on the next, and the merge consumes the second row:
 * the first day's cell shows `out` 00:30 with `outNextDay`, while the next
 * day's cell shows nothing and still counts its one Punch (ADR-0015). The two
 * facts live in different places, so a fixture has to be able to say both.
 *
 * Dates outside the declared month are ignored. Every date the month holds
 * still gets a cell, so an Employee with no declaration renders an empty
 * month rather than a short one.
 */

import { isWeeklyOff } from '@/utils/weekly-off';
import type { RosterDisclosure } from '@/lib/payroll-roster';
import type {
	ArCell,
	ArData,
	ArHolidays,
	ArMatrixRow,
	ArMeta,
	ArMonthPunch,
	ArStats,
} from './data-source';

// ─── Declaration ────────────────────────────────────────────────────

/** One employee-day, stated the way a fixture author thinks about it. */
export interface MockDaySpec {
	/**
	 * Device rows stamped on this date, 'HH:MM' ascending. They drive
	 * `punch_count`, the drill-down, the device list and the stats.
	 */
	punches?: readonly string[];
	/** First endpoint the cell shows. Defaults to the first Punch. */
	in?: string | null;
	/**
	 * Second endpoint the cell shows. `null` means the day has none.
	 * Defaults to the last Punch when the day holds two or more.
	 */
	out?: string | null;
	/** True when `out` carries the next calendar day's clock. */
	outNextDay?: boolean;
	/** Canonical Logged Hours, uncapped (ADR-0010). */
	loggedHours?: number | null;
	/** Authored `employee_attendance.status`, if a human marked the day. */
	status?: string | null;
	/** Device serial for this day's rows; defaults to the Employee's. */
	serial?: string;
	/** True when the device reported no direction for these rows. */
	directionless?: boolean;
}

/** One Employee down the left of the matrix. */
export interface MockEmployeeSpec {
	id: number;
	/** Accent's own employee code (`employees.employee_id`). */
	employee_id: string;
	name: string;
	department?: string | null;
	/** Smart Office code the Punches arrive under; null when unenrolled. */
	smartoffice_code?: string | null;
	/** Default device serial for this Employee's rows. */
	serial?: string;
	/** 'YYYY-MM-DD' → that day. A key the month does not hold is ignored. */
	days: Readonly<Record<string, MockDaySpec>>;
}

/** Punches a device reported under a code no Employee is enrolled under. */
export interface MockUnmappedCodeSpec {
	code: string;
	serial: string;
	/** 'YYYY-MM-DD' → the 'HH:MM' rows on that date. */
	times: Readonly<Record<string, readonly string[]>>;
}

export interface MockMonthOptions {
	/** 'YYYY-MM'. */
	month: string;
	employees: readonly MockEmployeeSpec[];
	holidays?: Partial<ArHolidays>;
	disclosure?: RosterDisclosure | null;
	unmappedCodes?: readonly MockUnmappedCodeSpec[];
}

// ─── Shapes ─────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/** Fallback serial, so a fixture can name devices only where it matters. */
const DEFAULT_SERIAL = 'DEMO000000000001';

/** Every 'YYYY-MM-DD' of a month, in order. */
function daysInMonth(month: string): string[] {
	const year = Number(month.slice(0, 4));
	const monthIndex = Number(month.slice(5, 7)) - 1;
	const dates: string[] = [];
	const cursor = new Date(Date.UTC(year, monthIndex, 1));
	while (cursor.getUTCMonth() === monthIndex) {
		dates.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return dates;
}

/**
 * Direction of the nth Punch of an employee-day, mirroring
 * `applyInferredDirections`: the first is an entry, then it alternates. A day
 * the device left directionless reports `unknown` throughout, which is the
 * drill-down's third badge.
 */
function inferredDirection(index: number, directionless: boolean) {
	if (directionless) return 'unknown' as const;
	return index % 2 === 0 ? ('in' as const) : ('out' as const);
}

/**
 * The stats strip's aggregation, mirrored from `buildStats` in the
 * data-source module. See the module header for why it is not imported.
 */
function mirrorStats(punches: readonly ArMonthPunch[]): ArStats {
	const days = new Set<string>();
	const codes = new Set<string>();
	const devices = new Set<string>();
	let mapped = 0;
	for (const punch of punches) {
		days.add(punch.date);
		codes.add(punch.employee_code);
		devices.add(punch.serial_number);
		if (punch.employee_id != null) mapped += 1;
	}
	return {
		total_punches: punches.length,
		mapped_punches: mapped,
		unmapped_punches: punches.length - mapped,
		distinct_days: days.size,
		distinct_employees: codes.size,
		distinct_devices: devices.size,
	};
}

// ─── Builder ────────────────────────────────────────────────────────

/** Build one month of `ArData` from declarations. */
export function mockArData(options: MockMonthOptions): ArData {
	if (!MONTH_RE.test(options.month)) {
		throw new Error(
			`mockArData: month must be 'YYYY-MM', got ${options.month}`
		);
	}

	const days = daysInMonth(options.month);
	const monthDays = new Set(days);
	const punches: ArMonthPunch[] = [];
	let nextPunchId = 1;

	const employees: ArMatrixRow[] = options.employees.map((spec) => {
		const employeeSerial = spec.serial ?? DEFAULT_SERIAL;

		const cells: ArCell[] = days.map((date) => {
			const day = spec.days[date];
			const rows = (day?.punches ?? []).filter((time) => TIME_RE.test(time));
			const serial = day?.serial ?? employeeSerial;
			const code = spec.smartoffice_code ?? spec.employee_id;
			const directionless = day?.directionless === true;

			// Both endpoints default off the rows, so an ordinary two-Punch
			// day needs no declaration at all. A declared `null` is an explicit
			// answer: it states the day has no second endpoint, or none of its
			// own. `undefined` means "not declared", which is why the check is
			// against undefined rather than a falsy test.
			const declaredIn = day?.in;
			const declaredOut = day?.out;
			const inPunch = declaredIn === undefined ? (rows[0] ?? null) : declaredIn;
			const outPunch =
				declaredOut === undefined
					? rows.length >= 2
						? rows[rows.length - 1]
						: null
					: declaredOut;

			for (const [index, time] of rows.entries()) {
				punches.push({
					id: nextPunchId,
					employee_code: code,
					log_date: `${date} ${time}:00`,
					date,
					time: `${time}:00`,
					serial_number: serial,
					employee_id: spec.id,
					direction: inferredDirection(index, directionless),
				});
				nextPunchId += 1;
			}

			return {
				date,
				first_punch: inPunch,
				last_punch: outPunch,
				last_punch_next_day: outPunch != null && day?.outNextDay === true,
				logged_hours: day?.loggedHours ?? null,
				status: day?.status ?? null,
				punch_count: rows.length,
			};
		});

		return {
			id: spec.id,
			employee_id: spec.employee_id,
			name: spec.name,
			department: spec.department ?? null,
			smartoffice_code: spec.smartoffice_code ?? null,
			punch_count: cells.reduce((total, cell) => total + cell.punch_count, 0),
			cells,
		};
	});

	for (const unmapped of options.unmappedCodes ?? []) {
		for (const [date, times] of Object.entries(unmapped.times)) {
			if (!monthDays.has(date)) continue;
			const rows = times.filter((time) => TIME_RE.test(time));
			for (const [index, time] of rows.entries()) {
				punches.push({
					id: nextPunchId,
					employee_code: unmapped.code,
					log_date: `${date} ${time}:00`,
					date,
					time: `${time}:00`,
					serial_number: unmapped.serial,
					employee_id: null,
					direction: inferredDirection(index, false),
				});
				nextPunchId += 1;
			}
		}
	}

	const stats = mirrorStats(punches);
	const devices = [
		...new Set(punches.map((punch) => punch.serial_number)),
	].sort();

	return {
		month: options.month,
		days,
		employees,
		stats,
		disclosure: options.disclosure ?? null,
		holidays: {
			non_optional: options.holidays?.non_optional ?? [],
			optional: options.holidays?.optional ?? [],
		},
		devices,
		punches,
	};
}

// ─── Scenario ───────────────────────────────────────────────────────

/** The month every fixture example uses: 31 days, one Independence Day. */
export const MOCK_MONTH = '2026-08';

/**
 * Working dates of the mock month — every date that is neither a Sunday nor
 * the 2nd or 4th Saturday (ADR-0004), read off the same predicate the report
 * uses.
 */
function workingDates(month: string): string[] {
	return daysInMonth(month).filter((date) => !isWeeklyOff(date));
}

/** A weekday's Punches and Logged Hours, before any row overrides it. */
const ORDINARY_DAY: MockDaySpec = {
	punches: ['09:05', '17:42'],
	loggedHours: 8,
	status: 'P',
};

/**
 * `ORDINARY_DAY` on every working date, then `overrides` wins per date. The
 * override replaces only the fields it names, so a special day still inherits
 * the ordinary Logged Hours unless it says otherwise.
 */
function withOverrides(
	month: string,
	overrides: Readonly<Record<string, MockDaySpec>>
): Record<string, MockDaySpec> {
	const days: Record<string, MockDaySpec> = {};
	for (const date of workingDates(month)) {
		days[date] = { ...ORDINARY_DAY, ...(overrides[date] ?? {}) };
	}
	// A declared day the working filter drops — a worked Sunday, say — keeps
	// its declaration verbatim. Ordinary Punches are not smuggled onto a day
	// nobody was expected to attend.
	for (const [date, day] of Object.entries(overrides)) {
		if (!(date in days)) days[date] = day;
	}
	return days;
}

/** A contract Employee the roster filter dropped, for the disclosure card. */
const MOCK_DISCLOSURE: RosterDisclosure = {
	considered_count: 7,
	roster_count: 6,
	excluded_count: 1,
	excluded_type_count: 1,
	excluded_status_count: 0,
	buckets: [{ reason: 'not_payroll_type', value: 'Contract', count: 1 }],
	excluded: [
		{
			id: 201,
			employee_id: 'EMP201',
			name: 'Barbara Liskov',
			employee_type: 'Contract',
			status: 'active',
			reason: 'not_payroll_type',
		},
	],
};

const MOCK_EMPLOYEES: readonly MockEmployeeSpec[] = [
	{
		id: 101,
		employee_id: 'EMP001',
		name: 'Ada Lovelace',
		department: 'Engineering',
		smartoffice_code: 'SO-101',
		serial: '84E0F42938231501',
		days: withOverrides(MOCK_MONTH, {
			// An accidental middle tap: three rows, and the day still measures
			// first to last.
			'2026-08-05': { punches: ['09:05', '12:30', '17:42'], loggedHours: 8 },
			// A lone Punch is an arrival with no departure.
			'2026-08-13': {
				punches: ['09:15'],
				in: '09:15',
				out: null,
				status: null,
				loggedHours: null,
			},
			// Unpaid leave: no Punches, a real badge, and it costs pay.
			'2026-08-14': { punches: [], loggedHours: null, status: 'LWP' },
			// A non-optional holiday with nothing recorded on it, so the cell
			// mutes. Katherine works the same date, which does not mute.
			'2026-08-15': { punches: [], loggedHours: null, status: null },
		}),
	},
	{
		id: 102,
		employee_id: 'EMP002',
		name: 'Grace Hopper',
		department: 'Engineering',
		smartoffice_code: 'SO-102',
		serial: '84E0F42938231501',
		days: withOverrides(MOCK_MONTH, {
			// A night shift that runs past midnight. The 00:30 row is stamped
			// on the 12th, but the merge consumed it into the 11th.
			'2026-08-11': {
				punches: ['22:00'],
				in: '22:00',
				out: '00:30',
				outNextDay: true,
			},
			// The day the night shift landed on: one Punch of its own, no
			// endpoints of its own, still counted.
			'2026-08-12': {
				punches: ['00:30'],
				in: null,
				out: null,
				loggedHours: 4,
				status: 'HD',
			},
			// An early finish against a full day's Logged Hours.
			'2026-08-20': { punches: ['09:30', '13:00'], loggedHours: 3.5 },
		}),
	},
	{
		id: 103,
		employee_id: 'EMP003',
		name: 'Alan Turing',
		department: 'Engineering',
		smartoffice_code: 'SO-103',
		serial: '84E0F42938231599',
		days: withOverrides(MOCK_MONTH, {
			// The device reported no direction at all, so every row carries the
			// drill-down's third badge.
			'2026-08-18': { directionless: true },
			// Two devices on one day, pooled into one span.
			'2026-08-25': { serial: 'AA00000000000002' },
		}),
	},
	{
		id: 104,
		employee_id: 'EMP004',
		name: 'Katherine Johnson',
		department: 'Finance',
		smartoffice_code: 'SO-104',
		serial: '84E0F42938231501',
		days: withOverrides(MOCK_MONTH, {
			// A Sunday that carries real effort, so it renders as a working day.
			'2026-08-16': {
				punches: ['10:02', '16:20'],
				loggedHours: 6,
				status: 'P',
			},
			// A non-optional holiday that carries effort, so it renders as a
			// working day too.
			'2026-08-15': { punches: ['09:40', '18:05'], loggedHours: 8 },
		}),
	},
	{
		id: 105,
		employee_id: 'EMP005',
		name: 'Radia Perlman',
		department: 'Finance',
		smartoffice_code: 'SO-105',
		serial: '84E0F42938231501',
		days: withOverrides(MOCK_MONTH, {
			'2026-08-03': {
				punches: ['09:00', '13:30'],
				loggedHours: 4,
				status: 'HD',
			},
			'2026-08-06': { punches: [], loggedHours: null, status: 'A' },
			'2026-08-07': { punches: [], loggedHours: null, status: 'SL' },
			'2026-08-19': {
				punches: ['08:50', '20:15'],
				loggedHours: 11,
				status: 'OT',
			},
			// An optional holiday is a working day, so this needs no override.
		}),
	},
	{
		// Enrolled nowhere, so the row reads "no device code" and every cell is
		// empty. Real: an Employee who never punched.
		id: 106,
		employee_id: 'EMP006',
		name: 'Margaret Hamilton',
		department: 'Human Resources',
		smartoffice_code: null,
		days: {},
	},
];

/** A device code nobody is enrolled under, for the amber strip. */
const MOCK_UNMAPPED_CODES: readonly MockUnmappedCodeSpec[] = [
	{
		code: 'SO-999',
		serial: 'BB00000000000003',
		times: {
			'2026-08-04': ['08:52', '17:31'],
			'2026-08-24': ['09:11'],
		},
	},
];

/** Build the mock month. `month` defaults to `MOCK_MONTH`. */
export function mockMonth(month: string = MOCK_MONTH): ArData {
	return mockArData({
		month,
		employees: MOCK_EMPLOYEES,
		holidays: { non_optional: ['2026-08-15'], optional: ['2026-08-27'] },
		disclosure: MOCK_DISCLOSURE,
		unmappedCodes: MOCK_UNMAPPED_CODES,
	});
}

/** The meta probe's answer: the latest month with logs. */
export function mockMeta(): ArMeta {
	return { latest_month: MOCK_MONTH, has_data: true };
}

// ─── Envelopes ──────────────────────────────────────────────────────

/**
 * The route's response envelope, mirrored so a preview can serve the page
 * without a server. Field-for-field the shape the page already reads.
 */
export interface MockApiResponse {
	success: boolean;
	data?: ArData | null;
	meta?: ArMeta;
	error?: string;
}

/** What the meta probe returns: the month, with no matrix. */
export function mockMetaResponse(): MockApiResponse {
	return { success: true, meta: mockMeta() };
}

/** What a month request returns: the whole matrix. */
export function mockMonthResponse(month: string = MOCK_MONTH): MockApiResponse {
	return { success: true, data: mockMonth(month), meta: mockMeta() };
}
