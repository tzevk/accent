/**
 * Section-scoped write validation.
 *
 * A project save names one section and the values it wants to persist. The
 * payload shape never creates authority:
 *
 *  - unknown sections, unknown fields, and out-of-section fields are errors;
 *  - `project_team`, `discussion`, and `upload_documents` can never be saved
 *    through the project row;
 *  - a protected commercial column is rejected from every work section;
 *  - commercial columns are written only through `section: 'commercial'` and
 *    only when the actor holds edit rights on each column.
 */

import {
	COMMERCIAL_SECTION,
	COMMERCIAL_WRITE_COLUMNS,
	PROTECTED_COMMERCIAL_COLUMNS,
	SECTION_WRITES,
	isProjectWritableSection,
	isProtectedCommercialColumn,
	isSectionId,
	type SectionId,
} from './sections';

export type SectionWriteErrorCode =
	| 'UNKNOWN_SECTION'
	| 'INVALID_VALUES'
	| 'UNKNOWN_FIELD'
	| 'PROTECTED_FIELD'
	| 'SECTION_NOT_WRITABLE';

export type SectionWriteFailure = {
	ok: false;
	code: SectionWriteErrorCode;
	error: string;
	field?: string;
};

export type ValidatedSectionWrite = {
	ok: true;
	section: SectionId | typeof COMMERCIAL_SECTION;
	/** Direct project columns present in the values. */
	columns: string[];
	/** JSON/list project columns present in the values. */
	listColumns: string[];
};

export type SectionWriteValidation =
	| ValidatedSectionWrite
	| SectionWriteFailure;

export type SectionWriteOptions = {
	/** Protected commercial columns the actor may edit. */
	commercialEdit?: readonly string[];
};

export type SectionUpdate = {
	columns: string[];
	params: unknown[];
	listColumns: string[];
};

export type BuildSectionUpdateResult =
	| {
			ok: true;
			section: SectionId | typeof COMMERCIAL_SECTION;
			update: SectionUpdate;
	  }
	| SectionWriteFailure;

function failure(
	code: SectionWriteErrorCode,
	error: string,
	field?: string
): SectionWriteFailure {
	return field === undefined
		? { ok: false, code, error }
		: { ok: false, code, error, field };
}

function asValueRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * Validate one section save. Strict: any key the section does not own makes
 * the whole save invalid, so a crafted request can never slip an extra column
 * into the UPDATE.
 */
export function validateSectionWrite(
	sectionId: unknown,
	values: unknown,
	options: SectionWriteOptions = {}
): SectionWriteValidation {
	if (typeof sectionId !== 'string' || sectionId.trim() === '') {
		return failure('UNKNOWN_SECTION', 'A project section is required');
	}
	const section = sectionId.trim();
	const record = asValueRecord(values);
	if (!record) {
		return failure('INVALID_VALUES', 'values must be an object');
	}
	const keys = Object.keys(record);
	if (keys.length === 0) {
		return failure('INVALID_VALUES', 'values must contain at least one field');
	}

	if (section === COMMERCIAL_SECTION) {
		const editable = new Set(options.commercialEdit ?? []);
		const columns: string[] = [];
		for (const key of keys) {
			if (!isProtectedCommercialColumn(key)) {
				return failure(
					'UNKNOWN_FIELD',
					`Field "${key}" is not a commercial column`,
					key
				);
			}
			if (!editable.has(key)) {
				return failure(
					'PROTECTED_FIELD',
					`You do not have permission to edit "${key}"`,
					key
				);
			}
			columns.push(key);
		}
		return { ok: true, section: COMMERCIAL_SECTION, columns, listColumns: [] };
	}

	if (!isSectionId(section)) {
		return failure('UNKNOWN_SECTION', `Unknown project section "${section}"`);
	}
	if (!isProjectWritableSection(section)) {
		return failure(
			'SECTION_NOT_WRITABLE',
			`Section "${section}" is not saved through the project row`
		);
	}

	const definition = SECTION_WRITES[section];
	const direct = new Set(definition.columns);
	const list = new Set(definition.listColumns);
	const columns: string[] = [];
	const listColumns: string[] = [];

	for (const key of keys) {
		if (isProtectedCommercialColumn(key)) {
			return failure(
				'PROTECTED_FIELD',
				`"${key}" is a protected commercial column and cannot be written from "${section}"`,
				key
			);
		}
		if (direct.has(key)) {
			columns.push(key);
			continue;
		}
		if (list.has(key)) {
			listColumns.push(key);
			continue;
		}
		return failure(
			'UNKNOWN_FIELD',
			`Field "${key}" does not belong to section "${section}"`,
			key
		);
	}

	return { ok: true, section, columns, listColumns };
}

/** Serialize a JSON/list column value; strings and null pass through. */
export function serializeListValue(value: unknown): unknown {
	if (value === undefined || value === null) return value;
	if (typeof value === 'string') return value;
	if (typeof value === 'object') return JSON.stringify(value);
	return value;
}

/**
 * Build the parameter list for the section UPDATE. List columns are
 * serialized; direct columns pass through so the caller can sanitize them
 * before this step.
 */
export function buildSectionUpdate(
	sectionId: unknown,
	values: unknown,
	options: SectionWriteOptions = {}
): BuildSectionUpdateResult {
	const validation = validateSectionWrite(sectionId, values, options);
	if (!validation.ok) return validation;

	const record = asValueRecord(values) ?? {};
	const columns: string[] = [];
	const params: unknown[] = [];
	const listColumns: string[] = [];

	for (const column of validation.columns) {
		const value = record[column];
		if (value === undefined) continue;
		columns.push(column);
		params.push(value);
	}
	for (const column of validation.listColumns) {
		const value = record[column];
		if (value === undefined) continue;
		columns.push(column);
		params.push(serializeListValue(value));
		listColumns.push(column);
	}

	return {
		ok: true,
		section: validation.section,
		update: { columns, params, listColumns },
	};
}

/** Every work section must stay clear of protected commercial columns. */
export function workSectionCommercialViolations(): Array<{
	section: SectionId;
	column: string;
}> {
	const violations: Array<{ section: SectionId; column: string }> = [];
	for (const [section, definition] of Object.entries(SECTION_WRITES)) {
		for (const column of [...definition.columns, ...definition.listColumns]) {
			if (
				(PROTECTED_COMMERCIAL_COLUMNS as readonly string[]).includes(column)
			) {
				violations.push({ section: section as SectionId, column });
			}
		}
	}
	return violations;
}

export { COMMERCIAL_SECTION, COMMERCIAL_WRITE_COLUMNS };
