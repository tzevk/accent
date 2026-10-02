/**
 * Punch (biometric attendance_logs event) derivation — domain logic shared
 * by the Attendance Report (raw punch table) and the employee attendance
 * grid's GET /api/attendance merge (ADR-0007).
 *
 * A face-scan device routinely omits punch direction, so directions are
 * inferred by alternating per employee per day (first punch = in), with
 * near-simultaneous retry taps collapsed. Day-level in/out times and
 * payable overtime derive from the resolved sequence.
 */

export type PunchDirection = 'in' | 'out' | 'unknown';

// Gate constants live with the Payable Day math they belong to (ADR-0006)
// so the entry-modal rule and the summary rule can't drift apart.
import {
	STANDARD_HOURS_PER_DAY,
	PAYABLE_OT_GATE_HOURS,
} from './attendance-summary';

/** Normalize a raw device direction; blank/unknown values → 'unknown'. */
export function resolveDirection(
	raw: string | null | undefined
): PunchDirection {
	if (!raw) return 'unknown';
	const normalized = raw.trim().toLowerCase();
	if (normalized === 'in') return 'in';
	if (normalized === 'out') return 'out';
	return 'unknown';
}

/** The minimum a Punch row needs to be bucketed into an employee-day. */
export interface PunchBucketSource {
	employee_code: string;
	/** 'YYYY-MM-DD HH:mm:ss' */
	log_date: string;
}

interface DirectionSource extends PunchBucketSource {
	direction?: string | null;
}

/** 'YYYY-MM-DD HH:mm:ss' — the wall-clock shape a device row carries. */
const LOG_DATE_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Does `logDate` look like the device's `YYYY-MM-DD HH:mm:ss` wall clock?
 * A value that fails this has no chronological position; the bucketing
 * below sorts it last inside its day.
 */
export function isLogDateFormat(logDate: unknown): logDate is string {
	return typeof logDate === 'string' && LOG_DATE_SHAPE.test(logDate);
}

/**
 * Indices per `${employee_code}|${YYYY-MM-DD}`, sorted by punch time so the
 * alternating direction assignment follows the day's real sequence.
 *
 * Extracted so the direction-gated day-times path (ADR-0007) and the
 * direction-agnostic Time Present calculator bucket identically and cannot
 * drift apart.
 *
 * Ordering is the original inline sort — `a < b ? -1 : 1`, which returns 1
 * (never 0) for equal timestamps — so V8's stable sort keeps its existing
 * tie behaviour. A malformed `log_date` has no chronological position and
 * sorts last in its bucket, which keeps it from ever becoming the day's
 * first punch.
 */
export function bucketPunchIndicesByEmployeeDay<P extends PunchBucketSource>(
	punches: P[]
): Map<string, number[]> {
	const buckets = new Map<string, number[]>();
	punches.forEach((punch, index) => {
		const date = punch.log_date.slice(0, 10);
		const key = `${punch.employee_code}|${date}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(index);
		else buckets.set(key, [index]);
	});
	const wellFormed = punches.map((punch) => isLogDateFormat(punch.log_date));
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) => {
			if (wellFormed[a] !== wellFormed[b]) return wellFormed[a] ? -1 : 1;
			return punches[a].log_date < punches[b].log_date ? -1 : 1;
		});
	}
	return buckets;
}

/** Blank retry within this long after a kept punch inherits its direction. */
const TAP_COLLAPSE_SECONDS = 120;

/** 'YYYY-MM-DD HH:mm:ss' → seconds since midnight; TZ-free, same-day diffs only. */
function daySeconds(logDate: string): number {
	const time = logDate.slice(11).split(':').map(Number);
	return time[0] * 3600 + time[1] * 60 + time[2];
}

/**
 * Fill in missing directions by alternating in → out per employee per day.
 *
 * Face-scan units leave `AttDirection` blank, so the direction is inferred
 * from punch order: first punch of the day = in, next = out, and so on.
 * Device-provided directions are always kept. Input order is preserved —
 * only the `direction` field changes.
 *
 * Double-taps (a blank retry seconds after a punch — seen live: 15s apart)
 * inherit the previous punch's direction without advancing the alternation,
 * so one action never renders as an in/out pair. Explicit device directions
 * are never collapsed.
 */
export function applyInferredDirections<P extends DirectionSource>(
	punches: P[]
): (P & { direction: PunchDirection })[] {
	// Indices per (employee_code, date), sorted by punch time so the
	// alternating assignment follows the day's real sequence — the same
	// bucketing Time Present consumes, so the two paths cannot drift.
	const buckets = bucketPunchIndicesByEmployeeDay(punches);

	const result: (P & { direction: PunchDirection })[] = punches.map(
		(punch) => ({ ...punch, direction: 'unknown' })
	);
	for (const bucket of buckets.values()) {
		// Every punch in the day advances the position — a device-reported
		// 'in' followed by a blank punch yields 'out' for the blank.
		let position = 0;
		let keptTime = -1;
		let keptDirection: PunchDirection = 'unknown';
		for (const index of bucket) {
			const resolved = resolveDirection(punches[index].direction);
			if (resolved === 'unknown' && keptTime >= 0) {
				const time = daySeconds(punches[index].log_date);
				if (time - keptTime <= TAP_COLLAPSE_SECONDS) {
					result[index].direction = keptDirection;
					continue;
				}
			}
			const direction =
				resolved === 'unknown' ? (position % 2 === 0 ? 'in' : 'out') : resolved;
			result[index].direction = direction;
			keptTime = daySeconds(punches[index].log_date);
			keptDirection = direction;
			position++;
		}
	}
	return result;
}

export interface DayTimes {
	/** 'HH:MM' */
	in_time: string | null;
	/** 'HH:MM'; null when the day has no out punch — never invented */
	out_time: string | null;
}

/**
 * Day's in/out times from its punches: first `in` and last `out`.
 *
 * Applies direction inference internally (idempotent for punches that
 * already carry a direction), so callers can pass raw rows in any order.
 * A day with only `in` punches (forgot to check out) keeps `out_time`
 * blank rather than fabricating a checkout.
 */
export function deriveDayTimes(
	punches: {
		employee_code: string;
		log_date: string;
		direction?: string | null;
	}[]
): DayTimes {
	let firstIn: string | null = null;
	let lastOut: string | null = null;
	for (const punch of applyInferredDirections(punches)) {
		const time = punch.log_date.slice(11, 16); // 'HH:MM'
		if (punch.direction === 'in' && firstIn === null) firstIn = time;
		if (punch.direction === 'out') lastOut = time;
	}
	return { in_time: firstIn, out_time: lastOut };
}

/**
 * Payable overtime for a punch-derived day: worked hours beyond 8, kept
 * only when they exceed the 2h gate — the same rule the entry modal shows.
 * Returns 0 unless both times exist and the span is positive.
 */
export function deriveOvertime(
	inTime: string | null | undefined,
	outTime: string | null | undefined
): number {
	if (!inTime || !outTime) return 0;
	const toDecimal = (t: string): number | null => {
		const [h, m] = t.slice(0, 5).split(':').map(Number);
		if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
		return h + m / 60;
	};
	const inDec = toDecimal(inTime);
	const outDec = toDecimal(outTime);
	if (inDec == null || outDec == null) return 0;
	const worked = outDec - inDec;
	if (worked <= 0) return 0;
	const excess = worked - STANDARD_HOURS_PER_DAY;
	return excess > PAYABLE_OT_GATE_HOURS ? parseFloat(excess.toFixed(2)) : 0;
}
