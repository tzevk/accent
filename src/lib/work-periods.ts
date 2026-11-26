const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;
const IST_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IST_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Parse an exact `YYYY-MM-DDTHH:mm` Asia/Kolkata wall-clock value. */
export function parseIstLocal(value: unknown): number | null {
	if (typeof value !== 'string') return null;

	const match = IST_LOCAL_PATTERN.exec(value);
	if (!match || match[0] !== value) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const utc = new Date(0);
	utc.setUTCFullYear(year, month - 1, day);
	utc.setUTCHours(hour, minute, 0, 0);

	if (
		utc.getUTCFullYear() !== year ||
		utc.getUTCMonth() !== month - 1 ||
		utc.getUTCDate() !== day ||
		utc.getUTCHours() !== hour ||
		utc.getUTCMinutes() !== minute
	) {
		return null;
	}

	return utc.getTime() - IST_OFFSET_MS;
}

/** Format epoch milliseconds as an exact IST `YYYY-MM-DDTHH:mm` value. */
export function formatIstLocal(ms: number): string {
	return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Return the Asia/Kolkata calendar date for epoch milliseconds. */
export function istDate(ms: number): string {
	return formatIstLocal(ms).slice(0, 10);
}

function istMidnight(date: string): number {
	const ms = parseIstLocal(`${date}T00:00`);
	if (ms === null) throw new RangeError(`Invalid IST date: ${date}`);
	return ms;
}

/** Return the Monday date for the ISO week containing an IST date. */
export function weekStartFor(date: string): string {
	const midnight = istMidnight(date);
	const weekday = new Date(midnight + IST_OFFSET_MS).getUTCDay();
	return shiftIstDate(date, -((weekday + 6) % 7));
}

/** Shift an IST calendar date by a whole number of days. */
export function shiftIstDate(date: string, days: number): string {
	if (!Number.isInteger(days)) {
		throw new RangeError('IST date shifts must use whole days');
	}

	const shifted = istDate(istMidnight(date) + days * DAY_MS);
	if (!IST_DATE_PATTERN.test(shifted)) {
		throw new RangeError('IST date shift is outside the supported range');
	}
	return shifted;
}

/** Check a finished period against the IST today/yesterday self-service window. */
export function isSelfServicePeriod(
	startMs: number,
	endMs: number,
	nowMs: number
): boolean {
	if (
		!Number.isFinite(startMs) ||
		!Number.isFinite(endMs) ||
		!Number.isFinite(nowMs) ||
		startMs >= endMs ||
		endMs > nowMs
	) {
		return false;
	}

	const today = istDate(nowMs);
	const yesterday = shiftIstDate(today, -1);
	const startDate = istDate(startMs);
	const endDate = istDate(endMs);

	return (
		(startDate === today || startDate === yesterday) &&
		(endDate === today || endDate === yesterday)
	);
}

/** Return elapsed seconds inside the half-open IST week beginning on Monday. */
export function workPeriodWeekSeconds(
	startMs: number,
	endMs: number,
	weekStart: string
): number {
	if (
		!Number.isFinite(startMs) ||
		!Number.isFinite(endMs) ||
		startMs >= endMs
	) {
		return 0;
	}

	const weekStartMs = istMidnight(weekStart);
	const weekEndMs = weekStartMs + 7 * DAY_MS;
	const clippedStart = Math.max(startMs, weekStartMs);
	const clippedEnd = Math.min(endMs, weekEndMs);

	return clippedEnd <= clippedStart ? 0 : (clippedEnd - clippedStart) / 1000;
}

export interface WorkPeriodDailyEntry {
	readonly date: string;
	readonly hours: number;
	readonly qty_done: number;
	readonly remarks: string;
}

export interface WorkPeriodDailyEntryInput {
	readonly startMs: number;
	readonly endMs: number;
	readonly quantity?: number | null;
	readonly dateCompleted?: string | null;
	readonly remarks?: string | null;
}

/** Attribute elapsed time to IST dates and quantity to Date Completed once. */
export function workPeriodDailyEntries({
	startMs,
	endMs,
	quantity,
	dateCompleted,
	remarks,
}: WorkPeriodDailyEntryInput): readonly WorkPeriodDailyEntry[] {
	if (
		!Number.isFinite(startMs) ||
		!Number.isFinite(endMs) ||
		startMs >= endMs
	) {
		return [];
	}

	const completedDate = dateCompleted || istDate(endMs);
	istMidnight(completedDate);
	const qty =
		typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : 0;
	const note = remarks ?? '';
	const entries: WorkPeriodDailyEntry[] = [];
	let quantityCredited = false;
	let cursor = startMs;

	while (cursor < endMs) {
		const date = istDate(cursor);
		const nextMidnight = istMidnight(shiftIstDate(date, 1));
		const segmentEnd = Math.min(endMs, nextMidnight);
		const creditsQuantity = date === completedDate;
		entries.push({
			date,
			hours: (segmentEnd - cursor) / (60 * 60 * 1000),
			qty_done: creditsQuantity ? qty : 0,
			remarks: note,
		});
		quantityCredited ||= creditsQuantity;
		cursor = segmentEnd;
	}

	if (qty !== 0 && !quantityCredited) {
		const quantityEntry: WorkPeriodDailyEntry = {
			date: completedDate,
			hours: 0,
			qty_done: qty,
			remarks: note,
		};
		if (completedDate < entries[0].date) entries.unshift(quantityEntry);
		else entries.push(quantityEntry);
	}

	return entries;
}
