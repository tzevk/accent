/**
 * The combined source drilldown: one filter, one sort, one page across every
 * cost source. Each source adapter reads its own store's matching records and
 * this module merges them before sorting and paging, so a page can never skip
 * another store's records and the totals always describe the same set the
 * reconciliation counted.
 *
 * Sorting is deterministic and cross-source: recognition period, then bill
 * date, then source name, then descending row id.
 */

import { R, toNumber } from '@/lib/money';
import { currencyCodeOf, reportingCurrencyOf } from './currency';
import { loadFilteredExpenseRecords, toCostRecordJson, type SqlConnection } from './records';
import { loadFilteredSupplierRecords } from './supplier-invoices';
import type { CostDrilldown, CostDrilldownQuery, CostRecord, CostSource } from './types';

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
	const results: CostRecord[] = [];
	if (source === 'all' || source === 'direct_expense') {
		results.push(...(await loadFilteredExpenseRecords(db, query)));
	}
	if (source === 'all' || source === 'supplier_invoice') {
		results.push(...(await loadFilteredSupplierRecords(db, query)));
	}
	const merged = sortRecords(results);
	const confirmed = merged.filter((record) => record.state === 'recognized');
	const currencies = [
		...new Set(
			confirmed
				.map((record) => currencyCodeOf(record.currency))
				.filter((code): code is string => code !== null)
		),
	];
	// Unknown amounts, an unknown original currency, and mixed currencies
	// cannot be stated as one figure; with no confirmed record at all the
	// subtotal is a known zero.
	const unknownAmounts = confirmed.some(
		(record) => record.recognizedAmount === null
	);
	const unknownCurrency = confirmed.some(
		(record) => currencyCodeOf(record.currency) === null
	);
	const confirmedAmount =
		unknownAmounts || unknownCurrency || currencies.length > 1
			? null
			: toNumber(
					confirmed.reduce(
						(total, record) => total.add(R(record.recognizedAmount ?? 0)),
						R(0)
					)
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
		totals: {
			confirmed_amount: confirmedAmount,
			currency: currencies.length === 1 ? currencies[0] : null,
			records: merged.length,
		},
	};
}

/** The sources a drilldown query can address (for validation by callers). */
export function isDrilldownSource(value: string): value is CostSource {
	return (DRILLDOWN_SOURCES as readonly string[]).includes(value);
}
