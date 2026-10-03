/**
 * Canonical Logged Hours module — ADR-0010.
 *
 * `user_activity_assignments.daily_entries` is the single source of logged
 * project hours. The column arrives either as a JSON string (mysql2 longtext)
 * or as an already-parsed array depending on the driver/caller, so every
 * reader must tolerate both and drop malformed payloads rather than throw.
 * Logged hours are never capped: overtime counts (ADR-0010) and the payroll
 * path prices exactly what was logged.
 *
 * This module is pure: no DB, no framework imports.
 */

export interface LoggedEntry {
	/** calendar day, normalized to 'YYYY-MM-DD' */
	date: string;
	/** hours already coerced to a finite number > 0 */
	hours: number;
}

export interface DailyEntriesBlob {
	entries: LoggedEntry[];
	months: string[];
}

/**
 * One `daily_entries` member that is a plain object carrying a string `date`,
 * with the member itself kept so readers that also project sibling fields
 * (`qty_done`, `remarks`, lock flags) keep their own coercion. Readers that
 * only need logged hours should use {@link parseDailyEntries}, which adds the
 * positive-hours requirement and normalizes the day.
 */
export interface DailyEntryRecord {
	/** The member's `date`, verbatim. */
	date: string;
	/** The member verbatim, with every field it was written with. */
	entry: Record<string, unknown>;
}

/**
 * JSON-decode one payload and keep the members that are objects with a string
 * `date`. Same payload tolerance as {@link parseDailyEntries} (`null`/`''`/
 * `'[]'`/`'null'`/malformed JSON/non-array JSON yield `[]`, never throw) —
 * this is the single place the blob is decoded; the projections below decide
 * what each report counts.
 */
export function parseDailyEntryRecords(raw: unknown): DailyEntryRecord[] {
	let parsed: unknown;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return [];
		}
	} else {
		parsed = raw;
	}
	if (!Array.isArray(parsed)) return [];

	const records: DailyEntryRecord[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		if (typeof record.date !== 'string') continue;
		records.push({ date: record.date, entry: record });
	}
	return records;
}

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Coerce a raw `hours` value to a positive finite number, or null when the
 * value cannot represent logged time. Matches the historical parseFloat
 * tolerance (numbers and numeric strings, surrounding whitespace allowed).
 */
function toPositiveHours(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

/**
 * Parse one `daily_entries` payload into the entries that actually carry
 * logged time. Tolerates a JSON string (mysql2 longtext) or an already-parsed
 * array; `null`/`''`/`'[]'`/`'null'`/malformed JSON/non-array JSON all yield
 * `[]` and never throw. Each surviving entry needs a `YYYY-MM-DD`-prefixed
 * string date and hours parsing to a finite number > 0; everything else is
 * dropped. Dates are normalized to their `YYYY-MM-DD` day.
 */
export function parseDailyEntries(raw: unknown): LoggedEntry[] {
	const entries: LoggedEntry[] = [];
	for (const record of parseDailyEntryRecords(raw)) {
		const dateMatch = DATE_PREFIX.exec(record.date);
		if (!dateMatch) continue;
		const hours = toPositiveHours(record.entry.hours);
		if (hours === null) continue;
		entries.push({ date: dateMatch[1], hours });
	}
	return entries;
}

/**
 * Logged hours in one month across `daily_entries` payloads. `payloads` is an
 * array of blobs (JSON string or already-parsed array of entries), i.e.
 * `sumLoggedHoursForMonth([row.daily_entries], month)`. `month` is `'YYYY-MM'`;
 * entries from other months are ignored. Uncapped (ADR-0010) and rounded to
 * 2 dp — the total is rounded once at the end, matching the payroll path it
 * replaces.
 */
export function sumLoggedHoursForMonth(
	payloads: unknown[],
	month: string
): number {
	let total = 0;
	for (const payload of payloads) {
		for (const entry of parseDailyEntries(payload)) {
			if (!entry.date.startsWith(month)) continue;
			total += entry.hours;
		}
	}
	return Math.round(total * 100) / 100;
}

/**
 * Logged hours per calendar day for one month, keyed `'YYYY-MM-DD'`. Duplicate
 * dates accumulate; each day's total is rounded to 2 dp.
 */
export function hoursByDateForMonth(
	payloads: unknown[],
	month: string
): Record<string, number> {
	const byDate: Record<string, number> = {};
	for (const payload of payloads) {
		for (const entry of parseDailyEntries(payload)) {
			if (!entry.date.startsWith(month)) continue;
			byDate[entry.date] = (byDate[entry.date] || 0) + entry.hours;
		}
	}
	for (const date of Object.keys(byDate)) {
		byDate[date] = Math.round(byDate[date] * 100) / 100;
	}
	return byDate;
}
