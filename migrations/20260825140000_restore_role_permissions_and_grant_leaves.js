/**
 * Corrective migration for roles_master.permissions.
 *
 * Background: 20260825120000_create_leave_system.js merged leaves:* grants
 * into roles_master.permissions, but mysql2/knex delivers that LONGTEXT
 * column ALREADY JSON-PARSED (typeof === 'object'). The old merge code ran
 * JSON.parse() on the array, which throws, silently treating every role's
 * existing permissions as empty — so each role ended up holding ONLY its
 * leaves:* keys.
 *
 * This migration restores the canonical baseline arrays from
 * seeds/01_dev_dummy_data.js (union leaves grants included) and merges with
 * whatever is currently stored, defensively handling BOTH shapes
 * (string or pre-parsed object).
 */

// Canonical baseline permissions from seeds/01_dev_dummy_data.js
const BASELINE_PERMISSIONS = {
	super_admin: [
		'projects:read',
		'projects:create',
		'projects:update',
		'projects:delete',
		'projects:close',
		'leads:read',
		'leads:create',
		'leads:update',
		'leads:delete',
		'quotations:read',
		'quotations:update',
		'purchase_orders:read',
		'purchase_orders:update',
		'invoices:read',
		'invoices:update',
		'employees:read',
		'employees:update',
		'users:read',
		'users:create',
		'users:update',
		'users:delete',
		'companies:read',
		'companies:update',
		'reports:read',
	],
	project_manager: [
		'projects:read',
		'projects:update',
		'projects:close',
		'leads:read',
		'quotations:read',
		'purchase_orders:read',
		'invoices:read',
		'reports:read',
	],
	employee: ['projects:read', 'leads:read'],
};

const LEAVES_GRANTS = {
	super_admin: [
		'leaves:read',
		'leaves:create',
		'leaves:update',
		'leaves:delete',
		'leaves:approve',
	],
	project_manager: ['leaves:read', 'leaves:create', 'leaves:approve'],
	employee: ['leaves:read', 'leaves:create'],
};

/** Parse a permissions value that may arrive as a JSON string OR an
 *  already-parsed array (mysql2/knex auto-parse behaviour). */
function parsePermissions(raw) {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter((k) => typeof k === 'string');
	if (typeof raw === 'object') {
		return Object.values(raw).filter((k) => typeof k === 'string');
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((k) => typeof k === 'string')
			: [];
	} catch (_) {
		return [];
	}
}

export async function up(knex) {
	const roles = await knex
		.select('id', 'role_code', 'permissions')
		.from('roles_master');

	for (const role of roles) {
		const baseline =
			BASELINE_PERMISSIONS[role.role_code] ?? BASELINE_PERMISSIONS.employee;
		const grants = LEAVES_GRANTS[role.role_code] ?? LEAVES_GRANTS.employee;

		const current = parsePermissions(role.permissions);
		const next = Array.from(
			new Set([
				...baseline,
				...current.filter((k) => !k.startsWith('leaves:')),
				...grants,
			])
		);

		await knex('roles_master')
			.where({ id: role.id })
			.update({ permissions: JSON.stringify(next) });
	}
}

export async function down(knex) {
	// No-op: restoring lost baseline data must not be reversible.
}
