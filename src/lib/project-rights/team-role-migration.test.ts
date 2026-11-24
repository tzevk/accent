import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { up } from '../../../drizzle/history/20261105100000_normalize_project_team_roles.ts';
import type { MigrationDb } from '../../../scripts/migration-sql.ts';

type ProjectRow = Record<string, unknown>;

type UpdateCall = {
	where: Record<string, unknown>;
	values: Record<string, unknown>;
};

/**
 * Minimal Drizzle execution double for the projects table, information_schema
 * column lookups, and role repairs. Updates mutate stored rows so a second
 * `up()` run observes the repaired data.
 */
function createDb(initialRows: ProjectRow[], columns: string[]) {
	const rows = initialRows.map((row) => ({ ...row }));
	const updates: UpdateCall[] = [];
	const dialect = new MySqlDialect();

	const db = {
		async execute(query: SQL) {
			const { sql, params } = dialect.sqlToQuery(query);
			const statement = sql.replace(/\s+/g, ' ').trim();

			if (
				statement ===
				'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1'
			) {
				const [tableName, column] = params;
				if (tableName !== 'projects') {
					throw new Error(`Unexpected schema lookup: ${String(tableName)}`);
				}
				return [columns.includes(String(column)) ? [{ present: 1 }] : [], []];
			}

			const select = statement.match(
				/^SELECT (project_id|id), project_team FROM projects WHERE isDelete = \?$/
			);
			if (select) {
				if (params[0] !== 0) {
					throw new Error(`Unexpected project filter: ${String(params[0])}`);
				}
				const identifier = select[1];
				return [
					rows
						.filter((row) => (row.isDelete ?? 0) === 0)
						.map((row) => ({
							[identifier]: row[identifier],
							project_team: row.project_team,
						})),
					[],
				];
			}

			const update = statement.match(
				/^UPDATE projects SET project_team = \? WHERE (project_id|id) = \?$/
			);
			if (update) {
				const identifier = update[1];
				const [projectTeam, id] = params;
				const matches = rows.filter((row) => row[identifier] === id);
				if (matches.length === 0) {
					throw new Error(`No project matches migration update: ${String(id)}`);
				}
				for (const row of matches) {
					Object.assign(row, { project_team: projectTeam });
				}
				updates.push({
					where: { [identifier]: id },
					values: { project_team: projectTeam },
				});
				return [{ affectedRows: matches.length }, []];
			}

			throw new Error(`Unexpected migration SQL: ${statement}`);
		},
	} as unknown as MigrationDb;

	return { db, rows, updates };
}

const canonicalTeam = JSON.stringify([
	{
		id: 1,
		name: 'Lead User',
		email: 'lead@example.com',
		department: 'Engineering',
		position: 'Design Engineer',
		role: 'Project Lead',
	},
]);

describe('normalize project team roles migration', () => {
	it('repairs a legacy role and preserves every other member field', async () => {
		const team = [
			{
				id: 1,
				name: 'Admin User',
				email: 'admin@example.com',
				department: 'Management',
				designation: 'Project Manager',
				position: 'Super Administrator',
				role: 'Project Manager',
			},
			{
				id: 2,
				name: 'Rahul Sharma',
				email: 'rahul@example.com',
				position: 'Design Engineer',
				role: 'Engineer',
			},
		];
		const { db, updates, rows } = createDb(
			[{ project_id: 10, project_team: JSON.stringify(team) }],
			['project_team', 'project_id', 'id']
		);

		await up(db);

		expect(updates).toHaveLength(1);
		expect(updates[0].where).toEqual({ project_id: 10 });
		const repaired = JSON.parse(String(rows[0].project_team));
		expect(repaired[0]).toEqual({
			id: 1,
			name: 'Admin User',
			email: 'admin@example.com',
			department: 'Management',
			designation: 'Project Manager',
			position: 'Super Administrator',
			role: 'Team Member',
		});
		expect(repaired[1]).toEqual(team[1]);
	});

	it('never turns a legacy value into lead authority', async () => {
		const { db, updates, rows } = createDb(
			[
				{
					project_id: 11,
					project_team: JSON.stringify([{ role: 'Project Manager' }]),
				},
				{
					project_id: 12,
					project_team: JSON.stringify([{ role: 'Lead' }]),
				},
				{
					project_id: 13,
					project_team: JSON.stringify([{ role: 'Team Lead' }]),
				},
			],
			['project_team', 'project_id']
		);

		await up(db);

		expect(updates).toHaveLength(3);
		for (const row of rows) {
			const [member] = JSON.parse(String(row.project_team));
			expect(member.role).toBe('Team Member');
		}
	});

	it('leaves canonical rows untouched and is idempotent', async () => {
		const { db, updates, rows } = createDb(
			[{ project_id: 20, project_team: canonicalTeam }],
			['project_team', 'project_id']
		);

		await up(db);
		expect(updates).toHaveLength(0);
		expect(rows[0].project_team).toBe(canonicalTeam);

		await up(db);
		expect(updates).toHaveLength(0);
		expect(rows[0].project_team).toBe(canonicalTeam);
	});

	it('canonicalises case and whitespace, then does nothing on a second run', async () => {
		const { db, updates, rows } = createDb(
			[
				{
					project_id: 21,
					project_team: JSON.stringify([
						{ role: ' project lead ' },
						{ role: 'QA/QC' },
					]),
				},
			],
			['project_team', 'project_id']
		);

		await up(db);
		expect(updates).toHaveLength(1);
		expect(JSON.parse(String(rows[0].project_team))).toEqual([
			{ role: 'Project Lead' },
			{ role: 'QA/QC' },
		]);

		await up(db);
		expect(updates).toHaveLength(1);
	});

	it('uses the runtime id column when project_id is absent', async () => {
		const { db, updates, rows } = createDb(
			[
				{
					id: 5,
					project_team: JSON.stringify([
						{ id: 3, role: 'Project Manager', position: 'Coordinator' },
					]),
				},
			],
			['project_team', 'id']
		);

		await up(db);

		expect(updates).toHaveLength(1);
		expect(updates[0].where).toEqual({ id: 5 });
		expect(JSON.parse(String(rows[0].project_team))).toEqual([
			{ id: 3, role: 'Team Member', position: 'Coordinator' },
		]);
	});

	it('skips malformed team JSON instead of destroying it', async () => {
		const { db, updates, rows } = createDb(
			[{ project_id: 30, project_team: 'not json' }],
			['project_team', 'project_id']
		);

		await up(db);
		expect(updates).toHaveLength(0);
		expect(rows[0].project_team).toBe('not json');
	});
});
