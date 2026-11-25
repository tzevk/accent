import type { RowDataPacket } from 'mysql2/promise';

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Seed per-action project scopes for existing grants.
 *
 * Project action scopes live beside the nested modules tree in
 * `users.field_permissions`:
 *
 *   { "projectScopes": { "projects": { "read": "all", ... } } }
 *
 * Every user whose merged role + direct permission array already contains a
 * project action receives all-projects scope for that action, so rollout does
 * not silently narrow existing management access. Existing scopes are
 * preserved; the migration is idempotent and tolerates JSON columns that
 * arrive either parsed or as strings.
 */

const PROJECT_ACTIONS = [
	'read',
	'update',
	'assign',
	'close',
	'delete',
	'reopen',
];

interface UserRow extends RowDataPacket {
	id: number;
	role_id: number | null;
	permissions: unknown;
	field_permissions: unknown;
}

interface RoleRow extends RowDataPacket {
	id: number;
	permissions: unknown;
}

function parsePermissions(raw: unknown): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw.filter((key): key is string => typeof key === 'string');
	}
	if (typeof raw === 'string') {
		try {
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed)
				? parsed.filter((key): key is string => typeof key === 'string')
				: [];
		} catch {
			return [];
		}
	}
	if (typeof raw === 'object') {
		return Object.values(raw).filter(
			(key): key is string => typeof key === 'string'
		);
	}
	return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseFieldPermissions(raw: unknown): Record<string, unknown> {
	if (!raw) return {};
	if (typeof raw === 'string') {
		try {
			return asRecord(JSON.parse(raw)) ?? {};
		} catch {
			return {};
		}
	}
	return asRecord(raw) ?? {};
}

/**
 * Project actions granted through the nested permission-editor tree
 * (`field_permissions.modules.projects.crud`). `hasProjectAction` treats a
 * `true` crud entry as a grant, so the migration must seed its scope too.
 */
function nestedProjectActions(fieldPermissions: Record<string, unknown>) {
	const modules = asRecord(fieldPermissions.modules);
	const projects = asRecord(modules?.projects);
	if (!projects || projects.enabled === false) return [];
	const crud = asRecord(projects.crud);
	if (!crud) return [];
	return PROJECT_ACTIONS.filter((action) => crud[action] === true).map(
		(action) => `projects:${action}`
	);
}

export async function up(db: MigrationDb): Promise<void> {
	const [users] = await executeMigrationSql<UserRow>(
		db,
		'SELECT id, role_id, permissions, field_permissions FROM users'
	);
	const [roles] = await executeMigrationSql<RoleRow>(
		db,
		'SELECT id, permissions FROM roles_master'
	);
	const rolePermissions = new Map<number | null, string[]>();
	for (const role of roles) {
		rolePermissions.set(role.id, parsePermissions(role.permissions));
	}

	for (const user of users) {
		const fieldPermissions = parseFieldPermissions(user.field_permissions);
		const merged = new Set([
			...(rolePermissions.get(user.role_id) ?? []),
			...parsePermissions(user.permissions),
			...nestedProjectActions(fieldPermissions),
		]);

		const existingProjectScopes =
			asRecord(fieldPermissions.projectScopes) ?? {};
		const existingScopes = asRecord(existingProjectScopes.projects) ?? {};

		const nextScopes = { ...existingScopes };
		let changed = false;
		for (const action of PROJECT_ACTIONS) {
			if (
				merged.has(`projects:${action}`) &&
				nextScopes[action] === undefined
			) {
				nextScopes[action] = 'all';
				changed = true;
			}
		}

		if (!changed) continue;

		const nextFieldPermissions = {
			...fieldPermissions,
			projectScopes: {
				...existingProjectScopes,
				projects: nextScopes,
			},
		};

		await executeMigrationSql(
			db,
			'UPDATE users SET field_permissions = ? WHERE id = ?',
			[JSON.stringify(nextFieldPermissions), user.id]
		);
	}
}
