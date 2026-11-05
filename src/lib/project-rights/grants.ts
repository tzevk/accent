/**
 * Grant parsing for project rights.
 *
 * The stored shape is the permission payload the permission editor already
 * writes: `users.field_permissions`. Project action scopes live beside the
 * modules tree so they survive `stripDisabledModules`:
 *
 * {
 *   "modules": { "...": "existing nested field permissions" },
 *   "projectScopes": {
 *     "projects": { "read": "all", "update": "led" }
 *   }
 * }
 */

import {
	COMMERCIAL_COLUMN_ALIASES,
	PROTECTED_COMMERCIAL_COLUMNS,
	WORK_SECTION_IDS,
	isSectionId,
	type SectionId,
} from './sections';

/** Actions that can be granted on an existing project. `create` has no scope. */
export const PROJECT_ACTIONS = [
	'read',
	'update',
	'assign',
	'close',
	'delete',
	'reopen',
] as const;

export type ProjectAction = (typeof PROJECT_ACTIONS)[number];
export type ProjectScope = 'led' | 'assigned' | 'all';

const PROJECT_SCOPES: readonly ProjectScope[] = ['led', 'assigned', 'all'];

export type PermissionCarrier = {
	permissions?: unknown;
	role_permissions?: unknown;
	merged_permissions?: unknown;
	field_permissions?: unknown;
	is_super_admin?: unknown;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as JsonRecord;
}

/** Parse a JSON column that mysql2 may return already parsed or as a string. */
export function parseJsonObject(value: unknown): JsonRecord {
	if (!value) return {};
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return asRecord(parsed) ?? {};
		} catch {
			return {};
		}
	}
	return asRecord(value) ?? {};
}

export function parseJsonArray(value: unknown): unknown[] {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

function permissionStrings(value: unknown): string[] {
	return parseJsonArray(value).filter(
		(item): item is string => typeof item === 'string'
	);
}

function projectModule(user: PermissionCarrier): JsonRecord | null {
	const fieldPermissions = parseJsonObject(user.field_permissions);
	const modules = asRecord(fieldPermissions.modules);
	return asRecord(modules?.projects);
}

/**
 * True when the user holds a project action through any grant source:
 * merged permissions, direct permissions, role permissions, or the nested
 * module `crud` block.
 */
export function hasProjectAction(
	user: PermissionCarrier,
	action: ProjectAction | 'create'
): boolean {
	if (!user) return false;
	if (user.is_super_admin) return true;

	const permissionKey = `projects:${action}`;
	const sources = [
		user.merged_permissions,
		user.permissions,
		user.role_permissions,
	];
	for (const source of sources) {
		if (permissionStrings(source).includes(permissionKey)) return true;
	}

	const projectModuleData = projectModule(user);
	if (projectModuleData && projectModuleData.enabled !== false) {
		const crud = asRecord(projectModuleData.crud);
		if (crud?.[action] === true) return true;
	}

	return false;
}

/** Stored scopes only. Missing entries are absent so callers can fail closed. */
export function parseProjectScopes(
	fieldPermissions: unknown
): Partial<Record<ProjectAction, ProjectScope>> {
	const fieldObject = parseJsonObject(fieldPermissions);
	const projectScopes = asRecord(fieldObject.projectScopes);
	const projects = asRecord(projectScopes?.projects);
	const scopes: Partial<Record<ProjectAction, ProjectScope>> = {};
	if (!projects) return scopes;

	for (const action of PROJECT_ACTIONS) {
		const stored = projects[action];
		if (
			typeof stored === 'string' &&
			(PROJECT_SCOPES as readonly string[]).includes(stored)
		) {
			scopes[action] = stored as ProjectScope;
		}
	}
	return scopes;
}

/**
 * Effective scope for an action. A grant without a stored scope fails closed
 * to `led`, the narrowest meaningful scope.
 */
export function resolveProjectActionScope(
	user: PermissionCarrier,
	action: ProjectAction
): ProjectScope | undefined {
	if (!hasProjectAction(user, action)) return undefined;
	const scopes = parseProjectScopes(user.field_permissions);
	return scopes[action] ?? 'led';
}

/** True when any granted project action carries all-projects scope. */
export function hasAllProjectScope(user: PermissionCarrier): boolean {
	if (!user) return false;
	if (user.is_super_admin) return true;
	const scopes = parseProjectScopes(user.field_permissions);
	return PROJECT_ACTIONS.some(
		(action) =>
			scopes[action] === 'all' && hasProjectAction(user, action)
	);
}

export type CommercialFieldRights = {
	view: string[];
	edit: string[];
};

function commercialColumnFor(fieldKey: string): string {
	return COMMERCIAL_COLUMN_ALIASES[fieldKey] ?? fieldKey;
}

/** Commercial field permissions, mapped to real protected column names. */
export function parseCommercialFieldRights(
	fieldPermissions: unknown
): CommercialFieldRights {
	const fieldObject = parseJsonObject(fieldPermissions);
	const modules = asRecord(fieldObject.modules);
	const projects = asRecord(modules?.projects);
	const sections = asRecord(projects?.sections);
	const commercial = asRecord(sections?.commercial);
	const fields = asRecord(commercial?.fields);

	const view: string[] = [];
	const edit: string[] = [];
	const protectedColumns: readonly string[] = PROTECTED_COMMERCIAL_COLUMNS;

	// A disabled module or section revokes its field permissions even when a
	// stale `permission` value remains in the saved editor payload. A boolean
	// permission is not a grant either.
	if (
		!projects ||
		projects.enabled === false ||
		!commercial ||
		commercial.enabled === false ||
		!fields
	) {
		return { view, edit };
	}

	for (const [fieldKey, raw] of Object.entries(fields)) {
		const definition = asRecord(raw);
		const permission = definition?.permission;
		const column = commercialColumnFor(fieldKey);
		if (!protectedColumns.includes(column)) continue;
		if (permission === 'view' || permission === 'edit') {
			view.push(column);
		}
		if (permission === 'edit') edit.push(column);
	}

	return { view: [...new Set(view)].sort(), edit: [...new Set(edit)].sort() };
}

export type ExplicitSectionRights = {
	read: SectionId[];
	edit: SectionId[];
};

/**
 * Explicit section field permissions are additive. A section counts as
 * readable when any of its fields is `view` or `edit`, and editable when any
 * field is `edit`. Callers decide whether the update action is in scope.
 */
export function parseExplicitSectionRights(
	fieldPermissions: unknown
): ExplicitSectionRights {
	const fieldObject = parseJsonObject(fieldPermissions);
	const modules = asRecord(fieldObject.modules);
	const sections = asRecord(asRecord(modules?.projects)?.sections);
	const read: SectionId[] = [];
	const edit: SectionId[] = [];
	if (!sections) return { read, edit };

	for (const [sectionKey, rawSection] of Object.entries(sections)) {
		if (!isSectionId(sectionKey)) continue;
		const section = asRecord(rawSection);
		if (!section || section.enabled === false) continue;
		const fields = asRecord(section.fields);
		if (!fields) continue;

		let canRead = false;
		let canEdit = false;
		for (const rawField of Object.values(fields)) {
			const permission = asRecord(rawField)?.permission;
			if (permission === 'view' || permission === 'edit') canRead = true;
			if (permission === 'edit') canEdit = true;
		}
		if (canRead) read.push(sectionKey);
		if (canEdit) edit.push(sectionKey);
	}

	return { read, edit };
}

/** Re-export so callers do not need a second import for the id list. */
export { WORK_SECTION_IDS };
