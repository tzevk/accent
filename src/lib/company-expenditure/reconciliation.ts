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
import {
	isNonOperatingNature,
	remainingBalance,
	toPeriodChargeJson,
} from './non-operating';
import { effectiveTaxTreatment, isConfirmed, isOpenState } from './recognition';
import type {
	CompanyReconciliation,
	CostBudgetRecord,
	CostRecord,
	CoverageNotice,
	CurrencyTotal,
	EvidenceStateSummary,
	EvidenceSummary,
	NonOperatingItemJson,
	NonOperatingSection,
	PeriodCharge,
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

function currencySlice(
	records: CostRecord[],
	charges: PeriodCharge[],
	currency: string
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
	// Approved period charges are cost of their own month, in the source's
	// destination and currency. They are already net of the source's
	// evidenced recoverable tax, so they carry no tax figure of their own.
	let chargeAmount = R(0);
	for (const charge of charges) {
		chargeAmount = add(chargeAmount, charge.amount);
		if (charge.classification === 'project') {
			project = add(project, charge.amount);
		} else if (charge.classification === 'company_overhead') {
			overhead = add(overhead, charge.amount);
		} else if (charge.classification === 'unallocated') {
			unallocated = add(unallocated, charge.amount);
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
		period_charge_amount: rounded(chargeAmount),
		period_charge_count: charges.length,
		record_count: records.filter((record) => confirmedAmount(record) !== null)
			.length,
	};
}

/**
 * The Project ids a month's cost places rows for: the confirmed and open
 * records plus the approved period charges that are counted as cost.
 */
export function projectIdsIn(
	records: CostRecord[],
	charges: PeriodCharge[] = []
): number[] {
	const ids = new Set<number>();
	for (const record of records) {
		if (record.classification === 'project' && record.projectId !== null) {
			ids.add(record.projectId);
		}
	}
	for (const charge of charges) {
		if (
			charge.state === 'approved' &&
			charge.sourceState === 'recognized' &&
			charge.classification === 'project' &&
			charge.projectId !== null
		) {
			ids.add(charge.projectId);
		}
	}
	return [...ids];
}

function projectRows(
	confirmed: CostRecord[],
	open: CostRecord[],
	charges: PeriodCharge[],
	previousMonth: Map<number, Map<string, number | null>>,
	projectFilter: number | null
): ReconciliationProjectRow[] {
	// One row per Project and currency. Amounts in different currencies are
	// never added, and the prior-month comparison is same-currency only; a
	// Project costing in two currencies therefore shows two rows.
	const ids = new Set<number>(
		projectIdsIn([...confirmed, ...open], charges)
	);
	const rows: ReconciliationProjectRow[] = [];
	for (const id of ids) {
		if (projectFilter !== null && projectFilter !== id) continue;
		const projectRecords = [...confirmed, ...open].filter(
			(record) => record.projectId === id
		);
		const projectCharges = charges.filter((charge) => charge.projectId === id);
		const sample = projectRecords[0] ?? projectCharges[0];
		const currencies = [
			...new Set(
				[...projectRecords, ...projectCharges].map(
					(record) => record.currency ?? 'INR'
				)
			),
		].sort();
		for (const currency of currencies) {
			const currencyRecords = projectRecords.filter(
				(record) => (record.currency ?? 'INR') === currency
			);
			const currencyCharges = projectCharges.filter(
				(charge) => charge.currency === currency
			);
			const confirmedRows = currencyRecords.filter(
				(record) => confirmedAmount(record) !== null
			);
			const openRows = currencyRecords.filter((record) =>
				isOpenState(record.state)
			);
			const incurred = sumMoney([
				...confirmedRows.map(confirmedAmount),
				...currencyCharges.map((charge) => charge.amount),
			]);
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
				period_charge_count: currencyCharges.length,
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

interface MonthNoticeInput {
	records: CostRecord[];
	/** Operating confirmed cost only. */
	confirmed: CostRecord[];
	currencyTotals: CurrencyTotal[];
	grossMissing: number;
	/** Every charge dated in the month, approved and cancelled. */
	charges: PeriodCharge[];
	/** Approved charges counted as this month's cost. */
	countedCharges: PeriodCharge[];
	/** This month's non-operating records, in any state. */
	nonOperatingSources: CostRecord[];
}

function monthNotices(input: MonthNoticeInput): CoverageNotice[] {
	const { records, confirmed, currencyTotals, grossMissing } = input;
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

	// ── Non-operating balances and their approved consumption (#317) ──────
	const recognizedNonOperating = input.nonOperatingSources.filter(
		(record) =>
			isNonOperatingNature(record.nature) && isConfirmed(record.state)
	);
	if (input.nonOperatingSources.length > 0) {
		notices.push({
			code: 'non_operating_items_separate',
			label: 'Non-operating items are separate from operating cost',
			detail: `${input.nonOperatingSources.length} advance, deposit, prepayment, capital, or unresolved-treatment item(s) are recorded for this month. Their source amounts are not Company Incurred Cost; only approved period consumption is counted.`,
			severity: 'info',
		});
	}
	if (input.countedCharges.length > 0) {
		const currencies = new Set(
			input.countedCharges.map((charge) => charge.currency)
		);
		const amount = rounded(sumMoney(input.countedCharges.map((c) => c.amount)));
		const stated =
			currencies.size === 1
				? ` They contribute ${amount} ${[...currencies][0]} to Company Incurred Cost.`
				: ' They are counted per currency; no combined figure is stated.';
		notices.push({
			code: 'period_charges_counted',
			label: 'Approved period consumption is included',
			detail: `${input.countedCharges.length} approved period charge(s) are dated in this month.${stated}`,
			severity: 'info',
		});
	}
	const unresolvedNature = records.filter(
		(record) => record.nature === 'unresolved' && isConfirmed(record.state)
	);
	if (unresolvedNature.length > 0) {
		notices.push({
			code: 'nature_unresolved_treatment',
			label: 'Treatment unresolved: excluded from operating cost',
			detail: `${unresolvedNature.length} recognized record(s) are neither decided operating cost nor a decided advance, deposit, prepayment, or capital item. They are excluded from Company Incurred Cost until their treatment is decided.`,
			severity: 'warning',
		});
	}
	const unapproved = input.nonOperatingSources.filter(
		(record) => !isConfirmed(record.state)
	);
	if (unapproved.length > 0) {
		notices.push({
			code: 'non_operating_item_not_approved',
			label: 'Non-operating items not approved yet',
			detail: `${unapproved.length} non-operating item(s) are not confirmed cost yet, so they have no supported balance to consume and no period charge is counted against them.`,
			severity: 'warning',
		});
	}
	const orphanedCharges = input.charges.filter(
		(charge) => charge.state === 'approved' && charge.sourceState !== 'recognized'
	);
	if (orphanedCharges.length > 0) {
		notices.push({
			code: 'period_charge_source_not_recognized',
			label: 'Period charges without confirmed sources',
			detail: `${orphanedCharges.length} approved period charge(s) are not counted because the source they consume is no longer confirmed cost.`,
			severity: 'warning',
		});
	}
	return notices;
}

/** Approved charges counted as cost: their source is still confirmed cost. */
function countedChargesOf(charges: PeriodCharge[]): PeriodCharge[] {
	return charges.filter(
		(charge) => charge.state === 'approved' && charge.sourceState === 'recognized'
	);
}
/** Approved charges dated in one month, in the month's single currency. */
function chargeSubtotal(charges: PeriodCharge[]): EvidenceStateSummary {
	const currencies = new Set(charges.map((charge) => charge.currency));
	return {
		count: charges.length,
		currency: currencies.size === 1 ? [...currencies][0] : null,
		amount:
			charges.length === 0
				? 0
				: currencies.size === 1
					? rounded(sumMoney(charges.map((charge) => charge.amount)))
					: null,
	};
}

/**
 * The non-operating section: each item's identity, amount, currency/tax basis,
 * and evidence, with its approved consumption to date and what remains.
 * Nothing here is Company Incurred Cost; the charges are counted separately.
 */
function nonOperatingSection(input: {
	sources: CostRecord[];
	charges: PeriodCharge[];
	chargeTotals: Map<string, number>;
	month: string;
}): NonOperatingSection {
	const { sources, charges, chargeTotals } = input;
	// Items recognized in the reported month drive the section's stock figures;
	// an item recognized earlier still appears (its charges do) but its balance
	// belongs to the month that recognized it. The month test mirrors the
	// loader: the recognition period, or the expense date when it has none.
	const monthSources = sources.filter(
		(record) =>
			(record.recognitionPeriod ?? record.expenseDate ?? '').slice(0, 7) ===
			input.month
	);
	const recognizedBalances = monthSources.filter(
		(record) => isNonOperatingNature(record.nature) && isConfirmed(record.state)
	);
	const excludedSourceAmount = subtotal(
		recognizedBalances,
		(record) => record.recognizedAmount
	);
	const currencies = new Set(
		[...sources, ...charges].map((entry) => entry.currency ?? 'INR')
	);
	const monthSourceIds = new Set(monthSources.map((record) => record.id));
	const consumedThisMonth = countedChargesOf(charges);
	const consumedMonthAmount =
		currencies.size > 1
			? null
			: rounded(sumMoney(consumedThisMonth.map((charge) => charge.amount)));
	const consumedToDateAmount =
		currencies.size > 1
			? null
			: rounded(
					sumMoney(
						recognizedBalances.map(
							(record) => chargeTotals.get(record.costUid ?? '') ?? 0
						)
					)
				);
	const remaining =
		excludedSourceAmount === null || consumedToDateAmount === null
			? null
			: rounded(excludedSourceAmount - consumedToDateAmount);
	const unresolvedSources = monthSources.filter(
		(record) => record.nature === 'unresolved' && isConfirmed(record.state)
	);

	const items: NonOperatingItemJson[] = sources
		.map((record) => {
			const itemCharges = charges.filter(
				(charge) => charge.sourceCostUid === record.costUid
			);
			const consumedToDateAmountForItem =
				chargeTotals.get(record.costUid ?? '') ?? 0;
			return {
				expense_id: record.id,
				cost_uid: record.costUid ?? '',
				expense_number: record.expenseNumber,
				nature: record.nature,
				source_state: record.state,
				cost_classification: record.classification,
				project_id: record.projectId,
				project_code: record.projectCode,
				project_name: record.projectName,
				currency: record.currency ?? 'INR',
				gross_amount: record.grossAmount,
				recognized_amount: record.recognizedAmount,
				recognition_period: record.recognitionPeriod,
				period_basis: record.periodBasis,
				source_reference: record.sourceReference,
				evidence_reference: record.evidenceReference,
				consumed_this_month: rounded(
					sumMoney(
						itemCharges
							.filter((charge) => charge.state === 'approved')
							.map((charge) => charge.amount)
					)
				),
				consumed_to_date: consumedToDateAmountForItem,
				// Only a decided non-operating nature carries a consumable
				// balance; an unresolved treatment has none to state.
				remaining_amount: isNonOperatingNature(record.nature)
					? remainingBalance(
							record.recognizedAmount,
							consumedToDateAmountForItem
						)
					: null,
				charges: itemCharges.map(toPeriodChargeJson),
			};
		})
		.sort(
			(a, b) =>
				(b.recognition_period ?? '').localeCompare(a.recognition_period ?? '') ||
				b.expense_id - a.expense_id
		);

	return {
		currency: currencies.size === 1 ? [...currencies][0] : null,
		excluded_source_amount: excludedSourceAmount,
		consumed_this_month: consumedMonthAmount,
		consumed_to_date: consumedToDateAmount,
		remaining_amount: remaining,
		unapproved_count: monthSources.filter(
			(record) => !isConfirmed(record.state)
		).length,
		unresolved_count: unresolvedSources.length,
		unresolved_source_amount: subtotal(
			unresolvedSources,
			(record) => record.recognizedAmount ?? record.grossAmount
		),
		items,
		// Charges of the month whose source balance was recognised in another
		// month are still this month's cost; they are listed so the reader can
		// trace them to their item.
		charges_from_prior_items: charges
			.filter((charge) => !monthSourceIds.has(charge.sourceId))
			.map(toPeriodChargeJson),
	};
}

export interface ReconciliationInput {
	month: string;
	/** Every direct cost belonging to the month, in any recognition state. */
	records: CostRecord[];
	/**
	 * Every period charge dated in the month, approved and cancelled: the
	 * approved ones whose source is still confirmed cost are counted here.
	 */
	charges: PeriodCharge[];
	/**
	 * Non-operating records to show separately: this month's advances,
	 * deposits, prepayments, capital items, and unresolved-treatment records,
	 * plus the sources of this month's charges when they were recognized in an
	 * earlier month.
	 */
	nonOperatingSources: CostRecord[];
	/** Approved charges to date per source identity, across all months. */
	chargeTotals: Map<string, number>;
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
	// Only operating records carry cost. Non-operating balances and records
	// whose treatment is unresolved are reported separately, never expensed;
	// approved period charges are cost of their own month instead.
	const costRecords = records.filter((record) => record.nature === 'operating');
	const confirmed = costRecords.filter(
		(record) => confirmedAmount(record) !== null
	);
	const open = records.filter((record) => isOpenState(record.state));
	const countedCharges = countedChargesOf(input.charges);
	const currencies = [
		...new Set([
			...confirmed.map((record) => record.currency ?? 'INR'),
			...countedCharges.map((charge) => charge.currency),
		]),
	].sort();
	const currencyTotals = currencies.map((currency) =>
		currencySlice(
			confirmed.filter((record) => (record.currency ?? 'INR') === currency),
			countedCharges.filter((charge) => charge.currency === currency),
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

	// Recognized non-operating sources and unresolved-treatment records are
	// stated apart from operating cost: these are the amounts Company Incurred
	// Cost deliberately excludes.
	const nonOperatingRecognized = input.nonOperatingSources.filter(
		(record) => isNonOperatingNature(record.nature) && isConfirmed(record.state)
	);
	const unresolvedNature = records.filter(
		(record) => record.nature === 'unresolved' && isConfirmed(record.state)
	);

	const evidence: EvidenceSummary = {
		recognized: countByState(costRecords, 'recognized'),
		pending_evidence: countByState(records, 'pending_evidence'),
		draft: countByState(records, 'draft'),
		rejected: countByState(records, 'rejected'),
		cancelled: countByState(records, 'cancelled'),
		period_charges: chargeSubtotal(countedCharges),
		non_operating_recognized: countByState(
			nonOperatingRecognized,
			'recognized'
		),
		unresolved_nature: countByState(unresolvedNature, 'recognized'),
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
		...monthNotices({
			records,
			confirmed,
			currencyTotals,
			grossMissing: missingAmounts.length,
			charges: input.charges,
			countedCharges,
			nonOperatingSources: input.nonOperatingSources,
		}),
	];

	const projects = projectRows(
		confirmed,
		open,
		countedCharges,
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
			// They cover confirmed operating records: a non-operating balance
			// is not cost and carries no tax figure of its own here.
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
		non_operating: nonOperatingSection({
			sources: input.nonOperatingSources,
			charges: input.charges,
			chargeTotals: input.chargeTotals,
			month: input.month,
		}),
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
