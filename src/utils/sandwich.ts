/**
 * Sandwich detector — pure date-key scan for bracketed Weekly Off / Holiday days.
 *
 * A Weekly Off (`WO`) or Holiday (`H`) run bracketed by leave on both sides
 * inside one continuous absence is a Sandwich (see ADR-0005, CONTEXT glossary).
 * Canonical: Sat leave + Sun WO + Mon leave → Sun deducted. Single-sided
 * adjacency never counts; Present / Absent / Half Day / OT / gaps break the run.
 *
 * Single source for the rule; attendance save (server + grid preview) consumes
 * this module. No DB dependency — input is an explicit status map, output is
 * the conversion map (date → leave code to write).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Leave codes that bracket a Sandwich and receive the converted days. */
export const SANDWICH_LEAVE_CODES: ReadonlySet<string> = new Set([
	'PL',
	'CL',
	'SL',
	'EL',
	'LWP',
	'UL',
]);

/** Off-day codes that can be sandwiched. */
export const SANDWICH_OFF_CODES: ReadonlySet<string> = new Set(['WO', 'H']);

function normalizeStatus(status: unknown): string {
	return typeof status === 'string' ? status.trim().toUpperCase() : '';
}

function isValidDateKey(date: string): boolean {
	if (!DATE_RE.test(date)) return false;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	return parsed.toISOString().slice(0, 10) === date;
}

/** Leave on either side of a potential Sandwich (HD never brackets). */
export function isSandwichLeaveStatus(status: unknown): boolean {
	return SANDWICH_LEAVE_CODES.has(normalizeStatus(status));
}

/** Weekly Off / Holiday cells that can be converted. */
export function isSandwichOffStatus(status: unknown): boolean {
	return SANDWICH_OFF_CODES.has(normalizeStatus(status));
}

function dayDiff(a: string, b: string): number {
	return (
		Math.round(
			(Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
		) || 0
	);
}

/**
 * Bracketed off-days mapped to the leave code to write.
 *
 * Linear scan over sorted day keys per employee: maximal consecutive calendar
 * runs containing only leave/off statuses are examined, and every off-day run
 * strictly inside such a run (leave on both sides) converts. When the two
 * bracketing leaves differ, the earlier (left) code wins so the result stays
 * deterministic.
 *
 * @param statusByDate explicit attendance statuses by YYYY-MM-DD
 * @returns conversions by date (empty when nothing is bracketed)
 */
export function getSandwichConversions(
	statusByDate: Record<string, string>
): Record<string, string> {
	const entries = Object.entries(statusByDate)
		.filter(([date]) => isValidDateKey(date))
		.map(([date, status]) => ({ date, status: normalizeStatus(status) }))
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const conversions: Record<string, string> = {};

	const flushRun = (run: Array<{ date: string; status: string }>): void => {
		let i = 0;
		while (i < run.length) {
			if (!SANDWICH_OFF_CODES.has(run[i].status)) {
				i += 1;
				continue;
			}
			let j = i;
			while (j < run.length && SANDWICH_OFF_CODES.has(run[j].status)) j += 1;
			// Off run is run[i..j-1]; bracketed only when strictly interior,
			// so both neighbours exist in the run and are leave by construction.
			if (i > 0 && j < run.length) {
				const target = run[i - 1].status;
				for (let k = i; k < j; k++) conversions[run[k].date] = target;
			}
			i = j;
		}
	};

	let run: Array<{ date: string; status: string }> = [];
	for (const entry of entries) {
		const isLeaveOrOff =
			SANDWICH_LEAVE_CODES.has(entry.status) ||
			SANDWICH_OFF_CODES.has(entry.status);
		const prev = run.length > 0 ? run[run.length - 1] : null;
		const consecutive = prev !== null && dayDiff(prev.date, entry.date) === 1;
		if (!isLeaveOrOff) {
			if (run.length > 0) {
				flushRun(run);
				run = [];
			}
			continue;
		}
		if (prev !== null && !consecutive) {
			flushRun(run);
			run = [];
		}
		run.push(entry);
	}
	if (run.length > 0) flushRun(run);

	return conversions;
}

/**
 * Bracketed off-day dates in ascending order (keys of getSandwichConversions).
 */
export function findSandwichedDays(
	statusByDate: Record<string, string>
): string[] {
	return Object.keys(getSandwichConversions(statusByDate)).sort();
}
