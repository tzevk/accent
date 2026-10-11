/**
 * Time Present — the office-presence duration for one Employee on one day
 * (issue #275), derived as the day's last Punch minus its first.
 *
 * Pure over Punch rows: no database, no framework, no clock reads.
 *
 * The rules, all deliberate:
 * - First → last, ignoring the punches in between, so an accidental middle
 *   punch can neither shorten nor lengthen the day.
 * - Direction-agnostic: real devices report none, so direction is not
 *   evidence and filtering on it would silently drop real punches.
 * - Pooled across devices and device codes: bucketing is by the attributed
 *   Employee's `employee_id` (stamped at ingest) when the Punch carries one,
 *   falling back to the device code — attribution, not the code, defines a
 *   day.
 * - Cross-midnight merge: the next day's chronologically-first punch joins
 *   this day when it is strictly after this day's last punch and within
 *   MAX_MERGED_SPAN_HOURS of this day's first. A merged punch is consumed,
 *   so no punch is ever credited to two days. Absolute elapsed time
 *   governs, never minutes-of-day.
 * - A single punch is uncomputable (`hours: null`), never zero: zero would
 *   read as "was there and left instantly".
 *
 * A day that needs the merge to be computable and whose candidate tail
 * fails the 12-hour rule is marked `mergeRefused` and stays null — an
 * implausible presence is never invented. A day that already has its own
 * computable span is not destroyed by a far next-day punch: an ordinary
 * workday followed by the next morning's check-in is ~24 hours from its
 * first punch, and refusing those would blank the whole report.
 *
 * One walk computes every view of a day, so no reader can hold a second
 * punch calculator:
 * - `computeTimePresent` / `computeTimePresentForDays` return the decision
 *   rows (`date`, `hours`, `merged`, `mergeRefused`) — one per day that
 *   still has a punch of its own once merges have consumed their tails.
 * - `computeDayPunchSpan` / `computeDayPunchSpans` return the same decision
 *   plus the day's clock endpoints and punch count, for a reader that shows
 *   times rather than durations. They also report a day whose only punch
 *   became the previous day's merge tail: such a day has no span of its own,
 *   but its punch still counts on its own date.
 */

import { bucketPunchIndicesByEmployeeDay, isLogDateFormat } from './punch';

/** A merged next-day punch may not stretch a day's presence past this. */
export const MAX_MERGED_SPAN_HOURS = 12;

/** The subset of an `attendance_logs` row Time Present reads. */
export interface PunchLike {
	employee_code: string;
	/**
	 * The Employee stamped at ingest — the attribution Time Present pools a
	 * day's Punches by. `null`/absent falls back to `employee_code`.
	 */
	employee_id?: number | string | null;
	/** 'YYYY-MM-DD HH:mm:ss' device wall clock, no timezone. */
	log_date: string;
}

export interface DayTimePresent {
	/** Calendar day the shift is credited to, 'YYYY-MM-DD'. */
	date: string;
	/** Hours, or null when the day is uncomputable. */
	hours: number | null;
	/** True when a next-day punch was merged into this day. */
	merged: boolean;
	/** True when a next-day punch exists but the merge was refused. */
	mergeRefused: boolean;
}

/**
 * One Employee-day's clock endpoints, on top of the day's Time Present
 * decision — what a reader that shows times instead of a duration needs.
 */
export interface DayPunchSpan extends DayTimePresent {
	/**
	 * Punches the day holds, counted from the rows themselves and never
	 * reduced by a merge: a punch consumed as the previous day's tail still
	 * counts on the day it was recorded.
	 */
	punchCount: number;
	/**
	 * The day's earliest surviving punch — where its measured span starts —
	 * or null when the day holds none of its own (its punch became the
	 * previous day's merge tail).
	 */
	firstPunch: PunchLike | null;
	/**
	 * The day's latest surviving punch, or the next-day punch that merged
	 * into the day when one joined, or null when the day holds none of its
	 * own.
	 */
	lastPunch: PunchLike | null;
	/**
	 * True when the day's span is measurable — two punches of its own, or its
	 * own punch plus a merged tail. A lone punch is never a zero-length span,
	 * so it stays false with `hours: null`.
	 */
	computable: boolean;
}

/** The Employee a day span is asked for: the ingest-stamped id, plus its date. */
export interface DayPunchSpanQuery {
	/** 'YYYY-MM-DD'. */
	date: string;
	/**
	 * The Employee stamped on the punch rows at ingest, which is the only
	 * attribution Time Present pools by. Rows with no stamped employee belong
	 * to no Employee, so such a day comes back with no punches at all.
	 */
	employeeId: number | string | null;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * `log_date` → epoch ms, reading the device wall clock as UTC so a
 * cross-midnight subtraction is genuine elapsed time and never a
 * minutes-of-day comparison. Malformed and impossible values return null;
 * this never throws.
 */
function parseLogDateMs(logDate: string): number | null {
	if (!isLogDateFormat(logDate)) return null;
	const ms = Date.parse(`${logDate.replace(' ', 'T')}Z`);
	return Number.isFinite(ms) ? ms : null;
}

/** 'YYYY-MM-DD' → the following calendar day, or null when malformed. */
function nextDate(date: string): string | null {
	const ms = Date.parse(`${date}T00:00:00Z`);
	return Number.isFinite(ms)
		? new Date(ms + MS_PER_DAY).toISOString().slice(0, 10)
		: null;
}

/** Split the shared `${employee_code}|${YYYY-MM-DD}` bucket key. */
function splitKey(key: string): { employee_code: string; date: string } {
	const separator = key.lastIndexOf('|');
	if (separator === -1) return { employee_code: '', date: key };
	return {
		employee_code: key.slice(0, separator),
		date: key.slice(separator + 1),
	};
}

/** An epoch-ms span → hours rounded to two places (ms/36000 is hours×100). */
function roundHours(ms: number): number {
	return Math.round(ms / 36_000) / 100;
}

/**
 * What a day's Punches pool by: the attributed Employee, else the device code.
 * The two namespaces are prefixed so a numeric device code can never collide
 * with an Employee id when a caller mixes attributed and raw Punches.
 */
function attributionKey(punch: PunchLike): string {
	const employeeId = punch.employee_id;
	return employeeId == null || employeeId === ''
		? `code:${punch.employee_code}`
		: `id:${String(employeeId)}`;
}

/**
 * Punches grouped per `${attribution key}|${YYYY-MM-DD}` — the ingest-stamped
 * Employee when present, else the device code — each bucket sorted ascending
 * by `log_date` through the shared bucketing, so the direction-gated
 * day-times path and Time Present cannot drift on ordering.
 */
export function bucketPunchesByEmployeeDay(
	punches: PunchLike[]
): Map<string, PunchLike[]> {
	const buckets = new Map<string, PunchLike[]>();
	for (const [key, indices] of bucketPunchIndicesByEmployeeDay(
		punches,
		attributionKey
	)) {
		buckets.set(
			key,
			indices.map((index) => punches[index])
		);
	}
	return buckets;
}

interface DayBucket {
	employee_code: string;
	date: string;
	punches: PunchLike[];
	/** Punches the day holds before any merge consumes one. */
	ownCount: number;
}

/** A walked day: the span view plus the bookkeeping the narrow view drops. */
interface DayWalkRow extends DayPunchSpan {
	/**
	 * Punches the day still holds after merges consumed tails. Zero means the
	 * day's only punch became the previous day's merged tail, so the day has
	 * no presence of its own: `computeTimePresent*` drops the row, while the
	 * span view keeps reporting its punch count.
	 */
	survivingPunches: number;
}

/**
 * Every employee-day of a pre-bucketed set, in one walk — the single
 * definition each reader shares.
 *
 * Buckets must be sorted ascending by `log_date` (as
 * `bucketPunchesByEmployeeDay` returns them). Rows come back ordered by
 * employee code, then date, one per day that holds at least one punch of its
 * own — a day emptied by a merge included, with no span of its own.
 */
function walkDayPunchSpans(days: Map<string, PunchLike[]>): DayWalkRow[] {
	// Merges consume punches; work on copies so the caller's buckets — and
	// therefore repeat calls — are untouched.
	const byKey = new Map<string, DayBucket>();
	for (const [key, bucket] of days) {
		if (bucket.length === 0) continue;
		byKey.set(key, {
			...splitKey(key),
			punches: [...bucket],
			ownCount: bucket.length,
		});
	}

	// Ascending key order is employee-then-date order (ISO dates sort
	// lexicographically), so every tail is consumed by the day before the
	// owning day is measured.
	const ordered = [...byKey.entries()].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0
	);

	const result: DayWalkRow[] = [];
	for (const [, day] of ordered) {
		// A day emptied by the previous day's merge has no presence of its
		// own: its punch is already credited to the day the shift began on.
		// It still reports how many punches it holds — a consumed tail counts
		// on its own date — but it neither measures itself nor reaches for a
		// tail of its own.
		if (day.punches.length === 0) {
			result.push({
				date: day.date,
				hours: null,
				merged: false,
				mergeRefused: false,
				punchCount: day.ownCount,
				firstPunch: null,
				lastPunch: null,
				computable: false,
				survivingPunches: 0,
			});
			continue;
		}

		const survivingPunches = day.punches.length;
		const firstPunch = day.punches[0];
		const lastOwnPunch = day.punches[day.punches.length - 1];
		const firstMs = parseLogDateMs(firstPunch.log_date);
		let lastMs = parseLogDateMs(lastOwnPunch.log_date);
		let merged = false;
		let mergeRefused = false;
		let lastPunch = lastOwnPunch;

		// Only a day without an own span depends on the merge, so only such
		// a day can be refused: a far next-day punch must not null a day
		// that already measured itself.
		const needsMerge = day.punches.length < 2;
		const following = nextDate(day.date);
		const next = following
			? byKey.get(`${day.employee_code}|${following}`)
			: undefined;
		const tailPunch = next && next.punches.length > 0 ? next.punches[0] : null;
		const tailMs = tailPunch ? parseLogDateMs(tailPunch.log_date) : null;

		if (
			next &&
			tailPunch &&
			tailMs !== null &&
			firstMs !== null &&
			lastMs !== null &&
			tailMs > lastMs
		) {
			if (tailMs - firstMs <= MAX_MERGED_SPAN_HOURS * MS_PER_HOUR) {
				next.punches.shift();
				lastMs = tailMs;
				lastPunch = tailPunch;
				merged = true;
			} else if (needsMerge) {
				mergeRefused = true;
			}
		}

		const effectivePunches = day.punches.length + (merged ? 1 : 0);
		const hours =
			!mergeRefused &&
			effectivePunches >= 2 &&
			firstMs !== null &&
			lastMs !== null
				? roundHours(lastMs - firstMs)
				: null;

		result.push({
			date: day.date,
			hours,
			merged,
			mergeRefused,
			punchCount: day.ownCount,
			firstPunch,
			lastPunch,
			computable: hours !== null,
			survivingPunches,
		});
	}
	return result;
}

/**
 * The narrow view of a walked window: one decision row per day that still
 * has a punch of its own once merges have consumed their tails. A day the
 * merge emptied holds no presence, so it is not a Time Present row — the
 * wide `computeDayPunchSpans` view is where its punches are still counted.
 */
function narrowDayTimePresent(rows: DayWalkRow[]): DayTimePresent[] {
	const result: DayTimePresent[] = [];
	for (const row of rows) {
		if (row.survivingPunches === 0) continue;
		result.push({
			date: row.date,
			hours: row.hours,
			merged: row.merged,
			mergeRefused: row.mergeRefused,
		});
	}
	return result;
}

/** The day with no punches at all: nothing to measure, nothing to credit. */
function emptyDayPunchSpan(date: string): DayPunchSpan {
	return {
		date,
		hours: null,
		merged: false,
		mergeRefused: false,
		punchCount: 0,
		firstPunch: null,
		lastPunch: null,
		computable: false,
	};
}

/**
 * Time Present for pre-bucketed employee-days. Buckets must be sorted
 * ascending by `log_date` (as `bucketPunchesByEmployeeDay` returns them).
 * Rows come back ordered by employee code, then date, one per day that has
 * a punch left after merges consume tails.
 */
export function computeTimePresentForDays(
	days: Map<string, PunchLike[]>
): DayTimePresent[] {
	return narrowDayTimePresent(walkDayPunchSpans(days));
}

/** Time Present for raw Punch rows, in any order, across all employees. */
export function computeTimePresent(punches: PunchLike[]): DayTimePresent[] {
	return narrowDayTimePresent(
		walkDayPunchSpans(bucketPunchesByEmployeeDay(punches))
	);
}

/**
 * Clock endpoints and punch count for every employee-day of a window of raw
 * Punch rows — in any order, across every employee the rows are stamped to.
 * Rows come back ordered by employee, then date.
 *
 * This is the wide view of the walk `computeTimePresent` projects: it keeps a
 * day whose punches a merge consumed, so a caller can still count that day's
 * punches, and it hands back the punches the hours are measured between.
 */
export function computeDayPunchSpans(punches: PunchLike[]): DayPunchSpan[] {
	const spans: DayPunchSpan[] = [];
	for (const row of walkDayPunchSpans(bucketPunchesByEmployeeDay(punches))) {
		spans.push({
			date: row.date,
			hours: row.hours,
			merged: row.merged,
			mergeRefused: row.mergeRefused,
			punchCount: row.punchCount,
			firstPunch: row.firstPunch,
			lastPunch: row.lastPunch,
			computable: row.computable,
		});
	}
	return spans;
}

/**
 * One Employee-day's clock endpoints, punch count and decision, from a set of
 * Punch rows that may be just that day's or the whole window around it: a
 * next-day punch of the same Employee joins when it is strictly after the
 * day's last punch and within MAX_MERGED_SPAN_HOURS of the day's first.
 *
 * A day the Employee is not stamped on holds no punches, so an unmapped punch
 * belongs to nobody's day — the same rule the Attendance report reads by.
 */
export function computeDayPunchSpan(
	punches: PunchLike[],
	day: DayPunchSpanQuery
): DayPunchSpan {
	if (day.employeeId == null) return emptyDayPunchSpan(day.date);

	// The day asked for is one Employee's, so pool by that Employee before
	// walking: the window may carry every employee's punches.
	const owner = `id:${String(day.employeeId)}`;
	const own = punches.filter((punch) => attributionKey(punch) === owner);
	const found = computeDayPunchSpans(own).find(
		(span) => span.date === day.date
	);
	return found ?? emptyDayPunchSpan(day.date);
}
