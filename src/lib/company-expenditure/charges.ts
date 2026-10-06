/**
 * The write path for approved period consumption, depreciation, and
 * amortization against a non-operating source balance (ticket #317).
 *
 * Invariants this file owns:
 *  - the source must be confirmed cost first — that act establishes the
 *    supported balance a charge draws down;
 *  - only an advance, deposit, prepayment, or capital item may be consumed;
 *  - an amount, its evidence, and the source's currency are required;
 *  - one source/period/basis may hold one approved charge, and the approved
 *    charges may never exceed the source's confirmed balance, so consumption
 *    can be neither duplicated nor overstated;
 *  - approval appends one journal row; cancellation is reasoned and versioned,
 *    keeps both rows, and restores the balance it freed.
 *
 * Nothing here computes a charge: the operator (or an import) states the
 * amount and its evidence, and these rules accept or refuse it. There is no
 * depreciation schedule and no automatic capitalization.
 *
 * Atomicity matches the cost commands: the caller's connection/transaction is
 * used when supplied (a financial-close check must commit with this change),
 * otherwise the module opens its own.
 */

import { randomUUID } from 'node:crypto';
import { CostError, inTransaction, type CommandOptions } from './commands';
import {
	chargePeriodDate,
	PERIOD_CHARGE_BASES,
	periodChargeBlockers,
	remainingBalance,
	consumedToDate,
	toPeriodChargeJson,
	type PeriodChargeBlocker,
} from './non-operating';
import {
	loadChargeByUid,
	loadChargeSourceForUpdate,
	loadSourceCharges,
} from './records';
import type {
	CostNature,
	PeriodChargeBasis,
	PeriodChargeJson,
	RecognitionState,
} from './types';

export interface CapturePeriodChargeInput {
	/** `expenses.id` of the non-operating item being consumed. */
	sourceId: number;
	/** The charge's own month (`YYYY-MM`). */
	period: string;
	basis: PeriodChargeBasis;
	amount: number | null;
	evidenceReference: string | null;
	/** Must match the source's currency when supplied. */
	currency?: string | null;
	/** The approver's note, kept on the charge's journal row. */
	reason?: string | null;
}

export interface PeriodChargeCommandInput {
	chargeUid: string;
	command: 'cancel';
	expectedVersion: number;
	reason: string | null;
}

interface BlockerContext {
	period: string;
	basis: PeriodChargeBasis;
	sourceNature: CostNature;
	sourceState: RecognitionState;
	sourceCurrency: string | null;
	remaining: number | null;
}

/**
 * The refusal an operator sees for each rule, with the status and detail the
 * route maps onto HTTP. Nothing here writes.
 */
function blockerError(
	blocker: PeriodChargeBlocker,
	context: BlockerContext
): CostError {
	switch (blocker) {
		case 'invalid_charge_period':
			return new CostError(
				'invalid_charge_period',
				'A period charge needs its month as YYYY-MM',
				422,
				{ field: 'period', period: context.period }
			);
		case 'invalid_charge_amount':
			return new CostError(
				'invalid_charge_amount',
				'A period charge needs a positive amount',
				422,
				{ field: 'amount' }
			);
		case 'charge_evidence_required':
			return new CostError(
				'charge_evidence_required',
				'Approved consumption needs the evidence that supports it',
				422,
				{ field: 'evidence_reference' }
			);
		case 'charge_currency_mismatch':
			return new CostError(
				'charge_currency_mismatch',
				`The charge currency must match the source currency (${context.sourceCurrency})`,
				422,
				{ field: 'currency', source_currency: context.sourceCurrency }
			);
		case 'source_currency_unknown':
			return new CostError(
				'source_currency_unknown',
				'This item has no original currency, so the charge cannot state the currency it consumes; record the item currency first',
				422,
				{ field: 'currency' }
			);
		case 'source_not_recognized':
			return new CostError(
				'source_not_recognized',
				'This item is not confirmed cost yet, so it has no supported balance to consume',
				409,
				{ state: context.sourceState }
			);
		case 'nature_not_non_operating':
			return new CostError(
				'nature_not_non_operating',
				'Only an advance, deposit, prepayment, or capital item carries a consumable balance',
				422,
				{ cost_nature: context.sourceNature }
			);
		case 'duplicate_period_charge':
			return new CostError(
				'duplicate_period_charge',
				`A ${context.basis} charge for ${context.period} is already approved for this item`,
				409,
				{ period: context.period, basis: context.basis }
			);
		case 'exceeds_source_balance':
			return new CostError(
				'exceeds_source_balance',
				'The charge exceeds the remaining supported balance of this item',
				422,
				{
					remaining_amount: context.remaining,
					period: context.period,
					basis: context.basis,
				}
			);
	}
}

function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function amountOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function basisOrThrow(value: unknown): PeriodChargeBasis {
	const candidate = String(value ?? '').trim() as PeriodChargeBasis;
	if (!PERIOD_CHARGE_BASES.includes(candidate)) {
		throw new CostError(
			'invalid_charge_basis',
			`Unknown charge basis: ${String(value ?? '')}`,
			422,
			{ field: 'basis' }
		);
	}
	return candidate;
}

/**
 * The refusal a duplicate-key failure produces, or the original failure. The
 * unique index on (source, period, basis, sequence) is the backstop that makes
 * two truly concurrent captures impossible; the pre-check above is the friendly
 * path, and this is what a race that slips past it reports.
 */
function chargeWriteError(error: unknown, context: BlockerContext): unknown {
	const failure = error as { code?: string; message?: string };
	if (
		failure?.code === 'ER_DUP_ENTRY' &&
		String(failure.message ?? '').includes('uq_period_charge_period_basis')
	) {
		return blockerError('duplicate_period_charge', context);
	}
	return error;
}

/**
 * Approve one period charge. The source row is locked for the whole command,
 * so two concurrent captures on one item serialize: the second sees the first
 * and is refused as a duplicate rather than both writing.
 */
export async function capturePeriodCharge(
	input: CapturePeriodChargeInput,
	actor: { id: number | null },
	options?: CommandOptions
): Promise<PeriodChargeJson> {
	const period = String(input.period ?? '').trim();
	const basis = basisOrThrow(input.basis);
	const amount = amountOrNull(input.amount);
	const evidenceReference = text(input.evidenceReference, 500);
	const currency = text(input.currency, 3)?.toUpperCase() ?? null;

	return inTransaction(options, async (db) => {
		const source = await loadChargeSourceForUpdate(db, input.sourceId);
		if (!source) {
			throw new CostError('not_found', 'Cost not found', 404);
		}
		const existing = await loadSourceCharges(db, source.costUid);
		const remaining = remainingBalance(
			source.recognizedAmount,
			consumedToDate(existing)
		);
		const context: BlockerContext = {
			period,
			basis,
			sourceNature: source.nature,
			sourceState: source.state,
			sourceCurrency: source.currency,
			remaining,
		};
		const blockers = periodChargeBlockers({
			period,
			basis,
			amount,
			currency,
			evidenceReference,
			sourceState: source.state,
			sourceNature: source.nature,
			sourceRecognizedAmount: source.recognizedAmount,
			sourceCurrency: source.currency,
			existing,
		});
		if (blockers.length > 0) {
			throw blockerError(blockers[0], context);
		}

		// Re-entry after a cancellation carries the next sequence for that
		// period and basis; the unique index is the concurrent-write backstop.
		const sequence =
			existing
				.filter(
					(charge) =>
						charge.period === chargePeriodDate(period) && charge.basis === basis
				)
				.reduce((max, charge) => Math.max(max, charge.sequence), 0) + 1;
		const chargeUid = `charge-${randomUUID()}`;
		const [result] = (await db
			.execute(
				`INSERT INTO expense_period_charges
           (charge_uid, source_table, source_id, source_cost_uid, charge_period,
            basis, amount, currency, evidence_reference, state,
            financial_version, sequence, approved_by, approved_at,
            created_at, updated_at)
         VALUES (?, 'expenses', ?, ?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?, NOW(), NOW(), NOW())`,
				[
					chargeUid,
					source.id,
					source.costUid,
					chargePeriodDate(period),
					basis,
					amount,
					source.currency,
					evidenceReference,
					sequence,
					actor.id,
				]
			)
			.catch((error: unknown) => {
				throw chargeWriteError(error, context);
			})) as [Record<string, unknown>, unknown];
		const insertId = Number(result.insertId);

		await db.execute(
			`INSERT INTO expense_period_charge_events
         (charge_uid, version, command, actor_user_id, reason, evidence_reference,
          snapshot, created_at)
       VALUES (?, 1, 'approved', ?, ?, ?, ?, NOW())`,
			[
				chargeUid,
				actor.id,
				text(input.reason, 500),
				evidenceReference,
				JSON.stringify({
					source_cost_uid: source.costUid,
					source_id: source.id,
					period: chargePeriodDate(period),
					basis,
					amount,
					currency: source.currency,
					evidence_reference: evidenceReference,
					state: 'approved',
					remaining_after: remainingBalance(
						source.recognizedAmount,
						consumedToDate(existing) + (amount ?? 0)
					),
					sequence,
					charge_id: insertId,
				}),
			]
		);

		const stored = await loadChargeByUid(db, chargeUid);
		if (!stored) {
			throw new CostError(
				'charge_not_written',
				'The period charge was not stored',
				500
			);
		}
		return toPeriodChargeJson(stored);
	});
}

/**
 * Cancel an approved period charge. The version must match, a reason is
 * required, and both the row and its journal keep the history; the balance the
 * charge consumed becomes available again.
 */
export async function cancelPeriodCharge(
	input: PeriodChargeCommandInput,
	actor: { id: number | null },
	options?: CommandOptions
): Promise<PeriodChargeJson> {
	const reason = text(input.reason, 500);
	if (!reason) {
		throw new CostError(
			'reason_required',
			'A reason is required to cancel a period charge',
			422
		);
	}
	return inTransaction(options, async (db) => {
		const [rows] = (await db.execute(
			`SELECT charge_uid, state, financial_version, evidence_reference,
              source_cost_uid
         FROM expense_period_charges
        WHERE charge_uid = ?
        FOR UPDATE`,
			[input.chargeUid]
		)) as [Array<Record<string, unknown>>, unknown];
		const row = rows[0];
		if (!row) {
			throw new CostError('not_found', 'Period charge not found', 404);
		}
		const version = Number(row.financial_version ?? 1);
		if (version !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				`This period charge changed since it was read (current version ${version})`,
				409,
				{ current_version: version }
			);
		}
		if (String(row.state) !== 'approved') {
			throw new CostError(
				'command_not_allowed',
				'This period charge is already cancelled',
				422,
				{ state: row.state }
			);
		}
		const [updated] = (await db.execute(
			`UPDATE expense_period_charges
          SET state = 'cancelled', cancelled_by = ?, cancelled_at = NOW(),
              cancel_reason = ?, financial_version = ?
        WHERE charge_uid = ? AND state = 'approved' AND financial_version = ?`,
			[actor.id, reason, version + 1, input.chargeUid, version]
		)) as [Record<string, unknown>, unknown];
		if (Number(updated.affectedRows ?? 0) === 0) {
			throw new CostError(
				'version_conflict',
				'This period charge changed while the command was applied',
				409
			);
		}

		await db.execute(
			`INSERT INTO expense_period_charge_events
         (charge_uid, version, command, actor_user_id, reason, evidence_reference,
          snapshot, created_at)
       VALUES (?, ?, 'cancelled', ?, ?, ?, ?, NOW())`,
			[
				input.chargeUid,
				version + 1,
				actor.id,
				reason,
				row.evidence_reference ?? null,
				JSON.stringify({ state: 'cancelled', reason }),
			]
		);

		const stored = await loadChargeByUid(db, input.chargeUid);
		if (!stored) {
			throw new CostError(
				'charge_not_written',
				'The cancelled period charge was not stored',
				500
			);
		}
		return toPeriodChargeJson(stored);
	});
}
