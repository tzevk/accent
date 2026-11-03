import {
	LEAD_AUDIT_PRESETS,
	type LeadAuditPreset,
} from './types';

/**
 * Calendar helpers for the report. Dates are `YYYY-MM-DD` calendar strings,
 * never `Date` objects at the boundary: the database calendar day is the
 * policy, and a local `Date` would silently reintroduce the browser or Node
 * time zone.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
	const match = ISO_DATE.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days))
		.toISOString()
		.slice(0, 10);
}

/** The exclusive next-day bound of an inclusive selected end date. */
export function nextDay(date: string): string {
	return addDays(date, 1);
}

export function monthStart(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
	const [year, month] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function quarterStart(date: string): string {
	const [year, month] = date.split('-').map(Number);
	const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
	return `${year}-${String(firstMonth).padStart(2, '0')}-01`;
}

function previousMonthStart(date: string): string {
	const [year, month] = date.split('-').map(Number);
	const value = new Date(Date.UTC(year, month - 2, 1));
	return value.toISOString().slice(0, 10);
}

export function isLeadAuditPreset(value: string): value is LeadAuditPreset {
	return (LEAD_AUDIT_PRESETS as readonly string[]).includes(value);
}

export interface LeadAuditPeriod {
	preset: LeadAuditPreset;
	fromDate: string;
	toDate: string;
}

/**
 * Resolve a preset against the database's calendar day. `custom` is handled
 * by the filter parser, which requires explicit dates.
 */
export function resolvePresetRange(
	preset: Exclude<LeadAuditPreset, 'custom'>,
	today: string
): LeadAuditPeriod {
	switch (preset) {
		case 'today':
			return { preset, fromDate: today, toDate: today };
		case 'current_month':
			return { preset, fromDate: monthStart(today), toDate: today };
		case 'previous_month': {
			const from = previousMonthStart(today);
			return { preset, fromDate: from, toDate: monthEnd(from) };
		}
		case 'last_7_days':
			return { preset, fromDate: addDays(today, -6), toDate: today };
		case 'last_30_days':
			return { preset, fromDate: addDays(today, -29), toDate: today };
		case 'current_quarter':
			return { preset, fromDate: quarterStart(today), toDate: today };
		case 'current_year':
			return { preset, fromDate: `${today.slice(0, 4)}-01-01`, toDate: today };
		default:
			throw new Error(`Unknown Lead Audit preset: ${String(preset)}`);
	}
}
