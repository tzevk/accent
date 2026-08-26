/**
 * Self-service leaves access for users without an assigned role.
 *
 * Production finding: every non-super-admin user has users.role_id NULL,
 * so role-based grants (roles_master.permissions) never reach them and any
 * permission check fails (403) — including the new /api/leaves endpoints.
 *
 * Assigning real roles is an organisational decision; until then this grants
 * leaves:read + leaves:create directly through the users.permissions
 * override channel to active, non-super-admin, role-less accounts.
 *
 * Idempotent and shape-safe (permissions may arrive as string OR array —
 * see 20260825120000_create_leave_system.js).
 */

const SELF_SERVICE_KEYS = ['leaves:read', 'leaves:create'];

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
	const users = await knex('users')
		.select('id', 'permissions')
		.whereNull('role_id')
		.where({ isDelete: 0 })
		.andWhere(function () {
			this.where('is_super_admin', 0).orWhereNull('is_super_admin');
		})
		.andWhere(function () {
			this.where('is_active', 1).orWhereNull('is_active');
		})
		.andWhere(function () {
			this.where('status', 'active').orWhereNull('status');
		});

	let updated = 0;
	for (const user of users) {
		const current = parsePermissions(user.permissions);
		const merged = new Set([...current, ...SELF_SERVICE_KEYS]);
		const next = Array.from(merged);

		if (next.length !== current.length) {
			await knex('users')
				.where({ id: user.id })
				.update({ permissions: JSON.stringify(next) });
			updated++;
		}
	}
	console.log(
		`grant_leaves_self_service: ${updated} of ${users.length} role-less users updated`
	);
}

export async function down(knex) {
	const users = await knex('users')
		.select('id', 'permissions')
		.whereNull('role_id')
		.where({ isDelete: 0 })
		.andWhere(function () {
			this.where('is_super_admin', 0).orWhereNull('is_super_admin');
		});

	for (const user of users) {
		const current = parsePermissions(user.permissions);
		if (current.length === 0) continue;
		const next = current.filter((k) => !SELF_SERVICE_KEYS.includes(k));

		if (next.length !== current.length) {
			await knex('users')
				.where({ id: user.id })
				.update({ permissions: JSON.stringify(next) });
		}
	}
}
