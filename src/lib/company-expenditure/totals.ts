/**
 * Money subtotals shared by the monthly reconciliation and the comparable
 * period comparison.
 *
 * Both views must answer "what does this add up to?" the same way, so the
 * rules live here once:
 *  - confirmed cost is `recognition_state = 'recognized'` and nothing else;
 *  - a missing amount is unknown, never zero: it makes a subtotal unknown
 *    instead of quietly contributing nothing;
 *  - currencies are never added together;
 *  - an empty record set is a known zero.
 */

import type Decimal from 'decimal.js';
import { add, R, toNumber } from '@/lib/money';
import { isConfirmed } from './recognition';
import type { CostRecord, EvidenceStateSummary } from './types';

/** Round money once, at the output boundary. */
export function rounded(value: Decimal.Value): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/** Sum money without floating point drift, rounded once at the boundary. */
export function sumMoney(values: Array<number | null>): number {
	return rounded(
		values.reduce<Decimal>((total, value) => add(total, value ?? 0), R(0))
	);
}

/** The amount a confirmed record contributes; the stored figure wins. */
export function confirmedAmount(record: CostRecord): number | null {
	if (!isConfirmed(record.state)) return null;
	if (record.recognizedAmount !== null) return record.recognizedAmount;
	return record.evaluation.recognizedAmount;
}

/** The single currency the records share, or null for none or more than one. */
export function currencyOf(records: CostRecord[]): string | null {
	const codes = new Set(records.map((record) => record.currency ?? 'INR'));
	return codes.size === 1 ? [...codes][0] : null;
}

/**
 * A subtotal that may only be stated in one currency. Zero records contribute
 * a known zero; a single unknown amount or a second currency makes the figure
 * null, because an unknown amount is not zero and currencies are never added.
 */
export function subtotal(
	records: CostRecord[],
	value: (record: CostRecord) => number | null
): number | null {
	if (records.length === 0) return 0;
	const amounts = records.map(value);
	if (amounts.some((amount) => amount === null)) return null;
	if (currencyOf(records) === null) return null;
	return sumMoney(amounts);
}

/** One evidence state's record count, currency, and amount. */
export function countByState(
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
