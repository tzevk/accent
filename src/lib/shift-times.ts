/**
 * The company's fixed shift, and the two remarks that read it.
 *
 * The Punch In and Punch Out tiles on the employee dashboard carry a "Late"
 * chip and an "OT" chip. Both chips are pure time comparisons, so the rule
 * lives here where it can be tested without rendering the dashboard — the
 * same seam #330 used for the punch-span helper.
 *
 * All times are `HH:MM` strings, the shape the punch endpoint and the
 * sign-in/logout fields already produce.
 */

/** Duty start. The nominal shift opens here. */
export const FIXED_IN_TIME = '09:00'; // 9:00 AM

/** Duty end. Past this, Punch Out carries the OT chip. */
export const FIXED_OUT_TIME = '17:30'; // 5:30 PM

/**
 * Lunch, 13:00 to 13:30. Subtracted from the shift for expected work.
 *
 * The band is movable in practice — it can start earlier or later than 13:00
 * — so this constant is the *usual* 30 minutes, not a promise about where the
 * break sits. It is only correct while the break falls inside the duty
 * window; a break that slides past duty end, or none at all, is not modelled.
 */
export const LUNCH_BREAK_MINS = 30;

/**
 * Arriving up to here is on time; the "Late" chip appears only past it.
 *
 * The grace band is 09:00–09:30. It is deliberately the Late remark's
 * threshold ONLY — `FIXED_IN_TIME` stays 09:00, so the expected-work figure
 * the Total Time tile reads (450 minutes) does not move with it.
 */
export const LATE_GRACE_TIME = '09:30'; // 9:30 AM

/** Minutes past midnight for an `HH:MM` string, or null if unparseable. */
function minutesOf(timeStr: string): number | null {
	if (!timeStr.includes(':')) return null;
	const [h, m] = timeStr.split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	return h * 60 + (m || 0);
}

/**
 * Expected work = (duty end − duty start) − lunch.
 * = (17:30 − 09:00) − 30m = 8h = 480 minutes.
 */
export const EXPECTED_WORK_MINS = (() => {
	const inMins = minutesOf(FIXED_IN_TIME) ?? 0;
	const outMins = minutesOf(FIXED_OUT_TIME) ?? 0;
	return outMins - inMins - LUNCH_BREAK_MINS;
})();

/** An empty, absent or unparseable time is never late. */
function isComparable(timeStr: string | null | undefined): timeStr is string {
	return typeof timeStr === 'string' && timeStr !== '' && timeStr.includes(':');
}

/**
 * Was this arrival late?
 *
 * True only strictly after the grace threshold, so 09:30 exactly reads as on
 * time and 09:31 does not. Times before duty start are not late — that is what
 * the early side of {@link isOvertime} describes.
 */
export function isLateLogin(timeStr: string | null | undefined): boolean {
	if (!isComparable(timeStr)) return false;
	const grace = minutesOf(LATE_GRACE_TIME) ?? 0;
	const mins = minutesOf(timeStr) ?? 0;
	return mins > grace;
}

/**
 * Is this time outside the fixed shift window — before duty start or after
 * duty end? The Punch Out tile reads it to show the OT chip.
 */
export function isOvertime(timeStr: string | null | undefined): boolean {
	if (!isComparable(timeStr)) return false;
	const mins = minutesOf(timeStr) ?? 0;
	const inMins = minutesOf(FIXED_IN_TIME) ?? 0;
	const outMins = minutesOf(FIXED_OUT_TIME) ?? 0;
	return mins < inMins || mins > outMins;
}
