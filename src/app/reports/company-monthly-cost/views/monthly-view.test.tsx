import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthlyView } from './monthly-view';
import type {
	CostSalaryEvidence,
	MonthlyCompanyCostData,
	MonthlyEmployeeRow,
	MonthlyProjectRow,
	MonthlyRow,
} from '../types';

function salary(
	overrides: Partial<CostSalaryEvidence> = {}
): CostSalaryEvidence {
	return {
		availability: 'available',
		issue: null,
		profile_id: 1,
		profile_source: 'employee_salary_profile',
		salary_type: 'monthly',
		ctc_source: 'employer_cost',
		conflict_ids: [],
		legacy_fallback: false,
		...overrides,
	};
}

const ambiguousSalary = salary({
	availability: 'ambiguous',
	issue: 'salary_profile_ambiguous',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
	conflict_ids: [7, 8],
});
const canonicalZeroSalary = salary({ profile_id: 2 });
const legacySalary = salary({
	profile_id: 3,
	ctc_source: 'gross_salary',
	legacy_fallback: true,
});
const recordedSalary = salary({
	availability: 'recorded',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
});

function costRow(
	overrides: Partial<MonthlyRow> & Pick<MonthlyRow, 'employee_id'>
): MonthlyRow {
	return {
		sr_no: 1,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: 'Engineering',
		designation: 'Engineer',
		project_id: 10,
		project_code: 'PRJ-10',
		project_name: 'Project Ten',
		client_name: 'Client',
		hourly_rate: 100,
		hours: 8,
		cost: 0,
		cost_known: true,
		missing_salary_profile: false,
		in_saved_roster: true,
		worked_outside_finalized_run: false,
		employment_issue: null,
		salary: canonicalZeroSalary,
		...overrides,
	};
}

function employeeRow(
	overrides: Partial<MonthlyEmployeeRow> &
		Pick<MonthlyEmployeeRow, 'employee_id'>
): MonthlyEmployeeRow {
	return {
		sr_no: 1,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: 'Engineering',
		designation: 'Engineer',
		hourly_rate: 100,
		hours: 8,
		cost: 0,
		cost_known: true,
		project_count: 1,
		missing_salary_profile: false,
		in_saved_roster: true,
		worked_outside_finalized_run: false,
		employment_issue: null,
		salary: canonicalZeroSalary,
		...overrides,
	};
}

const rows: MonthlyRow[] = [
	costRow({
		employee_id: 1,
		employee_name: 'Asha Ambiguous',
		cost_known: false,
		missing_salary_profile: true,
		salary: ambiguousSalary,
	}),
	costRow({
		employee_id: 2,
		employee_name: 'Rohan Zero',
		employee_code: 'EMP-2',
		cost: 0,
		cost_known: true,
		salary: canonicalZeroSalary,
	}),
	costRow({
		employee_id: 3,
		employee_name: 'Kabir Legacy',
		cost: 1000,
		salary: legacySalary,
	}),
	costRow({
		employee_id: 4,
		employee_name: 'Priya Recorded',
		cost: 500,
		salary: recordedSalary,
	}),
];

const employeeRows: MonthlyEmployeeRow[] = [
	employeeRow({
		employee_id: 1,
		employee_name: 'Asha Ambiguous',
		cost_known: false,
		missing_salary_profile: true,
		salary: ambiguousSalary,
	}),
	employeeRow({
		employee_id: 2,
		employee_name: 'Rohan Zero',
		cost: 0,
		salary: canonicalZeroSalary,
	}),
	employeeRow({
		employee_id: 3,
		employee_name: 'Kabir Legacy',
		cost: 1000,
		salary: legacySalary,
	}),
	employeeRow({
		employee_id: 4,
		employee_name: 'Priya Recorded',
		cost: 500,
		salary: recordedSalary,
	}),
];

const project: MonthlyProjectRow = {
	sr_no: 1,
	project_id: 10,
	project_code: 'PRJ-10',
	project_name: 'Project Ten',
	client_name: 'Client',
	hours: 32,
	cost: 1500,
	cost_known: true,
	employee_count: 4,
	missing_salary_profile_count: 1,
	salary_availability_counts: {
		recorded: 1,
		not_consulted: 0,
		available: 2,
		missing: 0,
		ambiguous: 1,
		ctc_missing: 0,
		ctc_invalid: 0,
		unavailable: 0,
	},
	unknown_cost_count: 1,
};

const projectRows: MonthlyProjectRow[] = [project];

const data: MonthlyCompanyCostData = {
	month: '2026-09',
	month_label: 'September 2026',
	fy_label: 'FY 2026–27',
	fy_year: 2026,
	rows,
	employee_rows: employeeRows,
	project_rows: projectRows,
	payroll: {
		currency: 'INR',
		recorded_total: 1500,
		estimated_total: 0,
		allocated_total: 0,
		unallocated_total: 0,
		estimated_allocated_total: 0,
		estimated_unallocated_total: 0,
		total_logged_hours: 32,
		project_hours: 32,
		no_project_hours: 0,
		rounding_adjustment: 0,
		recorded_count: 2,
		known_zero_count: 1,
		estimated_count: 0,
		missing_slip_count: 0,
		missing_pricing_count: 1,
		allocation_missing_count: 0,
		// The salary population is incomplete even though no payroll row is
		// counted as unpriced here; partial labelling must follow salary.complete.
		unpriced_count: 0,
	},
	salary: {
		available_count: 2,
		missing_count: 0,
		ambiguous_count: 1,
		ctc_missing_count: 0,
		ctc_invalid_count: 0,
		unavailable_count: 0,
		legacy_fallback_count: 1,
		recorded_count: 1,
		not_consulted_count: 0,
		complete: false,
	},
	coverage: [],
	totals: {
		total_hours: 32,
		total_cost: 1500,
		blended_rate: 46.88,
		employee_count: 4,
		project_count: 1,
	},
};

describe('MonthlyView salary disclosure', () => {
	it('renders each unavailable cause distinctly and keeps canonical zero, legacy basis and recorded cost', () => {
		render(
			<MonthlyView
				data={data}
				totals={data.totals}
				breakdown="byEmployee"
				employeeRows={employeeRows}
				projectRows={projectRows}
				sections={[{ project, rows }]}
			/>
		);

		const ambiguous = screen.getByText('Asha Ambiguous').closest('tr');
		expect(ambiguous).not.toBeNull();
		expect(
			within(ambiguous as HTMLElement).getByText(
				'Unpriced · Several Salary Profiles cover this month (#7, #8)'
			)
		).toBeInTheDocument();
		expect(within(ambiguous as HTMLElement).getByText('—')).toBeInTheDocument();
		expect(
			screen.queryByText(/Salary Profile missing/)
		).not.toBeInTheDocument();

		const zero = screen.getByText('Rohan Zero').closest('tr');
		expect(zero).not.toBeNull();
		expect(within(zero as HTMLElement).getByText('₹0.00')).toBeInTheDocument();
		expect(
			within(zero as HTMLElement).getByText(
				'Confirmed zero · explicit employer-cost CTC'
			)
		).toBeInTheDocument();

		const legacy = screen.getByText('Kabir Legacy').closest('tr');
		expect(legacy).not.toBeNull();
		expect(
			within(legacy as HTMLElement).getByText('₹1,000.00')
		).toBeInTheDocument();
		expect(
			within(legacy as HTMLElement).getByText(
				'Legacy gross basis — not agreed CTC'
			)
		).toBeInTheDocument();

		const recorded = screen.getByText('Priya Recorded').closest('tr');
		expect(recorded).not.toBeNull();
		expect(
			within(recorded as HTMLElement).getByText('₹500.00')
		).toBeInTheDocument();
		expect(
			within(recorded as HTMLElement).getByText('Recorded · frozen allocation')
		).toBeInTheDocument();

		expect(
			screen.getByText('Employee cost — partial · full-period total')
		).toBeInTheDocument();
	});

	it('states project salary availability counts and derives the legacy basis from its rows', () => {
		render(
			<MonthlyView
				data={data}
				totals={data.totals}
				breakdown="byProject"
				employeeRows={employeeRows}
				projectRows={projectRows}
				sections={[{ project, rows }]}
			/>
		);

		expect(
			screen.getByText(
				'Partial · Ambiguous Salary Profiles: 1 · Legacy gross basis (not agreed CTC): 1'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText(/missing Salary Profile/)
		).not.toBeInTheDocument();
		expect(
			screen.getByText('Employee cost — partial · full-period total')
		).toBeInTheDocument();
	});

	it('renders the same distinct causes in the Project Wise sheet', () => {
		render(
			<MonthlyView
				data={data}
				totals={data.totals}
				breakdown="detailed"
				employeeRows={employeeRows}
				projectRows={projectRows}
				sections={[{ project, rows }]}
			/>
		);

		expect(
			screen.getByText(
				'Unpriced · Several Salary Profiles cover this month (#7, #8)'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText('Confirmed zero · explicit employer-cost CTC')
		).toBeInTheDocument();
		expect(
			screen.getByText('Legacy gross basis — not agreed CTC')
		).toBeInTheDocument();
		expect(
			screen.getAllByText('Recorded · frozen allocation').length
		).toBeGreaterThan(0);
		expect(
			screen.getByText(
				'Partial · Ambiguous Salary Profiles: 1 · Legacy gross basis (not agreed CTC): 1'
			)
		).toBeInTheDocument();
		expect(screen.getByText(/partial · full-period total/)).toBeInTheDocument();
	});
});
