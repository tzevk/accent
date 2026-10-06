/**
 * The monthly company reconciliation — one pure interpretation shared by the
 * report response, the source drilldown, and (later) the Excel export.
 *
 * Rules it enforces, straight from the parent specification:
 *  - Company Incurred Cost = Incurred Project Cost + Company Overhead +
 *    Unallocated Cost, each underlying cost counted once.
 *  - Only `recognized` cost is confirmed cost. Drafts, pending evidence,
 *    rejected, cancelled, and unclassified records are separated out and
 *    disclosed, never folded into the total.
 *  - A missing amount is unknown, not zero; a known zero is a recorded zero.
 *  - Currencies are never added together: without a supported conversion the
 *    month is reported as currency subtotals with a coverage exception and no
 *    company total.
 *  - A Project filter narrows the Project detail, never the company
 *    reconciliation.
 */

import type Decimal from 'decimal.js';
import { add, R, toNumber } from '@/lib/money';
import { buildBudgetSection } from './budget-comparison';
import type { SourceCoverageDeclaration } from './coverage';
import { effectiveTaxTreatment, isConfirmed, isOpenState } from './recognition';
import type {
	CompanyReconciliation,
	CostBudgetRecord,
	CostRecord,
	CoverageNotice,
	CurrencyTotal,
	EvidenceStateSummary,
	EvidenceSummary,
	ReconciliationGroup,
	ReconciliationProjectRow,
} from './types';

const GROUP_LABELS = {
	incurred_project_cost: 'Incurred Project Cost',
	company_overhead: 'Company Overhead',
	unallocated_cost: 'Unallocated Cost',
} as const;

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

/** "2019-01" → "January 2019"; unparseable input is returned unchanged. */
export function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** The amount a confirmed record contributes; the stored figure wins. */
function confirmedAmount(record: CostRecord): number | null {
	if (!isConfirmed(record.state)) return null;
	if (record.recognizedAmount !== null) return record.recognizedAmount;
	return record.evaluation.recognizedAmount;
}

function rounded(value: Decimal.Value): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/** Sum money without floating point drift, rounded once at the boundary. */
function sumMoney(values: Array<number | null>): number {
	return rounded(
		values.reduce<Decimal>((total, value) => add(total, value ?? 0), R(0))
	);
}

/** The single currency the records share, or null for none or more than one. */
function currencyOf(records: CostRecord[]): string | null {
	const codes = new Set(records.map((record) => record.currency ?? 'INR'));
	return codes.size === 1 ? [...codes][0] : null;
}

/**
 * A subtotal that may only be stated in one currency. Zero records contribute
 * a known zero; a single unknown amount or a second currency makes the figure
 * null, because an unknown amount is not zero and currencies are never added.
 */
function subtotal(
	records: CostRecord[],
	value: (record: CostRecord) => number | null
): number | null {
	if (records.length === 0) return 0;
	const amounts = records.map(value);
	if (amounts.some((amount) => amount === null)) return null;
	if (currencyOf(records) === null) return null;
	return sumMoney(amounts);
}

function countByState(
	records: CostRecord[],
	state: CostRecord['state']
): EvidenceStateSummary {
	const matching = records.filter((record) => record.state === state);
	return {
		count: matching.length,
		currency: currencyOf(matching),
		amount: subtotal(matching, (record) =>
			isConfirmed(record.state) ? confirmedAmount(record) : record.grossAmount
		),
	};
}

function currencySlice(records: CostRecord[], currency: string): CurrencyTotal {
	let project = R(0);
	let overhead = R(0);
	let unallocated = R(0);
	let gross = R(0);
	let recoverable = R(0);
	let unresolvedGross = R(0);
	for (const record of records) {
		const amount = confirmedAmount(record);
		if (amount === null) continue;
		if (record.classification === 'project') project = add(project, amount);
		else if (record.classification === 'company_overhead') {
			overhead = add(overhead, amount);
		} else if (record.classification === 'unallocated') {
			unallocated = add(unallocated, amount);
		}
		const grossLiability = record.grossAmount ?? amount;
		gross = add(gross, grossLiability);
		const treatment = effectiveTaxTreatment(record);
		if (treatment === 'recoverable') {
			recoverable = add(recoverable, record.taxAmount ?? 0);
		} else if (treatment === 'unresolved') {
			unresolvedGross = add(unresolvedGross, grossLiability);
		}
	}
	return {
		currency,
		incurred_project_cost: rounded(project),
		company_overhead: rounded(overhead),
		unallocated_cost: rounded(unallocated),
		incurred_cost: rounded(add(add(project, overhead), unallocated)),
		gross_liability: rounded(gross),
		recoverable_tax: rounded(recoverable),
		unresolved_tax_gross: rounded(unresolvedGross),
		record_count: records.filter((record) => confirmedAmount(record) !== null)
			.length,
	};
}

/** The Project ids a month's records place rows for. */
export function projectIdsIn(records: CostRecord[]): number[] {
	const ids = new Set<number>();
	for (const record of records) {
		if (record.classification === 'project' && record.projectId !== null) {
			ids.add(record.projectId);
		}
	}
	return [...ids];
}

function projectRows(
	confirmed: CostRecord[],
	open: CostRecord[],
	previousMonth: Map<number, Map<string, number | null>>,
	projectFilter: number | null
): ReconciliationProjectRow[] {
	// One row per Project and currency. Amounts in different currencies are
	// never added, and the prior-month comparison is same-currency only; a
	// Project costing in two currencies therefore shows two rows.
	const ids = new Set<number>(projectIdsIn([...confirmed, ...open]));
	const rows: ReconciliationProjectRow[] = [];
	for (const id of ids) {
		if (projectFilter !== null && projectFilter !== id) continue;
		const projectRecords = [...confirmed, ...open].filter(
			(record) => record.projectId === id
		);
		const sample = projectRecords[0];
		const currencies = [
			...new Set(projectRecords.map((record) => record.currency ?? 'INR')),
		].sort();
		for (const currency of currencies) {
			const currencyRecords = projectRecords.filter(
				(record) => (record.currency ?? 'INR') === currency
			);
			const confirmedRows = currencyRecords.filter(
				(record) => confirmedAmount(record) !== null
			);
			const openRows = currencyRecords.filter((record) =>
				isOpenState(record.state)
			);
			const incurred = sumMoney(confirmedRows.map(confirmedAmount));
			const previous = previousMonth.get(id)?.get(currency) ?? null;
			const change = previous === null ? null : rounded(incurred - previous);
			rows.push({
				project_id: id,
				project_code: sample.projectCode ?? `#${id}`,
				project_name:
					sample.projectName ?? sample.projectCode ?? `Project #${id}`,
				client_name: sample.clientName,
				currency,
				incurred_cost: incurred,
				record_count: confirmedRows.length,
				not_confirmed_cost: subtotal(openRows, (record) => record.grossAmount),
				previous_month_cost: previous,
				change_amount: change,
				change_state:
					previous === null
						? 'no_prior'
						: incurred === previous
							? 'unchanged'
							: previous === 0
								? 'new'
								: incurred > previous
									? 'increase'
									: 'decrease',
			});
		}
	}
	rows.sort(
		(a, b) =>
			a.project_code.localeCompare(b.project_code) ||
			a.currency.localeCompare(b.currency)
	);
	return rows;
}

function monthNotices(
	records: CostRecord[],
	confirmed: CostRecord[],
	currencyTotals: CurrencyTotal[],
	grossMissing: number
): CoverageNotice[] {
	const notices: CoverageNotice[] = [];
	const openCount = records.filter((record) =>
		isOpenState(record.state)
	).length;
	const unresolvedClassification = records.filter(
		(record) => record.classification === null
	);
	const unresolvedTax = confirmed.filter(
		(record) => effectiveTaxTreatment(record) === 'unresolved'
	);
	const taxEvidenceMissing = confirmed.filter((record) =>
		record.evaluation.exceptions.includes('tax_evidence_missing')
	);
	const spanRecords = records.filter((record) =>
		record.evaluation.exceptions.includes('service_period_spans_months')
	);
	const startMissingRecords = records.filter((record) =>
		record.evaluation.exceptions.includes('service_period_start_missing')
	);

	if (confirmed.length === 0) {
		notices.push({
			code: 'no_recognized_cost',
			label: 'No recognized cost recorded for this month',
			detail:
				'An empty source is not proof of zero expenditure. Record cost, or review whether this month’s sources are captured.',
			severity: 'warning',
		});
	}
	if (currencyTotals.length > 1) {
		notices.push({
			code: 'currency_conversion_missing',
			label: 'More than one currency in this month',
			detail:
				'Amounts are shown per currency because no supported conversion exists; there is no combined company total.',
			severity: 'warning',
		});
	}
	if (openCount > 0) {
		notices.push({
			code: 'records_awaiting_recognition',
			label: 'Records awaiting recognition',
			detail: `${openCount} record(s) are draft or pending evidence and are excluded from confirmed cost.`,
			severity: 'warning',
		});
	}
	if (grossMissing > 0) {
		notices.push({
			code: 'missing_amount',
			label: 'Records with no amount',
			detail: `${grossMissing} record(s) have no amount recorded. A missing amount is unknown, not zero.`,
			severity: 'warning',
		});
	}
	if (unresolvedClassification.length > 0) {
		notices.push({
			code: 'unresolved_classification',
			label: 'Cost awaiting classification',
			detail: `${unresolvedClassification.length} record(s) have no Project, Company Overhead, or Unallocated Cost destination.`,
			severity: 'warning',
		});
	}
	if (unresolvedTax.length > 0) {
		notices.push({
			code: 'unresolved_tax_treatment',
			label: 'Tax treatment unresolved',
			detail: `${unresolvedTax.length} recognized record(s) were counted at gross because their tax treatment is not settled.`,
			severity: 'warning',
		});
	}
	if (taxEvidenceMissing.length > 0) {
		notices.push({
			code: 'tax_evidence_missing',
			label: 'Recoverable tax claimed without evidence',
			detail: `${taxEvidenceMissing.length} record(s) claim recoverable tax without its evidence, so the gross amount stays in cost.`,
			severity: 'warning',
		});
	}
	if (spanRecords.length > 0) {
		notices.push({
			code: 'service_period_spans_months',
			label: 'Service period spans more than one month',
			detail: `${spanRecords.length} record(s) cover more than one month; their whole amount sits in the month the work started in until period splitting is supported.`,
			severity: 'info',
		});
	}
	if (startMissingRecords.length > 0) {
		notices.push({
			code: 'service_period_start_missing',
			label: 'Service period start not recorded',
			detail: `${startMissingRecords.length} record(s) state only the end of the received-work period; each cost sits in that end month until the start is known.`,
			severity: 'info',
		});
	}
	return notices;
}

export interface ReconciliationInput {
	month: string;
	/** Every direct cost belonging to the month, in any recognition state. */
	records: CostRecord[];
	/**
	 * Confirmed Project cost of the previous month, keyed by project id and
	 * then currency. `null` means that currency's prior amount is unknown.
	 */
	previousMonthProjectCost: Map<number, Map<string, number | null>>;
	/**
	 * The cost budgets the budget section reads: every covering budget of the
	 * month plus every budget of the Projects above.
	 */
	budgets: CostBudgetRecord[];
	projectFilter: number | null;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	availableMonths: string[];
	coverageDeclarations: readonly SourceCoverageDeclaration[];
}

/** Build the reconciliation payload. Pure: all data arrives as arguments. */
export function buildReconciliation(
	input: ReconciliationInput
): CompanyReconciliation {
	const { records } = input;
	const confirmed = records.filter(
		(record) => confirmedAmount(record) !== null
	);
	const open = records.filter((record) => isOpenState(record.state));
	const currencies = [
		...new Set(confirmed.map((record) => record.currency ?? 'INR')),
	].sort();
	const currencyTotals = currencies.map((currency) =>
		currencySlice(
			confirmed.filter((record) => (record.currency ?? 'INR') === currency),
			currency
		)
	);

	const groups: ReconciliationGroup[] =
		currencyTotals.length === 1
			? [
					{
						key: 'incurred_project_cost',
						label: GROUP_LABELS.incurred_project_cost,
						amount: currencyTotals[0].incurred_project_cost,
						record_count: confirmed.filter(
							(record) => record.classification === 'project'
						).length,
					},
					{
						key: 'company_overhead',
						label: GROUP_LABELS.company_overhead,
						amount: currencyTotals[0].company_overhead,
						record_count: confirmed.filter(
							(record) => record.classification === 'company_overhead'
						).length,
					},
					{
						key: 'unallocated_cost',
						label: GROUP_LABELS.unallocated_cost,
						amount: currencyTotals[0].unallocated_cost,
						record_count: confirmed.filter(
							(record) => record.classification === 'unallocated'
						).length,
					},
				]
			: [];

	const unresolvedTax = confirmed.filter(
		(record) => effectiveTaxTreatment(record) === 'unresolved'
	);
	const unclassified = records.filter(
		(record) => record.classification === null
	);
	const missingAmounts = records.filter(
		(record) => record.grossAmount === null
	);
	// A month holding more than one currency has no combined company figure:
	// the per-currency slices carry each currency's own total instead.
	const singleCurrency = currencies.length === 1;

	const evidence: EvidenceSummary = {
		recognized: countByState(records, 'recognized'),
		pending_evidence: countByState(records, 'pending_evidence'),
		draft: countByState(records, 'draft'),
		rejected: countByState(records, 'rejected'),
		cancelled: countByState(records, 'cancelled'),
		unresolved_classification: {
			count: unclassified.length,
			currency: currencyOf(unclassified),
			gross_amount: subtotal(unclassified, (record) => record.grossAmount),
		},
		missing_amount: { count: missingAmounts.length },
		known_zero: {
			count: records.filter((record) => record.grossAmount === 0).length,
		},
	};

	const notices: CoverageNotice[] = [
		...input.coverageDeclarations
			.filter((entry) => entry.status === 'not_incorporated')
			.map((entry) => ({
				code: entry.code,
				label: entry.label,
				detail: entry.detail,
				severity: 'warning' as const,
			})),
		...monthNotices(records, confirmed, currencyTotals, missingAmounts.length),
	];

	const projects = projectRows(
		confirmed,
		open,
		input.previousMonthProjectCost,
		input.projectFilter
	);

	return {
		month: input.month,
		month_label: monthLabel(input.month),
		project_id: input.projectFilter,
		company: {
			currency: singleCurrency ? currencies[0] : null,
			incurred_cost: singleCurrency ? currencyTotals[0].incurred_cost : null,
			currency_totals: currencyTotals,
			groups,
			// Gross liability and recoverable tax are stated only for a single
			// currency; a multi-currency month keeps them per currency in
			// `currency_totals` rather than publishing a combined rupee figure.
			gross_liability: singleCurrency
				? currencyTotals[0].gross_liability
				: null,
			recoverable_tax: singleCurrency
				? currencyTotals[0].recoverable_tax
				: null,
			unresolved_tax: {
				count: unresolvedTax.length,
				currency: currencyOf(unresolvedTax),
				gross_amount: subtotal(
					unresolvedTax,
					(record) => record.grossAmount ?? confirmedAmount(record)
				),
			},
			known_zero_count: records.filter((record) => record.grossAmount === 0)
				.length,
			record_count: confirmed.length,
		},
		projects,
		evidence,
		coverage: notices,
		// The budget section is its own interpretation: a budget never enters
		// `company`, `projects`, or `evidence`.
		budgets: buildBudgetSection({
			month: input.month,
			rows: projects,
			records,
			budgets: input.budgets,
			projectFilter: input.projectFilter,
		}),
		project_options: input.projectOptions,
		available_months: input.availableMonths,
	};
}
