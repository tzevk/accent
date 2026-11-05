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

function parsePermissions(raw) {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw.filter((key) => typeof key === 'string');
	}
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed)
				? parsed.filter((key) => typeof key === 'string')
				: [];
		} catch {
			return [];
		}
	}
	if (typeof raw === 'object') {
		return Object.values(raw).filter((key) => typeof key === 'string');
	}
	return [];
}

function parseFieldPermissions(raw) {
	if (!raw) return {};
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? parsed
				: {};
		} catch {
			return {};
		}
	}
	return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function asRecord(value) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value
		: null;
}

/**
 * Project actions granted through the nested permission-editor tree
 * (`field_permissions.modules.projects.crud`). `hasProjectAction` treats a
 * `true` crud entry as a grant, so the migration must seed its scope too.
 */
function nestedProjectActions(fieldPermissions) {
	const modules = asRecord(fieldPermissions.modules);
	const projects = asRecord(modules?.projects);
	if (!projects || projects.enabled === false) return [];
	const crud = asRecord(projects.crud);
	if (!crud) return [];
	return PROJECT_ACTIONS.filter((action) => crud[action] === true).map(
		(action) => `projects:${action}`
	);
}

export async function up(knex) {
	const users = await knex
		.select('id', 'role_id', 'permissions', 'field_permissions')
		.from('users');
	const roles = await knex.select('id', 'permissions').from('roles_master');
	const rolePermissions = new Map(
		roles.map((role) => [role.id, parsePermissions(role.permissions)])
	);

	for (const user of users) {
		const fieldPermissions = parseFieldPermissions(user.field_permissions);
		const merged = new Set([
			...(rolePermissions.get(user.role_id) ?? []),
			...parsePermissions(user.permissions),
			...nestedProjectActions(fieldPermissions),
		]);

		const existingProjectScopes =
			fieldPermissions.projectScopes &&
			typeof fieldPermissions.projectScopes === 'object' &&
			!Array.isArray(fieldPermissions.projectScopes)
				? fieldPermissions.projectScopes
				: {};
		const existingScopes =
			existingProjectScopes.projects &&
			typeof existingProjectScopes.projects === 'object' &&
			!Array.isArray(existingProjectScopes.projects)
				? existingProjectScopes.projects
				: {};

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

		await knex('users')
			.where({ id: user.id })
			.update({ field_permissions: JSON.stringify(nextFieldPermissions) });
	}
}

export async function down() {
	// No-op: restoring existing access must not be reversible. Removing scopes
	// would silently narrow every migrated grant.
}
