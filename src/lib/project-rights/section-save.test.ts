import { describe, expect, it } from 'vitest';
import {
	collectProjectSnapshot,
	collectSectionSnapshot,
	diffSectionSaves,
	pickSectionValues,
	prepareSectionValues,
} from '@/lib/project-rights/section-save';

const loadedProject = {
	project_id: 10,
	name: 'Alpha',
	project_code: 'PRJ-10',
	priority: 'HIGH',
	start_date: new Date('2026-01-05T00:00:00.000Z'),
	scope_of_work: '<p>Scope</p>',
	additional_scope: 'none',
	project_activities_list: '[{"id":"a1","name":"Design"}]',
	planning_activities_list: '[]',
	team_members: '[]',
	documents_issued_list: '[{"document_number":"D-1"}]',
	project_schedule_list: '{"locked":false,"rows":[]}',
	project_team: '[{"user_id":7,"role":"Project Lead"}]',
	budget: '1000',
	project_value: '5000',
};

function currentSource(overrides: Record<string, unknown> = {}) {
	return {
		...loadedProject,
		start_date: '2026-01-05',
		project_activities_list: [{ id: 'a1', name: 'Design' }],
		planning_activities_list: [],
		team_members: [],
		documents_issued_list: [{ document_number: 'D-1' }],
		project_schedule_list: { locked: false, rows: [] },
		...overrides,
	};
}

describe('section snapshots', () => {
	it('parses list columns from raw project rows and keeps direct values', () => {
		const snapshot = collectProjectSnapshot(loadedProject);

		expect(snapshot.project_activity?.project_activities_list).toEqual([
			{ id: 'a1', name: 'Design' },
		]);
		expect(snapshot.project_details?.name).toBe('Alpha');
		expect(snapshot.project_details?.budget).toBeUndefined();
	});

	it('picks only the columns a section owns', () => {
		const values = pickSectionValues('scope', {
			scope_of_work: 's',
			additional_scope: 'a',
			description: 'not scope',
		});

		expect(values).toEqual({
			scope_of_work: 's',
			additional_scope: 'a',
		});
	});
});

describe('diffSectionSaves', () => {
	const editableSections = [
		'project_details',
		'scope',
		'project_activity',
		'project_schedule',
		'documents_issued',
	] as const;

	it('returns nothing when the screen matches the loaded project', () => {
		const initial = collectProjectSnapshot(loadedProject);
		const current = collectSectionSnapshot(currentSource(), {
			parseLists: false,
		});

		expect(diffSectionSaves(initial, current, editableSections)).toEqual([]);
	});

	it('sends only the changed columns of the changed section', () => {
		const initial = collectProjectSnapshot(loadedProject);
		const current = collectSectionSnapshot(
			currentSource({ name: 'Beta', priority: 'HIGH' }),
			{ parseLists: false }
		);

		const changes = diffSectionSaves(initial, current, editableSections);

		expect(changes).toEqual([
			{ section: 'project_details', values: { name: 'Beta' } },
		]);
	});

	it('ignores a changed section the actor cannot edit', () => {
		const initial = collectProjectSnapshot(loadedProject);
		const current = collectSectionSnapshot(
			currentSource({ name: 'Beta', scope_of_work: 'changed' }),
			{ parseLists: false }
		);

		const changes = diffSectionSaves(initial, current, ['scope']);

		expect(changes).toEqual([
			{ section: 'scope', values: { scope_of_work: 'changed' } },
		]);
	});

	it('never emits the team column or a commercial column', () => {
		const initial = collectProjectSnapshot(loadedProject);
		const current = collectSectionSnapshot(
			currentSource({
				project_team: '[{"user_id":7,"role":"Project Lead"}]',
				budget: '9000',
			}),
			{ parseLists: false }
		);

		const changes = diffSectionSaves(initial, current, [
			'project_team',
			'project_details',
		]);

		expect(changes).toEqual([]);
	});

	it('detects a changed list column and sends the current value', () => {
		const initial = collectProjectSnapshot(loadedProject);
		const current = collectSectionSnapshot(
			currentSource({
				documents_issued_list: [{ document_number: 'D-2' }],
			}),
			{ parseLists: false }
		);

		const changes = diffSectionSaves(initial, current, editableSections);

		expect(changes).toEqual([
			{
				section: 'documents_issued',
				values: {
					documents_issued_list: [{ document_number: 'D-2' }],
				},
			},
		]);
	});

	it('treats blank dates and numbers as equal across row and form shapes', () => {
		const initial = collectProjectSnapshot({
			...loadedProject,
			start_date: null,
			estimated_manhours: '12',
		});
		const current = collectSectionSnapshot(
			currentSource({
				start_date: '',
				estimated_manhours: '12',
			}),
			{ parseLists: false }
		);

		expect(diffSectionSaves(initial, current, ['project_details'])).toEqual([]);
	});
});

describe('prepareSectionValues', () => {
	it('turns blank date and numeric inputs into null', () => {
		const values = prepareSectionValues('project_details', {
			name: 'Alpha',
			start_date: '',
			estimated_manhours: '  ',
			notes: '',
		});

		expect(values).toEqual({
			name: 'Alpha',
			start_date: null,
			estimated_manhours: null,
			notes: '',
		});
	});
});
