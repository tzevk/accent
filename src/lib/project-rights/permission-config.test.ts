import { describe, expect, it } from 'vitest';
import {
	COMMERCIAL_SECTION,
	COMMERCIAL_COLUMN_ALIASES,
	PROTECTED_COMMERCIAL_COLUMNS,
	WORK_SECTION_IDS,
} from './sections';
import {
	PROJECT_PERMISSION_SECTIONS,
	PROJECT_PERMISSION_MODULE,
	PROJECT_SCOPED_ACTIONS,
	buildProjectScopesPayload,
	buildSectionPayload,
	configuredCommercialColumns,
} from './permission-config';

describe('shared project permission configuration', () => {
	it('exposes exactly the canonical work sections plus commercial', () => {
		expect(Object.keys(PROJECT_PERMISSION_MODULE.sections).sort()).toEqual(
			[...WORK_SECTION_IDS, COMMERCIAL_SECTION].sort()
		);
	});

	it('does not expose a configurable section the policy ignores', () => {
		for (const sectionKey of Object.keys(PROJECT_PERMISSION_SECTIONS)) {
			expect(
				(WORK_SECTION_IDS as readonly string[]).includes(sectionKey) ||
					sectionKey === COMMERCIAL_SECTION
			).toBe(true);
		}
	});

	it('gives every configurable section at least one field', () => {
		for (const section of Object.values(PROJECT_PERMISSION_SECTIONS)) {
			expect(Object.keys(section.fields).length).toBeGreaterThan(0);
		}
	});

	it('covers every protected commercial column', () => {
		const configured = configuredCommercialColumns();
		for (const column of PROTECTED_COMMERCIAL_COLUMNS) {
			expect(configured).toContain(column);
		}
	});

	it('maps the commercial field aliases to real protected columns', () => {
		const fields = PROJECT_PERMISSION_SECTIONS[COMMERCIAL_SECTION].fields;
		const columns = Object.keys(fields).map(
			(fieldKey) => COMMERCIAL_COLUMN_ALIASES[fieldKey] ?? fieldKey
		);
		expect(columns).toEqual(
			expect.arrayContaining([
				'budget',
				'project_value',
				'cost_to_company',
				'profitability_estimate',
				'actual_profit_loss',
			])
		);
	});

	it('keys repeated field names per section when saving', () => {
		const saved = buildSectionPayload(
			PROJECT_PERMISSION_SECTIONS,
			{
				project_activity: { estimated_hours: 'edit' },
				project_manhours: { estimated_hours: 'hidden' },
			},
			{ project_activity: true, project_manhours: true }
		);

		expect(
			saved.project_activity.fields.estimated_hours.permission
		).toBe('edit');
		expect(
			saved.project_manhours.fields.estimated_hours.permission
		).toBe('hidden');
	});

	it('saves a granted action scope and fails a missing scope closed to led', () => {
		const scopes = buildProjectScopesPayload(
			{ read: 'all', update: 'assigned' },
			['read', 'update', 'close']
		);

		expect(scopes).toEqual({
			read: 'all',
			update: 'assigned',
			close: 'led',
		});
	});

	it('never saves a scope for an action that is not granted', () => {
		const scopes = buildProjectScopesPayload({ delete: 'all' }, ['read']);

		expect(scopes).toEqual({ read: 'led' });
		expect(PROJECT_SCOPED_ACTIONS).not.toContain('create');
	});
});
