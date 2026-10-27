import { expect, it } from 'vitest';
import { rankProjects } from './ranking';
import type { ReconciliationProjectRow } from './types';

function project(
	overrides: Partial<ReconciliationProjectRow>
): ReconciliationProjectRow {
	return {
		project_id: 1,
		project_code: 'P-1',
		project_name: 'Project 1',
		client_name: null,
		currency: 'INR',
		conversion_status: 'reporting',
		converted_incurred_cost: 100,
		incurred_cost: 100,
		record_count: 1,
		period_charge_count: 0,
		not_confirmed_cost: 0,
		comparison_cost: 100,
		previous_period_cost: null,
		change_amount: null,
		change_percent: null,
		change_state: 'no_prior',
		cost_to_date: 100,
		late_entry: null,
		evidence: {
			state: 'recorded',
			findings: [],
			confirmed_records: 1,
			estimated_records: 0,
			unknown_amount_records: 0,
			unresolved_tax_records: 0,
			bill_date_fallback_records: 0,
			reconstructed_records: 0,
		},
		employee_cost: 0,
		estimated_employee_cost: 0,
		logged_hours: 0,
		employee_count: 0,
		recorded_employee_count: 0,
		missing_salary_profile_count: 0,
		...overrides,
	};
}

it('ranks available expenditure with shared positions for ties inside each currency', () => {
	const ranking = rankProjects([
		project({
			project_id: 1,
			project_code: 'P-1',
			incurred_cost: 100,
			estimated_employee_cost: 200,
		}),
		project({ project_id: 2, project_code: 'P-2', incurred_cost: 150 }),
		project({
			project_id: 3,
			project_code: 'P-3',
			incurred_cost: 250,
			estimated_employee_cost: 50,
		}),
		project({
			project_id: 4,
			project_code: 'P-4',
			currency: 'USD',
			incurred_cost: 9999,
		}),
	]);
	expect(
		ranking.by_cost.map(
			({ project_id, rank, available_cost, incurred_cost }) => ({
				project_id,
				rank,
				available_cost,
				incurred_cost,
			})
		)
	).toEqual([
		{ project_id: 1, rank: 1, available_cost: 300, incurred_cost: 100 },
		{ project_id: 3, rank: 1, available_cost: 300, incurred_cost: 250 },
		{ project_id: 2, rank: 3, available_cost: 150, incurred_cost: 150 },
		{ project_id: 4, rank: 1, available_cost: 9999, incurred_cost: 9999 },
	]);
});
