import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/database', () => ({ dbConnect: vi.fn() }));
vi.mock('@/utils/api-permissions', () => ({ getCurrentUser: vi.fn() }));

import { loadLeadPolicy } from './server';
import { WORK_SECTION_IDS } from './sections';

type PolicyRow = { sections?: unknown };

function dbWith(rows: PolicyRow[]) {
	return {
		execute: vi.fn().mockResolvedValue([rows, []]),
	};
}

describe('loadLeadPolicy', () => {
	it('falls back to the default only when the row is absent', async () => {
		const policy = await loadLeadPolicy(dbWith([]));

		expect(policy.sections).toEqual(
			Object.fromEntries(WORK_SECTION_IDS.map((section) => [section, 'edit']))
		);
	});

	it('reads the stored section map, including a JSON string column', async () => {
		const policy = await loadLeadPolicy(
			dbWith([
				{
					sections: JSON.stringify({
						project_details: 'hidden',
						scope: 'view',
					}),
				},
			])
		);

		expect(policy.sections.project_details).toBe('hidden');
		expect(policy.sections.scope).toBe('view');
		expect(policy.sections.documents_issued).toBe('edit');
	});

	it('reads a JSON column that arrives already parsed', async () => {
		const policy = await loadLeadPolicy(
			dbWith([{ sections: { scope: 'hidden' } }])
		);

		expect(policy.sections.scope).toBe('hidden');
	});

	it('throws when the stored value is not valid JSON', async () => {
		await expect(
			loadLeadPolicy(dbWith([{ sections: '{not json' }]))
		).rejects.toThrow('not valid JSON');
	});

	it.each([
		['null', null],
		['a number', 12],
		['an array', ['edit']],
	])('throws when the stored value is %s', async (_label, sections) => {
		await expect(loadLeadPolicy(dbWith([{ sections }]))).rejects.toThrow(
			'must be an object'
		);
	});

	it.each([
		['null', { sections: null }],
		['a number', { sections: 12 }],
		['an array', { sections: ['edit'] }],
		['a string', { sections: 'project_details=hidden' }],
	])(
		'throws instead of widening every section when a wrapped sections value is %s',
		async (_label, sections) => {
			await expect(loadLeadPolicy(dbWith([{ sections }]))).rejects.toThrow(
				'must be an object'
			);
		}
	);

	it('reads a wrapped sections object written by hand', async () => {
		const policy = await loadLeadPolicy(
			dbWith([{ sections: { sections: { scope: 'hidden' } } }])
		);

		expect(policy.sections.scope).toBe('hidden');
		expect(policy.sections.project_details).toBe('edit');
	});

	it('propagates a database error so access fails closed', async () => {
		const db = {
			execute: vi.fn().mockRejectedValue(new Error('connection lost')),
		};

		await expect(loadLeadPolicy(db)).rejects.toThrow('connection lost');
	});

	it('queries the singleton row', async () => {
		const db = dbWith([]);
		await loadLeadPolicy(db);

		expect(db.execute).toHaveBeenCalledWith(
			'SELECT sections FROM project_lead_policy WHERE id = 1 LIMIT 1'
		);
	});
});
