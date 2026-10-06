/**
 * The combined source drilldown: one filter, one sort, one page across every
 * cost source, plus the period-charge section the report's non-operating
 * figures draw down. Each source adapter reads its own store's matching
 * records and this module merges them before sorting and paging, so a page can
 * never skip another store's records and the totals always describe the same
 * set the reconciliation counted.
 *
 * Sorting is deterministic and cross-source: recognition period, then bill
 * date, then source name, then descending row id.
 */

import type Decimal from 'decimal.js';
import { add, R, toNumber } from '@/lib/money';
import { currencyCodeOf, reportingCurrencyOf } from './currency';
import { isNonOperatingNature, toPeriodChargeJson } from './non-operating';
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

/** The combined drilldown the report route and the screen consume. */
export async function loadCombinedDrilldown(
	db: SqlConnection,
	query: CostDrilldownQuery
): Promise<CostDrilldown> {
	const source = query.source ?? 'all';
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
	const merged = sortRecords(results);
	const confirmed = merged.filter((record) => record.state === 'recognized');
	const operating = confirmed.filter((record) => record.nature === 'operating');
	const nonOperating = confirmed.filter((record) =>
		isNonOperatingNature(record.nature)
	);
	const unresolvedNature = confirmed.filter(
		(record) => record.nature === 'unresolved'
	);
	// A subtotal that may only be stated in one currency: one unknown amount,
	// an unknown currency, or a second currency makes it null; with no record
	// at all it is a known zero.
	const subtotalOf = (records: CostRecord[]) =>
		statedSubtotal({
			amount: toNumber(
				records.reduce<Decimal>(
					(total, record) => add(total, record.recognizedAmount ?? 0),
					R(0)
				)
			),
			unknown: records.filter(
				(record) =>
					record.recognizedAmount === null ||
					currencyCodeOf(record.currency) === null
			).length,
			currencies: new Set(
				records.map((record) => currencyCodeOf(record.currency))
			).size,
			currency: records[0] ? currencyCodeOf(records[0].currency) : null,
		});
	const operatingTotal = subtotalOf(operating);
	const nonOperatingTotal = subtotalOf(nonOperating);
	const unresolvedNatureTotal = subtotalOf(unresolvedNature);
	const unknownAmounts = operating.some(
		(record) => record.recognizedAmount === null
	);
	const unknownCurrency = operating.some(
		(record) => currencyCodeOf(record.currency) === null
	);
	const operatingCurrencies = new Set(
		operating
			.map((record) => currencyCodeOf(record.currency))
			.filter((code): code is string => code !== null)
	);
	const confirmedAmount =
		unknownAmounts || unknownCurrency || operatingCurrencies.size > 1
			? null
			: (operatingTotal.amount ?? 0);

	// Charges are confirmed cost of their own month, so they belong to the
	// confirmed-cost filters only; a cancelled charge is returned as history.
	const includeCharges =
		!query.state || query.state === 'all' || query.state === 'recognized';
	const charges = includeCharges
		? await loadMonthCharges(db, {
				month: query.month,
				classification: query.classification,
				nature: query.nature,
				projectId: query.projectId,
			})
		: [];
	const countedCharges = charges.filter(
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
		period_charges: charges.map(toPeriodChargeJson),
		totals: {
			confirmed_amount: confirmedAmount,
			currency: unknownCurrency ? null : operatingTotal.currency,
			records: merged.length,
			non_operating_amount: nonOperatingTotal.amount,
			nature_unresolved_amount: unresolvedNatureTotal.amount,
			period_charge_amount: periodChargeAmount,
			period_charge_records: countedCharges.length,
		},
	};
}

/** The sources a drilldown query can address (for validation by callers). */
export function isDrilldownSource(value: string): value is CostSource {
	return (DRILLDOWN_SOURCES as readonly string[]).includes(value);
}
