/**
 * Which day column the month matrix treats as today, and where it opens.
 *
 * The matrix is one row per employee across a month's days, so only a handful
 * of day columns fit beside the sticky Employee column. Opening at the month's
 * first day hides the day the reader came for, so the matrix scrolls itself
 * once per month and marks today's column with its own semantic colour. Both
 * consumers — the scroll position and the column's styling — read the same
 * answer from here, so the column that opens under the reader's eye is always
 * the one wearing the today colour.
 *
 * The day columns' widths are content-driven, so the scroll target is measured
 * from the rendered rects in the page; this module only decides which date,
 * and the cases where there is none.
 */

/**
 * Today's local calendar date, 'YYYY-MM-DD' — the shape `days` and the day
 * headers carry. Local, not UTC: the matrix is a local wall-clock grid, so a
 * viewer east of Greenwich must not be handed yesterday before 05:30.
 */
export function todayDate(now: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The month's today column, or null when the month does not hold today.
 *
 * Null is the common case: the report's default month is the latest one with
 * logs, which is often last month, and a month the viewer picked by hand can
 * be any month at all. Null means "no today column" — the matrix then opens at
 * its first day and no column wears the today colour.
 */
export function todaysColumn(
	days: readonly string[],
	today: string = todayDate()
): string | null {
	return days.includes(today) ? today : null;
}

/**
 * The scroll offset that puts a column at the left edge of the day area —
 * immediately right of the sticky Employee column — given the measured
 * distance from the region's left edge to that column (`delta`, negative when
 * the column already sits under the sticky column).
 *
 * `currentScrollLeft` is added rather than ignored: the rects are measured
 * against the region as it currently is, so a measurement taken at a
 * non-zero scroll needs the offset carried forward.
 *
 * Returns 0 rather than a negative value: a month whose first days are still
 * visible must not scroll backwards.
 */
export function preScrollLeft(
	delta: number,
	currentScrollLeft: number
): number {
	return Math.max(0, currentScrollLeft + delta);
}
