/**
 * Where the month matrix opens: today's column, the first day column after
 * the sticky Employee column.
 *
 * The matrix is one row per employee across a month's days, so only a handful
 * of day columns fit beside the sticky Employee column. Opening at the month's
 * first day hides the day the reader came for, so the matrix scrolls itself
 * once per month. Both arguments are measured from the rendered rects, because
 * a day column's width is content-driven; this module only decides the target
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
 * The scroll offset that puts today's column at the left edge of the day area
 * — immediately right of the sticky Employee column — given the measured
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

/**
 * True when today is one of the month's day columns. A month without today —
 * the report's default month is the latest one with logs, which is often last
 * month — has no target, so the caller leaves the matrix at its first day.
 */
export function hasTodayColumn(
	today: string,
	days: readonly string[]
): boolean {
	return days.includes(today);
}
