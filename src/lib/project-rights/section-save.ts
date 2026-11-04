/**
 * Client-side section snapshot and diff helpers.
 *
 * The edit screen no longer submits one whole project form. It keeps the
 * values that were loaded and, on save, sends one section payload for each
 * editable section whose values actually changed. Values are filtered through
 * the same write map the server validates, so the client can never send a
 * field a section does not own.
 */

import {
	SECTION_LIST_COLUMNS,
	SECTION_WRITE_COLUMNS,
	WORK_SECTION_IDS,
	isSectionId,
	type SectionId,
} from './sections';

export type SectionValues = Record<string, unknown>;
export type SectionSnapshot = Partial<Record<SectionId, SectionValues>>;

const DATE_COLUMNS: Record<string, true> = {
	start_date: true,
	end_date: true,
	target_date: true,
	mobilization_date: true,
	kickoff_meeting_date: true,
	kickoff_followup_date: true,
	internal_meeting_date: true,
	next_internal_meeting: true,
};

const NUMERIC_COLUMNS: Record<string, true> = {
	project_duration_planned: true,
	project_duration_actual: true,
	estimated_manhours: true,
	unit_qty: true,
	duration: true,
};

/** Convert blank date/numeric inputs to `null` before they reach the DB. */
export function prepareSectionValues(
	section: SectionId,
	values: SectionValues
): SectionValues {
	const prepared: SectionValues = { ...values };
	for (const column of SECTION_WRITE_COLUMNS[section]) {
		if (!(column in prepared)) continue;
		const value = prepared[column];
		if (
			typeof value === 'string' &&
			value.trim() === '' &&
			(DATE_COLUMNS[column] || NUMERIC_COLUMNS[column])
		) {
			prepared[column] = null;
		}
	}
	return prepared;
}

function parseJsonish(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const text = value.trim();
	if (!text) return value;
	if (
		(text.startsWith('[') && text.endsWith(']')) ||
		(text.startsWith('{') && text.endsWith('}'))
	) {
		try {
			return JSON.parse(text);
		} catch {
			return value;
		}
	}
	return value;
}

function canonicalDate(value: unknown): string {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime())
			? ''
			: value.toISOString().slice(0, 10);
	}
	if (typeof value === 'string' && value.includes('T')) {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString().slice(0, 10);
		}
	}
	return typeof value === 'string' ? value : String(value ?? '');
}

function canonicalValue(column: string, value: unknown): unknown {
	if (value === undefined || value === null) return '';
	if (typeof value === 'number') return String(value);
	if (typeof value === 'string' && value.trim() === '') return '';
	if (DATE_COLUMNS[column]) return canonicalDate(value);
	if (Array.isArray(value))
		return value.map((item) => canonicalValue('', item));
	if (typeof value === 'object' && value instanceof Date) {
		return canonicalDate(value);
	}
	if (value && typeof value === 'object') {
		const source = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(source).sort()) {
			// Row ids are client-generated keys, not persisted content.
			if (key === 'id') continue;
			sorted[key] = canonicalValue(key, source[key]);
		}
		return sorted;
	}
	return value;
}

function stableKey(column: string, value: unknown): string {
	return JSON.stringify(canonicalValue(column, value));
}

/**
 * Pick one section's writable values from a flat source object. Direct and
 * list columns use the same names as the `projects` table.
 */
export function pickSectionValues(
	section: SectionId,
	source: Record<string, unknown>,
	options: { parseLists?: boolean } = {}
): SectionValues {
	const values: SectionValues = {};
	for (const column of SECTION_WRITE_COLUMNS[section]) {
		if (column in source) values[column] = source[column];
	}
	for (const column of SECTION_LIST_COLUMNS[section]) {
		if (!(column in source)) continue;
		values[column] =
			options.parseLists === false
				? source[column]
				: parseJsonish(source[column]);
	}
	return values;
}

/** Snapshot every work section from a flat project-shaped source. */
export function collectSectionSnapshot(
	source: Record<string, unknown>,
	options: { parseLists?: boolean } = {}
): SectionSnapshot {
	const snapshot: SectionSnapshot = {};
	for (const section of WORK_SECTION_IDS) {
		snapshot[section] = pickSectionValues(section, source, options);
	}
	return snapshot;
}

/** Snapshot from a raw project row: JSON/list columns arrive as text. */
export function collectProjectSnapshot(
	project: Record<string, unknown> | null | undefined
): SectionSnapshot {
	return collectSectionSnapshot(project ?? {}, { parseLists: true });
}

export type ChangedSection = {
	section: SectionId;
	values: SectionValues;
};

/**
 * Compare the loaded snapshot with the current state and return one payload
 * per changed editable section. Non-editable sections and non-writable
 * sections never produce a payload.
 */
export function diffSectionSaves(
	initial: SectionSnapshot | null | undefined,
	current: SectionSnapshot | null | undefined,
	editableSections: readonly string[]
): ChangedSection[] {
	const editable = new Set(editableSections);
	const changes: ChangedSection[] = [];
	if (!current) return changes;

	for (const section of WORK_SECTION_IDS) {
		if (!editable.has(section)) continue;
		const before = initial?.[section] ?? {};
		const after = current[section] ?? {};
		const values: SectionValues = {};

		for (const column of [
			...SECTION_WRITE_COLUMNS[section],
			...SECTION_LIST_COLUMNS[section],
		]) {
			if (!(column in after)) continue;
			if (
				stableKey(column, before[column]) === stableKey(column, after[column])
			) {
				continue;
			}
			values[column] = after[column];
		}

		if (Object.keys(values).length > 0) {
			changes.push({ section, values });
		}
	}

	return changes;
}

export { isSectionId };
