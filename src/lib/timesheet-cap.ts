/**
 * Client-safe per-project daily-hour capping for the Timesheet report.
 *
 * The monthly man-hours grid credits at most `standard_working_hours` per
 * day (the daily excess is surfaced separately as overtime). This helper
 * distributes that daily cap across the projects that logged time that day,
 * so the top per-project section of the grid never sums above the standard
 * working day. Pure and dependency-free: shared by the client page
 * (page.tsx) and the server Excel builder (excel-template.ts).
 */

export interface CapableProject {
	/** Hours per YYYY-MM-DD (raw logged hours) */
	days: Record<string, number>;
	/** Sum of `days` */
	total_hours: number;
}

const DEFAULT_STANDARD_HOURS = 8;

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

/**
 * Return new project objects whose `days` are capped so that, per day, the
 * rows sum to at most `standardHours` (default 8). When a day's logged
 * total exceeds the cap, each project's hours are scaled by
 * cap / total, keeping the ratio of time across projects; `total_hours` is
 * recomputed from the capped days. Days within the cap pass through
 * unchanged.
 */
export function capProjectDays<T extends CapableProject>(
	projects: T[],
	standardHours?: number
): T[] {
	const std =
		standardHours && standardHours > 0 ? standardHours : DEFAULT_STANDARD_HOURS;

	// Daily totals across all projects, so the cap applies to the day as a
	// whole, not per project.
	const dailyTotal: Record<string, number> = {};
	for (const project of projects) {
		for (const [date, hours] of Object.entries(project.days)) {
			dailyTotal[date] = (dailyTotal[date] || 0) + hours;
		}
	}

	return projects.map((project) => {
		const days: Record<string, number> = {};
		let totalHours = 0;
		for (const [date, hours] of Object.entries(project.days)) {
			const total = dailyTotal[date] || 0;
			const capped =
				total > std ? round2((hours * std) / total) : round2(hours);
			days[date] = capped;
			totalHours += capped;
		}
		return { ...project, days, total_hours: round2(totalHours) };
	});
}
