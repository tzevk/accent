/**
 * Attendance report cell rendering decisions — pure, no React, no DB.
 *
 * Two independent signals drive one cell and neither overwrites the other:
 *
 *  1. The **authored status** — a human marked this employee-day in
 *     `employee_attendance`. It is a claim, not a measurement: no row means
 *     "nothing was authored", never "Present".
 *  2. The **measured effort** — Logged Hours (`@/lib/logged-hours`) and
 *     Punches (`@/lib/time-present` / `@/lib/punch`). These are evidence.
 *
 * Muting is derived from the data, never from the calendar alone: a Weekly
 * Off or holiday is muted only when the employee has neither Logged Hours nor
 * Punches on it. A billed-effort report must surface real weekend work, so a
 * non-working day carrying evidence renders as a regular working day.
 *
 * The weekly-off part of the calendar comes from `isWeeklyOff`
 * (`@/utils/weekly-off`, ADR-0004) — the same predicate payroll uses for
 * Basis Hours. The holiday part is injected: the caller queries
 * `holiday_master` for ACTIVE, NON-OPTIONAL rows (payroll's
 * `getHolidaysForMonth(month, false)`). An optional holiday is a working day;
 * when a caller passes one anyway, it is excluded rather than trusted.
 *
 * The measured Punch evidence arrives as two clock endpoints, not a duration:
 * In is the day's First Punch and Out is its Last Punch, both taken from the
 * one presence walk in `@/lib/time-present`. This module owns the three
 * display rules for them, so the page never re-derives a time. A day with no
 * Punch of its own shows neither line. A day with a First Punch and no Last
 * Punch shows In and the em dash, because one Punch is never a span. Whether
 * the Out is a real second endpoint is reported on `outIsSecondEndpoint`, so
 * a caller branches on that flag and never inspects the em dash itself.
 *
 * This module is pure: same input, same output, no mutation of the caller.
 */

import { PAID_LEAVE_CODES, UNPAID_CODES } from '@/lib/attendance-summary';
import { isWeeklyOff } from '@/utils/weekly-off';

/**
 * The Out on a day with no second endpoint. The report never invents a
 * checkout the device did not record.
 */
const EM_DASH = '—';

// ─── Badge tones ────────────────────────────────────────────────────

/**
 * Badge tones, taken from the AGENTS.md palette (draft slate, pending amber,
 * approved green, rejected red, active blue, on hold orange) so the grid
 * matches the rest of the product.
 */
export type CellTone = 'slate' | 'amber' | 'green' | 'red' | 'blue' | 'orange';

/**
 * Tailwind classes per tone — the page renders badges from this instead of
 * re-deriving a colour. Static lookup table: a `Record`, not a `Map`.
 */
export const CELL_TONE_CLASSES: Record<CellTone, string> = {
	slate: 'bg-slate-100 text-slate-800',
	amber: 'bg-amber-100 text-amber-800',
	green: 'bg-green-100 text-green-800',
	red: 'bg-red-100 text-red-800',
	blue: 'bg-blue-100 text-blue-800',
	orange: 'bg-orange-100 text-orange-800',
};

/** Label + tone for one authored status code. */
export interface StatusBadge {
	label: string;
	tone: CellTone;
}

/** A resolved badge: the normalised code plus its label and tone. */
export interface ResolvedStatusBadge extends StatusBadge {
	code: string;
}

/**
 * Human label for each leave code. The set of leave codes is NOT restated
 * here — it comes from the canonical `PAID_LEAVE_CODES` / `UNPAID_CODES` in
 * `@/lib/attendance-summary`, which decides the tone below. A code with no
 * label degrades to the code itself rather than throwing.
 */
const LEAVE_LABELS: Record<string, string> = {
	PL: 'Privilege Leave',
	CL: 'Casual Leave',
	SL: 'Sick Leave',
	EL: 'Earned Leave',
	LWP: 'Leave Without Pay',
	UL: 'Unpaid Leave',
};

/**
 * Label + badge tone per `employee_attendance.status` code — the page renders
 * straight from this and never re-derives a mapping.
 *
 * Credit-bearing days (Present, paid leave) are green; unpaid leave is orange
 * because it costs the employee money; Absent is red; Half Day and Overtime
 * Present are amber — partial or extra effort, flagged rather than lost;
 * Weekly Off is blue and Holiday is slate (neither is worked).
 *
 * Leave entries are spread in from the canonical code lists, so a leave code
 * added there cannot be silently missing from this table.
 */
export const ATTENDANCE_STATUS_BADGE: Record<string, StatusBadge> = {
	P: { label: 'Present', tone: 'green' },
	OT: { label: 'Overtime Present', tone: 'amber' },
	HD: { label: 'Half Day', tone: 'amber' },
	A: { label: 'Absent', tone: 'red' },
	WO: { label: 'Weekly Off', tone: 'blue' },
	H: { label: 'Holiday', tone: 'slate' },
	...Object.fromEntries(
		[...PAID_LEAVE_CODES, ...UNPAID_CODES].map((code) => [
			code,
			{
				label: LEAVE_LABELS[code] ?? code,
				// Paid leave credits the day; unpaid leave does not and costs pay.
				tone: UNPAID_CODES.includes(code) ? 'orange' : 'green',
			},
		])
	),
};

// ─── Status resolution ──────────────────────────────────────────────

/**
 * Badge for an authored status code, or null when nothing was authored or the
 * code is unknown. Never invents a status: an unrecognised code degrades to
 * "no authored status" rather than falling back to Present.
 */
export function resolveStatusBadge(
	status: string | null | undefined
): ResolvedStatusBadge | null {
	const code = typeof status === 'string' ? status.trim().toUpperCase() : '';
	if (!code) return null;
	const badge = ATTENDANCE_STATUS_BADGE[code];
	if (!badge) return null;
	return { code, label: badge.label, tone: badge.tone };
}

// ─── Cell input ─────────────────────────────────────────────────────

/** Active holiday dates for the month — a Set or array of 'YYYY-MM-DD'. */
export type HolidayDateSource =
	| ReadonlySet<string>
	| readonly string[]
	| null
	| undefined;

/** Everything one cell needs, supplied by the page from the month matrix. */
export interface AttendanceCellInput {
	/** 'YYYY-MM-DD'. */
	date: string;
	/** Authored `employee_attendance.status`, if a row exists for the day. */
	status?: string | null;
	/** Logged hours for the day (uncapped, ADR-0010). 0 or absent = none. */
	loggedHours?: number | string | null;
	/** Number of punch rows on the day. 0 or absent = none. */
	punchCount?: number | string | null;
	/**
	 * The day's First Punch, 'HH:MM', from the presence walk's span view.
	 * Null means the day holds no Punch of its own, because its only Punch
	 * became the previous day's merge tail.
	 */
	firstPunch?: string | null;
	/**
	 * The day's Last Punch, 'HH:MM'. Null when the walk reports no second
	 * endpoint, so a lone Punch never gets an invented Out.
	 */
	lastPunch?: string | null;
	/** True when the Last Punch belongs to the next calendar day. */
	lastPunchNextDay?: boolean | null;
	/** Active NON-OPTIONAL `holiday_master` dates for the month. */
	nonOptionalHolidays?: HolidayDateSource;
	/** Optional holidays — never non-working, even if also passed above. */
	optionalHolidays?: HolidayDateSource;
}

// ─── Cell decision ──────────────────────────────────────────────────

/** How one grid cell renders. */
export interface AttendanceCell {
	date: string;
	/** Normalised authored code (kept even when unrecognised), else null. */
	statusCode: string | null;
	/** Human label for the badge, or null when there is no badge. */
	statusLabel: string | null;
	/** Badge tone, or null when there is no badge. */
	statusTone: CellTone | null;
	loggedHours: number;
	hasLoggedHours: boolean;
	punchCount: number;
	hasPunches: boolean;
	/**
	 * The day's First Punch as a display label, or blank when the day holds
	 * no Punch of its own.
	 */
	inLabel: string;
	/**
	 * The day's Last Punch as a display label, the em dash when the day has
	 * no second endpoint, or blank when there is no In to pair it with.
	 */
	outLabel: string;
	/**
	 * True when the Out is a real second endpoint (the day's Last Punch),
	 * false when it is the em dash or blank. Callers branch on this instead
	 * of comparing the label against the em dash.
	 */
	outIsSecondEndpoint: boolean;
	/** True when the Out belongs to the next calendar day. */
	outIsNextDay: boolean;
	/** `isWeeklyOff(date)` (ADR-0004). */
	weeklyOff: boolean;
	/** Date is an active non-optional holiday and not an optional one. */
	holiday: boolean;
	/** Weekly Off or holiday. */
	nonWorking: boolean;
	/** Non-working day carrying real effort — renders as a working day. */
	workedNonWorkingDay: boolean;
	/** True only for a non-working day with no logged hours and no punches. */
	muted: boolean;
}

/** Coerce a DB-ish value to a finite number, or null when it cannot be one. */
function toFiniteNumber(value: unknown): number | null {
	if (value == null || value === '') return null;
	const num = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(num) ? num : null;
}

/**
 * Decide how one cell renders. Pure: reads only its input, mutates nothing.
 *
 * Muting rule: a Weekly Off or non-optional holiday is muted only when the day
 * has no logged hours and no punches. Punches are counted, never inferred: a
 * day with rows but no First Punch of its own still counts as a day with
 * Punches.
 *
 * Time rules: the endpoints arrive already decided by the presence walk, so
 * this function only formats them. A day with no First Punch shows no In and
 * no Out, however many punch rows it counts. A day with a First Punch takes
 * the Last Punch as its Out, or the em dash when there is none. The
 * `outIsSecondEndpoint` flag distinguishes a real Out from the em dash, so the
 * page branches on it and never tests the em dash itself.
 */
export function resolveAttendanceCell(
	input: AttendanceCellInput
): AttendanceCell {
	const date = input.date ?? '';
	const badge = resolveStatusBadge(input.status);
	const authoredCode =
		typeof input.status === 'string' ? input.status.trim().toUpperCase() : '';

	const loggedHours = toFiniteNumber(input.loggedHours) ?? 0;
	const punchCount = toFiniteNumber(input.punchCount) ?? 0;
	const hasLoggedHours = loggedHours > 0;
	const hasPunches = punchCount > 0;

	const firstPunch = input.firstPunch ?? null;
	const lastPunch = input.lastPunch ?? null;
	// A day with no Punch of its own has neither endpoint, however many rows
	// it counts. A day with one has no second endpoint, never an invented one.
	const inLabel = firstPunch == null ? '' : firstPunch;
	const outLabel = firstPunch == null ? '' : (lastPunch ?? EM_DASH);
	// The Out is a real second endpoint only when the walk reported a Last
	// Punch; the em dash is this module's own marker for its absence.
	const outIsSecondEndpoint = firstPunch != null && lastPunch != null;

	const weeklyOff = isWeeklyOff(date);
	// An optional holiday is a working day (payroll treats it as such for Basis
	// Hours), so an optional date wins over a stray non-optional entry.
	// `ReadonlySet` is type-only — a Set arrives as a real `Set`.
	const hasDate = (source: HolidayDateSource): boolean =>
		source != null &&
		(Array.isArray(source)
			? (source as readonly string[]).includes(date)
			: (source as ReadonlySet<string>).has(date));
	const holiday =
		hasDate(input.nonOptionalHolidays) && !hasDate(input.optionalHolidays);
	const nonWorking = weeklyOff || holiday;

	const hasEffort = hasLoggedHours || hasPunches;

	return {
		date,
		statusCode: authoredCode || null,
		statusLabel: badge ? badge.label : null,
		statusTone: badge ? badge.tone : null,
		loggedHours,
		hasLoggedHours,
		punchCount,
		hasPunches,
		inLabel,
		outLabel,
		outIsSecondEndpoint,
		outIsNextDay: input.lastPunchNextDay === true,
		weeklyOff,
		holiday,
		nonWorking,
		workedNonWorkingDay: nonWorking && hasEffort,
		muted: nonWorking && !hasEffort,
	};
}
