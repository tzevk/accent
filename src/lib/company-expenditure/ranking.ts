/**
 * Comparable-period comparison, Project ranking, and per-Project evidence.
 *
 * The parent specification's rules this file enforces:
 *  - an unfinished month is compared over equivalent elapsed service periods,
 *    never against a full prior month;
 *  - a prior amount of zero shows an absolute change and a new-cost state, and
 *    no percentage is invented for it; an unknown comparison amount stays
 *    unknown;
 *  - late, backdated, and day-less entries are disclosed, and unequal
 *    evidence coverage between the two windows is never hidden;
 *  - a Project with no cost in the prior window has an *unknown* prior amount,
 *    not a zero: absence of records is not evidence of no expenditure.
 *  - "Largest cost" and "largest increase" are orderings of the same figures
 *    the reconciliation publishes, ranked inside one currency.
 *
 * Pure functions only: the records, the as-of date, and the cumulative
 * cost-before base arrive as arguments, so the report, the drilldown, and (an
 * the later export) share one interpretation.
 */

import { div, mul, sub } from '@/lib/money';
import { isConfirmed, isOpenState } from './recognition';
import {
	confirmedAmount,
	GROUP_CLASSIFICATION,
	GROUP_KEYS,
	GROUP_LABELS,
	rounded,
	sumMoney,
} from './totals';
import type {
	ChangeState,
	ComparisonBasis,
	ComparisonCurrency,
	ComparisonDisclosure,
	CostRecord,
	PeriodComparison,
	ProjectEvidenceState,
	ProjectRanking,
	RankingEntry,
	ReconciliationGroup,
	ReconciliationProjectRow,
} from './types';

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

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** "2019-01" → "January 2019"; unparseable input is returned unchanged. */
export function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** The month before `YYYY-MM`, as plain calendar arithmetic. */
export function previousMonthOf(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber) return month;
	return monthNumber <= 1
		? `${year - 1}-12`
		: `${year}-${pad(monthNumber - 1)}`;
}

/**
 * Days in a `YYYY-MM` month. Month `00`/`13` (unparseable input) falls back to
 * the calendar's own answer for the month the arithmetic lands in.
 */
export function daysInMonth(month: string): number {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber) return 31;
	return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** The last calendar date of a `YYYY-MM` month. */
export function monthEndDate(month: string): string {
	return `${month}-${pad(daysInMonth(month))}`;
}

/**
 * Day of month of a date or datetime string, or null when it is missing or
 * not a real calendar date (`2022-06-31` is null, not 31).
 */
export function dayOfDate(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!match) return null;
	const month = `${match[1]}-${match[2]}`;
	const day = Number(match[3]);
	if (day < 1 || day > daysInMonth(month)) return null;
	return day;
}

/** `YYYY-MM` of a date string, or null when there is not one. */
export function monthOfDate(value: string | null | undefined): string | null {
	if (!value) return null;
	const match = /^(\d{4}-\d{2})/.exec(value);
	return match ? match[1] : null;
}

/** The financial year that contains a month: April–March, so it starts in April. */
export function financialYearOf(month: string): number {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber) return year;
	return monthNumber >= 4 ? year : year - 1;
}

/** `2022-06` → `FY 2022–23`; the label the report's financial-year picker uses. */
export function financialYearLabel(startYear: number): string {
	return `FY ${startYear}–${String(startYear + 1).slice(-2)}`;
}

/**
 * How much of a month has elapsed and which comparison window that opens.
 *
 * `asOf` is the date the month is measured to — today for the current month,
 * or an explicitly requested date that identifies the comparable period. A
 * month measured before its last day is unfinished: both periods are then
 * compared over their first `currentDays` days, with the prior window clamped
 * to the prior month's own length and any mismatch disclosed.
 */
export interface ComparisonWindow {
	month: string;
	priorMonth: string;
	asOf: string;
	basis: ComparisonBasis;
	unfinished: boolean;
	/** Days of the reported month inside the window (0 when nothing elapsed). */
	currentDays: number;
	/** Days of the prior month inside the window, clamped to its length. */
	priorDays: number;
	monthDays: number;
	priorMonthDays: number;
	/** Days elapsed, or null when the whole month is covered. */
	elapsedDays: number | null;
	/** True when the prior month is shorter than the window the month needs. */
	windowMismatch: boolean;
	/** Last calendar date the window covers, or null when nothing elapsed. */
	throughDate: string | null;
}

export function comparisonWindow(
	month: string,
	asOf: string
): ComparisonWindow {
	const monthDays = daysInMonth(month);
	const priorMonth = previousMonthOf(month);
	const priorMonthDays = daysInMonth(priorMonth);
	const asOfMonth = monthOfDate(asOf);
	const asOfDay = dayOfDate(asOf);
	let elapsed = monthDays;
	if (asOfMonth === null || asOfDay === null) {
		elapsed = monthDays;
	} else if (asOfMonth > month) {
		elapsed = monthDays;
	} else if (asOfMonth < month) {
		elapsed = 0;
	} else {
		elapsed = Math.min(asOfDay, monthDays);
	}
	const unfinished = elapsed < monthDays;
	const priorDays = Math.min(elapsed, priorMonthDays);
	return {
		month,
		priorMonth,
		asOf,
		basis: unfinished ? 'equal_period' : 'full_month',
		unfinished,
		currentDays: elapsed,
		priorDays,
		monthDays,
		priorMonthDays,
		elapsedDays: unfinished ? elapsed : null,
		windowMismatch: priorDays < elapsed,
		throughDate: elapsed === 0 ? null : `${month}-${pad(elapsed)}`,
	};
}

/** Last calendar date of the window over one of the two periods. */
export function windowEndDate(
	window: ComparisonWindow,
	period: 'current' | 'prior'
): string | null {
	return period === 'current'
		? window.throughDate
		: window.priorDays === 0
			? null
			: `${window.priorMonth}-${pad(window.priorDays)}`;
}

/**
 * Is the cost inside the elapsed part of its month? A cost is attributed to
 * the day its received-work evidence starts (start, then end when only the end
 * is known, then the disclosed bill date). A confirmed cost with no day at all
 * is only covered by a full month; the window discloses how many such records
 * it counted instead of silently spreading them.
 */
export function withinWindow(
	record: CostRecord,
	days: number,
	monthDays: number
): boolean {
	const anchor =
		dayOfDate(record.servicePeriodStart) ??
		dayOfDate(record.servicePeriodEnd) ??
		dayOfDate(record.billDate);
	if (anchor === null) return days > 0 && days >= monthDays;
	return anchor <= days;
}

/** Confirmed records one period's window covers. */
export function windowRecords(
	records: CostRecord[],
	window: ComparisonWindow,
	period: 'current' | 'prior'
): CostRecord[] {
	const days = period === 'current' ? window.currentDays : window.priorDays;
	const monthDays =
		period === 'current' ? window.monthDays : window.priorMonthDays;
	if (days === 0) return [];
	return records.filter(
		(record) =>
			isConfirmed(record.state) && withinWindow(record, days, monthDays)
	);
}

/** Was the record entered after a period closed? Late and backdated evidence. */
export function isLateEntry(
	record: CostRecord,
	endDate: string | null
): boolean {
	if (endDate === null || !record.createdAt) return false;
	return record.createdAt.slice(0, 10) > endDate;
}

/**
 * The change state of one amount against its comparable prior amount. A known
 * zero prior is a new cost, never a percentage; an unknown prior stays unknown.
 */
export function changeStateFor(
	current: number,
	prior: number | null
): ChangeState {
	if (prior === null) return 'no_prior';
	if (current === prior) return 'unchanged';
	if (prior === 0) return 'new';
	return current > prior ? 'increase' : 'decrease';
}

/** Percentage change, stated only for a known non-zero prior amount. */
export function percentChange(
	current: number,
	prior: number | null
): number | null {
	if (prior === null || prior === 0) return null;
	return rounded(mul(div(sub(current, prior), prior), 100));
}

/** One currency's company figures over the reported and prior windows. */
function currencyComparison(
	records: CostRecord[],
	priorRecords: CostRecord[],
	currency: string,
	window: ComparisonWindow
): ComparisonCurrency {
	const sameCurrency = (record: CostRecord) =>
		(record.currency ?? 'INR') === currency;
	const current = windowRecords(records, window, 'current').filter(
		sameCurrency
	);
	const prior = windowRecords(priorRecords, window, 'prior').filter(
		sameCurrency
	);
	const currentCost = sumMoney(current.map(confirmedAmount));
	// No prior-window record for this currency is an unknown prior amount, not
	// a zero: the report cannot tell "no cost" from "not captured".
	const priorCost =
		prior.length === 0 ? null : sumMoney(prior.map(confirmedAmount));
	const currentEnd = windowEndDate(window, 'current');
	const priorEnd = windowEndDate(window, 'prior');
	const lateCurrent = current.filter((record) =>
		isLateEntry(record, currentEnd)
	);
	const latePrior = prior.filter((record) => isLateEntry(record, priorEnd));
	return {
		currency,
		current_cost: currentCost,
		prior_cost: priorCost,
		change_amount:
			priorCost === null ? null : rounded(sub(currentCost, priorCost)),
		change_percent: percentChange(currentCost, priorCost),
		change_state: changeStateFor(currentCost, priorCost),
		// The window's own categorization, from the same records, so a reader can
		// see which direct-cost category moved the comparison.
		groups: GROUP_KEYS.map((key) => {
			const matching = current.filter(
				(record) => record.classification === GROUP_CLASSIFICATION[key]
			);
			return {
				key,
				label: GROUP_LABELS[key],
				amount: sumMoney(matching.map(confirmedAmount)),
				record_count: matching.length,
			} satisfies ReconciliationGroup;
		}),
		undated_records: current.filter(
			(record) => record.periodBasis !== 'service_period'
		).length,
		late_records: lateCurrent.length,
		late_cost: sumMoney(lateCurrent.map(confirmedAmount)),
		prior_late_records: latePrior.length,
		prior_late_cost: sumMoney(latePrior.map(confirmedAmount)),
	};
}

export interface ComparisonInput {
	month: string;
	/** Every direct cost of the reported month, in any state. */
	records: CostRecord[];
	/** Every direct cost of the prior month, in any state. */
	priorMonthRecords: CostRecord[];
	/** The date the reported month is measured to. */
	asOf: string;
	/** The month's Project rows, before any Project filter narrows the detail. */
	rows: ReconciliationProjectRow[];
}

/**
 * The comparable-period comparison, its per-currency company figures, and the
 * disclosures that say what the comparison does and does not cover.
 */
export function buildPeriodComparison(
	input: ComparisonInput
): PeriodComparison {
	const window = comparisonWindow(input.month, input.asOf);
	const codes = [
		...new Set(
			[
				...windowRecords(input.records, window, 'current'),
				...windowRecords(input.priorMonthRecords, window, 'prior'),
			].map((record) => record.currency ?? 'INR')
		),
	].sort();
	const currencyTotals = codes.map((currency) =>
		currencyComparison(input.records, input.priorMonthRecords, currency, window)
	);
	const only = currencyTotals.length === 1 ? currencyTotals[0] : null;
	const prior = only?.prior_cost ?? null;
	const current = only === null ? null : only.current_cost;
	const lateCurrent = currencyTotals.reduce(
		(total, row) => total + row.late_records,
		0
	);
	const latePrior = currencyTotals.reduce(
		(total, row) => total + row.prior_late_records,
		0
	);
	const undated = currencyTotals.reduce(
		(total, row) => total + row.undated_records,
		0
	);
	const reportedEnd = monthEndDate(input.month);
	const backdated = windowRecords(input.records, window, 'current').filter(
		(record) => isLateEntry(record, reportedEnd)
	).length;

	const disclosures: ComparisonDisclosure[] = [];
	if (window.basis === 'equal_period') {
		disclosures.push({
			code: 'equal_period_comparison',
			label: `Equal ${window.currentDays}-day comparison`,
			detail: `${monthLabel(window.month)} is unfinished at ${window.asOf}, so both it and ${monthLabel(window.priorMonth)} are compared over their first ${window.currentDays} day(s) — not against a full prior month.`,
			severity: 'info',
			period: null,
			currency: only?.currency ?? null,
			count: window.currentDays,
			amount: null,
		});
	} else {
		disclosures.push({
			code: 'full_month_comparison',
			label: 'Full-month comparison',
			detail: `${monthLabel(window.month)} has fully elapsed, so the whole month is compared with the whole prior month.`,
			severity: 'info',
			period: null,
			currency: only?.currency ?? null,
			count: window.monthDays,
			amount: null,
		});
	}
	if (window.windowMismatch) {
		disclosures.push({
			code: 'unequal_window_length',
			label: 'Unequal comparison window',
			detail: `${window.priorMonth} holds only ${window.priorMonthDays} day(s), so the prior window covers ${window.priorDays} day(s) against ${window.currentDays}.`,
			severity: 'warning',
			period: 'prior',
			currency: only?.currency ?? null,
			count: window.priorDays,
			amount: null,
		});
	}
	if (lateCurrent > 0) {
		disclosures.push({
			code: 'late_recorded_cost',
			label: 'Late entries in the compared period',
			detail: `${lateCurrent} record(s) inside the reported window were entered after it closed; they are backdated into it.`,
			severity: 'warning',
			period: 'current',
			currency: only?.currency ?? null,
			count: lateCurrent,
			amount: only?.late_cost ?? null,
		});
	}
	if (latePrior > 0) {
		disclosures.push({
			code: 'late_recorded_cost',
			label: 'Late entries in the prior period',
			detail: `${latePrior} record(s) inside the prior window were entered after it closed, so the same elapsed point in the prior month showed less.`,
			severity: 'warning',
			period: 'prior',
			currency: only?.currency ?? null,
			count: latePrior,
			amount: only?.prior_late_cost ?? null,
		});
	}
	if (backdated > 0) {
		disclosures.push({
			code: 'backdated_recognition',
			label: 'Recognition backdated into this month',
			detail: `${backdated} record(s) of this month were entered after the month ended and recognized back into it.`,
			severity: 'warning',
			period: 'current',
			currency: only?.currency ?? null,
			count: backdated,
			amount: null,
		});
	}
	if (undated > 0) {
		disclosures.push({
			code: 'undated_period_evidence',
			label: 'Cost without day-level service evidence',
			detail: `${undated} record(s) counted in the reported window rest on a bill date or a period end only, so they are attributed to the window by disclosed fallback rather than a known service day.`,
			severity: 'info',
			period: 'current',
			currency: only?.currency ?? null,
			count: undated,
			amount: null,
		});
	}
	if (latePrior > 0) {
		disclosures.push({
			code: 'unequal_evidence_coverage',
			label: 'Unequal evidence coverage between the periods',
			detail: `The prior window gained ${latePrior} record(s) after it closed, so evidence coverage differs: a like-for-like read at the same elapsed point in ${window.priorMonth} would have been lower.`,
			severity: 'warning',
			period: 'prior',
			currency: only?.currency ?? null,
			count: latePrior,
			amount: only?.prior_late_cost ?? null,
		});
	}
	if (!input.priorMonthRecords.some((record) => isConfirmed(record.state))) {
		disclosures.push({
			code: 'no_prior_period_evidence',
			label: 'No recognized cost in the prior month',
			detail: `${window.priorMonth} holds no recognized cost at all, so every prior amount here is unknown rather than zero.`,
			severity: 'warning',
			period: 'prior',
			currency: null,
			count: 0,
			amount: null,
		});
	}
	// Row-level comparison states, stated with the company figures they belong
	// to so neither a new cost nor an unknown one can pass unlabeled.
	const zeroPrior = input.rows.filter((row) => row.previous_period_cost === 0);
	if (zeroPrior.length > 0) {
		disclosures.push({
			code: 'zero_prior_cost',
			label: 'New cost against a recorded zero',
			detail: `${zeroPrior.length} Project(s) had a recorded zero cost in the prior window, so their change is stated as an absolute new cost and no percentage is invented for it.`,
			severity: 'info',
			period: null,
			currency: null,
			count: zeroPrior.length,
			amount: null,
		});
	}
	const unknownPrior = input.rows.filter(
		(row) => row.previous_period_cost === null
	);
	if (unknownPrior.length > 0) {
		disclosures.push({
			code: 'unknown_prior_cost',
			label: 'Projects with an unknown prior amount',
			detail: `${unknownPrior.length} Project(s) have no cost recorded in the prior window, so neither their change nor a percentage is stated and they are left out of the increase ordering.`,
			severity: 'warning',
			period: 'prior',
			currency: null,
			count: unknownPrior.length,
			amount: null,
		});
	}

	return {
		month: input.month,
		as_of: window.asOf,
		prior_month: window.priorMonth,
		prior_month_label: monthLabel(window.priorMonth),
		basis: window.basis,
		unfinished: window.unfinished,
		elapsed_days: window.elapsedDays,
		current_days: window.currentDays,
		prior_days: window.priorDays,
		window_mismatch: window.windowMismatch,
		currency: only?.currency ?? null,
		current_cost: current,
		prior_cost: prior,
		change_amount: prior === null ? null : rounded(sub(current ?? 0, prior)),
		change_percent: current === null ? null : percentChange(current, prior),
		change_state: changeStateFor(current ?? 0, prior),
		currency_totals: currencyTotals,
		cost_to_date_through: window.throughDate ?? `${input.month}-01`,
		disclosures,
	};
}

/** Per-Project evidence state: what kind of cost the row's figures rest on. */
export function projectEvidence(records: CostRecord[]): ProjectEvidenceState {
	const confirmed = records.filter(
		(record) => confirmedAmount(record) !== null
	);
	const open = records.filter((record) => isOpenState(record.state));
	// An open record with no amount is an evidence gap; a cancelled or rejected
	// record is not cost and not a gap.
	const unknown = records.filter(
		(record) =>
			record.grossAmount === null &&
			(isConfirmed(record.state) || isOpenState(record.state))
	);
	const reconstructed = confirmed.filter(
		(record) => record.reconstructed === true
	);
	const billDate = confirmed.filter(
		(record) => record.periodBasis === 'bill_date_fallback'
	);
	const partial = confirmed.filter(
		(record) => record.periodBasis === 'service_period_end'
	);
	const unresolvedTax = confirmed.filter(
		(record) => record.evaluation.effectiveTaxTreatment === 'unresolved'
	);
	const findings: string[] = [];
	if (open.length > 0) findings.push('open_records');
	if (unknown.length > 0) findings.push('unknown_amount');
	if (billDate.length > 0) findings.push('bill_date_fallback');
	if (partial.length > 0) findings.push('partial_service_period');
	if (unresolvedTax.length > 0) findings.push('unresolved_tax');
	if (reconstructed.length > 0) findings.push('reconstructed');
	return {
		state:
			unknown.length > 0
				? 'incomplete'
				: reconstructed.length > 0
					? 'reconstructed'
					: open.length > 0 || billDate.length > 0 || partial.length > 0
						? 'estimated'
						: 'recorded',
		findings,
		confirmed_records: confirmed.length,
		estimated_records: open.length,
		unknown_amount_records: unknown.length,
		unresolved_tax_records: unresolvedTax.length,
		bill_date_fallback_records: billDate.length,
		reconstructed_records: reconstructed.length,
	};
}

function rankingEntry(row: ReconciliationProjectRow): RankingEntry {
	return {
		project_id: row.project_id,
		project_code: row.project_code,
		project_name: row.project_name,
		client_name: row.client_name,
		currency: row.currency,
		rank: 0,
		incurred_cost: row.incurred_cost,
		comparison_cost: row.comparison_cost,
		previous_period_cost: row.previous_period_cost,
		change_amount: row.change_amount,
		change_percent: row.change_percent,
		change_state: row.change_state,
	};
}

/**
 * Largest-cost and largest-increase orderings of the same Project rows.
 *
 * Orderings never mix currencies; the position is the count of strictly larger
 * figures inside the row's currency, so ties share a position and the order
 * among them stays deterministic. A row whose comparison amount is unknown
 * cannot be placed by increase and is reported as unranked with its reason.
 */
export function rankProjects(rows: ReconciliationProjectRow[]): ProjectRanking {
	const currencies = [...new Set(rows.map((row) => row.currency))].sort();
	const byCost: RankingEntry[] = [];
	const byIncrease: RankingEntry[] = [];
	const unranked: ProjectRanking['increase_unranked'] = [];
	for (const currency of currencies) {
		const group = rows.filter((row) => row.currency === currency);
		const costOrder = [...group].sort(
			(a, b) =>
				b.incurred_cost - a.incurred_cost ||
				a.project_code.localeCompare(b.project_code) ||
				a.project_id - b.project_id
		);
		for (const row of costOrder) {
			const entry = rankingEntry(row);
			entry.rank =
				1 +
				costOrder.filter((other) => other.incurred_cost > row.incurred_cost)
					.length;
			byCost.push(entry);
		}
		const rankable = group.filter((row) => row.change_amount !== null);
		const increaseOrder = [...rankable].sort(
			(a, b) =>
				(b.change_amount ?? 0) - (a.change_amount ?? 0) ||
				a.project_code.localeCompare(b.project_code) ||
				a.project_id - b.project_id
		);
		for (const row of increaseOrder) {
			const entry = rankingEntry(row);
			entry.rank =
				1 +
				increaseOrder.filter(
					(other) => (other.change_amount ?? 0) > (row.change_amount ?? 0)
				).length;
			byIncrease.push(entry);
		}
		for (const row of group.filter(
			(candidate) => candidate.change_amount === null
		)) {
			unranked.push({
				project_id: row.project_id,
				currency: row.currency,
				reason: 'unknown_prior',
				detail: `${row.project_code} has no comparable prior-period cost, so it cannot be placed in the increase ordering.`,
			});
		}
	}
	return {
		by_cost: byCost,
		by_increase: byIncrease,
		increase_unranked: unranked,
		currencies,
	};
}
