import { describe, expect, it } from 'vitest';
import {
	down,
	up,
} from '../../../migrations/20261106100000_project_lead_policy.js';
import { WORK_SECTION_IDS } from './sections';

type PolicyRow = { id: number; sections?: string };

/**
 * Minimal knex double: raw DDL/SELECT plus the insert builder the migration
 * uses. Committed rows are readable by a second `up()` run so idempotency is
 * observable.
 */
function createKnex(initialRows: PolicyRow[] = []) {
	const rows = initialRows.map((row) => ({ ...row }));
	const rawCalls: string[] = [];
	const inserts: Record<string, unknown>[] = [];

	function builder() {
		const state: { where?: Record<string, unknown> } = {};

		const chain = {
			where(condition: Record<string, unknown>) {
				state.where = condition;
				return chain;
			},
			async first() {
				const where = state.where ?? {};
				return rows.find((row) =>
					Object.entries(where).every(
						([key, value]) => (row as Record<string, unknown>)[key] === value
					)
				);
			},
			async insert(values: Record<string, unknown>) {
				inserts.push(values);
				rows.push(values as PolicyRow);
				return [1];
			},
		};

		return chain;
	}

	const knex = (table: string) => {
		expect(table).toBe('project_lead_policy');
		return builder();
	};

	knex.raw = async (sql: string) => {
		rawCalls.push(sql);
		if (/^\s*SELECT/i.test(sql)) {
			return [rows.map((row) => ({ id: row.id })), []];
		}
		return [{}, []];
	};

	return { knex, rows, rawCalls, inserts };
}

const ALL_EDIT = Object.fromEntries(
	WORK_SECTION_IDS.map((section) => [section, 'edit'])
);

describe('project lead policy migration', () => {
	it('creates the singleton table and seeds every section editable', async () => {
		const { knex, rawCalls, inserts } = createKnex();

		await up(knex);

		const createCall = rawCalls[0];
		expect(createCall).toContain('CREATE TABLE IF NOT EXISTS project_lead_policy');
		expect(createCall).toContain('sections JSON NOT NULL');
		expect(createCall).toContain('updated_by INT NULL');
		expect(createCall).toContain('PRIMARY KEY (id)');
		expect(createCall).not.toContain('project_id');

		expect(inserts).toHaveLength(1);
		expect(inserts[0].id).toBe(1);
		expect(JSON.parse(String(inserts[0].sections))).toEqual(ALL_EDIT);
	});

	it('never overwrites an operator-saved policy on a second run', async () => {
		const saved = JSON.stringify({ scope: 'view' });
		const { knex, rows, inserts } = createKnex([
			{ id: 1, sections: saved },
		]);

		await up(knex);

		expect(inserts).toHaveLength(0);
		expect(rows).toEqual([{ id: 1, sections: saved }]);
	});
});

describe('project lead policy migration down', () => {
	it('drops the table so the default policy applies again', async () => {
		const { knex, rawCalls } = createKnex();

		await down(knex);

		expect(rawCalls).toContain('DROP TABLE IF EXISTS project_lead_policy');
	});
});
