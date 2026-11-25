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

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

const SELF_SERVICE_KEYS = ['leaves:read', 'leaves:create'];

function parsePermissions(raw: unknown): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw.filter((key): key is string => typeof key === 'string');
	}
	if (typeof raw === 'object') {
		return Object.values(raw).filter(
			(key): key is string => typeof key === 'string'
		);
	}
	try {
		const parsed: unknown = JSON.parse(String(raw));
		return Array.isArray(parsed)
			? parsed.filter((key): key is string => typeof key === 'string')
			: [];
	} catch {
		return [];
	}
}

interface UserRow {
	id: number | string;
	permissions: unknown;
}

export async function up(db: MigrationDb): Promise<void> {
	const [users] = await executeMigrationSql(
		db,
		`SELECT id, permissions
		 FROM users
		 WHERE role_id IS NULL
		   AND isDelete = ?
		   AND (is_super_admin = ? OR is_super_admin IS NULL)
		   AND (is_active = ? OR is_active IS NULL)
		   AND (status = ? OR status IS NULL)`,
		[0, 0, 1, 'active']
	);

	let updated = 0;
	for (const user of users as UserRow[]) {
		const current = parsePermissions(user.permissions);
		const merged = new Set([...current, ...SELF_SERVICE_KEYS]);
		const next = Array.from(merged);

		if (next.length !== current.length) {
			await executeMigrationSql(
				db,
				`UPDATE users
				 SET permissions = ?
				 WHERE id = ?`,
				[JSON.stringify(next), user.id]
			);
			updated++;
		}
	}
	console.log(
		`grant_leaves_self_service: ${updated} of ${users.length} role-less users updated`
	);
}
