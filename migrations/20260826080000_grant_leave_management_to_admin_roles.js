/**
 * Grant leave-management actions to production's admin role.
 *
 * Production uses role codes unlike dev (e.g. 'ADMIN', 'MD', 'ENG_HEAD'),
 * so the baseline grants in 20260825120000 fell back to read/create for
 * everything and nobody could approve leaves. This adds the full
 * management set (update/delete/approve) to admin-coded roles.
 *
 * Broader approver roles (managers, department heads) can be granted from
 * the Roles master UI once admins decide the approval chain.
 */

const MANAGEMENT_ACTIONS = ['update', 'delete', 'approve'];

function parsePermissions(raw) {
	// mysql2/knex may deliver this LONGTEXT column already JSON-parsed.
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
	const admins = await knex('roles_master')
		.select('id', 'role_code', 'permissions')
		.whereRaw('LOWER(role_code) LIKE ?', ['%admin%']);

	for (const role of admins) {
		const current = parsePermissions(role.permissions);
		const merged = new Set([
			...current,
			...MANAGEMENT_ACTIONS.map((action) => `leaves:${action}`),
		]);
		const next = Array.from(merged);

		if (next.length !== current.length) {
			await knex('roles_master')
				.where({ id: role.id })
				.update({ permissions: JSON.stringify(next) });
		}
	}
}

export async function down(knex) {
	const admins = await knex('roles_master')
		.select('id', 'role_code', 'permissions')
		.whereRaw('LOWER(role_code) LIKE ?', ['%admin%']);

	for (const role of admins) {
		const current = parsePermissions(role.permissions);
		const next = current.filter(
			(key) =>
				!['leaves:update', 'leaves:delete', 'leaves:approve'].includes(key)
		);

		if (next.length !== current.length) {
			await knex('roles_master')
				.where({ id: role.id })
				.update({ permissions: JSON.stringify(next) });
		}
	}
}
