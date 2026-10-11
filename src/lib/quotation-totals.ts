/**
 * GST-inclusive totals for a quotation's scope items.
 *
 * The edit page's live totals, the saved payload and the read-only view must
 * all agree on the same numbers, so the arithmetic lives here once — on the
 * money.ts primitives, never on raw float math.
 */

import type Decimal from 'decimal.js';
import { R, add, mul, pctOf, toNumber } from '@/lib/money';

/** A scope item as stored on the quotation (DB DECIMALs arrive as strings). */
export interface QuotationTotalsItem {
	qty?: number | string | null;
	amount?: number | string | null;
}

export interface QuotationTotals {
	gross: Decimal;
	gst: Decimal;
	net: Decimal;
	cgst: Decimal;
	sgst: Decimal;
}

/** The plain decimal text that DB DECIMAL columns and form inputs produce. */
const NUMERIC_TEXT = /^(\d+(\.\d+)?|\.\d+)$/;

/**
 * A missing, empty or non-numeric amount is 0 — never NaN, never a throw
 * (decimal.js rejects non-numeric text instead of yielding NaN).
 */
const toDecimal = (value: number | string | null | undefined): Decimal => {
	if (typeof value === 'number') {
		return R(Number.isFinite(value) ? value : 0);
	}
	if (typeof value === 'string') {
		const text = value.trim();
		return NUMERIC_TEXT.test(text) ? R(text) : R(0);
	}
	return R(0);
};

/**
 * gross = sum of item amounts; gst = pct of gross (2dp);
 * net = gross + gst, split evenly into CGST + SGST (or shown whole as IGST).
 */
export function computeQuotationTotals(
	items: QuotationTotalsItem[],
	gstPercentage: number | string | null | undefined
): QuotationTotals {
	const gross = items.reduce<Decimal>(
		(sum, item) => add(sum, toDecimal(item?.amount)),
		R(0)
	);
	const gst = pctOf(gross, toNumber(toDecimal(gstPercentage)));
	const half = mul(gst, 0.5);
	return {
		gross,
		gst,
		net: add(gross, gst),
		cgst: half,
		sgst: half,
	};
}
