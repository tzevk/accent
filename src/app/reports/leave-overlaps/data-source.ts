/**
 * Pure grid logic for the Leave Overlaps report.
 *
 * One employee can never hold two intersecting pending/approved applications
 * (POST /api/leaves rejects that with 409), so a "leave overlap" always means
 * two or more *different* employees out on the same calendar date. Rejected
 * applications are never absence and never count.
 *
 * Date math is UTC-day based: leave dates arrive as 'YYYY-MM-DD' strings
 * (`dateStrings: true`) and every comparison is an inclusive day-number
 * intersection — half-day flags are ignored for the grid.
 */

export interface OverlapApplication {
	id: number;
	user_id: number;
	applicant_name: string | null;
	start_date: string;
	end_date: string;
	reason: string | null;
	status: string;
}

export type LeaveCellStatus = 'approved' | 'pending' | null;

export interface OverlapCell {
	status: LeaveCellStatus;
	overlapping: boolean;
}

export interface OverlapRow {
	userId: number;
	name: string;
	cells: OverlapCell[];
	total: number;
	reasons: string;
}

export interface OverlapDay {
	iso: string;
	day: number;
	weekday: string;
	isWeekend: boolean;
	overlapCount: number;
	overlapping: boolean;
}

export interface MonthGrid {
	year: number;
	/** 0-based month */
	month: number;
	days: OverlapDay[];
	rows: OverlapRow[];
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Only live applications can collide. Rejected rows never count. */
export function eligibleForOverlap(status: string): boolean {
	return status === 'pending' || status === 'approved';
}

function parseDay(iso: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
	if (!m) return null;
	const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(day) ? null : Math.floor(day / DAY_MS);
}

function dayToIso(day: number): string {
	const d = new Date(day * DAY_MS);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function displayName(app: OverlapApplication): string {
	return app.applicant_name?.trim() || `User #${app.user_id}`;
}

/**
 * Builds one month grid: per-date overlap counts across distinct employees,
 * one merged row per employee present that month, totals clipped to the month.
 */
export function buildMonthGrid(
	year: number,
	month: number,
	applications: OverlapApplication[]
): MonthGrid {
	const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const monthStart = Math.floor(Date.UTC(year, month, 1) / DAY_MS);
	const monthEnd = monthStart + daysInMonth - 1;

	const days: OverlapDay[] = [];
	for (let i = 0; i < daysInMonth; i += 1) {
		const dayNum = monthStart + i;
		const date = new Date(dayNum * DAY_MS);
		const dow = date.getUTCDay();
		days.push({
			iso: dayToIso(dayNum),
			day: i + 1,
			weekday: WEEKDAYS[dow] ?? '',
			isWeekend: dow === 0 || dow === 6,
			overlapCount: 0,
			overlapping: false,
		});
	}

	const live = applications.filter((app) => {
		if (!eligibleForOverlap(app.status)) return false;
		const start = parseDay(app.start_date);
		const end = parseDay(app.end_date);
		return (
			start !== null &&
			end !== null &&
			end >= start &&
			end >= monthStart &&
			start <= monthEnd
		);
	});

	// Distinct employees per day — one employee paints a day once even with
	// adjacent applications (server 409 makes true same-user overlap impossible).
	const painters = days.map(() => new Set<number>());
	// ponytail: O(users × days) scan, yearly grids stay small; interval sweep if this ever scales
	for (const app of live) {
		const start = Math.max(parseDay(app.start_date) as number, monthStart);
		const end = Math.min(parseDay(app.end_date) as number, monthEnd);
		for (let d = start; d <= end; d += 1)
			painters[d - monthStart]?.add(app.user_id);
	}
	for (let i = 0; i < days.length; i += 1) {
		const count = painters[i]?.size ?? 0;
		const day = days[i];
		if (day) {
			day.overlapCount = count;
			day.overlapping = count >= 2;
		}
	}

	const byUser = new Map<number, OverlapApplication[]>();
	for (const app of live)
		byUser.set(app.user_id, [...(byUser.get(app.user_id) ?? []), app]);

	const rows: OverlapRow[] = [...byUser.entries()].map(([userId, apps]) => {
		const cells: OverlapCell[] = days.map(() => ({
			status: null,
			overlapping: false,
		}));
		for (const app of apps) {
			const status = app.status as LeaveCellStatus;
			const start = Math.max(parseDay(app.start_date) as number, monthStart);
			const end = Math.min(parseDay(app.end_date) as number, monthEnd);
			for (let d = start; d <= end; d += 1) {
				const cell = cells[d - monthStart];
				if (!cell) continue;
				// Approved wins defensively; same-user overlap can't occur via API.
				if (cell.status === null || status === 'approved') cell.status = status;
				cell.overlapping = days[d - monthStart]?.overlapping ?? false;
			}
		}
		const reasons = [
			...new Set(apps.map((a) => (a.reason ?? '').trim()).filter(Boolean)),
		].join('; ');
		return {
			userId,
			name: displayName(apps[0] as OverlapApplication),
			cells,
			total: cells.filter((c) => c.status !== null).length,
			reasons,
		};
	});
	rows.sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));

	return { year, month, days, rows };
}
