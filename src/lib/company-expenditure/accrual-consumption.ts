/**
 * Accrual consumption wiring (ticket #314) — received work reduces the
 * outstanding supplier commitment before its invoice exists, and an invoice
 * replacement transfers that consumption instead of duplicating or dropping
 * it.
 *
 * Ownership: #312 owns the consumption rule (`recordOrderConsumption` /
 * `releaseOrderConsumption` in `commitments.ts` — native slice amounts, one
 * currency + tax basis pair, version guards); #313 owns accrual replacement
 * (`executeAccrualReplacement`) and the remaining-slice reader
 * (`ACCRUAL_ADAPTER.loadSlices`). This module only composes those calls in
 * one transaction — it never writes `order_consumptions` directly and never
 * re-derives a slice amount.
 *
 * Composition doctrine (contracts `expenditure-accrual-contract.md` §7 and
 * `expenditure-commitment-contract.md` §10):
 *  - recognizing a linked accrual records its remaining slice as order
 *    consumption (`source: 'accrual'`) in the same transaction;
 *  - replacing with an invoice releases the accrual's active consumption rows
 *    (reasoned, evidenced) and records the invoice's native slices in their
 *    own periods plus the accrual's new remainder slice, atomically;
 *  - cancelling a linked accrual releases its consumption;
 *  - cancelling a replacement invoice re-records the restored remainder
 *    (the supplier cancel command calls back here in its own transaction);
 *  - an accrual with no `order_uid` link takes the pure #313 path: the
 *    outcome is null and nothing is consumed;
 *  - a replacement invoice in another currency cannot consume this order
 *    (currencies are never mixed): its leg is skipped with an explicit code
 *    while the superseded estimate still leaves the order;
 *  - every other transfer refusal fails the whole command with its explicit
 *    code and zero partial writes.
 *
 * Lock order is order-first: the composer locks the order row before the
 * replacement/command locks its source rows, matching #312's fixed
 * order-then-source order so concurrent commands serialize instead of
 * deadlocking.
 */

import { gt, R, toNumber } from '@/lib/money';
import { withTransaction } from '@/utils/database';
import { OrderError } from './orders';
import type { SqlConnection } from './records';
import { num, s } from './records';
import { resolveCostSlices } from './sources';
import type { CostCommandResult } from './types';
import type {
	AccrualCommandInput,
	AccrualReplacementInput,
	AccrualReplacementResult,
} from './accruals';
import { executeAccrualCommand, executeAccrualReplacement } from './accruals';
import { recordOrderConsumption, releaseOrderConsumption } from './commitments';

type DbRow = Record<string, unknown>;

export interface AccrualConsumptionActor {
	id: number | null;
}

export interface AccrualConsumptionOptions {
	/** Use the caller's connection/transaction instead of opening one. */
	connection?: SqlConnection;
}

/** One recorded consumption row, as the composition outcome states it. */
export interface AccrualRecordedConsumption {
	id: number;
	cost_uid: string;
	recognized_period: string;
	amount: number;
}

/**
 * The outcome of composing recognition with consumption: the remaining slice
 * the linked order consumed. Null when the accrual carries no order link.
 */
export interface AccrualRecognitionConsumption {
	order_uid: string;
	consumption_id: number;
	amount: number;
	recognized_period: string;
	source: 'accrual';
	remaining_commitment: number;
}

/**
 * The outcome of composing a replacement with the consumption transfer: the
 * accrual rows released, the invoice slices recorded in their own periods,
 * the accrual remainder re-recorded, and — when the actual arrived in another
 * currency — the explicitly skipped invoice leg.
 */
export interface AccrualReplacementConsumption {
	order_uid: string;
	released_consumption_ids: number[];
	released_amount: number;
	recorded_invoice_consumptions: AccrualRecordedConsumption[];
	recorded_accrual_consumption: AccrualRecordedConsumption | null;
	/** The matched estimate that moved off the accrual. */
	transferred_amount: number;
	skipped_invoice: { code: string; detail: Record<string, unknown> } | null;
}

/**
 * The outcome of composing a cancellation with consumption: the rows released
 * and, when an estimate was restored, the remainder recorded again.
 */
export interface AccrualCancelConsumption {
	order_uid: string;
	released_consumption_ids: number[];
	released_amount: number;
	recorded_accrual_consumption: AccrualRecordedConsumption | null;
}

export type AccrualCommandWithConsumptionResult = CostCommandResult & {
	consumption: AccrualRecognitionConsumption | AccrualCancelConsumption | null;
};

export type AccrualReplacementWithConsumptionResult =
	AccrualReplacementResult & {
		consumption: AccrualReplacementConsumption | null;
	};

function trimReason(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, 500);
}

function orderCurrencyOf(value: unknown): string {
	return String(value ?? '').toUpperCase();
}

/** The order's current financial version inside the caller's transaction. */
async function orderVersionOf(
	db: SqlConnection,
	orderUid: string
): Promise<number> {
	const [rows] = (await db.execute(
		`SELECT financial_version FROM orders WHERE order_uid = ? AND isDelete = 0`,
		[orderUid]
	)) as [DbRow[], unknown];
	if (rows.length === 0) {
		throw new OrderError('order_not_found', 'Order not found', 404, {
			field: 'order_uid',
		});
	}
	return Number(num(rows[0], 'financial_version') ?? 1);
}

/** The order's amount basis inside the caller's transaction. */
async function orderBasisOf(
	db: SqlConnection,
	orderUid: string
): Promise<'gross' | 'net'> {
	const [rows] = (await db.execute(
		`SELECT amount_basis FROM orders WHERE order_uid = ? AND isDelete = 0`,
		[orderUid]
	)) as [DbRow[], unknown];
	const basis = s(rows[0], 'amount_basis', 'unknown');
	if (basis !== 'gross' && basis !== 'net') {
		throw new OrderError(
			'order_basis_unknown',
			'An order without a supported tax basis cannot consume cost',
			422,
			{ field: 'amount_basis' }
		);
	}
	return basis;
}

/**
 * Lock the linked order first (the fixed lock order), returning its uid, or
 * null when the accrual carries no order link. A link to a missing order
 * fails explicitly: the link asserts the order covers the cost.
 */
async function lockLinkedOrder(
	db: SqlConnection,
	orderUid: string | null
): Promise<string | null> {
	const uid = orderUid?.trim() ? String(orderUid).trim() : null;
	if (!uid) return null;
	const [rows] = (await db.execute(
		`SELECT order_uid FROM orders WHERE order_uid = ? AND isDelete = 0 FOR UPDATE`,
		[uid]
	)) as [DbRow[], unknown];
	if (rows.length === 0) {
		throw new OrderError(
			'order_not_found',
			'The linked supplier order does not exist',
			404,
			{ field: 'order_uid', order_uid: uid }
		);
	}
	return uid;
}

/** The accrual's link columns, locked for the composing transaction. */
async function loadAccrualLink(
	db: SqlConnection,
	accrualId: number
): Promise<{ costUid: string; orderUid: string | null } | null> {
	const [rows] = (await db.execute(
		`SELECT cost_uid, order_uid FROM cost_accruals
       WHERE id = ? AND isDelete = 0 FOR UPDATE`,
		[accrualId]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	return {
		costUid: s(rows[0], 'cost_uid', '') ?? '',
		orderUid: s(rows[0], 'order_uid'),
	};
}

/**
 * Record every native period of one cost as order consumption. Amounts stay
 * native (#312 derives them from the frozen slices); this helper only fans
 * the periods out and threads the advancing order version. The remaining
 * commitment comes from #312's own result, never re-derived here.
 */
async function recordCostPeriods(
	db: SqlConnection,
	input: {
		orderUid: string;
		costUid: string;
		expectedSourceVersion: number;
		source: 'invoice' | 'accrual';
		actor: AccrualConsumptionActor;
		reason: string | null;
		evidenceReference: string | null;
	}
): Promise<{ recorded: AccrualRecordedConsumption[]; remaining: number }> {
	const basis = await orderBasisOf(db, input.orderUid);
	const slices = await resolveCostSlices(db, input.costUid, {
		forUpdate: true,
	});
	if (slices === null) {
		throw new OrderError(
			'cost_not_found',
			'No registered cost source resolves this identity',
			422,
			{ field: 'cost_uid' }
		);
	}
	if (slices.length === 0) {
		throw new OrderError(
			'cost_not_recognized',
			'The cost is not a recognized slice of its source',
			422,
			{ field: 'cost_uid' }
		);
	}
	const periods = [...new Set(slices.map((slice) => slice.recognition_period))];
	const recorded: AccrualRecordedConsumption[] = [];
	let remaining = 0;
	for (const period of periods) {
		const result = await recordOrderConsumption(
			{
				orderUid: input.orderUid,
				costUid: input.costUid,
				recognizedPeriod: period,
				taxBasis: basis,
				expectedOrderVersion: await orderVersionOf(db, input.orderUid),
				expectedSourceVersion: input.expectedSourceVersion,
				source: input.source,
				reason: input.reason,
				evidenceReference: input.evidenceReference,
			},
			{ id: input.actor.id },
			{ connection: db }
		);
		recorded.push({
			id: result.consumption.id,
			cost_uid: result.consumption.costUid,
			recognized_period: result.consumption.recognizedPeriod,
			amount: result.consumption.amount,
		});
		remaining = result.remainingCommitment;
	}
	return { recorded, remaining };
}

/** Release every active consumption row of one cost on one order. */
async function releaseCostRows(
	db: SqlConnection,
	input: {
		orderUid: string;
		costUid: string;
		actor: AccrualConsumptionActor;
		reason: string;
		evidenceReference: string | null;
	}
): Promise<{ ids: number[]; amount: number }> {
	const [rows] = (await db.execute(
		`SELECT id, version, amount FROM order_consumptions
       WHERE order_uid = ? AND cost_uid = ? AND state = 'active'
       ORDER BY id FOR UPDATE`,
		[input.orderUid, input.costUid]
	)) as [DbRow[], unknown];
	const ids: number[] = [];
	let amount = R(0);
	for (const row of rows) {
		const consumptionId = Number(num(row, 'id') ?? 0);
		await releaseOrderConsumption(
			{
				orderUid: input.orderUid,
				consumptionId,
				expectedVersion: Number(num(row, 'version') ?? 1),
				reason: input.reason,
				evidenceReference: input.evidenceReference,
			},
			{ id: input.actor.id },
			{ connection: db }
		);
		ids.push(consumptionId);
		amount = amount.add(R(num(row, 'amount') ?? 0));
	}
	return { ids, amount: toNumber(amount.toDecimalPlaces(2)) };
}

/**
 * Recognize/cancel/update a Cost Accrual, composing recognition and
 * cancellation with order consumption in the same transaction. An accrual
 * without an order link, and every command other than recognize/cancel,
 * takes the pure #313 path with a null outcome.
 */
export async function executeAccrualCommandWithConsumption(
	input: AccrualCommandInput,
	actor: AccrualConsumptionActor,
	options?: AccrualConsumptionOptions
): Promise<AccrualCommandWithConsumptionResult> {
	const composes = input.command === 'recognize' || input.command === 'cancel';
	const run = async (
		db: SqlConnection
	): Promise<AccrualCommandWithConsumptionResult> => {
		const link = composes ? await loadAccrualLink(db, input.id) : null;
		const orderUid = link ? await lockLinkedOrder(db, link.orderUid) : null;
		const result = await executeAccrualCommand(
			input,
			{ id: actor.id },
			{ connection: db }
		);
		if (!orderUid || !link) return { ...result, consumption: null };

		const reasonBase =
			input.command === 'recognize'
				? 'Accrual recognition consumes the linked order'
				: 'Accrual cancellation releases the linked order consumption';
		const operatorReason = trimReason(input.reason);
		const reason = operatorReason
			? `${reasonBase}: ${operatorReason}`
			: reasonBase;
		const evidenceReference = trimReason(input.evidenceReference);

		if (
			input.command === 'recognize' &&
			result.recognition_state === 'recognized'
		) {
			const { recorded, remaining } = await recordCostPeriods(db, {
				orderUid,
				costUid: link.costUid,
				expectedSourceVersion: result.financial_version,
				source: 'accrual',
				actor,
				reason,
				evidenceReference,
			});
			const first = recorded[0];
			return {
				...result,
				consumption: {
					order_uid: orderUid,
					consumption_id: first.id,
					amount: first.amount,
					recognized_period: first.recognized_period,
					source: 'accrual' as const,
					remaining_commitment: remaining,
				},
			};
		}

		if (
			input.command === 'cancel' &&
			result.recognition_state === 'cancelled'
		) {
			const released = await releaseCostRows(db, {
				orderUid,
				costUid: link.costUid,
				actor,
				reason,
				evidenceReference,
			});
			return {
				...result,
				consumption: {
					order_uid: orderUid,
					released_consumption_ids: released.ids,
					released_amount: released.amount,
					recorded_accrual_consumption: null,
				},
			};
		}

		return { ...result, consumption: null };
	};

	if (options?.connection) return run(options.connection);
	if (!composes) {
		const result = await executeAccrualCommand(
			input,
			{ id: actor.id },
			options?.connection ? { connection: options.connection } : undefined
		);
		return { ...result, consumption: null };
	}
	return withTransaction((db) =>
		run(db)
	) as Promise<AccrualCommandWithConsumptionResult>;
}

/**
 * Supersede a linked accrual with an invoice, transferring its order
 * consumption in the same transaction: the accrual's active rows are
 * released, the invoice's native slices are recorded in their own periods,
 * and a partial remainder is recorded again — so the replaced portion is
 * never counted twice and the remainder never silently returns to the
 * commitment. An unlinked accrual takes the pure #313 path.
 */
export async function executeAccrualReplacementWithConsumption(
	input: AccrualReplacementInput,
	actor: AccrualConsumptionActor,
	options?: AccrualConsumptionOptions
): Promise<AccrualReplacementWithConsumptionResult> {
	const run = async (
		db: SqlConnection
	): Promise<AccrualReplacementWithConsumptionResult> => {
		const link = await loadAccrualLink(db, input.accrualId);
		const orderUid = link ? await lockLinkedOrder(db, link.orderUid) : null;
		const replacement = await executeAccrualReplacement(
			input,
			{ id: actor.id },
			{ connection: db }
		);
		if (!orderUid || !link) return { ...replacement, consumption: null };

		const operatorReason = trimReason(input.reason);
		const reasonBase = `Accrual replacement transfer to invoice ${input.invoiceId}`;
		const reason = operatorReason
			? `${reasonBase}: ${operatorReason}`
			: reasonBase;
		const evidenceReference = trimReason(input.evidenceReference);

		const released = await releaseCostRows(db, {
			orderUid,
			costUid: replacement.accrual_cost_uid,
			actor,
			reason,
			evidenceReference,
		});

		const invoiceSlices = await resolveCostSlices(
			db,
			replacement.invoice_cost_uid,
			{ forUpdate: true }
		);
		const invoiceCurrency =
			invoiceSlices && invoiceSlices.length > 0
				? orderCurrencyOf(invoiceSlices[0].currency)
				: null;
		const [orderRows] = (await db.execute(
			`SELECT currency FROM orders WHERE order_uid = ? AND isDelete = 0`,
			[orderUid]
		)) as [DbRow[], unknown];
		const orderCurrency = orderCurrencyOf(s(orderRows[0], 'currency', ''));

		let skippedInvoice: AccrualReplacementConsumption['skipped_invoice'] = null;
		let recordedInvoice: AccrualRecordedConsumption[] = [];
		if (invoiceCurrency === null || invoiceCurrency !== orderCurrency) {
			// Currencies are never mixed: the superseded estimate leaves the
			// order and the foreign actual is explicitly left unconsumed, its
			// variance already explained on the replacement row.
			skippedInvoice = {
				code: 'invoice_currency_unconsumed',
				detail: {
					order_uid: orderUid,
					order_currency: orderCurrency,
					invoice_currency: invoiceCurrency,
				},
			};
		} else {
			const { recorded } = await recordCostPeriods(db, {
				orderUid,
				costUid: replacement.invoice_cost_uid,
				expectedSourceVersion: replacement.invoice_version,
				source: 'invoice',
				actor,
				reason,
				evidenceReference,
			});
			recordedInvoice = recorded;
		}

		let recordedAccrual: AccrualRecordedConsumption | null = null;
		if (gt(replacement.accrual_remaining_amount, 0)) {
			const { recorded } = await recordCostPeriods(db, {
				orderUid,
				costUid: replacement.accrual_cost_uid,
				expectedSourceVersion: replacement.accrual_version,
				source: 'accrual',
				actor,
				reason,
				evidenceReference,
			});
			recordedAccrual = recorded[0] ?? null;
		}

		return {
			...replacement,
			consumption: {
				order_uid: orderUid,
				released_consumption_ids: released.ids,
				released_amount: released.amount,
				recorded_invoice_consumptions: recordedInvoice,
				recorded_accrual_consumption: recordedAccrual,
				transferred_amount: replacement.replaced_amount,
				skipped_invoice: skippedInvoice,
			},
		};
	};

	if (options?.connection) return run(options.connection);
	return withTransaction((db) =>
		run(db)
	) as Promise<AccrualReplacementWithConsumptionResult>;
}

/**
 * Re-record the restored remainder after a replacement invoice is cancelled.
 * Called by the supplier cancel command in its own transaction, right after
 * `releaseAccrualReplacementsForInvoice` restores the matched amounts: the
 * stale remainder row is released and the restored slice is recorded again,
 * so the received-work cost keeps consuming its order instead of silently
 * returning to the commitment. Accruals without an order link, or no longer
 * recognized, are left to the pure #313 path.
 */
export async function restoreAccrualConsumptionForReleasedReplacements(
	db: SqlConnection,
	input: {
		replacementIds: number[];
		actor: AccrualConsumptionActor;
		reason: string | null;
		evidenceReference: string | null;
	}
): Promise<AccrualCancelConsumption[]> {
	if (input.replacementIds.length === 0) return [];
	const placeholders = input.replacementIds.map(() => '?').join(', ');
	const [rows] = (await db.execute(
		`SELECT DISTINCT r.accrual_id AS accrual_id
       FROM cost_accrual_replacements r
       WHERE r.id IN (${placeholders})`,
		input.replacementIds
	)) as [DbRow[], unknown];
	const outcomes: AccrualCancelConsumption[] = [];
	for (const row of rows) {
		const accrualId = Number(num(row, 'accrual_id') ?? 0);
		if (!Number.isInteger(accrualId) || accrualId <= 0) continue;
		const [accrualRows] = (await db.execute(
			`SELECT cost_uid, order_uid, recognition_state
         FROM cost_accruals WHERE id = ? AND isDelete = 0 FOR UPDATE`,
			[accrualId]
		)) as [DbRow[], unknown];
		if (accrualRows.length === 0) continue;
		const orderUid = await lockLinkedOrder(db, s(accrualRows[0], 'order_uid'));
		if (!orderUid) continue;
		const state = s(accrualRows[0], 'recognition_state', 'draft');
		if (state !== 'recognized') continue;
		const costUid = s(accrualRows[0], 'cost_uid', '') ?? '';
		const operatorReason = trimReason(input.reason);
		const reason = operatorReason
			? `Accrual consumption restored after invoice cancel: ${operatorReason}`
			: 'Accrual consumption restored after invoice cancel';
		const released = await releaseCostRows(db, {
			orderUid,
			costUid,
			actor: input.actor,
			reason,
			evidenceReference: trimReason(input.evidenceReference),
		});
		// The restored slice states the full remaining estimate again; the
		// stale remainder row was just released, so the re-record takes its
		// freed slice back atomically.
		const [versionRows] = (await db.execute(
			`SELECT financial_version FROM cost_accruals WHERE id = ? AND isDelete = 0`,
			[accrualId]
		)) as [DbRow[], unknown];
		const { recorded } = await recordCostPeriods(db, {
			orderUid,
			costUid,
			expectedSourceVersion: Number(
				num(versionRows[0], 'financial_version') ?? 1
			),
			source: 'accrual',
			actor: input.actor,
			reason,
			evidenceReference: trimReason(input.evidenceReference),
		});
		outcomes.push({
			order_uid: orderUid,
			released_consumption_ids: released.ids,
			released_amount: released.amount,
			recorded_accrual_consumption: recorded[0] ?? null,
		});
	}
	return outcomes;
}
