import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanyReconciliationPanel } from './company-reconciliation';
import {
	ComparisonDetail,
	ComparisonSummary,
	CompanyCurrencySubtotals,
} from './comparison-panel';
import { ProjectBreakdown } from './project-breakdown';
import { DecisionView } from './decision-view';
import type { DecisionViewProps } from './decision-view';
import type { ProjectRow, ReconciliationPayload } from './types';
import type {
	ClosePayload,
	CostRecordJson,
	RevisionPayload,
} from '@/lib/company-expenditure';

function data(): ReconciliationPayload {
	return {
		month: '2026-09',
		month_label: 'September 2026',
		project_id: null,
		current_month: '2026-10',
		company: {
			reporting_currency: 'INR',
			conversion: {
				status: 'reporting',
				converted_records: 0,
				unsupported_records: 0,
				converted_charges: 0,
				unsupported_charges: 0,
				unsupported_currencies: [],
				unknown_currency_records: 0,
			},
			currency: 'INR',
			incurred_cost: 22000,
			currency_totals: [],
			groups: [
				{
					key: 'incurred_project_cost',
					label: 'Incurred Project Cost',
					amount: 22000,
					record_count: 2,
				},
				{
					key: 'company_overhead',
					label: 'Company Overhead',
					amount: 0,
					record_count: 0,
				},
				{
					key: 'unallocated_cost',
					label: 'Unallocated Cost',
					amount: 0,
					record_count: 0,
				},
			],
			gross_liability: 22000,
			recoverable_tax: 0,
			unresolved_tax: { count: 0, currency: 'INR', gross_amount: 0 },
			known_zero_count: 0,
			record_count: 2,
		},
		projects: [],
		non_operating: {
			currency: null,
			excluded_source_amount: null,
			consumed_this_month: null,
			consumed_to_date: null,
			remaining_amount: null,
			unapproved_count: 0,
			unresolved_count: 0,
			unresolved_source_amount: null,
			items: [],
			charges_from_prior_items: [],
		},
		supplier_commitment: {
			month: '2026-09',
			totals: [],
			exceptions: [],
			orders: [],
			ineffectiveConsumption: 0,
		},
		comparison: {
			month: '2026-09',
			as_of: '2026-09-30',
			prior_month: '2026-08',
			prior_month_label: 'August 2026',
			basis: 'full_month',
			unfinished: false,
			elapsed_days: null,
			current_days: 30,
			prior_days: 31,
			window_mismatch: false,
			currency: 'INR',
			current_cost: 22000,
			prior_cost: 9000,
			change_amount: 13000,
			change_percent: 144.44,
			change_state: 'increase',
			currency_totals: [],
			cost_to_date_through: '2026-09-30',
			disclosures: [],
		},
		ranking: {
			by_cost: [],
			by_increase: [],
			increase_unranked: [],
			currencies: [],
		},
		filtered_subtotal: null,
		evidence: {
			recognized: { count: 2, currency: 'INR', amount: 22000 },
			pending_evidence: { count: 0, currency: null, amount: null },
			draft: { count: 0, currency: null, amount: null },
			rejected: { count: 0, currency: null, amount: null },
			cancelled: { count: 0, currency: null, amount: null },
			period_charges: { count: 0, currency: null, amount: null },
			non_operating_recognized: { count: 0, currency: null, amount: null },
			unresolved_nature: { count: 0, currency: null, amount: null },
			unresolved_classification: {
				count: 0,
				currency: null,
				gross_amount: null,
			},
			missing_amount: { count: 0 },
			missing_currency: { count: 0 },
			known_zero: { count: 0 },
		},
		coverage: [],
		payroll: {
			currency: 'INR',
			recorded_total: 0,
			estimated_total: 4955,
			allocated_total: 0,
			unallocated_total: 0,
			total_logged_hours: 100,
			project_hours: 100,
			no_project_hours: 0,
			rounding_adjustment: 0,
			recorded_count: 0,
			known_zero_count: 0,
			estimated_count: 1,
			missing_slip_count: 0,
			missing_pricing_count: 1,
			allocation_missing_count: 0,
		},
		petty_cash: {
			month: null,
			currency: null,
			funding: null,
			spend: null,
			remaining_funding: null,
			recognized_cost: null,
			by_currency: [],
			unresolved_settlements: { count: 0, amount: null },
			unlinked_spend: { count: 0, amount: null },
			unknown_currency: { count: 0 },
		},
		budgets: {
			month: '2026-09',
			basis: 'basis',
			variance_note: 'variance note',
			comparisons: [],
			notices: [],
		},
		cash: {
			month: '2026-09',
			currency: null,
			paid: null,
			by_currency: [],
			funding: {
				by_currency: [],
				movements: [],
				unlinked_vouchers: { count: 0 },
			},
			targets: [],
			coverage: {
				settled_targets: 0,
				partial_targets: 0,
				unsettled_targets: 0,
				outstanding: null,
			},
			unresolved_targets: { count: 0, amount: null },
			legacy: {
				outward_unlinked: { count: 0, amount: null },
				undated_balances: { count: 0, amount: null },
				client_receipts: { count: 0, amount: null },
				internal_transfers: { count: 0, amount: null },
			},
		},
		project_options: [],
		available_months: ['2026-09'],
	};
}

describe('CompanyReconciliationPanel estimate separation', () => {
	it('keeps a nonzero payroll estimate with unknown pricing outside the confirmed headline', () => {
		const month = data();
		month.payroll = {
			...month.payroll,
			recorded_total: 12000,
			known_zero_count: 2,
		};
		render(<CompanyReconciliationPanel data={month} />);
		const estimate = screen.getByRole('region', { name: 'Estimated payroll' });
		expect(within(estimate).getByText('₹4,955.00')).toBeInTheDocument();
		expect(
			within(estimate).getByText('Recorded', { exact: false })
		).toHaveTextContent('₹12,000.00');
		expect(
			within(estimate).getByText('2 known-zero', { exact: false })
		).toBeInTheDocument();
		expect(
			within(estimate).getByText('Unknown pricing:', { exact: false })
		).toBeInTheDocument();
		expect(screen.getByTestId('kpi-incurred-cost')).toHaveTextContent(
			'₹22,000.00'
		);
	});
});

describe('ComparisonSummary comparison scope', () => {
	it('identifies full-month and elapsed-window amounts as separate bases', () => {
		const month = data();
		month.company.incurred_cost = 22000;
		month.comparison = {
			...month.comparison,
			basis: 'equal_period',
			unfinished: true,
			elapsed_days: 12,
			current_days: 12,
			prior_days: 12,
			currency: 'INR',
			current_cost: 18000,
			prior_cost: 9000,
			change_amount: 9000,
			change_percent: 100,
			change_state: 'increase',
			disclosures: [
				{
					code: 'equal_period_comparison',
					label: 'Equal 12-day comparison',
					detail:
						'September 2026 is unfinished, so both periods cover their first 12 day(s).',
					severity: 'info',
					period: null,
					currency: 'INR',
					count: 12,
					amount: null,
				},
			],
		};
		render(
			<>
				<CompanyReconciliationPanel data={month} />
				<ComparisonSummary data={month} />
			</>
		);
		expect(screen.getByTestId('kpi-incurred-cost')).toHaveTextContent(
			'₹22,000.00'
		);
		const panel = screen.getByTestId('comparison-panel');
		expect(
			within(panel).getByText('Full-month Company Incurred Cost:', {
				exact: false,
			})
		).toHaveTextContent('₹22,000.00');
		expect(
			within(panel).getByText('First 12 day(s) of this period:', {
				exact: false,
			})
		).toHaveTextContent('₹18,000.00');
	});

	it('keeps an unknown prior amount unknown without an invented percentage', () => {
		const month = data();
		month.comparison = {
			...month.comparison,
			prior_cost: null,
			change_amount: null,
			change_percent: null,
			change_state: 'no_prior',
			disclosures: [
				{
					code: 'unknown_prior_cost',
					label: 'Projects with an unknown prior amount',
					detail: 'One Project has no cost recorded in the prior window.',
					severity: 'warning',
					period: 'prior',
					currency: null,
					count: 1,
					amount: null,
				},
			],
		};
		render(<ComparisonSummary data={month} />);
		const panel = screen.getByTestId('comparison-panel');
		expect(within(panel).getByTestId('comparison-prior')).toHaveTextContent(
			'Unknown'
		);
		expect(within(panel).getByTestId('comparison-percent')).toHaveTextContent(
			'Prior amount unknown'
		);
	});

	it('states a known zero prior as new cost without a percentage', () => {
		const month = data();
		month.comparison = {
			...month.comparison,
			prior_cost: 0,
			change_amount: 22000,
			change_percent: null,
			change_state: 'new',
			disclosures: [
				{
					code: 'zero_prior_cost',
					label: 'New cost against a recorded zero',
					detail: 'One Project had a recorded zero cost in the prior window.',
					severity: 'info',
					period: null,
					currency: null,
					count: 1,
					amount: null,
				},
			],
		};
		render(<ComparisonSummary data={month} />);
		const panel = screen.getByTestId('comparison-panel');
		expect(within(panel).getByTestId('comparison-prior')).toHaveTextContent(
			'₹0.00'
		);
		expect(within(panel).getByTestId('comparison-percent')).toHaveTextContent(
			'New cost, no percentage'
		);
	});
});

function projectRow(overrides: Partial<ProjectRow>): ProjectRow {
	return {
		project_id: 60,
		project_code: 'P60',
		project_name: 'Project Sixty',
		client_name: 'Client',
		currency: 'INR',
		conversion_status: 'reporting',
		converted_incurred_cost: 16000,
		incurred_cost: 16000,
		record_count: 2,
		period_charge_count: 0,
		not_confirmed_cost: 0,
		comparison_cost: 16000,
		previous_period_cost: 9000,
		change_amount: 7000,
		change_percent: 77.78,
		change_state: 'increase',
		cost_to_date: 16000,
		late_entry: null,
		evidence: {
			state: 'recorded',
			findings: [],
			confirmed_records: 2,
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
		...overrides,
	};
}

describe('ProjectBreakdown budget variance', () => {
	it('states an overspent approved budget beside confirmed cost with its percentage', () => {
		const month = data();
		month.projects = [projectRow({})];
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 60,
					project_code: 'P60',
					project_name: 'Project Sixty',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 16000,
					confirmed_records: 2,
					period_charges: 0,
					pending_records: 0,
					outcome: 'compared',
					budget: {
						budget_id: 1,
						budget_uid: 'BUD-1',
						state: 'approved',
						currency: 'INR',
						scope: 'project_incurred_cost',
						amount: 10000,
						period_start: '2026-09-01',
						period_end: '2026-09-30',
						basis_note: null,
						financial_version: 2,
						approval_evidence_reference: 'EV-1',
						approved_at: '2026-09-02',
					},
					candidates: [],
					variance: -6000,
					over_budget: true,
					detail: 'compared with confirmed Incurred Project Cost',
				},
			],
		};
		render(
			<ProjectBreakdown
				data={month}
				month="2026-09"
				clientOrdersByProject={new Map()}
				costRanks={new Map([['60:INR', 1]])}
				increaseRanks={new Map([['60:INR', 1]])}
				rankedRows={[{ row: month.projects[0], rank: 1 }]}
				rankingMode="cost"
				expandedProject={null}
				onProjectExpand={() => {}}
				drilldownLoading={false}
				drilldownRecords={[]}
				drilldownPeriodCharges={[]}
				drilldownMonth="2026-09"
				evidenceLoading={false}
				evidenceRecords={[]}
			/>
		);
		const row = screen.getByTestId('expenditure-project-row');
		expect(within(row).getByTestId('project-incurred-cost')).toHaveTextContent(
			'₹16,000.00'
		);
		const cells = within(row).getAllByRole('cell');
		const budget = cells.find((cell) => within(cell).queryByText('₹10,000.00'));
		expect(budget).toBeDefined();
		const variance = cells.find((cell) =>
			within(cell).queryByText('Overspent', { exact: false })
		);
		expect(variance).toBeDefined();
		expect(variance).toHaveTextContent('₹6,000.00');
		expect(variance).toHaveTextContent('60.00%');
	});

	it('keeps an incompatible-currency budget unavailable without a variance', () => {
		const month = data();
		month.projects = [projectRow({ project_id: 61, project_code: 'P61' })];
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 61,
					project_code: 'P61',
					project_name: 'Project Sixty One',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 16000,
					confirmed_records: 2,
					period_charges: 0,
					pending_records: 0,
					outcome: 'incompatible_currency',
					budget: null,
					candidates: [
						{
							budget_id: 2,
							budget_uid: 'BUD-2',
							state: 'approved',
							currency: 'USD',
							scope: 'project_incurred_cost',
							amount: 120,
							period_start: '2026-09-01',
							period_end: '2026-09-30',
							basis_note: null,
							financial_version: 2,
							approval_evidence_reference: 'EV-2',
							approved_at: '2026-09-02',
						},
					],
					variance: null,
					over_budget: null,
					detail: 'approved budget in USD cannot be compared with INR cost',
				},
			],
		};
		render(
			<ProjectBreakdown
				data={month}
				month="2026-09"
				clientOrdersByProject={new Map()}
				costRanks={new Map([['61:INR', 1]])}
				increaseRanks={new Map([['61:INR', 1]])}
				rankedRows={[{ row: month.projects[0], rank: 1 }]}
				rankingMode="cost"
				expandedProject={null}
				onProjectExpand={() => {}}
				drilldownLoading={false}
				drilldownRecords={[]}
				drilldownPeriodCharges={[]}
				drilldownMonth="2026-09"
				evidenceLoading={false}
				evidenceRecords={[]}
			/>
		);
		const row = screen.getByTestId('expenditure-project-row');
		expect(within(row).getByText('Different currency')).toBeInTheDocument();
		expect(within(row).getByText('Unavailable')).toBeInTheDocument();
		expect(
			within(row).queryByText('Overspent', { exact: false })
		).not.toBeInTheDocument();
	});

	it('keeps an incompatible-period budget unavailable without a variance', () => {
		const month = data();
		month.projects = [projectRow({ project_id: 61, project_code: 'P61' })];
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 61,
					project_code: 'P61',
					project_name: 'Project Sixty One',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 16000,
					confirmed_records: 2,
					period_charges: 0,
					pending_records: 0,
					outcome: 'incompatible_period',
					budget: null,
					candidates: [
						{
							budget_id: 5,
							budget_uid: 'BUD-5',
							state: 'approved',
							currency: 'INR',
							scope: 'project_incurred_cost',
							amount: 9000,
							period_start: '2026-08-01',
							period_end: '2026-08-31',
							basis_note: null,
							financial_version: 2,
							approval_evidence_reference: 'EV-5',
							approved_at: '2026-08-02',
						},
					],
					variance: null,
					over_budget: null,
					detail: 'approved budget covers August 2026, not September 2026',
				},
			],
		};
		render(
			<ProjectBreakdown
				data={month}
				month="2026-09"
				clientOrdersByProject={new Map()}
				costRanks={new Map([['61:INR', 1]])}
				increaseRanks={new Map([['61:INR', 1]])}
				rankedRows={[{ row: month.projects[0], rank: 1 }]}
				rankingMode="cost"
				expandedProject={null}
				onProjectExpand={() => {}}
				drilldownLoading={false}
				drilldownRecords={[]}
				drilldownPeriodCharges={[]}
				drilldownMonth="2026-09"
				evidenceLoading={false}
				evidenceRecords={[]}
			/>
		);
		const row = screen.getByTestId('expenditure-project-row');
		expect(within(row).getByText('Different period')).toBeInTheDocument();
		expect(within(row).getByText('Unavailable')).toBeInTheDocument();
		expect(
			within(row).queryByText('Remaining', { exact: false })
		).not.toBeInTheDocument();
		expect(
			within(row).queryByText('Overspent', { exact: false })
		).not.toBeInTheDocument();
	});

	it('states a missing approval without implying a budget basis', () => {
		const month = data();
		month.projects = [projectRow({})];
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 60,
					project_code: 'P60',
					project_name: 'Project Sixty',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 16000,
					confirmed_records: 2,
					period_charges: 0,
					pending_records: 0,
					outcome: 'unapproved',
					budget: null,
					candidates: [
						{
							budget_id: 4,
							budget_uid: 'BUD-4',
							state: 'submitted',
							currency: 'INR',
							scope: 'project_incurred_cost',
							amount: 10000,
							period_start: '2026-09-01',
							period_end: '2026-09-30',
							basis_note: null,
							financial_version: 1,
							approval_evidence_reference: null,
							approved_at: null,
						},
					],
					variance: null,
					over_budget: null,
					detail: 'budget is not approved, so it is not compared',
				},
			],
		};
		render(
			<ProjectBreakdown
				data={month}
				month="2026-09"
				clientOrdersByProject={new Map()}
				costRanks={new Map([['60:INR', 1]])}
				increaseRanks={new Map([['60:INR', 1]])}
				rankedRows={[{ row: month.projects[0], rank: 1 }]}
				rankingMode="cost"
				expandedProject={null}
				onProjectExpand={() => {}}
				drilldownLoading={false}
				drilldownRecords={[]}
				drilldownPeriodCharges={[]}
				drilldownMonth="2026-09"
				evidenceLoading={false}
				evidenceRecords={[]}
			/>
		);
		const row = screen.getByTestId('expenditure-project-row');
		expect(within(row).getByText('Not approved')).toBeInTheDocument();
		expect(
			within(row).queryByText('Remaining', { exact: false })
		).not.toBeInTheDocument();
		expect(
			within(row).queryByText('Overspent', { exact: false })
		).not.toBeInTheDocument();
	});

	it('keeps a zero approved budget percentage unavailable with its amount shown', () => {
		const month = data();
		month.projects = [projectRow({ incurred_cost: 6000 })];
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 60,
					project_code: 'P60',
					project_name: 'Project Sixty',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 6000,
					confirmed_records: 1,
					period_charges: 0,
					pending_records: 0,
					outcome: 'compared',
					budget: {
						budget_id: 3,
						budget_uid: 'BUD-3',
						state: 'approved',
						currency: 'INR',
						scope: 'project_incurred_cost',
						amount: 0,
						period_start: '2026-09-01',
						period_end: '2026-09-30',
						basis_note: null,
						financial_version: 2,
						approval_evidence_reference: 'EV-3',
						approved_at: '2026-09-02',
					},
					candidates: [],
					variance: -6000,
					over_budget: true,
					detail: 'compared with confirmed Incurred Project Cost',
				},
			],
		};
		render(
			<ProjectBreakdown
				data={month}
				month="2026-09"
				clientOrdersByProject={new Map()}
				costRanks={new Map([['60:INR', 1]])}
				increaseRanks={new Map([['60:INR', 1]])}
				rankedRows={[{ row: month.projects[0], rank: 1 }]}
				rankingMode="cost"
				expandedProject={null}
				onProjectExpand={() => {}}
				drilldownLoading={false}
				drilldownRecords={[]}
				drilldownPeriodCharges={[]}
				drilldownMonth="2026-09"
				evidenceLoading={false}
				evidenceRecords={[]}
			/>
		);
		const row = screen.getByTestId('expenditure-project-row');
		const cells = within(row).getAllByRole('cell');
		const variance = cells.find((cell) =>
			within(cell).queryByText('Overspent', { exact: false })
		);
		expect(variance).toBeDefined();
		expect(variance).toHaveTextContent('₹6,000.00');
		expect(variance).toHaveTextContent('Percentage unavailable');
	});
});

function closePayload(): ClosePayload {
	return {
		month: '2026-09',
		status: 'open',
		financial_version: 0,
		close_uid: null,
		review: {
			can_close: false,
			blockers: [
				{
					code: 'records_awaiting_recognition',
					label: 'Records awaiting recognition',
					detail: 'One record awaits recognition.',
					severity: 'error',
				},
			],
			warnings: [
				{
					code: 'payroll_finalization_pending',
					label: 'Payroll finalization pending',
					detail: 'One position is estimated.',
					severity: 'warning',
				},
			],
		},
		snapshot: null,
		reviewed_by: null,
		reviewed_at: null,
		review_reason: null,
		evidence_reference: null,
		created_at: null,
	};
}

function revisionPayload(): RevisionPayload {
	return {
		month: '2026-09',
		status: 'open',
		close_uid: null,
		close_version: 0,
		prior: null,
		current: { incurred_cost: 22000, currency: 'INR' },
		candidates: [],
		revisions: [],
	};
}

function queueRecord(): CostRecordJson {
	return {
		id: 9,
		cost_uid: 'COST-9',
		source: 'direct_expense',
		source_id: '9',
		split: null,
		expense_number: 'EXP-9',
		recognition_state: 'draft',
		cost_classification: null,
		cost_nature: 'operating',
		recognized_amount: null,
		recognition_period: null,
		period_basis: 'unresolved',
		service_period_start: null,
		service_period_end: null,
		expense_date: '2026-09-10',
		created_at: '2026-09-10T00:00:00.000Z',
		currency: 'INR',
		reporting_currency: 'INR',
		conversion_rate: null,
		conversion_date: null,
		conversion_evidence_reference: null,
		converted_amount: null,
		conversion_status: 'reporting',
		gross_amount: 1200,
		tax_amount: null,
		tax_treatment: 'none',
		effective_tax_treatment: 'none',
		tax_evidence_reference: null,
		source_reference: 'EXP-9',
		evidence_reference: null,
		project_id: 60,
		project_code: 'P60',
		project_name: 'Project Sixty',
		client_name: null,
		vendor_name: 'Vendor',
		description: null,
		financial_version: 1,
		recognized_at: null,
		recognized_by: null,
		missing_amount: false,
		known_zero: false,
		reconstructed: false,
		accrual: null,
		exceptions: [],
	};
}

function decisionProps(input: {
	month: ReconciliationPayload;
	queue?: CostRecordJson[];
	close?: ClosePayload | null;
	revisions?: RevisionPayload | null;
}): DecisionViewProps {
	return {
		data: input.month,
		month: '2026-09',
		close: input.close ?? closePayload(),
		closeLoading: false,
		revisions: input.revisions ?? revisionPayload(),
		revisionsLoading: false,
		clientOrders: [],
		clientOrdersByProject: new Map(),
		costRanks: new Map(),
		increaseRanks: new Map(),
		rankedRows: input.month.projects.map((row) => ({ row, rank: 1 })),
		rankingMode: 'cost',
		expandedProject: null,
		onProjectExpand: () => {},
		drilldownLoading: false,
		drilldownRecords: [],
		drilldownPeriodCharges: [],
		drilldownMonth: '2026-09',
		evidenceLoading: false,
		evidenceRecords: [],
		payrollEmployees: [],
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
		canEditCost: false,
		canRecognize: false,
		canCloseMonth: false,
		canReviseClosed: false,
		queue: input.queue ?? [queueRecord()],
		queueLoading: false,
		queueFailed: false,
		queueError: null,
		onCommandReset: () => {},
		onEditTargetChange: () => {},
		onCommandTargetChange: () => {},
	};
}

function renderDecision(props: DecisionViewProps) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<DecisionView {...props} />
		</QueryClientProvider>
	);
}

describe('DecisionView review summary', () => {
	it('counts overlapping review categories without totaling them', () => {
		const month = data();
		month.projects = [
			projectRow({}),
			projectRow({
				project_id: 60,
				project_code: 'P60',
				project_name: 'Project Sixty',
				currency: 'USD',
				conversion_status: 'unsupported',
				converted_incurred_cost: null,
			}),
		];
		month.evidence = {
			...month.evidence,
			pending_evidence: { count: 1, currency: 'INR', amount: 1200 },
			draft: { count: 1, currency: 'INR', amount: 300 },
		};
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 60,
					project_code: 'P60',
					project_name: 'Project Sixty',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 16000,
					confirmed_records: 2,
					period_charges: 0,
					pending_records: 1,
					outcome: 'compared',
					budget: {
						budget_id: 1,
						budget_uid: 'BUD-1',
						state: 'approved',
						currency: 'INR',
						scope: 'project_incurred_cost',
						amount: 10000,
						period_start: '2026-09-01',
						period_end: '2026-09-30',
						basis_note: null,
						financial_version: 2,
						approval_evidence_reference: 'EV-1',
						approved_at: '2026-09-02',
					},
					candidates: [],
					variance: -6000,
					over_budget: true,
					detail: 'compared with confirmed Incurred Project Cost',
				},
				{
					project_id: 60,
					project_code: 'P60',
					project_name: 'Project Sixty',
					client_name: 'Client',
					currency: 'USD',
					incurred_cost: 200,
					confirmed_records: 1,
					period_charges: 0,
					pending_records: 0,
					outcome: 'compared',
					budget: {
						budget_id: 6,
						budget_uid: 'BUD-6',
						state: 'approved',
						currency: 'USD',
						scope: 'project_incurred_cost',
						amount: 100,
						period_start: '2026-09-01',
						period_end: '2026-09-30',
						basis_note: null,
						financial_version: 2,
						approval_evidence_reference: 'EV-6',
						approved_at: '2026-09-02',
					},
					candidates: [],
					variance: -100,
					over_budget: true,
					detail: 'compared with confirmed Incurred Project Cost',
				},
				{
					project_id: 61,
					project_code: 'P61',
					project_name: 'Project Sixty One',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 6000,
					confirmed_records: 1,
					period_charges: 0,
					pending_records: 0,
					outcome: 'incompatible_currency',
					budget: null,
					candidates: [],
					variance: null,
					over_budget: null,
					detail: 'approved budget in USD cannot be compared with INR cost',
				},
			],
		};
		renderDecision(decisionProps({ month }));
		const review = screen.getByRole('region', { name: 'Review summary' });
		expect(
			within(review).getByRole('link', { name: '1 project(s) over budget' })
		).toHaveAttribute('href', '#decision-project-detail');
		expect(
			within(review).getByRole('link', {
				name: '1 project(s) without a usable budget comparison',
			})
		).toHaveAttribute('href', '#decision-budget');
		expect(
			within(review).getByRole('link', { name: '1 unconfirmed record(s)' })
		).toHaveAttribute('href', '#decision-recognition');
		expect(
			within(review).getByRole('link', {
				name: /1 pending record\(s\) · 1 draft\(s\)/,
			})
		).toHaveAttribute('href', '#decision-recognition');
		expect(
			within(review).queryByText('total issues', { exact: false })
		).not.toBeInTheDocument();
	});

	it('reveals a collapsed section and focuses its heading from a review link', async () => {
		const user = userEvent.setup();
		const month = data();
		renderDecision(decisionProps({ month }));
		await user.click(screen.getByTestId('financial-close-toggle'));
		expect(
			screen.queryByTestId('financial-close-blockers')
		).not.toBeInTheDocument();
		const review = screen.getByRole('region', { name: 'Review summary' });
		const link = within(review).getByRole('link', {
			name: /Financial close: open/,
		});
		await user.click(link);
		expect(screen.getByTestId('financial-close-blockers')).toBeInTheDocument();
		const section = screen.getByTestId('decision-section-close');
		expect(
			within(section).getByRole('heading', { name: 'Financial close' })
		).toHaveFocus();
	});

	it('keeps company totals and review scope explicit under a project filter', () => {
		const month = data();
		month.project_id = 60;
		month.filtered_subtotal = {
			project_id: 60,
			currency_totals: [
				{
					currency: 'INR',
					incurred_cost: 16000,
					comparison_cost: 16000,
					cost_to_date: 16000,
				},
			],
		};
		renderDecision(decisionProps({ month }));
		expect(screen.getByTestId('kpi-incurred-cost')).toHaveTextContent(
			'₹22,000.00'
		);
		const review = screen.getByRole('region', { name: 'Review summary' });
		expect(
			within(review).getByText('Project detail is filtered', { exact: false })
		).toBeInTheDocument();
	});

	it('shows an unavailable queue with its error instead of a clean zero', () => {
		const month = data();
		const props = decisionProps({ month, queue: [] });
		props.queueLoading = false;
		props.queueFailed = true;
		props.queueError = new Error('queue offline');
		renderDecision(props);
		const review = screen.getByRole('region', { name: 'Review summary' });
		expect(within(review).getByRole('alert')).toHaveTextContent(
			'queue offline'
		);
		expect(
			within(review).queryByRole('link', { name: /unconfirmed record/ })
		).not.toBeInTheDocument();
	});

	it('shows a loading queue as loading, never as a clean zero', () => {
		const month = data();
		const props = decisionProps({ month, queue: [] });
		props.queueLoading = true;
		renderDecision(props);
		const review = screen.getByRole('region', { name: 'Review summary' });
		expect(
			within(review).getByText('Unconfirmed cost: loading', { exact: false })
		).toBeInTheDocument();
		expect(
			within(review).queryByRole('link', { name: /unconfirmed record/ })
		).not.toBeInTheDocument();
	});

	it('shows unavailable close data as unavailable, never as ready to close', () => {
		const month = data();
		const props = decisionProps({ month, close: null });
		props.closeLoading = true;
		renderDecision(props);
		const review = screen.getByRole('region', { name: 'Review summary' });
		expect(
			within(review).getByText('Financial close: unavailable')
		).toBeInTheDocument();
		expect(
			within(review).queryByRole('link', { name: /Financial close/ })
		).not.toBeInTheDocument();
	});

	it('keeps a read-only review free of financial write controls', () => {
		const month = data();
		renderDecision(decisionProps({ month }));
		expect(
			screen.queryByRole('button', { name: /Record cost budget/ })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /Recognize/ })
		).not.toBeInTheDocument();
		expect(
			screen.getByText('Recognition needs approval access')
		).toBeInTheDocument();
	});
});

describe('DecisionView payroll and currency coverage', () => {
	it('links payroll estimate and unknown pricing to the payroll section', () => {
		const month = data();
		month.coverage = [
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
		];
		renderDecision(decisionProps({ month }));
		const review = screen.getByRole('region', { name: 'Review summary' });
		const link = within(review).getByRole('link', {
			name: /Payroll: estimated/,
		});
		expect(link).toHaveAttribute('href', '#decision-payroll');
		expect(link).toHaveTextContent('₹4,955.00');
		const row = screen.getByTestId('decision-review-payroll');
		expect(row).toHaveTextContent('1 unknown pricing');
	});

	it('keeps an unsupported conversion without a combined total', () => {
		const month = data();
		month.company = {
			...month.company,
			conversion: {
				status: 'unsupported',
				converted_records: 0,
				unsupported_records: 2,
				converted_charges: 0,
				unsupported_charges: 0,
				unsupported_currencies: ['USD'],
				unknown_currency_records: 0,
			},
			currency: null,
			incurred_cost: null,
			groups: [],
			currency_totals: [
				{
					currency: 'USD',
					incurred_project_cost: 100,
					company_overhead: 0,
					unallocated_cost: 0,
					incurred_cost: 100,
					gross_liability: 100,
					recoverable_tax: 0,
					unresolved_tax_gross: 0,
					period_charge_amount: 0,
					period_charge_count: 0,
					record_count: 2,
					reporting: {
						currency: 'INR',
						status: 'unsupported',
						unsupported_count: 2,
						incurred_project_cost: null,
						company_overhead: null,
						unallocated_cost: null,
						incurred_cost: null,
						gross_liability: null,
						recoverable_tax: null,
						unresolved_tax_gross: null,
					},
				},
			],
		};
		render(
			<>
				<CompanyReconciliationPanel data={month} />
				<CompanyCurrencySubtotals data={month} />
			</>
		);
		expect(screen.getByTestId('conversion-warning')).toBeInTheDocument();
		expect(screen.getByTestId('kpi-incurred-cost')).toHaveTextContent(
			'Not combinable'
		);
		expect(screen.getByTestId('currency-total-row')).toHaveTextContent('USD');
	});

	it('states closed and revised context without recomputing frozen figures', () => {
		const month = data();
		const props = decisionProps({ month });
		props.close = { ...closePayload(), status: 'closed' };
		props.revisions = {
			...revisionPayload(),
			status: 'closed',
			close_uid: 'CLS-1',
			close_version: 3,
			prior: { incurred_cost: 21000, currency: 'INR' },
			revisions: [
				{
					id: 1,
					revision_uid: 'REV-1',
					month: '2026-09',
					close_uid: 'CLS-1',
					close_version: 3,
					target_kind: 'cost',
					target_uid: 'COST-9',
					target_label: 'EXP-9',
					source_table: 'expenses',
					command: 'updated',
					prior_version: 1,
					new_version: 2,
					prior_figures: {
						amount: 1100,
						currency: 'INR',
						classification: 'project',
						period: '2026-09-10',
						state: 'recognized',
						project_code: 'P60',
						project_name: 'Project Sixty',
						source_label: 'EXP-9',
					},
					new_figures: {
						amount: 1200,
						currency: 'INR',
						classification: 'project',
						period: '2026-09-10',
						state: 'recognized',
						project_code: 'P60',
						project_name: 'Project Sixty',
						source_label: 'EXP-9',
					},
					reason: 'Correct amount',
					evidence_reference: 'EV-9',
					actor_user_id: 1,
					actor_name: 'Reviewer',
					created_at: '2026-10-01T00:00:00.000Z',
				},
			],
		};
		renderDecision(props);
		const summary = screen.getByTestId('decision-close-context');
		expect(
			within(summary).getByRole('link', { name: /Financial close: closed/ })
		).toHaveAttribute('href', '#decision-close');
		expect(
			within(summary).getByRole('link', {
				name: /Financial revisions: closed/,
			})
		).toHaveAttribute('href', '#decision-revision');
		expect(
			within(summary).getByText('1 revision(s)', { exact: false })
		).toBeInTheDocument();
		const review = screen.getByRole('region', { name: 'Review summary' });
		expect(
			within(review).getByRole('link', { name: /Financial close: closed/ })
		).toBeInTheDocument();
		expect(
			within(review).getByRole('link', { name: /Financial revisions: closed/ })
		).toBeInTheDocument();
		expect(
			within(review).getByText('1 revision(s)', { exact: false })
		).toBeInTheDocument();
	});
});

describe('DecisionView keyboard and separation', () => {
	it('reveals a collapsed section from the keyboard and focuses its heading', async () => {
		const user = userEvent.setup();
		const month = data();
		renderDecision(decisionProps({ month }));
		await user.click(screen.getByTestId('financial-revision-toggle'));
		expect(
			screen.queryByTestId('financial-revision-totals')
		).not.toBeInTheDocument();
		const review = screen.getByRole('region', { name: 'Review summary' });
		const link = within(review).getByRole('link', {
			name: /Financial revisions: open/,
		});
		link.focus();
		expect(link).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(screen.getByTestId('financial-revision-totals')).toBeInTheDocument();
		const section = screen.getByTestId('decision-section-revision');
		expect(
			within(section).getByRole('heading', { name: 'Financial revisions' })
		).toHaveFocus();
	});

	it('preserves an estimate currency that differs from reporting currency', () => {
		const month = data();
		month.payroll = { ...month.payroll, currency: 'USD', estimated_total: 60 };
		render(<CompanyReconciliationPanel data={month} />);
		const estimate = screen.getByRole('region', { name: 'Estimated payroll' });
		expect(within(estimate).getByText('$60.00')).toBeInTheDocument();
		expect(screen.getByTestId('kpi-incurred-cost')).toHaveTextContent(
			'₹22,000.00'
		);
	});

	it('retains a budget-only project in the standalone budget section only', () => {
		const month = data();
		month.projects = [projectRow({})];
		month.budgets = {
			...month.budgets,
			comparisons: [
				{
					project_id: 60,
					project_code: 'P60',
					project_name: 'Project Sixty',
					client_name: 'Client',
					currency: 'INR',
					incurred_cost: 16000,
					confirmed_records: 2,
					period_charges: 0,
					pending_records: 0,
					outcome: 'compared',
					budget: {
						budget_id: 1,
						budget_uid: 'BUD-1',
						state: 'approved',
						currency: 'INR',
						scope: 'project_incurred_cost',
						amount: 10000,
						period_start: '2026-09-01',
						period_end: '2026-09-30',
						basis_note: null,
						financial_version: 2,
						approval_evidence_reference: 'EV-1',
						approved_at: '2026-09-02',
					},
					candidates: [],
					variance: -6000,
					over_budget: true,
					detail: 'compared with confirmed Incurred Project Cost',
				},
				{
					project_id: 70,
					project_code: 'P70',
					project_name: 'Project Seventy',
					client_name: null,
					currency: 'INR',
					incurred_cost: null,
					confirmed_records: 0,
					period_charges: 0,
					pending_records: 0,
					outcome: 'no_incurred_cost',
					budget: {
						budget_id: 9,
						budget_uid: 'BUD-9',
						state: 'approved',
						currency: 'INR',
						scope: 'project_incurred_cost',
						amount: 5000,
						period_start: '2026-09-01',
						period_end: '2026-09-30',
						basis_note: null,
						financial_version: 2,
						approval_evidence_reference: 'EV-9',
						approved_at: '2026-09-02',
					},
					candidates: [],
					variance: null,
					over_budget: null,
					detail: 'No Incurred Project Cost is recorded for P70',
				},
			],
		};
		renderDecision(decisionProps({ month }));
		expect(screen.getAllByTestId('expenditure-project-row')).toHaveLength(1);
		const budgetSection = screen.getByTestId('budget-section');
		expect(
			within(budgetSection).getByRole('row', { name: /Project Seventy/ })
		).toBeInTheDocument();
	});
});

describe('DecisionView company summary composition', () => {
	it('keeps the headline, comparable change, and close context together above the review', () => {
		const month = data();
		renderDecision(decisionProps({ month }));
		const summary = screen.getByTestId('decision-summary');
		expect(within(summary).getByTestId('kpi-incurred-cost')).toHaveTextContent(
			'₹22,000.00'
		);
		expect(within(summary).getByTestId('comparison-panel')).toBeInTheDocument();
		expect(
			within(summary).getByTestId('decision-close-context')
		).toBeInTheDocument();
		const view = screen.getByTestId('decision-view');
		const order = Array.from(
			view.querySelectorAll(
				'[data-testid="decision-summary"],[data-testid="decision-review"]'
			)
		).map((node) => node.getAttribute('data-testid'));
		expect(order).toEqual(['decision-summary', 'decision-review']);
	});

	it('keeps the review above the verbose comparison detail', () => {
		const month = data();
		month.comparison = {
			...month.comparison,
			currency_totals: [
				{
					currency: 'INR',
					current_cost: 22000,
					prior_cost: 9000,
					change_amount: 13000,
					change_percent: 144.44,
					change_state: 'increase',
					dayless_cost: 0,
					dayless_records: 0,
					groups: [
						{
							key: 'incurred_project_cost',
							label: 'Incurred Project Cost',
							amount: 22000,
							record_count: 2,
						},
					],
				},
			],
		};
		renderDecision(decisionProps({ month }));
		const view = screen.getByTestId('decision-view');
		const order = Array.from(
			view.querySelectorAll(
				'[data-testid="decision-review"],[data-testid="comparison-detail"]'
			)
		).map((node) => node.getAttribute('data-testid'));
		expect(order).toEqual(['decision-review', 'comparison-detail']);
		expect(screen.getByTestId('comparison-currency-row')).toHaveTextContent(
			'INR'
		);
	});

	it('shows missing close and revision context as unavailable near the summary', () => {
		const month = data();
		const props = decisionProps({ month, close: null, revisions: null });
		props.closeLoading = true;
		props.revisionsLoading = true;
		renderDecision(props);
		const summary = screen.getByTestId('decision-close-context');
		expect(
			within(summary).getByText('Financial close: unavailable')
		).toBeInTheDocument();
		expect(
			within(summary).getByText('Financial revisions: unavailable')
		).toBeInTheDocument();
		expect(
			within(summary).queryByRole('link', { name: /Financial close/ })
		).not.toBeInTheDocument();
	});

	it('omits the project count beside company project cost under a project filter', () => {
		const month = data();
		month.project_id = 60;
		month.projects = [projectRow({})];
		month.filtered_subtotal = {
			project_id: 60,
			currency_totals: [
				{
					currency: 'INR',
					incurred_cost: 16000,
					comparison_cost: 16000,
					cost_to_date: 16000,
				},
			],
		};
		renderDecision(decisionProps({ month }));
		expect(screen.getByTestId('kpi-project-cost')).toHaveTextContent(
			'₹22,000.00'
		);
		expect(screen.getByTestId('kpi-project-count')).toHaveTextContent(
			'company cost stays unfiltered'
		);
		expect(
			screen.queryByText('1 project(s) with cost')
		).not.toBeInTheDocument();
	});
});
