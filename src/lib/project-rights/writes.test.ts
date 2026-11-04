import { describe, expect, it } from 'vitest';
import {
	buildSectionUpdate,
	validateSectionWrite,
	workSectionCommercialViolations,
} from '@/lib/project-rights/writes';

describe('validateSectionWrite', () => {
	it('accepts a permitted section and splits direct from list columns', () => {
		const result = validateSectionWrite('project_details', {
			name: 'Alpha',
			priority: 'HIGH',
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.section).toBe('project_details');
		expect(result.columns).toEqual(['name', 'priority']);
		expect(result.listColumns).toEqual([]);
	});

	it('accepts list columns for the section that owns them', () => {
		const result = validateSectionWrite('project_activity', {
			project_activities_list: [],
			team_members: [],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.listColumns).toEqual([
			'project_activities_list',
			'team_members',
		]);
	});

	it('rejects an unknown section', () => {
		const result = validateSectionWrite('nonsense', { name: 'x' });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNKNOWN_SECTION');
	});

	it('rejects a missing section', () => {
		const result = validateSectionWrite(undefined, { name: 'x' });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNKNOWN_SECTION');
	});

	it('rejects an out-of-section field instead of ignoring it', () => {
		const result = validateSectionWrite('scope', { name: 'Alpha' });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNKNOWN_FIELD');
		expect(result.field).toBe('name');
	});

	it('rejects a protected commercial column in a work section', () => {
		const result = validateSectionWrite('project_details', { budget: 100 });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('PROTECTED_FIELD');
	});

	it('rejects non-object values and empty values', () => {
		expect(validateSectionWrite('scope', []).ok).toBe(false);
		expect(validateSectionWrite('scope', null).ok).toBe(false);
		expect(validateSectionWrite('scope', {}).ok).toBe(false);
	});

	it('rejects sections that are not saved through the project row', () => {
		for (const section of ['project_team', 'discussion', 'upload_documents']) {
			const result = validateSectionWrite(section, { project_team: [] });
			expect(result.ok).toBe(false);
			if (result.ok) continue;
			expect(result.code).toBe('SECTION_NOT_WRITABLE');
		}
	});

	it('allows commercial columns only through the commercial section', () => {
		const denied = validateSectionWrite('commercial', { budget: 100 });
		expect(denied.ok).toBe(false);
		if (denied.ok) return;
		expect(denied.code).toBe('PROTECTED_FIELD');

		const allowed = validateSectionWrite(
			'commercial',
			{ budget: 100 },
			{ commercialEdit: ['budget'] }
		);
		expect(allowed.ok).toBe(true);
		if (!allowed.ok) return;
		expect(allowed.columns).toEqual(['budget']);
	});

	it('rejects a non-commercial key inside a commercial save', () => {
		const result = validateSectionWrite(
			'commercial',
			{ budget: 100, name: 'x' },
			{ commercialEdit: ['budget'] }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNKNOWN_FIELD');
	});
});

describe('buildSectionUpdate', () => {
	it('serializes list columns and keeps direct values', () => {
		const result = buildSectionUpdate('documents_issued', {
			documents_issued_list: [{ document_number: 'D-1' }],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.update.columns).toEqual(['documents_issued_list']);
		expect(result.update.params).toEqual([
			'[{"document_number":"D-1"}]',
		]);
		expect(result.update.listColumns).toEqual(['documents_issued_list']);
	});

	it('passes pre-serialized strings and null through untouched', () => {
		const result = buildSectionUpdate('project_handover', {
			project_handover_list: '[{"id":1}]',
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.update.params).toEqual(['[{"id":1}]']);
	});

	it('returns the validation failure without producing SQL values', () => {
		const result = buildSectionUpdate('project_details', { budget: 1 });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('PROTECTED_FIELD');
	});

	it('reports no work section mapping a protected commercial column', () => {
		expect(workSectionCommercialViolations()).toEqual([]);
	});
});
