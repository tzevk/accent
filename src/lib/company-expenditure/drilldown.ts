/**
 * The combined source drilldown: one filter, one sort, one page across every
 * cost source. Each source adapter reads its own store's matching records and
 * this module merges them before sorting and paging, so a page can never skip
 * another store's records and the totals always describe the same set the
 * reconciliation counted.
 *
 * The totals keep the reconciliation's interpretation (#317/#319): only
 * operating confirmed cost is `confirmed_amount`; recognized non-operating
 * balances and unresolved treatments are stated apart; approved period charges
 * of the month are counted once; and an unknown amount, an unknown original
 * currency, or more than one currency makes a figure null rather than a
 * partial or mixed total.
 *
 * Sorting is deterministic and cross-source: recognition period, then bill
 * date, then source name, then descending row id.
 */

import { add, R, toNumber } from '@/lib/money';
import { currencyCodeOf, reportingCurrencyOf } from './currency';
import { isNonOperatingNature, toPeriodChargeJson } from './non-operating';
import { loadFilteredOtherExpenseRecords } from './other-expenses';
import {
	loadFilteredExpenseRecords,
	loadMonthCharges,
	statedSubtotal,
	toCostRecordJson,
	type SqlConnection,
} from './records';
import { loadFilteredSupplierRecords } from './supplier-invoices';
import type {
	CostDrilldown,
	CostDrilldownQuery,
	CostRecord,
	CostSource,
} from './types';

/** The sources a drilldown can be scoped to. */
const DRILLDOWN_SOURCES: readonly CostSource[] = [
	'direct_expense',
	'supplier_invoice',
	'other_expense',
];

function sortRecords(records: CostRecord[]): CostRecord[] {
	return [...records].sort((a, b) => {
		const period = (b.recognitionPeriod ?? '').localeCompare(
			a.recognitionPeriod ?? ''
		);
		if (period !== 0) return period;
		const date = (b.expenseDate ?? '').localeCompare(a.expenseDate ?? '');
		if (date !== 0) return date;
		const source = a.source.localeCompare(b.source);
		if (source !== 0) return source;
		return b.id - a.id;
	});
}

/**
 * One statement of a set of records in the module's single-currency rule: an
 * unknown amount, an unknown original currency, or a second currency makes it
 * null; no records are a known zero.
 */
function statedRecordsSubtotal(
	records: CostRecord[],
	value: (record: CostRecord) => number | null
): number | null {
	const amounts = records.map(value);
	const codes = records.map((record) => currencyCodeOf(record.currency));
	const unknownAmounts = amounts.some((amount) => amount === null);
	const knownCurrencies = [
		...new Set(codes.filter((code): code is string => code !== null)),
	];
	return statedSubtotal({
		amount: unknownAmounts
			? null
			: toNumber(
					amounts
						.reduce((total, amount) => add(total, amount ?? 0), R(0))
						.toDecimalPlaces(2)
				),
		unknown: (unknownAmounts ? 1 : 0) + (codes.includes(null) ? 1 : 0),
		currencies: knownCurrencies.length,
		currency: knownCurrencies.length === 1 ? knownCurrencies[0] : null,
	}).amount;
}

/** The combined drilldown the report route and the screen consume. */
export async function loadCombinedDrilldown(
	db: SqlConnection,
	query: CostDrilldownQuery
): Promise<CostDrilldown> {
	const source = query.source ?? 'all';
	// Supplier invoices are operating cost: a non-operating or unresolved
	// nature filter must never surface them.
	const supplierIsOperating =
		!query.nature || query.nature === 'all' || query.nature === 'operating';
	const results: CostRecord[] = [];
	if (source === 'all' || source === 'direct_expense') {
		results.push(...(await loadFilteredExpenseRecords(db, query)));
	}
	if (
		(source === 'all' || source === 'supplier_invoice') &&
		supplierIsOperating
	) {
		results.push(...(await loadFilteredSupplierRecords(db, query)));
	}
	if (source === 'all' || source === 'other_expense') {
		results.push(...(await loadFilteredOtherExpenseRecords(db, query)));
	}
	const merged = sortRecords(results);

	// Charges are confirmed cost of their own month, so they belong to the
	// confirmed-cost filters only: they are expense-side rows, never supplier
	// cost, and a cancelled charge is returned as history but never counted.
	const includeCharges =
		source !== 'supplier_invoice' &&
		(!query.state || query.state === 'all' || query.state === 'recognized');
	const periodCharges = includeCharges
		? await loadMonthCharges(db, {
				month: query.month,
				classification: query.classification,
				nature: query.nature,
				projectId: query.projectId,
			})
		: [];
	const countedCharges = periodCharges.filter(
		(charge) =>
			charge.state === 'approved' && charge.sourceState === 'recognized'
	);
	const chargeCurrencies = new Set(
		countedCharges.map((charge) => charge.currency)
	);
	const periodChargeAmount =
		chargeCurrencies.size > 1
			? null
			: toNumber(
					countedCharges
						.reduce((total, charge) => add(total, charge.amount), R(0))
						.toDecimalPlaces(2)
				);

	// Only operating confirmed cost is confirmed cost: a recognized
	// non-operating balance or an unresolved treatment is stated apart and
	// never folded into the confirmed figure.
	const confirmed = merged.filter(
		(record) => record.state === 'recognized' && record.nature === 'operating'
	);
	const nonOperating = merged.filter(
		(record) =>
			record.state === 'recognized' && isNonOperatingNature(record.nature)
	);
	const unresolvedNature = merged.filter(
		(record) => record.state === 'recognized' && record.nature === 'unresolved'
	);
	const currencies = [
		...new Set(
			confirmed
				.map((record) => currencyCodeOf(record.currency))
				.filter((code): code is string => code !== null)
		),
	];
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
	const offset = Math.max(query.offset ?? 0, 0);
	const reporting = reportingCurrencyOf({
		reportingCurrency: query.reportingCurrency ?? null,
	});
	return {
		month: query.month,
		scope: 'month',
		total: merged.length,
		limit,
		offset,
		records: merged
			.slice(offset, offset + limit)
			.map((record) => toCostRecordJson(record, reporting)),
		period_charges: periodCharges.map(toPeriodChargeJson),
		totals: {
			confirmed_amount: statedRecordsSubtotal(
				confirmed,
				(record) => record.recognizedAmount
			),
			currency: currencies.length === 1 ? currencies[0] : null,
			records: merged.length,
			non_operating_amount: statedRecordsSubtotal(
				nonOperating,
				(record) => record.recognizedAmount
			),
			nature_unresolved_amount: statedRecordsSubtotal(
				unresolvedNature,
				(record) => record.recognizedAmount
			),
			period_charge_amount: periodChargeAmount,
			period_charge_records: countedCharges.length,
		},
	};
}

/** The sources a drilldown query can address (for validation by callers). */
export function isDrilldownSource(value: string): value is CostSource {
	return (DRILLDOWN_SOURCES as readonly string[]).includes(value);
}
