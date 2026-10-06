/**
 * Non-operating rules — pure, no database and no clock.
 *
 * These decide what may become Company Incurred Cost when a spend is an
 * advance, deposit, prepayment, or capital item rather than operating cost
 * (ticket #317):
 *
 *  - the payment or invoice of a non-operating item is never cost by itself;
 *  - only an approved, evidenced period charge makes it cost, in the charge's
 *    own month, with the classification and currency of its source;
 *  - a charge may never exceed the source's supported balance (its confirmed
 *    amount), and one source/period/basis may hold one approved charge, so
 *    consumption cannot be duplicated;
 *  - a missing balance is unknown, not zero.
 *
 * There is deliberately no depreciation schedule here: nothing computes a
 * charge. An operator (or an import) states each approved amount and its
 * evidence, and these rules only accept or refuse it.
 */

import { add, R, sub, toNumber } from '@/lib/money';
import type {
	CostNature,
	PeriodCharge,
	PeriodChargeBasis,
	PeriodChargeJson,
	PeriodChargeState,
	RecognitionState,
} from './types';

export const COST_NATURES: readonly CostNature[] = [
	'operating',
	'advance',
	'deposit',
	'prepayment',
	'capital',
	'unresolved',
];

/** Natures whose payment is a balance, not an expense. */
export const NON_OPERATING_NATURES: readonly CostNature[] = [
	'advance',
	'deposit',
	'prepayment',
	'capital',
];

export const PERIOD_CHARGE_BASES: readonly PeriodChargeBasis[] = [
	'consumption',
	'depreciation',
	'amortization',
];

/** Reader-facing names for the report, the queue, and the artifact. */
export const NATURE_LABELS: Record<CostNature, string> = {
	operating: 'Operating cost',
	advance: 'Advance',
	deposit: 'Deposit',
	prepayment: 'Prepayment',
	capital: 'Capital item',
	unresolved: 'Treatment unresolved',
};

export const CHARGE_BASIS_LABELS: Record<PeriodChargeBasis, string> = {
	consumption: 'Consumption',
	depreciation: 'Depreciation',
	amortization: 'Amortization',
};

/** Whether the spend is a balance drawn down by approved period charges. */
export function isNonOperatingNature(nature: CostNature): boolean {
	return NON_OPERATING_NATURES.includes(nature);
}

/** The month a charge period (`YYYY-MM`) belongs to, as the stored date. */
export function chargePeriodDate(period: string): string {
	return `${period}-01`;
}

/** A well-formed `YYYY-MM` month. */
export function isChargePeriod(period: string | null | undefined): boolean {
	return !!period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

/** Approved charges to date; a cancelled charge never reduces the balance. */
export function consumedToDate(
	charges: ReadonlyArray<{
		amount: number;
		state: PeriodChargeState;
	}>
): number {
	return toNumber(
		charges.reduce(
			(total, charge) =>
				charge.state === 'approved' ? add(total, charge.amount) : total,
			R(0)
		)
	);
}

/**
 * The unconsumed supported balance, or null when the source has no confirmed
 * balance to consume (unknown is not zero).
 */
export function remainingBalance(
	recognizedAmount: number | null,
	consumed: number
): number | null {
	if (recognizedAmount === null) return null;
	return toNumber(sub(recognizedAmount, consumed));
}

export interface PeriodChargeCandidate {
	period: string;
	basis: PeriodChargeBasis;
	amount: number | null;
	currency: string | null;
	evidenceReference: string | null;
}

export interface PeriodChargeBlockerInput extends PeriodChargeCandidate {
	sourceState: RecognitionState;
	sourceNature: CostNature;
	sourceRecognizedAmount: number | null;
	sourceCurrency: string;
	/** Every charge already recorded for this source, in any state. */
	existing: ReadonlyArray<{
		period: string;
		basis: PeriodChargeBasis;
		state: PeriodChargeState;
		amount: number;
	}>;
}

/** The reason a period charge is refused, in the order an operator fixes it. */
export type PeriodChargeBlocker =
	| 'invalid_charge_period'
	| 'invalid_charge_amount'
	| 'charge_evidence_required'
	| 'charge_currency_mismatch'
	| 'source_not_recognized'
	| 'nature_not_non_operating'
	| 'duplicate_period_charge'
	| 'exceeds_source_balance';

/**
 * What still blocks an approved period charge; an empty list means it may be
 * approved. A charge needs a supported source balance, an amount, its
 * evidence, the source's currency, a month and basis that are not already
 * consumed, and room in the remaining balance.
 */
export function periodChargeBlockers(
	input: PeriodChargeBlockerInput
): PeriodChargeBlocker[] {
	const blockers: PeriodChargeBlocker[] = [];
	if (!isChargePeriod(input.period)) blockers.push('invalid_charge_period');
	if (input.amount === null || input.amount <= 0) {
		blockers.push('invalid_charge_amount');
	}
	if (!input.evidenceReference) blockers.push('charge_evidence_required');
	if (
		input.currency !== null &&
		input.currency.toUpperCase() !== input.sourceCurrency.toUpperCase()
	) {
		blockers.push('charge_currency_mismatch');
	}
	// The source must be confirmed cost first: that act establishes the
	// balance the charge draws down.
	if (input.sourceState !== 'recognized') blockers.push('source_not_recognized');
	if (!isNonOperatingNature(input.sourceNature)) {
		blockers.push('nature_not_non_operating');
	}
	if (
		input.existing.some(
			(charge) =>
				charge.state === 'approved' &&
				charge.period === chargePeriodDate(input.period) &&
				charge.basis === input.basis
		)
	) {
		blockers.push('duplicate_period_charge');
	}
	if (input.amount !== null && input.amount > 0) {
		const consumed = consumedToDate(input.existing);
		const remaining = remainingBalance(
			input.sourceRecognizedAmount,
			consumed
		);
		if (remaining === null) {
			// No supported balance: the source is not confirmed cost, which the
			// blocker above already stated; nothing can be measured here.
			if (input.sourceState === 'recognized') {
				blockers.push('exceeds_source_balance');
			}
		} else if (input.amount > remaining) {
			blockers.push('exceeds_source_balance');
		}
	}
	return blockers;
}

/** The charge shape the report section, the drilldown, and the routes publish. */
export function toPeriodChargeJson(charge: PeriodCharge): PeriodChargeJson {
	return {
		charge_uid: charge.chargeUid,
		source_cost_uid: charge.sourceCostUid,
		source_expense_id: charge.sourceId,
		source_expense_number: charge.sourceExpenseNumber,
		cost_nature: charge.sourceNature,
		source_state: charge.sourceState,
		cost_classification: charge.classification,
		project_id: charge.projectId,
		project_code: charge.projectCode,
		project_name: charge.projectName,
		period: charge.period,
		basis: charge.basis,
		amount: charge.amount,
		currency: charge.currency,
		evidence_reference: charge.evidenceReference,
		state: charge.state,
		financial_version: charge.financialVersion,
		sequence: charge.sequence,
		approved_by: charge.approvedBy,
		approved_at: charge.approvedAt,
		cancel_reason: charge.cancelReason,
		source_recognized_amount: charge.sourceRecognizedAmount,
	};
}
