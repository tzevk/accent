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

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

const MANAGEMENT_ACTIONS = ['update', 'delete', 'approve'];

function parsePermissions(raw: unknown): string[] {
	// mysql2/knex may deliver this LONGTEXT column already JSON-parsed.
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

interface RoleRow {
	id: number | string;
	permissions: unknown;
}

export async function up(db: MigrationDb): Promise<void> {
	const [admins] = await executeMigrationSql(
		db,
		`SELECT id, role_code, permissions
		 FROM roles_master
		 WHERE LOWER(role_code) LIKE ?`,
		['%admin%']
	);

	for (const role of admins as RoleRow[]) {
		const current = parsePermissions(role.permissions);
		const merged = new Set([
			...current,
			...MANAGEMENT_ACTIONS.map((action) => `leaves:${action}`),
		]);
		const next = Array.from(merged);

		if (next.length !== current.length) {
			await executeMigrationSql(
				db,
				`UPDATE roles_master
				 SET permissions = ?
				 WHERE id = ?`,
				[JSON.stringify(next), role.id]
			);
		}
	}
}
