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
 * - Pooled across devices: bucketing is by Employee + day only.
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
 */

import { bucketPunchIndicesByEmployeeDay, isLogDateFormat } from './punch';

/** A merged next-day punch may not stretch a day's presence past this. */
export const MAX_MERGED_SPAN_HOURS = 12;

/** The subset of an `attendance_logs` row Time Present reads. */
export interface PunchLike {
	employee_code: string;
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
 * Punches grouped per `${employee_code}|${YYYY-MM-DD}`, each bucket sorted
 * ascending by `log_date`, using the same key format and ordering as
 * `@/lib/punch` so the direction-gated day-times path and Time Present
 * cannot drift.
 */
export function bucketPunchesByEmployeeDay(
	punches: PunchLike[]
): Map<string, PunchLike[]> {
	const buckets = new Map<string, PunchLike[]>();
	for (const [key, indices] of bucketPunchIndicesByEmployeeDay(punches)) {
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
	// Merges consume punches; work on copies so the caller's buckets — and
	// therefore repeat calls — are untouched.
	const byKey = new Map<string, DayBucket>();
	for (const [key, bucket] of days) {
		if (bucket.length === 0) continue;
		byKey.set(key, { ...splitKey(key), punches: [...bucket] });
	}

	// Ascending key order is employee-then-date order (ISO dates sort
	// lexicographically), so every tail is consumed by the day before the
	// owning day is measured.
	const ordered = [...byKey.entries()].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0
	);

	const result: DayTimePresent[] = [];
	for (const [, day] of ordered) {
		// A day emptied by the previous day's merge has no presence of its own.
		if (day.punches.length === 0) continue;

		const firstMs = parseLogDateMs(day.punches[0].log_date);
		let lastMs = parseLogDateMs(day.punches[day.punches.length - 1].log_date);
		let merged = false;
		let mergeRefused = false;

		// Only a day without an own span depends on the merge, so only such
		// a day can be refused: a far next-day punch must not null a day
		// that already measured itself.
		const needsMerge = day.punches.length < 2;
		const following = nextDate(day.date);
		const next = following
			? byKey.get(`${day.employee_code}|${following}`)
			: undefined;
		const tailMs =
			next && next.punches.length > 0
				? parseLogDateMs(next.punches[0].log_date)
				: null;

		if (
			next &&
			tailMs !== null &&
			firstMs !== null &&
			lastMs !== null &&
			tailMs > lastMs
		) {
			if (tailMs - firstMs <= MAX_MERGED_SPAN_HOURS * MS_PER_HOUR) {
				next.punches.shift();
				lastMs = tailMs;
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

		result.push({ date: day.date, hours, merged, mergeRefused });
	}
	return result;
}

/** Time Present for raw Punch rows, in any order, across all employees. */
export function computeTimePresent(punches: PunchLike[]): DayTimePresent[] {
	return computeTimePresentForDays(bucketPunchesByEmployeeDay(punches));
}
