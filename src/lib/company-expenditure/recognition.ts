/**
 * Recognition rules for direct cost — pure, no database and no clock.
 *
 * These are the decisions the whole expenditure reconciliation depends on, so
 * they live in one place and are exercised through the module's public
 * interface:
 *
 *  - the Recognition Period comes from the received-work/service period, or
 *    from the bill date as a disclosed fallback, and never from the order or
 *    payment dates;
 *  - a missing amount is unknown, not zero;
 *  - confirmed recoverable tax is excluded from cost only with its evidence;
 *    unresolved tax keeps the gross liability as cost and says so.
 */

import { R, sub, toNumber } from '@/lib/money';
import type {
	CostClassification,
	CostCommandName,
	CostEvaluation,
	CostFinancialInput,
	EffectiveTaxTreatment,
	PeriodBasis,
	RecognitionState,
	TaxTreatment,
} from './types';

/** The month a date belongs to, as the first day (the stored period form). */
export function firstOfMonth(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

/**
 * The Recognition Period. The service period wins; the bill date is only a
 * disclosed fallback; without either the cost has no period and cannot be
 * recognized into a month. When only the end of the received-work period is
 * recorded, that end month is used and disclosed as `service_period_end`
 * rather than silently falling through to the bill date.
 */
export function resolveRecognitionPeriod(input: {
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	billDate?: string | null;
}): { period: string | null; basis: PeriodBasis } {
	if (input.servicePeriodStart) {
		return {
			period: firstOfMonth(input.servicePeriodStart),
			basis: 'service_period',
		};
	}
	if (input.servicePeriodEnd) {
		return {
			period: firstOfMonth(input.servicePeriodEnd),
			basis: 'service_period_end',
		};
	}
	if (input.billDate) {
		return { period: firstOfMonth(input.billDate), basis: 'bill_date_fallback' };
	}
	return { period: null, basis: 'unresolved' };
}

/**
 * The tax treatment actually applied. A recoverable claim without its evidence
 * is unresolved: excluding tax on an unevidenced claim would understate cost.
 */
export function effectiveTaxTreatment(input: {
	taxTreatment: TaxTreatment;
	taxAmount: number | null;
	taxEvidenceReference: string | null;
}): EffectiveTaxTreatment {
	const tax = input.taxAmount ?? 0;
	if (input.taxTreatment === 'recoverable') {
		if (!input.taxEvidenceReference || tax <= 0) return 'unresolved';
		return 'recoverable';
	}
	if (input.taxTreatment === 'non_recoverable') return 'non_recoverable';
	if (input.taxTreatment === 'unresolved') return tax > 0 ? 'unresolved' : 'none';
	// 'none': a recorded tax amount without a stated treatment stays open.
	return tax > 0 ? 'unresolved' : 'none';
}

/**
 * What the cost is worth, and every reason it is not a clean confirmed amount.
 * Pure: it reads only the cost's own fields.
 */
export function evaluateCost(input: CostFinancialInput): CostEvaluation {
	const exceptions: CostEvaluation['exceptions'] = [];
	const gross = input.grossAmount;
	const tax = input.taxAmount ?? 0;
	const treatment = effectiveTaxTreatment(input);

	if (!input.classification) exceptions.push('classification_unresolved');
	if (input.nature === 'unresolved') exceptions.push('nature_unresolved');
	if (!input.recognitionPeriod) exceptions.push('missing_recognition_period');
	if (!input.sourceReference) exceptions.push('missing_source_reference');
	if (!input.evidenceReference) exceptions.push('missing_evidence_reference');
	if (
		input.servicePeriodStart &&
		input.servicePeriodEnd &&
		input.servicePeriodStart.slice(0, 7) !== input.servicePeriodEnd.slice(0, 7)
	) {
		// Splitting a span across months belongs to the period-control slice;
		// until then the whole cost sits in the month the work starts in.
		exceptions.push('service_period_spans_months');
	}
	if (!input.servicePeriodStart && input.servicePeriodEnd) {
		// The received-work period is known to have ended; its start is not
		// recorded, and the cost sits in the end month (disclosed basis).
		exceptions.push('service_period_start_missing');
	}

	if (gross === null) {
		exceptions.push('missing_amount');
		return { recognizedAmount: null, effectiveTaxTreatment: treatment, exceptions };
	}

	if (treatment === 'recoverable') {
		const net = toNumber(sub(R(gross), R(tax)));
		return { recognizedAmount: net, effectiveTaxTreatment: treatment, exceptions };
	}

	if (treatment === 'unresolved') {
		if (input.taxTreatment === 'recoverable') {
			exceptions.push('tax_evidence_missing');
		} else if (input.taxTreatment === 'unresolved') {
			exceptions.push('tax_treatment_unresolved');
		} else {
			exceptions.push('tax_treatment_missing');
		}
	}

	return { recognizedAmount: gross, effectiveTaxTreatment: treatment, exceptions };
}

/** States that count as confirmed cost — `recognized` and nothing else. */
export function isConfirmed(state: RecognitionState): boolean {
	return state === 'recognized';
}

/** States whose amount is still expected to become cost (the review queue). */
export function isOpenState(state: RecognitionState): boolean {
	return state === 'draft' || state === 'pending_evidence';
}

const COMMAND_TRANSITIONS: Record<
	RecognitionState,
	ReadonlyArray<CostCommandName>
> = {
	draft: ['submit', 'recognize', 'reject', 'cancel', 'update'],
	pending_evidence: ['submit', 'recognize', 'reject', 'cancel', 'update'],
	recognized: ['cancel'],
	rejected: ['submit', 'cancel'],
	cancelled: [],
};

/** The state a command would produce, or null when the command is not allowed. */
export function nextState(
	state: RecognitionState,
	command: CostCommandName
): RecognitionState | null {
	if (!COMMAND_TRANSITIONS[state].includes(command)) return null;
	switch (command) {
		case 'submit':
			return 'pending_evidence';
		case 'recognize':
			return 'recognized';
		case 'reject':
			return 'rejected';
		case 'cancel':
			return 'cancelled';
		case 'update':
			return state;
	}
}

/**
 * What still blocks recognition. An empty list means the cost may become
 * confirmed cost; every name here is a field the operator must supply.
 */
export function recognitionBlockers(input: {
	grossAmount: number | null;
	classification: CostClassification | null;
	projectId: number | null;
	recognitionPeriod: string | null;
	currency: string | null;
}): string[] {
	const blockers: string[] = [];
	if (input.grossAmount === null) blockers.push('gross_amount');
	if (!input.classification) blockers.push('cost_classification');
	if (input.classification === 'project' && !input.projectId) {
		blockers.push('project_id');
	}
	if (
		input.classification &&
		input.classification !== 'project' &&
		input.projectId
	) {
		blockers.push('project_id_not_allowed');
	}
	if (!input.recognitionPeriod) blockers.push('recognition_period');
	if (!input.currency) blockers.push('currency');
	return blockers;
}
