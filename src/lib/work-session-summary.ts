/**
 * Work Session summary — the day's observed browser spans, not attendance.
 *
 * A Work Session is only the browser's reported span (ADR-0033): not the
 * authenticated Session revocation acts on, not device-measured Time Present,
 * and not a Punch (ADR-0007). This module folds one day of Work Session rows
 * into the attendance panel's session fields from their SQL-read epochs —
 * never from stored `duration_minutes`, never from first-login minus one end.
 *
 * The database formats the HH:MM labels in its own session timezone and reads
 * the epochs via `UNIX_TIMESTAMP(...)*1000`; the host never parses dates here.
 * Overlapping rows union so concurrent spans do not double count, disjoint
 * spans exclude their breaks, and any corrupt evidence surfaces as invalid
 * rather than a guessed repair.
 */

/** How a Work Session end was recorded; NULL is a pre-existing row. */
export type WorkSessionEndSource = 'logout' | 'beacon' | 'sweep';

/**
 * One Work Session row as the attendance query reads it. Epochs arrive as
 * `UNIX_TIMESTAMP(...)*1000` — a DECIMAL the driver returns as a string —
 * labels as SQL-formatted HH:MM, and the snapshot clock the same way.
 */
export interface WorkSessionObservation {
	readonly startMs: unknown;
	readonly endMs: unknown;
	readonly startLabel: unknown;
	readonly endLabel: unknown;
	readonly endSource: unknown;
	readonly status: unknown;
}

/** The session fields the attendance GET answers with. */
export interface WorkSessionSummary {
	/** Earliest observed start, SQL-formatted HH:MM, or null. */
	readonly sessionStartTime: string | null;
	/** Latest valid end, only when nothing is active and nothing is invalid. */
	readonly sessionEndTime: string | null;
	/** How that end was recorded; null when active, invalid, or legacy. */
	readonly sessionEndSource: WorkSessionEndSource | null;
	/** Unioned observed minutes, or null when none or any invalid. */
	readonly sessionElapsedMinutes: number | null;
	/** DB snapshot clock, epoch ms, or null when unreadable. */
	readonly sessionAsOf: number | null;
	/** Any current-day Work Session still active. */
	readonly sessionActive: boolean;
	/** Any corrupt interval, future start, or unreadable clock. */
	readonly sessionTimeInvalid: boolean;
}

const MS_PER_MINUTE = 60_000;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A raw epoch-ms cell → finite positive ms. mysql2 returns the
 * `UNIX_TIMESTAMP(...)*1000` DECIMAL as a string, so numeric strings convert;
 * null, blank, non-finite, zero, and negative values hold no instant.
 */
function toFiniteMs(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') {
		return Number.isFinite(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string') {
		if (value.trim() === '') return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

/** A raw HH:MM cell → the label, or null when it is not clock-shaped. */
function toLabel(value: unknown): string | null {
	return typeof value === 'string' && HH_MM.test(value) ? value : null;
}

/** A raw end source → the known one, or null for legacy and unknown. */
function toEndSource(value: unknown): WorkSessionEndSource | null {
	return value === 'logout' || value === 'beacon' || value === 'sweep'
		? value
		: null;
}

/** No session evidence could be read: every field unavailable, never zero. */
export function unavailableWorkSessionSummary(): WorkSessionSummary {
	return {
		sessionStartTime: null,
		sessionEndTime: null,
		sessionEndSource: null,
		sessionElapsedMinutes: null,
		sessionAsOf: null,
		sessionActive: false,
		sessionTimeInvalid: false,
	};
}

interface Interval {
	readonly start: number;
	readonly end: number;
}

/**
 * Fold one day of Work Session observations into the attendance session
 * fields. `asOfMs` is the DB `CURRENT_TIMESTAMP(3)` snapshot the rows were
 * read with; active spans run to it. Ended rows with a missing or reversed
 * end, any future start, an unknown status, or an unreadable clock mark the
 * whole day invalid with a null total — the corrupt row stays visible through
 * the start label, never silently repaired.
 */
export function summarizeWorkSessions(
	rows: readonly WorkSessionObservation[],
	asOfMs: unknown
): WorkSessionSummary {
	const asOf = toFiniteMs(asOfMs);
	if (rows.length === 0) {
		return {
			sessionStartTime: null,
			sessionEndTime: null,
			sessionEndSource: null,
			sessionElapsedMinutes: null,
			sessionAsOf: asOf,
			sessionActive: false,
			sessionTimeInvalid: false,
		};
	}

	let invalid = asOf === null;
	let active = false;
	let earliestLabel: string | null = null;
	let earliestStart: number | null = null;
	let latestEnd: number | null = null;
	let latestEndLabel: string | null = null;
	let latestEndSource: WorkSessionEndSource | null = null;
	const intervals: Interval[] = [];

	for (const row of rows) {
		const isActive = row.status === 'active';
		const isEnded = row.status === 'ended';
		if (isActive) active = true;
		if (!isActive && !isEnded) {
			invalid = true;
			const start = toFiniteMs(row.startMs);
			if (start !== null && (earliestStart === null || start < earliestStart)) {
				earliestStart = start;
				earliestLabel = toLabel(row.startLabel);
			}
			continue;
		}

		const start = toFiniteMs(row.startMs);
		if (start === null) {
			invalid = true;
			continue;
		}
		if (earliestStart === null || start < earliestStart) {
			earliestStart = start;
			earliestLabel = toLabel(row.startLabel);
		}
		const startsAfterSnapshot = asOf !== null && start > asOf;
		if (startsAfterSnapshot) {
			invalid = true;
		}

		if (isActive) {
			if (asOf !== null && start <= asOf) {
				intervals.push({ start, end: asOf });
			}
			continue;
		}

		const end = toFiniteMs(row.endMs);
		if (end === null || end < start) {
			invalid = true;
			continue;
		}
		if (asOf !== null && end > asOf) {
			invalid = true;
			continue;
		}
		intervals.push({ start, end });
		if (latestEnd === null || end > latestEnd) {
			latestEnd = end;
			latestEndLabel = toLabel(row.endLabel);
			latestEndSource = toEndSource(row.endSource);
		}
	}

	if (invalid) {
		return {
			sessionStartTime: earliestLabel,
			sessionEndTime: null,
			sessionEndSource: null,
			sessionElapsedMinutes: null,
			sessionAsOf: asOf,
			sessionActive: active,
			sessionTimeInvalid: true,
		};
	}

	if (intervals.length === 0) {
		return {
			sessionStartTime: earliestLabel,
			sessionEndTime: null,
			sessionEndSource: null,
			sessionElapsedMinutes: null,
			sessionAsOf: asOf,
			sessionActive: active,
			sessionTimeInvalid: false,
		};
	}

	const ordered = [...intervals].sort((a, b) => a.start - b.start);
	let totalMs = 0;
	let openStart = ordered[0].start;
	let openEnd = ordered[0].end;
	for (let i = 1; i < ordered.length; i++) {
		const next = ordered[i];
		if (next.start <= openEnd) {
			if (next.end > openEnd) openEnd = next.end;
		} else {
			totalMs += openEnd - openStart;
			openStart = next.start;
			openEnd = next.end;
		}
	}
	totalMs += openEnd - openStart;

	if (active) {
		return {
			sessionStartTime: earliestLabel,
			sessionEndTime: null,
			sessionEndSource: null,
			sessionElapsedMinutes: Math.floor(totalMs / MS_PER_MINUTE),
			sessionAsOf: asOf,
			sessionActive: true,
			sessionTimeInvalid: false,
		};
	}
	return {
		sessionStartTime: earliestLabel,
		sessionEndTime: latestEndLabel,
		sessionEndSource: latestEndSource,
		sessionElapsedMinutes: Math.floor(totalMs / MS_PER_MINUTE),
		sessionAsOf: asOf,
		sessionActive: false,
		sessionTimeInvalid: false,
	};
}
