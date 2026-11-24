import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { up as applyScopes } from '../../../drizzle/history/20261104120000_project_permission_scopes.ts';
import type { MigrationDb } from '../../../scripts/migration-sql.ts';

type UserRow = {
	id: number;
	role_id?: number | null;
	permissions?: unknown;
	field_permissions?: unknown;
};

type RoleRow = { id: number; permissions?: unknown };

/**
 * Minimal Drizzle execution double for the migration's user and role reads.
 * Updates mutate stored rows so a second run observes the seeded scopes.
 */
function createDb(users: UserRow[], roles: RoleRow[] = []) {
	const userRows = users.map((user) => ({ ...user }));
	const roleRows = roles.map((role) => ({ ...role }));
	const updates: Array<{
		where: Record<string, unknown>;
		values: Record<string, unknown>;
	}> = [];
	const dialect = new MySqlDialect();

	const db = {
		async execute(query: SQL) {
			const { sql, params } = dialect.sqlToQuery(query);
			const statement = sql.replace(/\s+/g, ' ').trim();

			if (
				statement ===
				'SELECT id, role_id, permissions, field_permissions FROM users'
			) {
				return [userRows, []];
			}
			if (statement === 'SELECT id, permissions FROM roles_master') {
				return [roleRows, []];
			}
			if (statement === 'UPDATE users SET field_permissions = ? WHERE id = ?') {
				const [fieldPermissions, id] = params;
				const matches = userRows.filter((row) => row.id === id);
				if (matches.length === 0) {
					throw new Error(`No user matches migration update: ${String(id)}`);
				}
				for (const row of matches) {
					Object.assign(row, { field_permissions: fieldPermissions });
				}
				updates.push({
					where: { id },
					values: { field_permissions: fieldPermissions },
				});
				return [{ affectedRows: matches.length }, []];
			}

			throw new Error(`Unexpected migration SQL: ${statement}`);
		},
	} as unknown as MigrationDb;

	return { db, userRows, updates };
}

function savedPermissions(row: UserRow) {
	return JSON.parse(String(row.field_permissions));
}

describe('project permission scope migration', () => {
	it('seeds all-projects scope for a role-derived project grant', async () => {
		const { db, userRows, updates } = createDb(
			[{ id: 1, role_id: 5, permissions: [], field_permissions: {} }],
			[{ id: 5, permissions: ['projects:read', 'projects:update'] }]
		);

		await applyScopes(db);

		expect(updates).toHaveLength(1);
		expect(savedPermissions(userRows[0]).projectScopes.projects).toEqual({
			read: 'all',
			update: 'all',
		});
	});

	it('seeds all-projects scope for a nested crud-only grant', async () => {
		const { db, userRows, updates } = createDb([
			{
				id: 2,
				role_id: null,
				permissions: [],
				field_permissions: {
					modules: {
						projects: {
							enabled: true,
							crud: { read: true, update: true, close: false },
						},
					},
				},
			},
		]);

		await applyScopes(db);

		expect(updates).toHaveLength(1);
		expect(savedPermissions(userRows[0]).projectScopes.projects).toEqual({
			read: 'all',
			update: 'all',
		});
	});

	it('ignores nested crud entries when the projects module is disabled', async () => {
		const { db, updates } = createDb([
			{
				id: 3,
				role_id: null,
				permissions: [],
				field_permissions: {
					modules: {
						projects: {
							enabled: false,
							crud: { update: true },
						},
					},
				},
			},
		]);

		await applyScopes(db);

		expect(updates).toHaveLength(0);
	});

	it('preserves existing scopes and never downgrades them', async () => {
		const { db, userRows } = createDb([
			{
				id: 4,
				role_id: null,
				permissions: ['projects:update'],
				field_permissions: {
					modules: {
						projects: { enabled: true, crud: { read: true } },
					},
					projectScopes: { projects: { update: 'led' } },
				},
			},
		]);

		await applyScopes(db);

		expect(savedPermissions(userRows[0]).projectScopes.projects).toEqual({
			update: 'led',
			read: 'all',
		});
	});

	it('is idempotent on a second run', async () => {
		const { db, userRows, updates } = createDb([
			{
				id: 5,
				role_id: null,
				permissions: [],
				field_permissions: {
					modules: { projects: { enabled: true, crud: { update: true } } },
				},
			},
		]);

		await applyScopes(db);
		expect(updates).toHaveLength(1);
		const saved = savedPermissions(userRows[0]);

		await applyScopes(db);
		expect(updates).toHaveLength(1);
		expect(savedPermissions(userRows[0])).toEqual(saved);
	});
});
