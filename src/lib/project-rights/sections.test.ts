import { describe, expect, it } from 'vitest';
import {
	PROTECTED_COMMERCIAL_COLUMNS,
	SECTION_COLUMNS,
	SECTION_LABELS,
	SECTION_LIST_COLUMNS,
	SECTION_TABS,
	SECTION_WRITE_COLUMNS,
	SECTION_WRITES,
	WORK_SECTION_IDS,
	isSectionId,
} from '@/lib/project-rights/sections';
import { workSectionCommercialViolations } from '@/lib/project-rights/writes';
import { PROJECT_PERMISSION_SECTIONS } from '@/lib/project-rights/permission-config';
import { PROJECT_TABS } from '@/lib/project-tabs';

describe('project section vocabulary', () => {
	it('gives every work section a config key, tab, and write definition', () => {
		const tabIds = new Set(PROJECT_TABS.map((tab) => tab.id));

		for (const section of WORK_SECTION_IDS) {
			expect(SECTION_LABELS[section], `${section} label`).toBeTruthy();
			expect(SECTION_TABS[section], `${section} tab`).toBeTruthy();
			expect(tabIds.has(SECTION_TABS[section]), `${section} tab exists`).toBe(
				true
			);
			expect(
				PROJECT_PERMISSION_SECTIONS[section],
				`${section} permission config`
			).toBeTruthy();
			expect(Array.isArray(SECTION_COLUMNS[section])).toBe(true);
			expect(Array.isArray(SECTION_WRITE_COLUMNS[section])).toBe(true);
			expect(Array.isArray(SECTION_LIST_COLUMNS[section])).toBe(true);
			expect(SECTION_WRITES[section]).toBeTruthy();
		}
	});

	it('has no write definition keyed to a section outside the vocabulary', () => {
		for (const section of Object.keys(SECTION_WRITES)) {
			expect(isSectionId(section)).toBe(true);
		}
	});

	it('maps no protected commercial column into any work section', () => {
		expect(workSectionCommercialViolations()).toEqual([]);

		for (const section of WORK_SECTION_IDS) {
			for (const column of [
				...SECTION_WRITES[section].columns,
				...SECTION_WRITES[section].listColumns,
			]) {
				expect(PROTECTED_COMMERCIAL_COLUMNS).not.toContain(column);
			}
		}
	});

	it('marks team, discussion, and uploads as non-project writes', () => {
		for (const section of [
			'project_team',
			'discussion',
			'upload_documents',
		] as const) {
			expect(SECTION_WRITES[section].mode).toBe('sub_resource');
			expect(SECTION_WRITES[section].columns).toEqual([]);
			expect(SECTION_WRITES[section].listColumns).toEqual([]);
			expect(SECTION_WRITES[section].writePath).toBeTruthy();
		}
	});
});
