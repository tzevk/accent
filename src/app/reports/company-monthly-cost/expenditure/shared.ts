/**
 * The vocabulary and helpers the company expenditure view reads.
 *
 * The label maps turn a stored state into the reader's words, and the
 * helpers answer the questions every block of the view asks of a row. They
 * live apart from the view itself so the forms and the revision panel state
 * the same words for the same values.
 */

import type { CostNature } from '@/lib/company-expenditure';
import { formatCurrencyIn, formatNumber } from '@/lib/format';

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

export const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

/** How the Recognition Period was established, in the reader's words. */
export const PERIOD_BASIS_LABELS: Record<string, string> = {
	service_period: 'service period',
	service_period_end: 'service period end (start not recorded)',
	bill_date_fallback: 'bill date fallback',
	unresolved: 'unresolved',
};

export const CLASSIFICATION_LABELS: Record<string, string> = {
	project: 'Project',
	company_overhead: 'Company Overhead',
	unallocated: 'Unallocated Cost',
};

/**
 * Where a cost from another source register is reviewed. Its approval lives in
 * that register's own controls (a versioned `financial_version` + journal like
 * this one), so the report must not send its row-level commands to the direct
 * expense path.
 */
export const SOURCE_REGISTER_LABELS: Record<string, string> = {
	other_expense: 'Recognized in the Other Expense register',
	supplier_invoice: 'Recognized in the Purchase Invoice register',
	petty_cash: 'Recognized in the Petty Cash register',
	non_operating: 'Recognized in the period-charge workflow',
	payroll: 'Finalized with payroll',
};

export const SOURCE_REGISTER_LINKS: Record<string, string> = {
	other_expense: '/admin/other-expenses',
};

/** What the spend is (#317), in the reader's words. */
export const NATURE_LABELS: Record<string, string> = {
	operating: 'Operating cost',
	advance: 'Advance',
	deposit: 'Deposit',
	prepayment: 'Prepayment',
	capital: 'Capital item',
	unresolved: 'Treatment unresolved',
};

export const CHARGE_BASIS_LABELS: Record<string, string> = {
	consumption: 'Consumption',
	depreciation: 'Depreciation',
	amortization: 'Amortization',
};

/** Natures whose balance is consumed by approved period charges. */
export const CONSUMABLE_NATURES = [
	'advance',
	'deposit',
	'prepayment',
	'capital',
];

export const NATURE_OPTIONS: ReadonlyArray<{
	value: CostNature;
	label: string;
}> = [
	{ value: 'operating', label: 'Operating cost' },
	{ value: 'advance', label: 'Advance (balance, not cost)' },
	{ value: 'deposit', label: 'Deposit (balance, not cost)' },
	{ value: 'prepayment', label: 'Prepayment (balance, not cost)' },
	{ value: 'capital', label: 'Capital item (balance, not cost)' },
	{ value: 'unresolved', label: 'Treatment unresolved (excluded)' },
];

/** The select's exact vocabulary, for narrowing a DOM string to `CostNature`. */
export const NATURE_VALUES: readonly string[] = NATURE_OPTIONS.map(
	(option) => option.value
);

export function isCostNature(value: string): value is CostNature {
	return NATURE_VALUES.includes(value);
}

export const CHANGE_LABELS: Record<string, string> = {
	no_prior: 'No prior month',
	new: 'New cost',
	increase: 'Increase',
	decrease: 'Decrease',
	unchanged: 'No change',
	unproven: 'Window membership unproven',
};

/** What the row's figures rest on, in the reader's words. */
export const EVIDENCE_LABELS: Record<string, string> = {
	recorded: 'Recorded',
	estimated: 'Estimated',
	reconstructed: 'Reconstructed',
	incomplete: 'Incomplete evidence',
};

/** The findings behind an evidence state, in the reader's words. */
export const EVIDENCE_FINDING_LABELS: Record<string, string> = {
	open_records: 'not yet confirmed',
	unknown_amount: 'amount unknown',
	bill_date_fallback: 'bill-date period',
	partial_service_period: 'period end only',
	unresolved_tax: 'tax unresolved',
	reconstructed: 'reconstructed',
};

/**
 * A change stated as a percentage only when one is supported: a known zero
 * prior is a new cost, and an unknown prior amount stays unknown. No figure is
 * invented for either.
 */
export function percentLabel(percent: number | null, state: string): string {
	if (percent !== null) return `${percent.toFixed(2)}%`;
	if (state === 'new') return 'New cost, no percentage';
	if (state === 'no_prior') return 'Prior amount unknown';
	return CHANGE_LABELS[state] ?? state;
}

/** Position of each row in an ordering, keyed by Project and currency. */
export function rankMap(
	entries: Array<{ project_id: number; currency: string; rank: number }>
): Map<string, number> {
	return new Map(
		entries.map((entry) => [
			`${entry.project_id}:${entry.currency}`,
			entry.rank,
		])
	);
}

/** How an employee's cost is known (#307). */
export const PAYROLL_STATUS_LABELS: Record<string, string> = {
	recorded: 'Recorded',
	estimated: 'Estimated',
	known_zero: 'Known zero',
	unknown: 'Unknown pricing',
};
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong';
}

/** Money whose original currency is unknown is never labelled as INR. */
export function formatSourceMoney(
	value: number | null,
	currency: string | null
): string {
	if (value === null) return '—';
	return currency === null
		? `${formatNumber(value)} (currency unknown)`
		: formatCurrencyIn(value, currency);
}

/**
 * A missing amount is unknown, never zero, and a multi-currency figure is
 * not stated at all; both read as "Unknown" here rather than as a number.
 */
export function money(value: number | null, currency: string | null): string {
	return value === null
		? 'Unknown'
		: formatCurrencyIn(value, currency ?? 'INR');
}
