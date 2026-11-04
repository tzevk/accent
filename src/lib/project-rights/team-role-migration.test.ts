import { describe, expect, it } from 'vitest';
import { up } from '../../../migrations/20261105100000_normalize_project_team_roles.js';

type ProjectRow = Record<string, unknown>;

type UpdateCall = {
	where: Record<string, unknown>;
	values: Record<string, unknown>;
};

/**
 * Minimal knex double: one `projects` table, information_schema column
 * lookups, and chainable select/where/update. Updates mutate the rows so a
 * second `up()` run observes the repaired data.
 */
function createKnex(initialRows: ProjectRow[], columns: string[]) {
	const rows = initialRows.map((row) => ({ ...row }));
	const updates: UpdateCall[] = [];

	function queryBuilder() {
		const state: {
			where?: Record<string, unknown>;
		} = {};

		const builder = {
			select() {
				return builder;
			},
			where(condition: Record<string, unknown>) {
				state.where = condition;
				return builder;
			},
			update(values: Record<string, unknown>) {
				updates.push({ where: state.where ?? {}, values });
				const where = state.where ?? {};
				for (const row of rows) {
					const matches = Object.entries(where).every(
						([key, value]) => row[key] === value
					);
					if (matches) Object.assign(row, values);
				}
				return Promise.resolve(1);
			},
			then(
				resolve: (value: ProjectRow[]) => unknown,
				reject?: (reason: unknown) => unknown
			) {
				return Promise.resolve(rows).then(resolve, reject);
			},
		};

		return builder;
	}

	const knex = (table: string) => {
		expect(table).toBe('projects');
		return queryBuilder();
	};
	knex.raw = async (_sql: string, params: unknown[]) => {
		const column = String(params?.[1] ?? '');
		return [columns.includes(column) ? [{ present: 1 }] : [], []];
	};

	return { knex, rows, updates };
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
		const { knex, updates, rows } = createKnex(
			[{ project_id: 10, project_team: JSON.stringify(team) }],
			['project_team', 'project_id', 'id']
		);

		await up(knex);

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
		const { knex, rows } = createKnex(
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

		await up(knex);

		for (const row of rows) {
			const [member] = JSON.parse(String(row.project_team));
			expect(member.role).toBe('Team Member');
		}
	});

	it('leaves canonical rows untouched and is idempotent', async () => {
		const { knex, updates } = createKnex(
			[{ project_id: 20, project_team: canonicalTeam }],
			['project_team', 'project_id']
		);

		await up(knex);
		expect(updates).toHaveLength(0);

		await up(knex);
		expect(updates).toHaveLength(0);
	});

	it('canonicalises case and whitespace, then does nothing on a second run', async () => {
		const { knex, updates, rows } = createKnex(
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

		await up(knex);
		expect(updates).toHaveLength(1);
		expect(JSON.parse(String(rows[0].project_team))).toEqual([
			{ role: 'Project Lead' },
			{ role: 'QA/QC' },
		]);

		await up(knex);
		expect(updates).toHaveLength(1);
	});

	it('uses the runtime id column when project_id is absent', async () => {
		const { knex, updates } = createKnex(
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

		await up(knex);

		expect(updates).toHaveLength(1);
		expect(updates[0].where).toEqual({ id: 5 });
	});

	it('skips malformed team JSON instead of destroying it', async () => {
		const { knex, updates } = createKnex(
			[{ project_id: 30, project_team: 'not json' }],
			['project_team', 'project_id']
		);

		await up(knex);
		expect(updates).toHaveLength(0);
	});
});
