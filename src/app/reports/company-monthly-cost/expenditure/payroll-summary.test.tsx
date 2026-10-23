import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PayrollSummary } from './payroll-summary';
import type { PayrollSummaryProps } from './payroll-summary';
import type { PayrollEmployeeRow } from './types';

const MONTH = '2026-09';
const ESTIMATED_TOTAL = 53182;

function employee(overrides: Partial<PayrollEmployeeRow>): PayrollEmployeeRow {
	return {
		employee_id: 7,
		employee_code: 'EMP-7',
		employee_name: 'Employee 7',
		pay_stream: 'unknown',
		status: 'unknown',
		recorded_amount: null,
		estimated_amount: null,
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
		expect(
			within(unknown as HTMLElement).getByText('Unknown pricing')
		).toBeInTheDocument();
		const estimated = within(summary)
			.getAllByRole('row')
			.find((row) => within(row).queryByText('Employee 11'));
		expect(
			within(estimated as HTMLElement).getByText('Estimated')
		).toBeInTheDocument();
	});
});
