import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { up } from '../../../drizzle/history/20261106100000_project_lead_policy.ts';
import type { MigrationDb } from '../../../scripts/migration-sql.ts';
import { WORK_SECTION_IDS } from './sections';

type PolicyRow = {
	id: number;
	sections?: string;
	updated_by?: number | null;
};

type QueryCall = { sql: string; params: unknown[] };

/**
 * Minimal Drizzle execution double for the migration's DDL, singleton lookup,
 * and insert. Stored rows remain readable by later runs so idempotency is
 * observable.
 */
function createDb(initialRows: PolicyRow[] = []) {
	const rows = initialRows.map((row) => ({ ...row }));
	const queries: QueryCall[] = [];
	const dialect = new MySqlDialect();

	const db = {
		async execute(query: SQL) {
			const { sql, params } = dialect.sqlToQuery(query);
			queries.push({ sql, params });
			const statement = sql.replace(/\s+/g, ' ').trim();

			if (
				statement.startsWith('CREATE TABLE IF NOT EXISTS project_lead_policy')
			) {
				return [[], []];
			}
			if (
				statement === 'SELECT id FROM project_lead_policy WHERE id = 1 LIMIT 1'
			) {
				return [
					rows.filter((row) => row.id === 1).map((row) => ({ id: row.id })),
					[],
				];
			}
			if (
				statement ===
				'INSERT INTO project_lead_policy (id, sections, updated_by) VALUES (?, ?, ?)'
			) {
				const [id, sections, updatedBy] = params;
				rows.push({
					id: Number(id),
					sections: String(sections),
					updated_by: updatedBy as number | null,
				});
				return [{ affectedRows: 1 }, []];
			}

			throw new Error(`Unexpected migration SQL: ${statement}`);
		},
	} as unknown as MigrationDb;

	return { db, rows, queries };
}

const ALL_EDIT = Object.fromEntries(
	WORK_SECTION_IDS.map((section) => [section, 'edit'])
);

describe('project lead policy migration', () => {
	it('creates the singleton table and seeds every section editable', async () => {
		const { db, rows, queries } = createDb();

		await up(db);

		const createCall = queries[0].sql;
		expect(createCall).toContain(
			'CREATE TABLE IF NOT EXISTS project_lead_policy'
		);
		expect(createCall).toContain('sections JSON NOT NULL');
		expect(createCall).toContain('updated_by INT NULL');
		expect(createCall).toContain('PRIMARY KEY (id)');
		expect(createCall).not.toContain('project_id');

		expect(rows).toEqual([
			{ id: 1, sections: JSON.stringify(ALL_EDIT), updated_by: null },
		]);
		const insertCall = queries.find(({ sql }) =>
			/^\s*INSERT INTO project_lead_policy/i.test(sql)
		);
		expect(insertCall?.params).toEqual([1, JSON.stringify(ALL_EDIT), null]);
	});

	it('never overwrites an operator-saved policy on a second run', async () => {
		const saved = JSON.stringify({ scope: 'view' });
		const { db, rows, queries } = createDb([{ id: 1, sections: saved }]);

		await up(db);
		await up(db);

		expect(rows).toEqual([{ id: 1, sections: saved }]);
		expect(
			queries.filter(({ sql }) =>
				/^\s*INSERT INTO project_lead_policy/i.test(sql)
			)
		).toHaveLength(0);
	});
});
