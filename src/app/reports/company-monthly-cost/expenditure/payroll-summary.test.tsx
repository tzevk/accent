import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PayrollSalaryEvidence } from '@/lib/company-expenditure/payroll';
import { PayrollSummary } from './payroll-summary';
import type { PayrollSummaryProps } from './payroll-summary';
import type { PayrollEmployeeRow } from './types';

const MONTH = '2026-09';
const ESTIMATED_TOTAL = 53182;

function salaryEvidence(
	overrides: Partial<PayrollSalaryEvidence> = {}
): PayrollSalaryEvidence {
	return {
		availability: 'missing',
		issue: 'salary_profile_missing',
		profile_id: null,
		profile_source: null,
		salary_type: null,
		ctc_source: 'none',
		conflict_ids: [],
		legacy_fallback: false,
		...overrides,
	};
}

function employee(overrides: Partial<PayrollEmployeeRow>): PayrollEmployeeRow {
	return {
		employee_id: 7,
		employee_code: 'EMP-7',
		employee_name: 'Employee 7',
		pay_stream: 'unknown',
		status: 'unknown',
		salary: salaryEvidence(),
		recorded_amount: null,
		estimated_amount: null,
		slip_amount: null,
		in_saved_roster: null,
		worked_outside_finalized_run: false,
		employment_issue: null,
		logged_hours: 0,
		project_hours: 0,
		no_project_hours: 0,
		no_logged_hours: true,
		missing_slip: false,
		missing_pricing: true,
		allocation_missing: false,
		source: {
			payroll_slip_id: 70,
			allocation_id: null,
			allocation_version: null,
			allocation_kind: null,
			month: MONTH,
		},
		shares: [],
		hours_by_project: [],
		reconstruction: null,
		...overrides,
	};
}

function props(): PayrollSummaryProps {
	return {
		data: {
			month_label: 'September 2026',
			coverage: [
				{
					code: 'payroll_not_finalized',
					label: 'Payroll not finalized for this month',
					detail: 'Employee cost is an estimate until Payroll Finalize.',
					severity: 'warning',
				},
				{
					code: 'payroll_pricing_missing',
					label: 'No Salary Profile covers this month',
					detail: 'One employee has no covering profile.',
					severity: 'warning',
				},
			],
			payroll: {
				currency: 'INR',
				recorded_total: 0,
				estimated_total: ESTIMATED_TOTAL,
				allocated_total: 0,
				unallocated_total: 0,
				estimated_allocated_total: 0,
				estimated_unallocated_total: ESTIMATED_TOTAL,
				total_logged_hours: 104,
				project_hours: 0,
				no_project_hours: 104,
				rounding_adjustment: 0,
				recorded_count: 0,
				known_zero_count: 0,
				estimated_count: 1,
				missing_slip_count: 0,
				missing_pricing_count: 1,
				allocation_missing_count: 0,
				unpriced_count: 1,
			},
			project_options: [],
		},
		payrollEmployees: [
			employee({
				employee_id: 11,
				employee_code: 'EMP-11',
				employee_name: 'Employee 11',
				pay_stream: 'payroll',
				status: 'estimated',
				estimated_amount: ESTIMATED_TOTAL,
				logged_hours: 104,
				no_project_hours: 104,
				no_logged_hours: false,
				missing_pricing: false,
				salary: salaryEvidence({
					availability: 'available',
					issue: null,
					profile_id: 21,
					profile_source: 'employee_salary_profile',
					salary_type: 'monthly',
					ctc_source: 'employer_cost',
				}),
				source: {
					payroll_slip_id: null,
					allocation_id: null,
					allocation_version: null,
					allocation_kind: null,
					month: MONTH,
				},
			}),
			employee({}),
		],
		payrollLoading: false,
		payrollFailed: false,
		payrollError: null,
		proposeSubmitting: false,
		reviewSubmitting: false,
		onProposeReconstruction: () => {},
		onReviewReconstruction: () => {},
		reconstructionError: null,
		expandedEmployee: null,
		onEmployeeExpand: () => {},
		reconstructionReason: '',
		onReconstructionReasonChange: () => {},
		canProposeReconstruction: false,
		canReviewReconstruction: false,
		canRevise: false,
	};
}

describe('PayrollSummary draft disclosure', () => {
	it('separates a nonzero estimate from zero recorded cost with unknown pricing disclosed', () => {
		render(<PayrollSummary {...props()} />);
		const summary = screen.getByTestId('payroll-summary');
		expect(
			within(summary).getByText('No Salary Profile covers this month.', {
				exact: false,
			})
		).toBeInTheDocument();
		const unknown = within(summary)
			.getAllByRole('row')
			.find((row) => within(row).queryByText('Employee 7'));
		expect(unknown).toBeDefined();
		const estimated = within(summary)
			.getAllByRole('row')
			.find((row) => within(row).queryByText('Employee 11'));
		expect(
			within(estimated as HTMLElement).getByText('Estimated')
		).toBeInTheDocument();
	});
});

function rowFor(name: string): HTMLElement {
	const row = screen
		.getAllByRole('row')
		.find((candidate) => within(candidate).queryByText(name));
	if (!row) throw new Error(`No employee row for ${name}`);
	return row;
}

describe('PayrollSummary salary availability disclosure', () => {
	it('shows an ambiguity as unknown cost with its conflict ids, never as zero', () => {
		const fixture = props();
		const ambiguous = fixture.payrollEmployees.find(
			(candidate) => candidate.employee_id === 7
		);
		if (!ambiguous) throw new Error('Fixture is missing Employee 7');
		ambiguous.salary = salaryEvidence({
			availability: 'ambiguous',
			issue: 'salary_profile_ambiguous',
			conflict_ids: [31, 32],
		});
		render(<PayrollSummary {...fixture} />);

		const row = rowFor('Employee 7');
		const gap = within(row).getByTestId('payroll-salary-gap');
		expect(gap).toHaveTextContent(
			'Cost unknown — several Salary Profiles cover the month'
		);
		expect(gap.getAttribute('title')).toContain('Profiles #31, #32');
		expect(within(row).queryByText('₹0.00')).toBeNull();
	});

	it('distinguishes a legacy gross fallback from a confirmed canonical zero', () => {
		const fixture = props();
		fixture.payrollEmployees = [
			employee({
				employee_id: 41,
				employee_code: 'EMP-41',
				employee_name: 'Legacy 41',
				pay_stream: 'payroll',
				status: 'estimated',
				estimated_amount: 42000,
				missing_pricing: false,
				salary: salaryEvidence({
					availability: 'available',
					issue: null,
					profile_id: 41,
					profile_source: 'employee_salary_profile',
					salary_type: 'monthly',
					ctc_source: 'gross_salary',
					legacy_fallback: true,
				}),
			}),
			employee({
				employee_id: 42,
				employee_code: 'EMP-42',
				employee_name: 'Zero 42',
				pay_stream: 'payroll',
				status: 'estimated',
				estimated_amount: 0,
				missing_pricing: false,
				salary: salaryEvidence({
					availability: 'available',
					issue: null,
					profile_id: 42,
					profile_source: 'employee_salary_profile',
					salary_type: 'monthly',
					ctc_source: 'employer_cost',
				}),
			}),
		];
		render(<PayrollSummary {...fixture} />);

		const legacy = rowFor('Legacy 41');
		expect(
			within(legacy).getByTestId('payroll-salary-legacy')
		).toHaveTextContent('Legacy gross basis, not agreed CTC');
		expect(within(legacy).queryByTestId('payroll-salary-zero')).toBeNull();

		const zero = rowFor('Zero 42');
		expect(within(zero).getByTestId('payroll-salary-zero')).toHaveTextContent(
			'Confirmed zero employer cost'
		);
		expect(within(zero).queryByTestId('payroll-salary-gap')).toBeNull();
		expect(within(zero).getByText('₹0.00')).toBeInTheDocument();
	});

	it('renders every salary coverage notice the month carries', () => {
		const fixture = props();
		fixture.data.coverage = [
			{
				code: 'payroll_salary_ambiguous',
				label: 'Several Salary Profiles cover this month',
				detail: 'One employee has overlapping agreements.',
				severity: 'warning',
			},
			{
				code: 'payroll_salary_ctc_missing',
				label: 'Salary Profile has no monthly CTC',
				detail: 'One employee has no agreed CTC.',
				severity: 'warning',
			},
			{
				code: 'payroll_salary_ctc_invalid',
				label: 'Salary Profile CTC is invalid',
				detail: 'One employee has an invalid CTC.',
				severity: 'warning',
			},
			{
				code: 'payroll_salary_unavailable',
				label: 'Salary evidence unavailable for this month',
				detail: 'One employee has no roster salary record.',
				severity: 'warning',
			},
		];
		render(<PayrollSummary {...fixture} />);

		const notices = screen
			.getAllByTestId('payroll-notice')
			.map((notice) => notice.textContent);
		expect(notices).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Several Salary Profiles cover this month'),
				expect.stringContaining('Salary Profile has no monthly CTC'),
				expect.stringContaining('Salary Profile CTC is invalid'),
				expect.stringContaining('Salary evidence unavailable for this month'),
			])
		);
	});
});
