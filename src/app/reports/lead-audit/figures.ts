/**
 * The Lead Audit report's shared figure formatting.
 *
 * Counts, rates, shares, and elapsed durations read the same on the screen
 * views and in the printable management summary. Calendar and timestamp text
 * comes from `@/lib/format`; this module only adds the report-specific units
 * (whole counts, percentages, 0–1 shares, and whole-second durations).
 */

export function formatCount(value: number): string {
	return value.toLocaleString('en-IN');
}

/** A percentage the server already calculated, or Not applicable. */
export function formatRate(value: number | null): string {
	if (value === null) return 'Not applicable';
	return `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

/** A 0–1 share, or Not applicable when the population is empty. */
export function formatShare(share: number | null): string {
	if (share === null) return 'Not applicable';
	return formatRate(Math.round(share * 1000) / 10);
}

/**
 * A whole-second elapsed duration at two units of precision. Negative
 * intervals keep their sign; they are never clamped to zero.
 */
export function formatDuration(seconds: number | null): string {
	if (seconds === null) return 'Not available';
	const negative = seconds < 0;
	const absolute = Math.abs(seconds);
	const days = Math.floor(absolute / 86400);
	const hours = Math.floor((absolute % 86400) / 3600);
	const minutes = Math.floor((absolute % 3600) / 60);
	const remainder = absolute % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} d`);
	if (hours > 0) parts.push(`${hours} h`);
	if (days === 0 && minutes > 0) parts.push(`${minutes} m`);
	if (parts.length === 0 || (days === 0 && minutes === 0 && remainder > 0)) {
		parts.push(
			`${Number.isInteger(remainder) ? remainder : remainder.toFixed(1)} s`
		);
	}
	return `${negative ? '−' : ''}${parts.slice(0, 2).join(' ')}`;
}
