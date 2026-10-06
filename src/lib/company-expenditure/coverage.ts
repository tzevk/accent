/**
 * Source coverage of the company reconciliation.
 *
 * The reconciliation must never imply that the sources it can read are the
 * whole company's expenditure. Every source the parent specification names is
 * declared here with its wiring state; the reconciliation reports each
 * `not_incorporated` entry as a coverage notice so a reader can see what the
 * total does and does not include.
 *
 * Later slices of #304 flip a declaration to `wired` when they add the source
 * adapter that feeds its recognized cost into this module — they do not add a
 * second aggregation.
 */

export interface SourceCoverageDeclaration {
	/** Stable code the report and its tests address the notice by. */
	code: string;
	label: string;
	status: 'wired' | 'not_incorporated';
	detail: string;
}

export const SOURCE_COVERAGE: readonly SourceCoverageDeclaration[] = [
	{
		code: 'direct_expense_source',
		label: 'Direct expense recognition',
		status: 'wired',
		detail:
			'Direct expenses are entered, recognized, and reconciled through this module (#306).',
	},
	{
		code: 'payroll_employee_cost_not_incorporated',
		label: 'Employee cost (recorded payroll)',
		status: 'not_incorporated',
		detail:
			'Recorded Payroll Slip employer cost and its frozen Project allocation are not part of this total yet; they are incorporated by a later slice (#307).',
	},
	{
		code: 'supplier_source_not_incorporated',
		label: 'Supplier invoices and commitments',
		status: 'not_incorporated',
		detail:
			'Supplier invoices, orders, and Outstanding Supplier Commitment are not part of this total yet.',
	},
	{
		code: 'cost_accrual_capture_not_incorporated',
		label: 'Cost Accruals',
		status: 'not_incorporated',
		detail:
			'Evidenced Cost Accruals and their replacement invoices are not captured yet; no accrual estimate is added to this total.',
	},
	{
		code: 'cash_and_payments_not_incorporated',
		label: 'Cash paid',
		status: 'not_incorporated',
		detail:
			'Dated outward settlements and advances are not linked yet, so no company cash-paid figure is presented. Petty-cash funding and spending are incorporated separately (#316).',
	},
	{
		code: 'petty_cash_source',
		label: 'Petty cash funding and spending',
		status: 'wired',
		detail:
			'Cash-voucher funding and its mirrored credit are one funding event and never operating cost; actual spending is recognized once with its Project, Company Overhead, or unresolved classification (#316).',
	},
];
