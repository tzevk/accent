import { describe, expect, it } from 'vitest';
import { up as applyScopes } from '../../../migrations/20261104120000_project_permission_scopes.js';

type UserRow = {
	id: number;
	role_id?: number | null;
	permissions?: unknown;
	field_permissions?: unknown;
};

type RoleRow = { id: number; permissions?: unknown };

/**
 * Minimal knex double for the migration's select/from and
 * where/update builder calls.
 */
function createKnex(users: UserRow[], roles: RoleRow[] = []) {
	const userRows = users.map((user) => ({ ...user }));
	const updates: Array<{
		where: Record<string, unknown>;
		values: Record<string, unknown>;
	}> = [];

	const table = (rows: Record<string, unknown>[]) => {
		const state: { where?: Record<string, unknown> } = {};
		const chain = {
			where(condition: Record<string, unknown>) {
				state.where = condition;
				return chain;
			},
			async update(values: Record<string, unknown>) {
				updates.push({ where: state.where ?? {}, values });
				for (const row of rows) {
					if (
						Object.entries(state.where ?? {}).every(
							([key, value]) => row[key] === value
						)
					) {
						Object.assign(row, values);
					}
				}
				return 1;
			},
		};
		return chain;
	};

	const rowsFor = (tableName: string) =>
		tableName === 'users'
			? (userRows as unknown as Record<string, unknown>[])
			: (roles as unknown as Record<string, unknown>[]);

	const knex = (tableName: string) => {
		const rows = rowsFor(tableName);
		return table(rows);
	};

	knex.select = () => ({
		from: async (tableName: string) => rowsFor(tableName),
	});

	return { knex, userRows, updates };
}

function savedPermissions(row: Record<string, unknown>) {
	return JSON.parse(String(row.field_permissions));
}

describe('project permission scope migration', () => {
	it('seeds all-projects scope for a role-derived project grant', async () => {
		const { knex, userRows, updates } = createKnex(
			[{ id: 1, role_id: 5, permissions: [], field_permissions: {} }],
			[{ id: 5, permissions: ['projects:read', 'projects:update'] }]
		);

		await applyScopes(knex);

		expect(updates).toHaveLength(1);
		expect(savedPermissions(userRows[0]).projectScopes.projects).toEqual({
			read: 'all',
			update: 'all',
		});
	});

	it('seeds all-projects scope for a nested crud-only grant', async () => {
		const { knex, userRows, updates } = createKnex([
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

		await applyScopes(knex);

		expect(updates).toHaveLength(1);
		expect(savedPermissions(userRows[0]).projectScopes.projects).toEqual({
			read: 'all',
			update: 'all',
		});
	});

	it('ignores nested crud entries when the projects module is disabled', async () => {
		const { knex, updates } = createKnex([
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

		await applyScopes(knex);

		expect(updates).toHaveLength(0);
	});

	it('preserves existing scopes and never downgrades them', async () => {
		const { knex, userRows } = createKnex([
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

		await applyScopes(knex);

		expect(savedPermissions(userRows[0]).projectScopes.projects).toEqual({
			update: 'led',
			read: 'all',
		});
	});

	it('is idempotent on a second run', async () => {
		const { knex, updates } = createKnex([
			{
				id: 5,
				role_id: null,
				permissions: [],
				field_permissions: {
					modules: { projects: { enabled: true, crud: { update: true } } },
				},
			},
		]);

		await applyScopes(knex);
		expect(updates).toHaveLength(1);

		await applyScopes(knex);
		expect(updates).toHaveLength(1);
	});
});
