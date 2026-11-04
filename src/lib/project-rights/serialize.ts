/**
 * Read filtering for project payloads.
 *
 * Hidden values must be absent from the response, not merely hidden in the
 * interface. This module builds the response from an allowlist — identity
 * and summary fields, the columns of readable sections, the authorised
 * commercial columns, and the virtual `project_activities` list — so a new
 * project column can never leak before it is mapped to a section.
 */

import type { ProjectRights } from './policy';
import {
	PROJECT_IDENTITY_FIELDS,
	PROJECT_SUMMARY_FIELDS,
	PROTECTED_COMMERCIAL_COLUMNS,
	SECTION_COLUMNS,
	WORK_SECTION_IDS,
} from './sections';

type ProjectPayload = Record<string, unknown>;

export function filterProjectForRights<T extends ProjectPayload>(
	project: T,
	rights: ProjectRights
): T {
	if (!project || !rights) return project;
	// The super-admin bypass keeps the existing full-row read, including
	// columns that have not been mapped to a work section yet.
	if (rights.isSuperAdmin) return project;

	const filtered: ProjectPayload = {};

	for (const field of PROJECT_IDENTITY_FIELDS) {
		if (field in project) filtered[field] = project[field];
	}
	for (const field of PROJECT_SUMMARY_FIELDS) {
		if (field in project) filtered[field] = project[field];
	}

	for (const section of WORK_SECTION_IDS) {
		if (!rights.sections?.[section]?.read) continue;
		for (const column of SECTION_COLUMNS[section]) {
			if (column in project) filtered[column] = project[column];
		}
	}

	// Commercial values are only copied back when the field permission is
	// explicit; they never come from a section map.
	for (const column of PROTECTED_COMMERCIAL_COLUMNS) {
		if (
			rights.commercial?.view?.includes(column) &&
			Object.hasOwn(project, column)
		) {
			filtered[column] = project[column];
		}
	}

	return filtered as T;
}

export { PROTECTED_COMMERCIAL_COLUMNS };
