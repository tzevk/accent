/**
 * Company weekly-off policy: every Sunday plus the 2nd and 4th Saturdays
 * of the month (every other Saturday is a working day).
 *
 * Single source of truth for the rule (see ADR-0004); attendance marking,
 * leave approval, and reports all consume this predicate. Dates are
 * 'YYYY-MM-DD'; anything else returns false. Weekdays resolve in UTC so
 * the answer never shifts with server timezone.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isWeeklyOff(date: string): boolean {
	if (!DATE_RE.test(date)) return false;
	const day = Number(date.slice(8, 10));
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	// Guard against e.g. 2026-02-31 normalising into March.
	if (parsed.toISOString().slice(0, 10) !== date) return false;
	const weekday = parsed.getUTCDay();
	if (weekday === 0) return true;
	if (weekday !== 6) return false;
	// 2nd/4th Saturday = the Saturday of the 2nd/4th week of the month.
	const saturdayOfMonth = Math.ceil(day / 7);
	return saturdayOfMonth === 2 || saturdayOfMonth === 4;
}
