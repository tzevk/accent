/**
 * Read filtering for project payloads.
 *
 * Hidden values must be absent from the response, not merely hidden in the
 * interface. This module removes unreadable work-section columns, the team
 * list when unreadable, and protected commercial columns unless the actor
 * holds the matching commercial field permission.
 */

import type { ProjectRights } from './policy';
import {
	PROJECT_IDENTITY_FIELDS,
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

	const filtered: ProjectPayload = { ...project };

	for (const section of WORK_SECTION_IDS) {
		if (rights.sections?.[section]?.read) continue;
		for (const column of SECTION_COLUMNS[section]) {
			delete filtered[column];
		}
	}

	for (const column of PROTECTED_COMMERCIAL_COLUMNS) {
		if (!rights.commercial?.view?.includes(column)) {
			delete filtered[column];
		}
	}

	// Identity and list-safe fields stay visible for any openable project.
	for (const field of PROJECT_IDENTITY_FIELDS) {
		if (field in project) filtered[field] = project[field];
	}

	return filtered as T;
}

export { PROTECTED_COMMERCIAL_COLUMNS };
