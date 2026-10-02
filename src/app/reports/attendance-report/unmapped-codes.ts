/**
 * Unmapped device codes — the Punches that arrived under a biometric device
 * code which resolved to no Employee (issue #283).
 *
 * Pure: no database, no framework, no clock reads. The caller passes only the
 * selected month's Punches, so there is no date logic here by default; an
 * explicit `month` narrows further when a caller holds a wider range.
 *
 * Why the strip exists: attendance_logs rows are LEFT JOINed to employees, so
 * a code nobody is enrolled under lands with `employee_id IS NULL`. Those
 * Punches are real attendance the reader would expect in the grid, but they
 * have no Employee to key a row on and can therefore never appear there.
 * Naming them is what makes a short day total explainable rather than
 * mysterious. They must never *invent* presence either: because the grid is
 * keyed by Employee, an unmapped Punch is not aggregated into anyone's Time
 * Present — this module only counts and reports, it feeds no hours.
 */

/** The label a nameless device code is reported under. */
export const BLANK_CODE_LABEL = '(blank code)';

/** The subset of an `attendance_logs` row this aggregation reads. */
export interface PunchMappingLike {
	/** Smart Office employee code as the device reported it. */
	employee_code: string;
	/** Accent `employees.id`, or null/unset when the code matched nobody. */
	employee_id?: number | string | null;
	/** 'YYYY-MM-DD'; only read when an explicit month is supplied. */
	date?: string;
}

/** One unmapped device code and the Punches it carries. */
export interface UnmappedCodeCount {
	employee_code: string;
	punch_count: number;
}

export interface UnmappedCodesSummary {
	/** Punch count descending, then code ascending — the device-list order. */
	codes: UnmappedCodeCount[];
	/** Every unmapped Punch, i.e. the sum of `codes[].punch_count`. */
	total_punches: number;
	code_count: number;
}

/**
 * A Punch is mapped only when it names a real Employee row. `0`, `''` and
 * anything unparsable are treated as unmapped: they are what a failed
 * enrollment writes, and counting them as mapped would hide the shortfall
 * this strip exists to explain.
 */
export function isPunchMapped(punch: PunchMappingLike): boolean {
	const raw = punch.employee_id;
	if (raw === null || raw === undefined) return false;
	if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0;
	const trimmed = raw.trim();
	if (trimmed === '') return false;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) && parsed > 0;
}

/** Devices pad codes inconsistently; group the bare form. */
function normaliseCode(code: string | null | undefined): string {
	const trimmed = (code ?? '').trim();
	return trimmed === '' ? BLANK_CODE_LABEL : trimmed;
}

/**
 * Aggregate a month's Punches into the per-code unmapped counts the amber
 * strip renders. Returns an empty `codes` list when every Punch resolved.
 *
 * `options.month` ('YYYY-MM') restricts the input to that month; omit it to
 * aggregate exactly the Punches handed in.
 */
export function aggregateUnmappedCodes(
	punches: readonly PunchMappingLike[],
	options: { month?: string | null } = {}
): UnmappedCodesSummary {
	const month = options.month ?? null;
	const counts = new Map<string, number>();
	let total = 0;

	for (const punch of punches) {
		if (month && !(punch.date ?? '').startsWith(month)) continue;
		if (isPunchMapped(punch)) continue;
		const code = normaliseCode(punch.employee_code);
		counts.set(code, (counts.get(code) ?? 0) + 1);
		total++;
	}

	const codes = Array.from(counts, ([employee_code, punch_count]) => ({
		employee_code,
		punch_count,
	})).sort((a, b) =>
		a.punch_count === b.punch_count
			? a.employee_code.localeCompare(b.employee_code)
			: b.punch_count - a.punch_count
	);

	return { codes, total_punches: total, code_count: codes.length };
}
