/**
 * Tiny coercion helpers for raw DB rows, shared by the utilization
 * data-source and the project breakdown so the two copies cannot drift.
 *
 * Pure — no DB imports — so importing them never drags a connection module
 * into a unit test or a client bundle.
 */

export type DbRow = Record<string, unknown>;

/** A DB cell as a string; numbers/bigints stringify, anything else is the fallback. */
export function dbStr(row: DbRow, key: string, fallback = ''): string {
	const value = row[key];
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'bigint')
		return String(value);
	return fallback;
}

/**
 * A DB cell as a finite number. A blank string reads as absent (the
 * fallback), as does anything unparsable or non-finite.
 */
export function dbNum(row: DbRow, key: string, fallback = 0): number {
	const value = row[key];
	if (typeof value === 'number')
		return Number.isFinite(value) ? value : fallback;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}
