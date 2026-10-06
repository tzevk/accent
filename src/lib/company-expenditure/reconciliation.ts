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
 *  - Currencies are never added together. Amounts are stated in the requested
 *    reporting currency only from matching stored conversion evidence
 *    (`currency.ts`); anything else stays in its own currency subtotal with an
 *    explicit exception, and a mixed grand total is never presented.
 *  - A Project filter narrows the Project detail, never the company
 *    reconciliation.
 */

import type Decimal from 'decimal.js';
import { add, R, toNumber } from '@/lib/money';
import { buildBudgetSection } from './budget-comparison';
import type { SourceCoverageDeclaration } from './coverage';
import {
	convertToReporting,
	conversionStatusOf,
	currencyCodeOf,
	evidenceOf,
	reportingCurrencyOf,
} from './currency';
import { effectiveTaxTreatment, isConfirmed, isOpenState } from './recognition';
import type {
	CompanyConversion,
	CompanyReconciliation,
	CostBudgetRecord,
	CostRecord,
	CoverageNotice,
	CurrencyReporting,
	CurrencyTotal,
	EvidenceStateSummary,
	EvidenceSummary,
	ReconciliationGroup,
	ReconciliationProjectRow,
	ReconciliationSourceSummary,
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

/**
 * The single currency the records share, or null for none, more than one, or
 * any unknown original currency — an unknown currency can never be stated.
 */
function currencyOf(records: CostRecord[]): string | null {
	const codes = new Set(records.map((record) => currencyCodeOf(record.currency)));
	if (codes.has(null)) return null;
	return codes.size === 1 ? ([...codes][0] as string) : null;
}

/**
 * A subtotal that may only be stated in one currency. Zero records contribute
 * a known zero; a single unknown amount, an unknown currency, or a second
 * currency makes the figure null, because an unknown amount is not zero and
 * currencies are never added.
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

/** The same amount in the requested reporting basis, or null when unsupported. */
function convertedAmountOf(
	record: CostRecord,
	value: number | null,
	reporting: string
): number | null {
	if (value === null) return null;
	return convertToReporting(value, evidenceOf(record), reporting).amount;
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

function currencySlice(
	records: CostRecord[],
	currency: string,
	reporting: string
): CurrencyTotal {
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
		reporting: reportingSlice(records, currency, reporting),
	};
}

/**
 * The same slice in the requested reporting currency. Every confirmed record
 * must be supported; a slice with even one unsupported record is stated as
 * null rather than as a partial total.
 */
function reportingSlice(
	records: CostRecord[],
	currency: string,
	reporting: string
): CurrencyReporting {
	const confirmed = records.filter(
		(record) => confirmedAmount(record) !== null
	);
	const unsupported = confirmed.filter(
		(record) => conversionStatusOf(evidenceOf(record), reporting) === 'unsupported'
	).length;
	if (unsupported > 0) {
		return {
			currency: reporting,
			status: 'unsupported',
			unsupported_count: unsupported,
			incurred_project_cost: null,
			company_overhead: null,
			unallocated_cost: null,
			incurred_cost: null,
			gross_liability: null,
			recoverable_tax: null,
			unresolved_tax_gross: null,
		};
	}
	let project = R(0);
	let overhead = R(0);
	let unallocated = R(0);
	let gross = R(0);
	let recoverable = R(0);
	let unresolvedGross = R(0);
	for (const record of confirmed) {
		const amount = convertedAmountOf(record, confirmedAmount(record), reporting);
		if (amount === null) continue;
		if (record.classification === 'project') project = add(project, amount);
		else if (record.classification === 'company_overhead') {
			overhead = add(overhead, amount);
		} else if (record.classification === 'unallocated') {
			unallocated = add(unallocated, amount);
		}
		const grossLiability =
			convertedAmountOf(
				record,
				record.grossAmount ?? confirmedAmount(record),
				reporting
			) ?? 0;
		gross = add(gross, grossLiability);
		const treatment = effectiveTaxTreatment(record);
		if (treatment === 'recoverable') {
			recoverable = add(
				recoverable,
				convertedAmountOf(record, record.taxAmount ?? 0, reporting) ?? 0
			);
		} else if (treatment === 'unresolved') {
			unresolvedGross = add(unresolvedGross, grossLiability);
		}
	}
	return {
		currency: reporting,
		status: currency === reporting ? 'reporting' : 'converted',
		unsupported_count: 0,
		incurred_project_cost: rounded(project),
		company_overhead: rounded(overhead),
		unallocated_cost: rounded(unallocated),
		incurred_cost: rounded(add(add(project, overhead), unallocated)),
		gross_liability: rounded(gross),
		recoverable_tax: rounded(recoverable),
		unresolved_tax_gross: rounded(unresolvedGross),
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
	projectFilter: number | null,
	reporting: string
): ReconciliationProjectRow[] {
	// One row per Project and currency. Amounts in different currencies are
	// never added, and the prior-month comparison is same-currency only; a
	// Project costing in two currencies therefore shows two rows. A record
	// whose currency is unknown cannot be stated and stays out of the rows.
	const stated = [...confirmed, ...open].filter(
		(record) => currencyCodeOf(record.currency) !== null
	);
	const ids = new Set<number>(projectIdsIn(stated));
	const rows: ReconciliationProjectRow[] = [];
	for (const id of ids) {
		if (projectFilter !== null && projectFilter !== id) continue;
		const projectRecords = stated.filter((record) => record.projectId === id);
		const sample = projectRecords[0];
		const currencies = [
			...new Set(
				projectRecords.map((record) => currencyCodeOf(record.currency) as string)
			),
		].sort();
		for (const currency of currencies) {
			const currencyRecords = projectRecords.filter(
				(record) => currencyCodeOf(record.currency) === currency
			);
			const confirmedRows = currencyRecords.filter(
				(record) => confirmedAmount(record) !== null
			);
			const openRows = currencyRecords.filter((record) =>
				isOpenState(record.state)
			);
			const incurred = sumMoney(confirmedRows.map(confirmedAmount));
			const reportingOutcomes = confirmedRows.map((record) =>
				convertToReporting(confirmedAmount(record), evidenceOf(record), reporting)
			);
			const unsupported = reportingOutcomes.some(
				(outcome) => outcome.status === 'unsupported'
			);
			const previous = previousMonth.get(id)?.get(currency) ?? null;
			const change = previous === null ? null : rounded(incurred - previous);
			rows.push({
				project_id: id,
				project_code: sample.projectCode ?? `#${id}`,
				project_name:
					sample.projectName ?? sample.projectCode ?? `Project #${id}`,
				client_name: sample.clientName,
				currency,
				conversion_status: unsupported
					? 'unsupported'
					: currency === reporting
						? 'reporting'
						: 'converted',
				converted_incurred_cost: unsupported
					? null
					: sumMoney(reportingOutcomes.map((outcome) => outcome.amount)),
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
	grossMissing: number,
	reporting: string
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
	const unsupported = confirmed.filter(
		(record) => conversionStatusOf(evidenceOf(record), reporting) === 'unsupported'
	);
	const unknownCurrency = confirmed.filter(
		(record) => currencyCodeOf(record.currency) === null
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
	if (unsupported.length > 0) {
		const unsupportedCurrencies = currencyTotals
			.filter((row) => row.reporting.status === 'unsupported')
			.map((row) => row.currency);
		notices.push({
			code: 'currency_conversion_missing',
			label: 'Some cost is not stated in the reporting currency',
			detail: `${unsupported.length} recognized record(s) carry no supported conversion evidence for ${reporting}${
				unsupportedCurrencies.length > 0
					? ` (${unsupportedCurrencies.join(', ')})`
					: ''
			}; those amounts stay in their own currency subtotals with no combined total.`,
			severity: 'warning',
		});
	}
	if (unknownCurrency.length > 0) {
		notices.push({
			code: 'original_currency_missing',
			label: 'Original currency not recorded',
			detail: `${unknownCurrency.length} recognized record(s) have no original currency. It is unknown, never assumed INR, so they are excluded from every currency subtotal.`,
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

/** Human labels for the sources the module reads today. */
const SOURCE_LABELS: Record<string, string> = {
	direct_expense: 'Direct expenses',
	supplier_invoice: 'Supplier invoices',
	other_expense: 'Other expenses',
	petty_cash: 'Petty cash',
	non_operating: 'Non-operating charges',
	payroll: 'Employee cost (payroll)',
};

/**
 * The wired sources always appear — a source with no records in the month is a
 * known zero for that source, not an omitted one. A source that is not wired
 * yet is declared through `SOURCE_COVERAGE`, not summarized as zero here.
 */
const WIRED_SOURCES: ReadonlyArray<CostRecord['source']> = [
	'direct_expense',
	'supplier_invoice',
];

function sourceSummaries(
	records: CostRecord[]
): ReconciliationSourceSummary[] {
	return WIRED_SOURCES.map((source) => {
		const rows = records.filter((record) => record.source === source);
		const confirmed = rows.filter((record) => confirmedAmount(record) !== null);
		const pending = rows.filter((record) => isOpenState(record.state));
		const unresolvedEvidence = rows.filter(
			(record) =>
				record.classification === null ||
				record.grossAmount === null ||
				(isConfirmed(record.state) &&
					effectiveTaxTreatment(record) === 'unresolved')
		);
		return {
			source,
			label: SOURCE_LABELS[source] ?? source,
			confirmed_count: confirmed.length,
			confirmed_amount: subtotal(confirmed, (record) => confirmedAmount(record)),
			currency: currencyOf(confirmed),
			pending_count: pending.length,
			pending_amount: subtotal(pending, (record) => record.grossAmount),
			unresolved_evidence_count: unresolvedEvidence.length,
		};
	});
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
	/** Requested reporting basis; absent means the company reporting currency. */
	reportingCurrency?: string | null;
}

/** Build the reconciliation payload. Pure: all data arrives as arguments. */
export function buildReconciliation(
	input: ReconciliationInput
): CompanyReconciliation {
	const { records } = input;
	const reporting = reportingCurrencyOf({
		reportingCurrency: input.reportingCurrency ?? null,
	});
	const confirmed = records.filter(
		(record) => confirmedAmount(record) !== null
	);
	const open = records.filter((record) => isOpenState(record.state));
	const knownConfirmed = confirmed.filter(
		(record) => currencyCodeOf(record.currency) !== null
	);
	const unknownCurrency = records.filter(
		(record) => currencyCodeOf(record.currency) === null
	);
	const currencies = [
		...new Set(
			knownConfirmed.map((record) => currencyCodeOf(record.currency) as string)
		),
	].sort();
	const currencyTotals = currencies.map((currency) =>
		currencySlice(
			knownConfirmed.filter(
				(record) => currencyCodeOf(record.currency) === currency
			),
			currency,
			reporting
		)
	);

	// A month can be stated in the reporting currency only when every
	// confirmed record is supported (and there is at least one). Otherwise a
	// single known currency keeps its own total and everything else has none.
	const convertedRecords = confirmed.filter(
		(record) => conversionStatusOf(evidenceOf(record), reporting) === 'converted'
	).length;
	const unsupportedRecords = confirmed.filter(
		(record) => conversionStatusOf(evidenceOf(record), reporting) === 'unsupported'
	).length;
	const singleCurrency = currencies.length === 1;
	const complete = unsupportedRecords === 0 && currencies.length > 0;
	// One known currency that cannot be stated in the reporting basis keeps its
	// own total; a complete month states every figure in the reporting basis.
	const singleUnsupportedCurrency =
		!complete && singleCurrency && unknownCurrency.length === 0;

	const CLASSIFICATION_OF_GROUP: Record<
		ReconciliationGroup['key'],
		CostRecord['classification']
	> = {
		incurred_project_cost: 'project',
		company_overhead: 'company_overhead',
		unallocated_cost: 'unallocated',
	};
	const groupOf = (key: ReconciliationGroup['key']): ReconciliationGroup => {
		const reportingAmount = (row: CurrencyTotal): number | null => {
			if (key === 'incurred_project_cost') {
				return row.reporting.incurred_project_cost;
			}
			if (key === 'company_overhead') return row.reporting.company_overhead;
			return row.reporting.unallocated_cost;
		};
		return {
			key,
			label: GROUP_LABELS[key],
			amount: complete
				? sumMoney(currencyTotals.map(reportingAmount))
				: singleUnsupportedCurrency
					? (currencyTotals[0][key] as number)
					: 0,
			record_count: knownConfirmed.filter(
				(record) => record.classification === CLASSIFICATION_OF_GROUP[key]
			).length,
		};
	};

	const groups: ReconciliationGroup[] =
		complete || singleUnsupportedCurrency
			? [
					groupOf('incurred_project_cost'),
					groupOf('company_overhead'),
					groupOf('unallocated_cost'),
				]
			: [];

	// The unresolved-tax subset follows the same statement rule as the rest.
	const unresolvedTax = knownConfirmed.filter(
		(record) => effectiveTaxTreatment(record) === 'unresolved'
	);
	const unresolvedTaxGross = (): number | null => {
		if (complete) {
			return sumMoney(
				unresolvedTax.map((record) =>
					convertedAmountOf(
						record,
						record.grossAmount ?? confirmedAmount(record),
						reporting
					)
				)
			);
		}
		if (singleUnsupportedCurrency) {
			return subtotal(
				unresolvedTax,
				(record) => record.grossAmount ?? confirmedAmount(record)
			);
		}
		return null;
	};

	const companyIncurredCost = complete
		? sumMoney(currencyTotals.map((row) => row.reporting.incurred_cost))
		: singleUnsupportedCurrency
			? currencyTotals[0].incurred_cost
			: null;

	const conversion: CompanyConversion = {
		// Nothing unconverted means nothing is withheld: a month with no
		// confirmed record is not "unsupported", it has nothing to state.
		status:
			unsupportedRecords === 0
				? currencyTotals.some((row) => row.reporting.status === 'converted')
					? 'converted'
					: 'reporting'
				: 'unsupported',
		converted_records: convertedRecords,
		unsupported_records: unsupportedRecords,
		unsupported_currencies: currencyTotals
			.filter((row) => row.reporting.status === 'unsupported')
			.map((row) => row.currency),
		unknown_currency_records: confirmed.filter(
			(record) => currencyCodeOf(record.currency) === null
		).length,
	};

	const missingAmounts = records.filter(
		(record) => record.grossAmount === null
	);
	const unclassified = records.filter(
		(record) => record.classification === null
	);
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
		missing_currency: { count: unknownCurrency.length },
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
		...monthNotices(
			records,
			confirmed,
			currencyTotals,
			missingAmounts.length,
			reporting
		),
	];

	const projects = projectRows(
		confirmed,
		open,
		input.previousMonthProjectCost,
		input.projectFilter,
		reporting
	);

	return {
		month: input.month,
		month_label: monthLabel(input.month),
		project_id: input.projectFilter,
		company: {
			reporting_currency: reporting,
			conversion,
			// Complete: the reporting currency. One known currency without
			// matching evidence: that currency. Otherwise no combined total.
			currency: complete
				? reporting
				: singleUnsupportedCurrency
					? currencies[0]
					: null,
			incurred_cost: companyIncurredCost,
			currency_totals: currencyTotals,
			groups,
			gross_liability: complete
				? sumMoney(currencyTotals.map((row) => row.reporting.gross_liability))
				: singleUnsupportedCurrency
					? currencyTotals[0].gross_liability
					: null,
			recoverable_tax: complete
				? sumMoney(currencyTotals.map((row) => row.reporting.recoverable_tax))
				: singleUnsupportedCurrency
					? currencyTotals[0].recoverable_tax
					: null,
			unresolved_tax: {
				count: unresolvedTax.length,
				currency: complete
					? reporting
					: singleUnsupportedCurrency
						? currencyOf(unresolvedTax)
						: null,
				gross_amount: unresolvedTaxGross(),
			},
			known_zero_count: records.filter((record) => record.grossAmount === 0)
				.length,
			record_count: confirmed.length,
		},
		projects,
		evidence,
		sources: sourceSummaries(records),
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
