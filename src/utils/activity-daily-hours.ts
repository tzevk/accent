/**
 * Server-side daily-hour cap for `user_activity_assignments.daily_entries`.
 *
 * One person can log at most `MAX_DAY_HOURS` hours per calendar date across
 * ALL their assignments. The standard working day is 8h (surfaced in the
 * Timesheet report as normal hours, with the excess as overtime), so the cap
 * deliberately higher than 8h to keep legitimate OT days (10h shifts)
 * legal — it exists to stop physically impossible days (18h/20h/32h
 * double-logging, where the same actual hours get entered against several
 * assignments). Every writer of actual-hours `daily_entries` (PUT progress
 * updates, project-edit sync) must call `validateDayHours` before
 * persisting. The self-service add (users/[id]/activity-assignments PATCH)
 * intentionally does not: it records planned manhours for a whole activity,
 * not worked hours.
 */

export const MAX_DAY_HOURS = 12;

export interface DailyEntry {
	date?: string | null;
	hours?: number | string | null;
	[key: string]: unknown;
}

/** Safe parse of a `daily_entries` JSON blob (string or array). */
export function parseDailyEntries(raw: unknown): DailyEntry[] {
	if (raw == null) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return Array.isArray(parsed) ? (parsed as DailyEntry[]) : [];
	} catch {
		return [];
	}
}

/**
 * Sum hours per YYYY-MM-DD across a collection of entries. Non-numeric,
 * zero, and negative hours are ignored (matching how the reports treat
 * them); entries without a usable date are ignored.
 */
export function sumHoursByDate(entries: unknown): Record<string, number> {
	const byDate: Record<string, number> = {};
	for (const entry of parseDailyEntries(entries)) {
		const date = typeof entry?.date === 'string' ? entry.date : '';
		if (!date) continue;
		const hours = Number(entry?.hours);
		if (!Number.isFinite(hours) || hours <= 0) continue;
		byDate[date] = (byDate[date] || 0) + hours;
	}
	return byDate;
}

/** Merge per-date hour maps (later maps add into the first). */
export function mergeHoursByDate(
	...maps: Record<string, number>[]
): Record<string, number> {
	const merged: Record<string, number> = {};
	for (const map of maps) {
		for (const [date, hours] of Object.entries(map)) {
			merged[date] = (merged[date] || 0) + hours;
		}
	}
	return merged;
}

/**
 * Existing hours the user already logged per date, across every assignment
 * except the ones being rewritten right now (the update path excludes the
 * assignment whose entries are being replaced; the bulk-sync path excludes
 * assignments whose (project_id, activity_id) keys appear in the incoming
 * payload — their old entries are overwritten, not added to).
 */
export async function fetchExistingDayHours(
	db: {
		execute: (
			sql: string,
			params?: unknown[]
		) => Promise<[{ [key: string]: unknown }[], unknown]>;
	},
	userId: number,
	options: {
		excludeAssignmentIds?: Iterable<number | string>;
		excludeAssignmentKeys?: Iterable<string>;
	} = {}
): Promise<Record<string, number>> {
	const [rows] = await db.execute(
		'SELECT id, project_id, activity_id, daily_entries FROM user_activity_assignments WHERE user_id = ?',
		[userId]
	);
	const excludeIds = new Set(options.excludeAssignmentIds ?? []);
	const excludeKeys = new Set(options.excludeAssignmentKeys ?? []);
	const byDate: Record<string, number> = {};
	for (const row of rows) {
		const rowId = row.id as string | number | undefined;
		if (rowId != null && excludeIds.has(rowId)) continue;
		const key = `${row.project_id}-${row.activity_id}`;
		if (excludeKeys.has(key)) continue;
		const perDate = sumHoursByDate(row.daily_entries);
		for (const [date, hours] of Object.entries(perDate)) {
			byDate[date] = (byDate[date] || 0) + hours;
		}
	}
	return byDate;
}

/**
 * Check that the new entries, added to the user's already-logged hours,
 * keep every calendar date at or below `MAX_DAY_HOURS`. Returns a
 * human-readable error message on violation, or `null` when the payload is
 * within the cap.
 */
export function validateDayHours(
	newEntries: unknown,
	existingByDate: Record<string, number> = {}
): string | null {
	const totals = { ...existingByDate };
	for (const entry of parseDailyEntries(newEntries)) {
		const date = typeof entry?.date === 'string' ? entry.date : '';
		if (!date) continue;
		const hours = Number(entry?.hours);
		if (!Number.isFinite(hours) || hours <= 0) continue;
		totals[date] = (totals[date] || 0) + hours;
	}
	for (const [date, total] of Object.entries(totals)) {
		if (total > MAX_DAY_HOURS) {
			return (
				`Daily hours for ${date} would total ${Math.round(total * 100) / 100}h, ` +
				`exceeding the ${MAX_DAY_HOURS}h per-day limit. ` +
				'Hours are counted across all of your activities for the day.'
			);
		}
	}
	return null;
}
