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
			'Direct expenses are entered, recognized, and reconciled through this module (#306). Non-operating items — advances, deposits, prepayments, and capital — are shown separately and contribute only their approved period consumption, depreciation, or amortization (#317).',
	},
	{
		code: 'other_expense_source',
		label: 'Other expenses and receipt copies',
		status: 'wired',
		detail:
			'Other expenses are recorded, classified, recognized, and reconciled through this module; a receipt copy links to an already recognized cost instead of adding a second one (#315).',
	},
	{
		code: 'payroll_employee_cost_not_incorporated',
		label: 'Employee cost (recorded payroll)',
		status: 'wired',
		detail:
			'Recorded Payroll Slip employer cost and its frozen Project allocation are part of this total (#307, ADR-0016); estimates are disclosed separately.',
	},
	{
		code: 'supplier_source_wired',
		label: 'Supplier invoices and commitments',
		status: 'wired',
		detail:
			'Supplier invoices are entered, recognized, and reconciled through this module (#311); one supplier liability is one cost, and payable follow-ups, receipt copies, and settlements link to it instead of counting again.',
	},
	{
		code: 'cost_accrual_source',
		label: 'Cost Accruals',
		status: 'wired',
		detail:
			'Evidenced Cost Accruals for received work and their partial or final replacement invoices are captured, recognized, and reconciled through this module (#313); a replacement supersedes only the matched accrual amount, so the estimate and the invoice are never both counted in full.',
	},
	{
		code: 'cash_and_payments_not_incorporated',
		label: 'Cash paid',
		status: 'wired',
		detail:
			'Dated outward cash paid is the month\u2019s supported third-party movements: recorded settlements, native payroll payouts, and dated petty-cash spending (#318). Bank-into-float funding is one internal movement shown apart from paid; client receipts, internal transfers, and undated balances are disclosed, never counted.',
	},
	{
		code: 'petty_cash_source',
		label: 'Petty cash funding and spending',
		status: 'wired',
		detail:
			'Cash-voucher funding and its mirrored credit are one funding event and never operating cost; actual spending is recognized once with its Project, Company Overhead, or unresolved classification (#316).',
	},
];
