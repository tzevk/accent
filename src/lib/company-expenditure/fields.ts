/**
 * Shared field validation for the financial sources.
 *
 * Request bodies are untrusted: every source that records or commands a cost
 * needs the same date/amount/text/enum handling, and the same classification
 * and tax vocabulary, or the sources would drift apart. These helpers throw
 * `CostError` with the explicit code the routes publish.
 */

import { CostError } from './errors';
import type { CostClassification } from './types';

export const CLASSIFICATIONS = [
	'project',
	'company_overhead',
	'unallocated',
] as const;

export const TAX_TREATMENTS = [
	'none',
	'recoverable',
	'non_recoverable',
	'unresolved',
] as const;

/** Trimmed text, capped at `max`, or null for absent/empty. */
export function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/** A finite number, or null for absent/empty. Invalid input is refused. */
export function amountOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		throw new CostError('invalid_amount', 'Amount must be a number', 422);
	}
	return parsed;
}

/** A `YYYY-MM-DD` date, or null. Anything else is refused. */
export function dateOrNull(value: unknown): string | null {
	const trimmed = text(value, 10);
	if (!trimmed) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new CostError('invalid_date', `Invalid date: ${trimmed}`, 422);
	}
	return trimmed;
}

/** One of `allowed`, or null for anything else — no throw. */
export function pickEnum<T extends string>(
	value: unknown,
	allowed: readonly T[]
): T | null {
	if (value === null || value === undefined) return null;
	const candidate = String(value).trim();
	return (allowed as readonly string[]).includes(candidate)
		? (candidate as T)
		: null;
}

/** One of `allowed`, null for absent, and an explicit refusal otherwise. */
export function enumOrThrow<T extends string>(
	value: unknown,
	allowed: readonly T[],
	code: string,
	field: string
): T | null {
	const picked = pickEnum(value, allowed);
	if (
		value !== null &&
		value !== undefined &&
		String(value).trim() !== '' &&
		!picked
	) {
		throw new CostError(code, `Unknown ${field}: ${String(value)}`, 422, {
			field,
		});
	}
	return picked;
}

/**
 * The destination rules every cost shares: a Project classification needs its
 * `project_id`; Company Overhead and Unallocated Cost must not carry one.
 */
export function assertClassificationProject(
	classification: CostClassification | null,
	projectId: number | null
): void {
	if (classification === 'project' && !projectId) {
		throw new CostError(
			'classification_conflict',
			'A Project classification needs a project_id',
			422,
			{ missing: ['project_id'] }
		);
	}
	if (classification && classification !== 'project' && projectId) {
		throw new CostError(
			'classification_conflict',
			'Company Overhead and Unallocated Cost cannot carry a project_id',
			422,
			{ missing: ['project_id_not_allowed'] }
		);
	}
}
