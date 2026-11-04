import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LEAD_POLICY,
	isLeadSectionSetting,
	normalizeLeadPolicy,
	normalizeLeadSectionRecord,
} from './lead-policy';
import { WORK_SECTION_IDS } from './sections';

const ALL_EDIT = Object.fromEntries(
	WORK_SECTION_IDS.map((section) => [section, 'edit'])
);

describe('DEFAULT_LEAD_POLICY', () => {
	it('sets every work section to edit and nothing else', () => {
		expect(Object.keys(DEFAULT_LEAD_POLICY.sections).sort()).toEqual(
			[...WORK_SECTION_IDS].sort()
		);
		expect(Object.values(DEFAULT_LEAD_POLICY.sections)).toEqual(
			Array.from({ length: WORK_SECTION_IDS.length }, () => 'edit')
		);
	});
});

describe('normalizeLeadPolicy', () => {
	it.each([
		['undefined', undefined],
		['null', null],
		['an empty object', {}],
		['a string', 'edit'],
		['an array', ['hidden']],
	])('defaults every section to edit for %s', (_label, value) => {
		expect(normalizeLeadPolicy(value).sections).toEqual(ALL_EDIT);
	});

	it('keeps the valid settings a stored policy provides', () => {
		const policy = normalizeLeadPolicy({
			sections: {
				project_details: 'hidden',
				scope: 'view',
				documents_issued: 'edit',
			},
		});

		expect(policy.sections.project_details).toBe('hidden');
		expect(policy.sections.scope).toBe('view');
		expect(policy.sections.documents_issued).toBe('edit');
	});

	it('defaults sections missing from the stored policy to edit', () => {
		const policy = normalizeLeadPolicy({ sections: { scope: 'view' } });

		expect(policy.sections.scope).toBe('view');
		for (const section of WORK_SECTION_IDS) {
			if (section === 'scope') continue;
			expect(policy.sections[section]).toBe('edit');
		}
	});

	it('drops unknown section keys', () => {
		const policy = normalizeLeadPolicy({
			sections: {
				scope: 'hidden',
				commercial: 'view',
				not_a_section: 'hidden',
			},
		});

		expect(policy.sections.scope).toBe('hidden');
		expect(Object.keys(policy.sections).sort()).toEqual(
			[...WORK_SECTION_IDS].sort()
		);
		expect(policy.sections).not.toHaveProperty('commercial');
		expect(policy.sections).not.toHaveProperty('not_a_section');
	});

	it('defaults an unknown setting value to edit', () => {
		const policy = normalizeLeadPolicy({
			sections: { scope: 'admin', project_details: true },
		});

		expect(policy.sections.scope).toBe('edit');
		expect(policy.sections.project_details).toBe('edit');
	});

	it('accepts a bare section map as well as the wrapped shape', () => {
		expect(normalizeLeadPolicy({ scope: 'hidden' }).sections.scope).toBe(
			'hidden'
		);
	});

	it('does not mutate the input', () => {
		const input = { sections: { scope: 'hidden' } };
		normalizeLeadPolicy(input);

		expect(input).toEqual({ sections: { scope: 'hidden' } });
	});

	it('returns a full section record', () => {
		const record = normalizeLeadSectionRecord({ scope: 'view' });

		expect(Object.keys(record).sort()).toEqual([...WORK_SECTION_IDS].sort());
	});
});

describe('isLeadSectionSetting', () => {
	it.each(['hidden', 'view', 'edit'] as const)('accepts %s', (value) => {
		expect(isLeadSectionSetting(value)).toBe(true);
	});

	it.each([[''], ['hidden '], ['EDIT'], [true], [null], [1]])(
		'rejects %j',
		(value) => {
			expect(isLeadSectionSetting(value)).toBe(false);
		}
	);
});
