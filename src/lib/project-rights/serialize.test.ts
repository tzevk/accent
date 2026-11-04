import { describe, expect, it } from 'vitest';
import { resolveProjectRights } from './policy';
import { filterProjectForRights } from './serialize';

const project = {
	id: 10,
	project_id: 'PRJ-10',
	project_code: 'CODE-10',
	name: 'Alpha Project',
	status: 'Ongoing',
	priority: 'HIGH',
	start_date: '2026-01-01',
	end_date: '2026-12-31',
	created_at: '2026-01-01T00:00:00.000Z',
	description: 'Internal description',
	client_name: 'Client A',
	scope_of_work: 'Scope work',
	project_team: '[]',
	project_activities_list: '[]',
	project_activity: '[]',
	budget: '1000',
	project_value: '5000',
	cost_to_company: '4000',
	profitability_estimate: '20',
	actual_profit_loss: '500',
};

const memberRights = resolveProjectRights({
	user: {
		id: 42,
		email: 'member@example.com',
		merged_permissions: [],
		field_permissions: {},
	},
	project: { project_team: [{ id: 42, role: 'Team Member' }] },
});

const leadRights = resolveProjectRights({
	user: { id: 43, email: 'lead@example.com', is_super_admin: false },
	project: {
		project_team: [{ id: 43, role: 'Project Lead' }],
	},
});

describe('filterProjectForRights', () => {
	it('omits unreadable section columns but keeps identity fields', () => {
		const filtered = filterProjectForRights(project, memberRights);

		expect(filtered.description).toBeUndefined();
		expect(filtered.client_name).toBeUndefined();
		expect(filtered.budget).toBeUndefined();
		expect(filtered.project_value).toBeUndefined();
		expect(filtered.cost_to_company).toBeUndefined();
		expect(filtered.profitability_estimate).toBeUndefined();
		expect(filtered.actual_profit_loss).toBeUndefined();
		expect(filtered.scope_of_work).toBe('Scope work');
		expect(filtered.name).toBe('Alpha Project');
		expect(filtered.id).toBe(10);
		expect(filtered.project_code).toBe('CODE-10');
		expect(filtered.status).toBe('Ongoing');
	});

	it('omits the team and activity lists when those sections are unreadable', () => {
		const rights = {
			...memberRights,
			sections: {
				...memberRights.sections,
				project_team: { read: false, edit: false },
				project_activity: { read: false, edit: false },
			},
			readableSections: memberRights.readableSections.filter(
				(section) => section !== 'project_team'
			),
		};

		const filtered = filterProjectForRights(project, rights);

		expect(filtered.project_team).toBeUndefined();
		expect(filtered.project_activities_list).toBeUndefined();
	});

	it('keeps only commercially authorised columns', () => {
		const rights = {
			...leadRights,
			commercial: { view: ['budget'], edit: [] },
		};

		const filtered = filterProjectForRights(project, rights);

		expect(filtered.budget).toBe('1000');
		expect(filtered.project_value).toBeUndefined();
		expect(filtered.cost_to_company).toBeUndefined();
		expect(filtered.actual_profit_loss).toBeUndefined();
	});

	it('keeps every readable lead section and its commercial values when authorised', () => {
		const rights = {
			...leadRights,
			commercial: { view: ['budget', 'project_value'], edit: [] },
		};

		const filtered = filterProjectForRights(project, rights);

		expect(filtered.description).toBe('Internal description');
		expect(filtered.project_team).toBe('[]');
		expect(filtered.budget).toBe('1000');
		expect(filtered.project_value).toBe('5000');
		expect(filtered.profitability_estimate).toBeUndefined();
	});

	it('omits protected columns as absent keys, not blank values', () => {
		const filtered = filterProjectForRights(project, memberRights);

		for (const column of [
			'budget',
			'project_value',
			'cost_to_company',
			'profitability_estimate',
			'actual_profit_loss',
		]) {
			expect(Object.hasOwn(filtered, column)).toBe(false);
			expect(Object.hasOwn(project, column)).toBe(true);
		}
	});

	it('keeps the response shape and the authorised amounts unchanged', () => {
		const rights = {
			...memberRights,
			commercial: {
				view: [
					'budget',
					'project_value',
					'cost_to_company',
					'profitability_estimate',
					'actual_profit_loss',
				],
				edit: [],
			},
		};

		const filtered = filterProjectForRights(project, rights);

		expect(Object.hasOwn(filtered, 'project_value')).toBe(true);
		expect(filtered.budget).toBe('1000');
		expect(filtered.project_value).toBe('5000');
		expect(filtered.cost_to_company).toBe('4000');
		expect(filtered.profitability_estimate).toBe('20');
		expect(filtered.actual_profit_loss).toBe('500');
	});

	it('does not reveal commercial amounts for a financial-document grant alone', () => {
		const rights = {
			...memberRights,
			financialAreas: { quotation: true, purchase_order: false, invoice: false },
			commercial: { view: [], edit: [] },
		};

		const filtered = filterProjectForRights(project, rights);

		expect(rights.financialAreas.quotation).toBe(true);
		expect(Object.hasOwn(filtered, 'cost_to_company')).toBe(false);
		expect(Object.hasOwn(filtered, 'profitability_estimate')).toBe(false);
		expect(Object.hasOwn(filtered, 'budget')).toBe(false);
	});
});
