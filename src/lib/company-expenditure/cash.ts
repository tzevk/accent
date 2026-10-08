/**
 * Dated outward cash settlements (#318).
 *
 * Monthly outward cash paid is the sum of dated supported third-party
 * movements only: recorded manual settlements, native payroll payouts
 * (the mark-paid control's `payment_status='paid'` + `payment_date`), and
 * dated petty-cash spending. Bank-into-float funding is an internal transfer:
 * the voucher and its mirrored credit are one funding movement displayed
 * apart from outward paid, never inside it.
 *
 * A manual settlement may never restate a native movement: a `payment`
 * against a payroll slip is refused (the mark-paid control owns payouts), and
 * a settlement whose target is a petty-cash spend row is refused (the spend
 * is itself the outward movement). The read rollup additionally dedups by
 * canonical movement identity, so a pre-existing row can never count twice.
 *
 * All money uses `src/lib/money.ts` Decimals; numbers leave the module only
 * at the JSON boundary. A missing amount or currency stays null (unknown),
 * never zero, and per-currency subtotals are never mixed. Legacy money tables
 * predate currency evidence entirely (no currency column); their disclosures
 * state as-recorded sums with no currency asserted.
 *
 * Writes join the caller's transaction (`options.connection`) or own one via
 * `withTransaction`, mirroring the accrual command path.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '@/utils/database';
import { add, gte, R, sub, toNumber } from '@/lib/money';
import type { CommandOptions, CostActor } from './commands';
import { CostError } from './errors';
import { currencyCodeOf } from './currency';
import { PAYROLL_CURRENCY } from './payroll';
import { monthBounds, num, s, type DbRow, type SqlConnection } from './records';
import { linkCostReference, resolveCostReference } from './sources';
import type { CostNature } from './types';

export type CashMovementKind =
	| 'payment'
	| 'withholding'
	| 'deduction'
	| 'payroll_payout'
	| 'petty_spend';
export type CashMovementSource =
	| 'settlement'
	| 'payroll'
	| 'petty_cash'
	| 'funding';

export interface CashMovementJson {
	source: CashMovementSource;
	movement_kind: CashMovementKind;
	/** settle:<uid> | payroll:<slipId> | petty:<rowId> | fund:<voucherId>. */
	movement_uid: string;
	/** Null for derived payroll/petty/funding movements. */
	settlement_uid: string | null;
	/** The settlement row id commands address; null for derived movements. */
	settlement_id: number | null;
	/** 'none' = the movement is its own purpose (unlinked petty spend). */
	target_kind: 'cost' | 'payroll' | 'none';
	/** cost_uid | slip id | 'petty:<rowId>' | 'fund:<voucherId>'. */
	target_key: string;
	target_label: string | null;
	target_nature: CostNature | null;
	amount: number;
	currency: string | null;
	/** YYYY-MM-DD, the cash date. */
	settled_on: string;
	reference: string | null;
	destination: string | null;
	evidence_reference: string | null;
	actor_user_id: number | null;
	/** Settlements carry it; derived movements state null. */
	financial_version: number | null;
}

export interface CashTargetJson {
	target_kind: 'cost' | 'payroll';
	target_key: string;
	label: string | null;
	nature: CostNature | null;
	/** Null = unknown, never assumed. */
	currency: string | null;
	/** Recognized cost / slip employer cost; null = unknown. */
	liability: number | null;
	/** All-time recorded movements for this target (all sources). */
	settled: number;
	settled_this_month: number;
	/** Liability minus settled; null when the liability is unknown. */
	remaining: number | null;
	state: 'unsettled' | 'partial' | 'settled' | 'over_settled';
	/** This month's movements for the target. */
	movements: CashMovementJson[];
}

export interface CashSection {
	month: string;
	/** Single currency when every movement shares one; else null. */
	currency: string | null;
	/** Outward total (settlement + payroll + petty_spend); null = mixed. */
	paid: number | null;
	by_currency: Array<{
		currency: string;
		paid: number;
		movement_count: number;
		settlement: number;
		payroll: number;
		petty_spend: number;
	}>;
	/** Voucher funding: one movement per voucher, apart from outward paid. */
	funding: {
		by_currency: Array<{
			currency: string | null;
			amount: number;
			movement_count: number;
		}>;
		movements: CashMovementJson[];
		/** Funding row without a resolvable voucher document. */
		unlinked_vouchers: { count: number };
	};
	/** Targets of this month's movements plus this month's recognized costs
	 * and payroll slips, so partial and unsettled coverage shows. */
	targets: CashTargetJson[];
	coverage: {
		settled_targets: number;
		partial_targets: number;
		unsettled_targets: number;
		/** Single-currency only; null otherwise. */
		outstanding: number | null;
	};
	/** Movement whose source row no longer resolves. */
	unresolved_targets: { count: number; amount: number | null };
	legacy: {
		/** payment_issues and kin: no canonical link. */
		outward_unlinked: { count: number; amount: number | null };
		/** paid fields without a usable date. */
		undated_balances: { count: number; amount: number | null };
		/** payment_entries / payment_receivables / invoices. */
		client_receipts: { count: number; amount: number | null };
		/** account_transactions type='transfer'. */
		internal_transfers: { count: number; amount: number | null };
	};
}

export interface SettlementInput {
	targetKind: 'cost' | 'payroll';
	targetCostUid?: string | null;
	payrollSlipId?: number | null;
	movementKind?: 'payment' | 'withholding' | 'deduction';
	amount: number;
	/** Default 'INR'; must match the target. */
	currency?: string;
	/** YYYY-MM-DD, the cash date; required, never inferred. */
	settledOn: string;
	reference?: string | null;
	destination?: string | null;
	evidenceReference?: string | null;
	/** Optional idempotency key; must look like settle-<uuid>. */
	settlementUid?: string | null;
}

export interface SettlementRecord {
	id: number;
	settlement_uid: string;
	target_kind: 'cost' | 'payroll';
	target_cost_uid: string | null;
	payroll_slip_id: number | null;
	movement_kind: 'payment' | 'withholding' | 'deduction';
	amount: number;
	currency: string;
	settled_on: string;
	reference: string | null;
	destination: string | null;
	evidence_reference: string | null;
	status: 'recorded' | 'cancelled';
	financial_version: number;
	created_by: number | null;
}

export interface SettlementCommandInput {
	/** Either the numeric row id or the settlement_uid. */
	id?: number | null;
	uid?: string | null;
	command: 'update' | 'cancel';
	expectedVersion: number;
	patch?: {
		amount?: number | null;
		currency?: string | null;
		settledOn?: string | null;
		reference?: string | null;
		destination?: string | null;
		evidenceReference?: string | null;
	} | null;
	reason?: string | null;
	evidenceReference?: string | null;
}

export interface SettlementEvent {
	version: number;
	command: 'recorded' | 'updated' | 'cancelled';
	actor_user_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
	created_at: string;
}

/** The guard row the #322 financial close hangs its checks off. */
export interface SettlementGuardRow {
	id: number;
	settlement_uid: string;
	status: 'recorded' | 'cancelled';
	financial_version: number;
	settled_on: string;
}

export interface RegisterRefusal {
	status: number;
	code: string;
	message: string;
	detail?: Record<string, unknown>;
}

const MOVEMENT_KINDS = ['payment', 'withholding', 'deduction'] as const;
const SETTLEMENT_UID_PATTERN = /^settle-[A-Za-z0-9-]{1,64}$/;

function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	if (trimmed.length === 0) return null;
	return trimmed.slice(0, max);
}

function dateOrNull(value: unknown): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
	if (!match) return null;
	const [date] = match;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== date
	) {
		return null;
	}
	return date;
}

function amountOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function mapSettlementRow(row: DbRow): SettlementRecord {
	return {
		id: Number(num(row, 'id') ?? 0),
		settlement_uid: s(row, 'settlement_uid', '') ?? '',
		target_kind: (s(row, 'target_kind', 'cost') ?? 'cost') as
			| 'cost'
			| 'payroll',
		target_cost_uid: s(row, 'target_cost_uid'),
		payroll_slip_id: num(row, 'payroll_slip_id'),
		movement_kind: (s(row, 'movement_kind', 'payment') ?? 'payment') as
			| 'payment'
			| 'withholding'
			| 'deduction',
		amount: num(row, 'amount') ?? 0,
		currency: s(row, 'currency', 'INR') ?? 'INR',
		settled_on: (s(row, 'settled_on') ?? '').slice(0, 10),
		reference: s(row, 'reference'),
		destination: s(row, 'destination'),
		evidence_reference: s(row, 'evidence_reference'),
		status: (s(row, 'status', 'recorded') ?? 'recorded') as
			| 'recorded'
			| 'cancelled',
		financial_version: Number(num(row, 'financial_version') ?? 1),
		created_by: num(row, 'created_by'),
	};
}

interface ResolvedTarget {
	kind: 'cost' | 'payroll';
	costUid: string | null;
	slipId: number | null;
	currency: string;
	label: string | null;
	nature: CostNature | null;
	liability: number | null;
}

/**
 * Resolve the target inside the caller's transaction. An unresolvable
 * identity fails closed: never a new cost, never a silent skip.
 */
async function resolveTarget(
	db: SqlConnection,
	input: { targetKind: 'cost' | 'payroll'; costUid: string; slipId: number }
): Promise<ResolvedTarget | null> {
	if (input.targetKind === 'cost') {
		const reference = await resolveCostReference(db, input.costUid);
		if (!reference) return null;
		return {
			kind: 'cost',
			costUid: reference.cost_uid,
			slipId: null,
			currency: reference.currency ?? 'INR',
			label: reference.label,
			nature: reference.nature ?? null,
			liability: reference.recognized_amount ?? reference.gross_amount,
		};
	}
	const slip = await loadSlip(db, input.slipId);
	if (!slip) return null;
	return {
		kind: 'payroll',
		costUid: null,
		slipId: input.slipId,
		currency: PAYROLL_CURRENCY,
		label: slip.employeeName,
		nature: 'operating',
		liability: slip.employerCost,
	};
}

async function loadSlip(
	db: SqlConnection,
	slipId: number
): Promise<{
	employerCost: number | null;
	netPay: number | null;
	employeeName: string | null;
} | null> {
	const [rows] = (await db.execute(
		`SELECT s.employer_cost, s.net_pay,
            TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name
       FROM payroll_slips s
       LEFT JOIN employees e ON e.id = s.employee_id AND e.isDelete = 0
      WHERE s.id = ?`,
		[slipId]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	const row = rows[0];
	const name = s(row, 'employee_name');
	return {
		employerCost: num(row, 'employer_cost'),
		netPay: num(row, 'net_pay'),
		employeeName: name && name.length > 0 ? name : null,
	};
}

/**
 * Record one dated outward cash movement. Target resolution, the
 * native-movement guard, the insert, the settlement link, and the journal row
 * are one transaction on the caller's connection.
 */
export async function recordSettlement(
	input: SettlementInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<SettlementRecord> {
	const run = async (db: SqlConnection): Promise<SettlementRecord> => {
		const targetKind = input.targetKind;
		if (targetKind !== 'cost' && targetKind !== 'payroll') {
			throw new CostError('invalid_target', 'Unknown settlement target', 422, {
				field: 'target_kind',
			});
		}
		const movementKind =
			input.movementKind === undefined ? 'payment' : input.movementKind;
		if (!MOVEMENT_KINDS.includes(movementKind)) {
			throw new CostError(
				'invalid_movement_kind',
				`Unknown movement kind: ${String(input.movementKind)}`,
				422,
				{ field: 'movement_kind' }
			);
		}
		const amount = amountOrNull(input.amount);
		if (amount === null || amount <= 0) {
			throw new CostError(
				'invalid_amount',
				'A settlement needs a positive amount',
				422,
				{ field: 'amount' }
			);
		}
		const currency = currencyCodeOf(input.currency ?? 'INR') ?? 'INR';
		if (!/^[A-Z]{3}$/.test(currency)) {
			throw new CostError(
				'invalid_currency',
				`Unknown currency: ${String(input.currency)}`,
				422,
				{ field: 'currency' }
			);
		}
		const settledOn = dateOrNull(input.settledOn);
		if (!settledOn) {
			throw new CostError(
				'invalid_date',
				'A settlement needs a real cash date (YYYY-MM-DD); it is never inferred',
				422,
				{ field: 'settled_on' }
			);
		}
		const costUid = text(input.targetCostUid, 64);
		const slipId =
			input.payrollSlipId === null || input.payrollSlipId === undefined
				? null
				: Number(input.payrollSlipId);
		if (targetKind === 'cost' && !costUid) {
			throw new CostError(
				'invalid_target',
				'A cost settlement needs its target cost identity',
				422,
				{ field: 'target_cost_uid' }
			);
		}
		if (
			targetKind === 'payroll' &&
			(slipId === null || !Number.isInteger(slipId) || slipId <= 0)
		) {
			throw new CostError(
				'invalid_target',
				'A payroll settlement needs its slip',
				422,
				{ field: 'payroll_slip_id' }
			);
		}
		const suppliedUid = text(input.settlementUid, 64);
		if (suppliedUid !== null && !SETTLEMENT_UID_PATTERN.test(suppliedUid)) {
			throw new CostError(
				'settlement_uid_required',
				'A supplied settlement_uid must look like settle-<uuid>',
				422,
				{ field: 'settlement_uid' }
			);
		}
		if (suppliedUid !== null) {
			const existing = await loadSettlementByUid(db, suppliedUid);
			if (existing) return existing;
		}

		const target = await resolveTarget(db, {
			targetKind,
			costUid: costUid ?? '',
			slipId: slipId ?? 0,
		});
		if (!target) {
			throw new CostError(
				'unknown_target',
				'The settlement target does not resolve to a known cost or slip',
				422
			);
		}
		if (target.currency !== currency) {
			throw new CostError(
				'currency_mismatch',
				`The settlement is ${currency} but its target is ${target.currency}; cross-currency settlement carries no conversion evidence`,
				422,
				{ target_currency: target.currency }
			);
		}
		if (targetKind === 'payroll' && movementKind === 'payment') {
			throw new CostError(
				'payroll_payout_is_native',
				'Payroll payouts move through the mark-paid control; a manual settlement may only remit a withholding or deduction',
				409
			);
		}
		if (targetKind === 'cost') {
			const [linkRows] = (await db.execute(
				`SELECT source_table FROM financial_cost_links
          WHERE cost_uid = ? AND role = 'cost' LIMIT 1`,
				[target.costUid ?? '']
			)) as [DbRow[], unknown];
			const sourceTable = s(linkRows[0] ?? {}, 'source_table');
			if (sourceTable === 'petty_cash_expenses') {
				throw new CostError(
					'petty_cash_movement_is_native',
					'The petty-cash spend is itself the outward movement; settling it again would count the same money twice',
					409
				);
			}
		}

		const settlementUid = suppliedUid ?? `settle-${randomUUID()}`;
		const reference = text(input.reference, 191);
		const destination = text(input.destination, 255);
		const evidenceReference = text(input.evidenceReference, 500);
		let insertedId: number;
		try {
			const [result] = (await db.execute(
				`INSERT INTO financial_settlements
            (settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
             movement_kind, amount, currency, settled_on, reference, destination,
             evidence_reference, status, financial_version, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', 1, ?)`,
				[
					settlementUid,
					targetKind,
					target.costUid,
					target.slipId,
					movementKind,
					amount,
					currency,
					settledOn,
					reference,
					destination,
					evidenceReference,
					actor.id,
				]
			)) as [{ insertId: number }, unknown];
			insertedId = Number(result.insertId);
		} catch (error) {
			if (isDuplicateKey(error)) {
				const existing = await loadSettlementByUid(db, settlementUid);
				if (existing) return existing;
			}
			throw error;
		}
		await linkCostReference(db, {
			costUid:
				target.kind === 'cost'
					? (target.costUid ?? '')
					: `payroll:${target.slipId}`,
			sourceTable: 'financial_settlements',
			sourceId: insertedId,
			role: 'settlement',
			basis: 'explicit',
			reviewState: 'confirmed',
			evidenceReference: reference,
			createdBy: actor.id,
		});
		await writeSettlementEvent(db, {
			settlementUid,
			sourceId: insertedId,
			version: 1,
			command: 'recorded',
			actorId: actor.id,
			reason: null,
			evidenceReference,
			snapshot: {
				target_kind: targetKind,
				target_cost_uid: target.costUid,
				payroll_slip_id: target.slipId,
				movement_kind: movementKind,
				amount,
				currency,
				settled_on: settledOn,
				reference,
				destination,
				status: 'recorded',
			},
		});
		const created = await loadSettlementByUid(db, settlementUid);
		if (!created) {
			throw new CostError(
				'settlement_not_found',
				'The settlement was recorded but cannot be read back',
				500
			);
		}
		return created;
	};
	if (options?.connection) return run(options.connection);
	return withTransaction((db) => run(db)) as Promise<SettlementRecord>;
}

function isDuplicateKey(error: unknown): boolean {
	const code = (error as { code?: unknown })?.code;
	return (
		code === 'ER_DUP_ENTRY' ||
		code === 1062 ||
		(error instanceof Error && error.message.includes('Duplicate entry'))
	);
}

async function loadSettlementByUid(
	db: SqlConnection,
	settlementUid: string
): Promise<SettlementRecord | null> {
	const [rows] = (await db.execute(
		`SELECT id, settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
            movement_kind, amount, currency, settled_on, reference, destination,
            evidence_reference, status, financial_version, created_by
       FROM financial_settlements
      WHERE settlement_uid = ? AND isDelete = 0`,
		[settlementUid]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	return mapSettlementRow(rows[0]);
}

async function writeSettlementEvent(
	db: SqlConnection,
	entry: {
		settlementUid: string;
		sourceId: number;
		version: number;
		command: 'recorded' | 'updated' | 'cancelled';
		actorId: number | null;
		reason: string | null;
		evidenceReference: string | null;
		snapshot: Record<string, unknown>;
	}
): Promise<void> {
	await db.execute(
		`INSERT INTO financial_settlement_events
        (settlement_uid, source_table, source_id, version, command, actor_user_id,
         reason, evidence_reference, snapshot)
      VALUES (?, 'financial_settlements', ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.settlementUid,
			entry.sourceId,
			entry.version,
			entry.command,
			entry.actorId,
			entry.reason,
			entry.evidenceReference,
			JSON.stringify(entry.snapshot),
		]
	);
}

/**
 * Apply one versioned command to a settlement. State check, version check,
 * update, link maintenance, and journal append are one transaction; a stale
 * or refused command writes nothing.
 */
export async function executeSettlementCommand(
	input: SettlementCommandInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<SettlementRecord> {
	const run = async (db: SqlConnection): Promise<SettlementRecord> => {
		if (input.command !== 'update' && input.command !== 'cancel') {
			throw new CostError(
				'invalid_command',
				`Unknown settlement command: ${String(input.command)}`,
				400
			);
		}
		if (
			input.expectedVersion === null ||
			input.expectedVersion === undefined ||
			!Number.isInteger(input.expectedVersion)
		) {
			throw new CostError(
				'version_required',
				'The command must present the version it read (expected_version)',
				400
			);
		}
		const [rows] = (await db.execute(
			`SELECT id, settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
              movement_kind, amount, currency, settled_on, reference, destination,
              evidence_reference, status, financial_version, created_by
         FROM financial_settlements
        WHERE ${
					input.id !== null && input.id !== undefined
						? 'id = ?'
						: 'settlement_uid = ?'
				} AND isDelete = 0
        FOR UPDATE`,
			[
				input.id !== null && input.id !== undefined
					? Number(input.id)
					: String(input.uid ?? ''),
			]
		)) as [DbRow[], unknown];
		if (rows.length === 0) {
			throw new CostError(
				'settlement_not_found',
				'The settlement does not exist',
				404
			);
		}
		const current = mapSettlementRow(rows[0]);
		if (current.status === 'cancelled') {
			throw new CostError(
				'settlement_cancelled',
				'A cancelled settlement keeps its history; record a new movement instead of rewriting it',
				409
			);
		}
		if (current.financial_version !== input.expectedVersion) {
			throw new CostError(
				'stale_version',
				`This settlement changed since it was read (current version ${current.financial_version})`,
				409,
				{ current_version: current.financial_version }
			);
		}
		const nextVersion = current.financial_version + 1;
		if (input.command === 'cancel') {
			await db.execute(
				`UPDATE financial_settlements
            SET status = 'cancelled', financial_version = ?
          WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
				[nextVersion, current.id, current.financial_version]
			);
			await db.execute(
				`UPDATE financial_cost_links
            SET review_state = 'rejected'
          WHERE source_table = 'financial_settlements' AND source_id = ?
            AND role = 'settlement'`,
				[String(current.id)]
			);
			await writeSettlementEvent(db, {
				settlementUid: current.settlement_uid,
				sourceId: current.id,
				version: nextVersion,
				command: 'cancelled',
				actorId: actor.id,
				reason: text(input.reason, 500),
				evidenceReference: text(input.evidenceReference, 500),
				snapshot: { ...current, status: 'cancelled' },
			});
		} else {
			const patch = input.patch ?? {};
			const amount =
				patch.amount === null || patch.amount === undefined
					? current.amount
					: amountOrNull(patch.amount);
			if (amount === null || amount <= 0) {
				throw new CostError(
					'invalid_amount',
					'A settlement needs a positive amount',
					422,
					{ field: 'amount' }
				);
			}
			const currency =
				patch.currency === null || patch.currency === undefined
					? current.currency
					: (currencyCodeOf(patch.currency) ?? '');
			if (!/^[A-Z]{3}$/.test(currency)) {
				throw new CostError(
					'invalid_currency',
					`Unknown currency: ${String(patch.currency)}`,
					422,
					{ field: 'currency' }
				);
			}
			const settledOn =
				patch.settledOn === null || patch.settledOn === undefined
					? current.settled_on
					: dateOrNull(patch.settledOn);
			if (!settledOn) {
				throw new CostError(
					'invalid_date',
					'A settlement needs a real cash date (YYYY-MM-DD); it is never inferred',
					422,
					{ field: 'settled_on' }
				);
			}
			const target = await resolveTarget(db, {
				targetKind: current.target_kind,
				costUid: current.target_cost_uid ?? '',
				slipId: current.payroll_slip_id ?? 0,
			});
			if (!target) {
				throw new CostError(
					'unknown_target',
					'The settlement target no longer resolves to a known cost or slip',
					422
				);
			}
			if (target.currency !== currency) {
				throw new CostError(
					'currency_mismatch',
					`The settlement is ${currency} but its target is ${target.currency}; cross-currency settlement carries no conversion evidence`,
					422,
					{ target_currency: target.currency }
				);
			}
			const reference =
				patch.reference === undefined
					? current.reference
					: text(patch.reference, 191);
			const destination =
				patch.destination === undefined
					? current.destination
					: text(patch.destination, 255);
			const evidenceReference =
				patch.evidenceReference === undefined
					? current.evidence_reference
					: text(patch.evidenceReference, 500);
			await db.execute(
				`UPDATE financial_settlements
            SET amount = ?, currency = ?, settled_on = ?, reference = ?,
                destination = ?, evidence_reference = ?, financial_version = ?
          WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
				[
					amount,
					currency,
					settledOn,
					reference,
					destination,
					evidenceReference,
					nextVersion,
					current.id,
					current.financial_version,
				]
			);
			await writeSettlementEvent(db, {
				settlementUid: current.settlement_uid,
				sourceId: current.id,
				version: nextVersion,
				command: 'updated',
				actorId: actor.id,
				reason: text(input.reason, 500),
				evidenceReference: text(input.evidenceReference, 500),
				snapshot: {
					...current,
					amount,
					currency,
					settled_on: settledOn,
					reference,
					destination,
					evidence_reference: evidenceReference,
				},
			});
		}
		const updated = await loadSettlementByUid(db, current.settlement_uid);
		if (!updated) {
			throw new CostError(
				'settlement_not_found',
				'The settlement was updated but cannot be read back',
				500
			);
		}
		return updated;
	};
	if (options?.connection) return run(options.connection);
	return withTransaction((db) => run(db)) as Promise<SettlementRecord>;
}

/** The versioned history of one settlement, oldest first. */
export async function loadSettlementEvents(
	db: SqlConnection,
	settlementUid: string
): Promise<SettlementEvent[]> {
	const [rows] = (await db.execute(
		`SELECT version, command, actor_user_id, reason, evidence_reference, created_at
       FROM financial_settlement_events
      WHERE settlement_uid = ?
      ORDER BY version ASC`,
		[settlementUid]
	)) as [DbRow[], unknown];
	return rows.map((row) => ({
		version: Number(num(row, 'version') ?? 0),
		command: (s(row, 'command', 'recorded') ?? 'recorded') as
			| 'recorded'
			| 'updated'
			| 'cancelled',
		actor_user_id: num(row, 'actor_user_id'),
		reason: s(row, 'reason'),
		evidence_reference: s(row, 'evidence_reference'),
		created_at: String(s(row, 'created_at') ?? ''),
	}));
}

/** Read the guard row with a row lock inside the caller's transaction. */
export async function loadSettlementGuardRow(
	db: SqlConnection,
	id: number
): Promise<SettlementGuardRow | null> {
	const [rows] = (await db.execute(
		`SELECT id, settlement_uid, status, financial_version, settled_on
       FROM financial_settlements
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	const row = rows[0];
	return {
		id: Number(num(row, 'id') ?? 0),
		settlement_uid: s(row, 'settlement_uid', '') ?? '',
		status: (s(row, 'status', 'recorded') ?? 'recorded') as
			| 'recorded'
			| 'cancelled',
		financial_version: Number(num(row, 'financial_version') ?? 1),
		settled_on: (s(row, 'settled_on') ?? '').slice(0, 10),
	};
}

/**
 * Whether an ordinary register edit or delete may touch this settlement. A
 * cancelled settlement keeps its history: the versioned command path (or a
 * new movement) is the way to move its money, never an edit or a delete.
 * Exported so the #322 close and the #323 revision slice hang their
 * closed-period checks off the same hook; closed-period rules themselves
 * belong to #322.
 */
export function settlementRegisterRefusal(
	row: SettlementGuardRow,
	operation: 'update' | 'delete'
): RegisterRefusal | null {
	if (row.status === 'cancelled') {
		return {
			status: 409,
			code: 'settlement_cancelled',
			message:
				'A cancelled settlement keeps its history. Record a new movement instead of changing or removing it.',
		};
	}
	if (operation === 'delete') {
		return {
			status: 409,
			code: 'settlement_history_preserved',
			message:
				'A recorded settlement keeps its financial history. Reverse it through the versioned cancel command instead of deleting the row.',
		};
	}
	return null;
}

/** One cost the record-settlement target picker can offer. */
export interface SettlementCandidateCost {
	cost_uid: string;
	label: string | null;
	currency: string | null;
	recognized_amount: number | null;
	recognition_period: string | null;
	nature: CostNature | null;
	source: string;
	/** All-time recorded settlements; null when the target was never settled. */
	settled: number | null;
	remaining: number | null;
}

/** One payroll slip the target picker can offer. */
export interface SettlementCandidateSlip {
	slip_id: number;
	employee_name: string | null;
	month: string;
	employer_cost: number | null;
	net_pay: number | null;
	payment_status: string;
	payment_date: string | null;
	settled: number | null;
	remaining: number | null;
}

/**
 * The record-settlement target picker: the month's recognized costs and
 * payroll slips, plus every older target that still carries an outstanding
 * balance. Refused targets (petty-cash spends, which are their own movement)
 * are never offered.
 */
export async function loadSettlementCandidates(
	db: SqlConnection,
	month: string
): Promise<{
	costs: SettlementCandidateCost[];
	slips: SettlementCandidateSlip[];
}> {
	const bounds = monthBounds(month);
	const window: Array<string | number | null> = [bounds.start, bounds.end];
	const costQueries: Array<{ sql: string; source: string }> = [
		{
			source: 'expenses',
			sql: `SELECT cost_uid, expense_number AS label, currency, recognized_amount,
                recognition_period, cost_nature AS nature
           FROM expenses
          WHERE isDelete = 0 AND recognition_state = 'recognized'
            AND recognition_period BETWEEN ? AND ?`,
		},
		{
			source: 'purchase_invoices',
			sql: `SELECT cost_uid, invoice_number AS label, currency, recognized_amount,
                recognition_period, 'operating' AS nature
           FROM purchase_invoices
          WHERE isDelete = 0 AND recognition_state = 'recognized'
            AND recognition_period BETWEEN ? AND ?`,
		},
		{
			source: 'other_expenses',
			sql: `SELECT cost_uid, voucher_number AS label, currency, recognized_amount,
                recognition_period, 'operating' AS nature
           FROM other_expenses
          WHERE isDelete = 0 AND recognition_state = 'recognized'
            AND recognition_period BETWEEN ? AND ?`,
		},
		{
			source: 'cost_accruals',
			sql: `SELECT cost_uid, accrual_number AS label, currency, recognized_amount,
                recognition_period, 'operating' AS nature
           FROM cost_accruals
          WHERE isDelete = 0 AND recognition_state = 'recognized'
            AND recognition_period BETWEEN ? AND ?`,
		},
	];
	const costs = new Map<string, SettlementCandidateCost>();
	for (const entry of costQueries) {
		const [rows] = (await db.execute(entry.sql, window)) as [DbRow[], unknown];
		for (const row of rows) {
			const uid = s(row, 'cost_uid');
			if (!uid || costs.has(uid)) continue;
			const recognized = num(row, 'recognized_amount');
			costs.set(uid, {
				cost_uid: uid,
				label: s(row, 'label'),
				currency: s(row, 'currency'),
				recognized_amount: recognized,
				recognition_period: s(row, 'recognition_period'),
				nature: (s(row, 'nature') as CostNature | null) ?? 'operating',
				source: entry.source,
				settled: null,
				remaining: recognized,
			});
		}
	}
	const [settledRows] = (await db.execute(
		`SELECT target_cost_uid, COALESCE(SUM(amount), 0) AS settled
       FROM financial_settlements
      WHERE isDelete = 0 AND status = 'recorded' AND target_kind = 'cost'
        AND target_cost_uid IS NOT NULL
      GROUP BY target_cost_uid`
	)) as [DbRow[], unknown];
	for (const row of settledRows) {
		const uid = s(row, 'target_cost_uid');
		if (!uid) continue;
		const settled = toNumber(R(num(row, 'settled') ?? 0));
		const existing = costs.get(uid);
		if (existing) {
			existing.settled = settled;
			existing.remaining =
				existing.recognized_amount === null
					? null
					: toNumber(sub(existing.recognized_amount, settled));
			continue;
		}
		const reference = await resolveCostReference(db, uid);
		if (!reference) continue;
		const liability = reference.recognized_amount ?? reference.gross_amount;
		costs.set(uid, {
			cost_uid: uid,
			label: reference.label,
			currency: reference.currency,
			recognized_amount: liability,
			recognition_period: null,
			nature: reference.nature ?? null,
			source: reference.source_table,
			settled,
			remaining: liability === null ? null : toNumber(sub(liability, settled)),
		});
	}

	const [slipRows] = (await db.execute(
		`SELECT s.id, s.month, s.employer_cost, s.net_pay, s.payment_status, s.payment_date,
            TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name
       FROM payroll_slips s
       LEFT JOIN employees e ON e.id = s.employee_id AND e.isDelete = 0
      WHERE s.month = ?`,
		[`${month}-01`]
	)) as [DbRow[], unknown];
	const slips = new Map<number, SettlementCandidateSlip>();
	for (const row of slipRows) {
		const id = Number(num(row, 'id') ?? 0);
		if (!id || slips.has(id)) continue;
		const employer = num(row, 'employer_cost');
		slips.set(id, {
			slip_id: id,
			employee_name: s(row, 'employee_name') || null,
			month,
			employer_cost: employer,
			net_pay: num(row, 'net_pay'),
			payment_status: s(row, 'payment_status', 'pending') ?? 'pending',
			payment_date: s(row, 'payment_date'),
			settled: null,
			remaining: employer,
		});
	}
	const [slipSettled] = (await db.execute(
		`SELECT payroll_slip_id, COALESCE(SUM(amount), 0) AS settled
       FROM financial_settlements
      WHERE isDelete = 0 AND status = 'recorded' AND target_kind = 'payroll'
        AND payroll_slip_id IS NOT NULL
      GROUP BY payroll_slip_id`
	)) as [DbRow[], unknown];
	for (const row of slipSettled) {
		const id = Number(num(row, 'payroll_slip_id') ?? 0);
		if (!id) continue;
		const settled = toNumber(R(num(row, 'settled') ?? 0));
		const existing = slips.get(id);
		if (existing) {
			existing.settled = settled;
			existing.remaining =
				existing.employer_cost === null
					? null
					: toNumber(sub(existing.employer_cost, settled));
			continue;
		}
		const slip = await loadSlip(db, id);
		if (!slip) continue;
		slips.set(id, {
			slip_id: id,
			employee_name: slip.employeeName,
			month: '',
			employer_cost: slip.employerCost,
			net_pay: slip.netPay,
			payment_status: '',
			payment_date: null,
			settled,
			remaining:
				slip.employerCost === null
					? null
					: toNumber(sub(slip.employerCost, settled)),
		});
	}
	return { costs: [...costs.values()], slips: [...slips.values()] };
}

interface SlipPayout {
	slipId: number;
	employeeName: string | null;
	netPay: number;
	currency: string;
	paidOn: string;
	reference: string | null;
}

async function loadPayouts(
	db: SqlConnection,
	start: string,
	end: string
): Promise<SlipPayout[]> {
	const [rows] = (await db.execute(
		`SELECT s.id, s.net_pay, s.payment_date, s.payment_reference,
            TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name
       FROM payroll_slips s
       LEFT JOIN employees e ON e.id = s.employee_id AND e.isDelete = 0
      WHERE s.payment_status = 'paid' AND s.payment_date BETWEEN ? AND ?`,
		[start, end]
	)) as [DbRow[], unknown];
	const payouts: SlipPayout[] = [];
	for (const row of rows) {
		const netPay = num(row, 'net_pay');
		const paidOn = s(row, 'payment_date');
		if (netPay === null || !paidOn) continue;
		const name = s(row, 'employee_name');
		payouts.push({
			slipId: Number(num(row, 'id') ?? 0),
			employeeName: name && name.length > 0 ? name : null,
			netPay,
			currency: PAYROLL_CURRENCY,
			paidOn: paidOn.slice(0, 10),
			reference: s(row, 'payment_reference'),
		});
	}
	return payouts;
}

interface PettySpend {
	rowId: string;
	costUid: string | null;
	label: string | null;
	debit: number;
	currency: string | null;
	spentOn: string;
	destination: string | null;
	linkedCostUid: string | null;
}

async function loadSpends(
	db: SqlConnection,
	start: string,
	end: string
): Promise<PettySpend[]> {
	const [rows] = (await db.execute(
		`SELECT id, cost_uid, transaction_number, transaction_date, debit_amount,
            currency, recipient_name, linked_cost_uid
       FROM petty_cash_expenses
      WHERE isDelete = 0 AND entry_kind = 'spend'
        AND recognition_state <> 'cancelled'
        AND transaction_date BETWEEN ? AND ?`,
		[start, end]
	)) as [DbRow[], unknown];
	const spends: PettySpend[] = [];
	for (const row of rows) {
		const debit = num(row, 'debit_amount');
		const spentOn = s(row, 'transaction_date');
		if (debit === null || !spentOn) continue;
		spends.push({
			rowId: String(s(row, 'id') ?? ''),
			costUid: s(row, 'cost_uid'),
			label: s(row, 'transaction_number'),
			debit,
			currency: s(row, 'currency'),
			spentOn: spentOn.slice(0, 10),
			destination: s(row, 'recipient_name'),
			linkedCostUid: s(row, 'linked_cost_uid'),
		});
	}
	return spends;
}

interface FundingRow {
	voucherId: number | null;
	rowId: string;
	credit: number;
	currency: string | null;
	fundedOn: string;
	voucherNumber: string | null;
}

async function loadFunding(
	db: SqlConnection,
	start: string,
	end: string
): Promise<FundingRow[]> {
	const [rows] = (await db.execute(
		`SELECT p.id, p.credit_amount, p.currency, p.transaction_date,
            p.source_voucher_id, v.voucher_number
       FROM petty_cash_expenses p
       LEFT JOIN cash_vouchers v
         ON v.id = p.source_voucher_id AND (v.isDelete IS NULL OR v.isDelete = 0)
      WHERE p.isDelete = 0 AND p.entry_kind = 'funding'
        AND p.transaction_date BETWEEN ? AND ?`,
		[start, end]
	)) as [DbRow[], unknown];
	const funding: FundingRow[] = [];
	for (const row of rows) {
		const credit = num(row, 'credit_amount');
		const fundedOn = s(row, 'transaction_date');
		if (credit === null || !fundedOn) continue;
		funding.push({
			voucherId: num(row, 'source_voucher_id'),
			rowId: String(s(row, 'id') ?? ''),
			credit,
			currency: s(row, 'currency'),
			fundedOn: fundedOn.slice(0, 10),
			voucherNumber: s(row, 'voucher_number'),
		});
	}
	return funding;
}

/** One money bucket: legacy rows state as-recorded sums, no currency asserted. */
async function sumLegacy(
	db: SqlConnection,
	sql: string,
	params: Array<string | number | null>
): Promise<{ count: number; amount: number | null }> {
	const [rows] = (await db.execute(sql, params)) as [DbRow[], unknown];
	const row = rows[0] ?? {};
	const count = Number(num(row, 'count') ?? 0);
	const amount = num(row, 'amount');
	return { count, amount };
}

/** Months with recorded outward settlements, newest first. */
export async function loadSettlementMonths(
	db: SqlConnection
): Promise<string[]> {
	const [rows] = (await db.execute(
		`SELECT DISTINCT DATE_FORMAT(settled_on, '%Y-%m') AS month
       FROM financial_settlements
      WHERE isDelete = 0 AND status = 'recorded' AND settled_on IS NOT NULL
      ORDER BY month DESC`
	)) as [DbRow[], unknown];
	const months: string[] = [];
	for (const row of rows) {
		const month = s(row, 'month');
		if (month) months.push(month);
	}
	return months;
}

/**
 * Read one month's outward cash section on the caller's connection: every
 * dated supported movement, the funding set apart, per-target cover, and the
 * legacy disclosures. Pure read: nothing here writes.
 */
export async function loadCashSection(
	db: SqlConnection,
	month: string
): Promise<CashSection> {
	const bounds = monthBounds(month);
	const [settlementRows] = (await db.execute(
		`SELECT id, settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
            movement_kind, amount, currency, settled_on, reference, destination,
            evidence_reference, status, financial_version, created_by
       FROM financial_settlements
      WHERE isDelete = 0 AND status = 'recorded'
        AND settled_on BETWEEN ? AND ?
      ORDER BY settled_on ASC, id ASC`,
		[bounds.start, bounds.end]
	)) as [DbRow[], unknown];
	const [payouts, spends, funding] = await Promise.all([
		loadPayouts(db, bounds.start, bounds.end),
		loadSpends(db, bounds.start, bounds.end),
		loadFunding(db, bounds.start, bounds.end),
	]);

	const movements = new Map<string, CashMovementJson>();
	const remember = (movement: CashMovementJson): void => {
		if (!movements.has(movement.movement_uid)) {
			movements.set(movement.movement_uid, movement);
		}
	};
	for (const row of settlementRows) {
		const record = mapSettlementRow(row);
		const uid = `settle:${record.settlement_uid}`;
		const targetKey =
			record.target_kind === 'cost'
				? (record.target_cost_uid ?? uid)
				: String(record.payroll_slip_id ?? uid);
		let label: string | null = null;
		let nature: CostNature | null = null;
		if (record.target_kind === 'cost' && record.target_cost_uid) {
			const reference = await resolveCostReference(db, record.target_cost_uid);
			if (reference) {
				label = reference.label;
				nature = reference.nature ?? null;
			}
		} else if (record.target_kind === 'payroll' && record.payroll_slip_id) {
			const slip = await loadSlip(db, record.payroll_slip_id);
			if (slip) {
				label = slip.employeeName;
				nature = 'operating';
			}
		}
		remember({
			source: 'settlement',
			movement_kind: record.movement_kind,
			movement_uid: uid,
			settlement_uid: record.settlement_uid,
			settlement_id: record.id,
			target_kind: record.target_kind,
			target_key: targetKey,
			target_label: label,
			target_nature: nature,
			amount: record.amount,
			currency: record.currency,
			settled_on: record.settled_on,
			reference: record.reference,
			destination: record.destination,
			evidence_reference: record.evidence_reference,
			actor_user_id: record.created_by,
			financial_version: record.financial_version,
		});
	}
	for (const payout of payouts) {
		remember({
			source: 'payroll',
			movement_kind: 'payroll_payout',
			movement_uid: `payroll:${payout.slipId}`,
			settlement_uid: null,
			settlement_id: null,
			target_kind: 'payroll',
			target_key: String(payout.slipId),
			target_label: payout.employeeName,
			target_nature: 'operating',
			amount: payout.netPay,
			currency: payout.currency,
			settled_on: payout.paidOn,
			reference: payout.reference,
			destination: payout.employeeName,
			evidence_reference: null,
			actor_user_id: null,
			financial_version: null,
		});
	}
	for (const spend of spends) {
		const linked = spend.linkedCostUid;
		let targetKey = `petty:${spend.rowId}`;
		let targetKind: 'cost' | 'none' = 'none';
		let label: string | null = spend.label;
		if (linked) {
			const reference = await resolveCostReference(db, linked);
			if (reference) {
				targetKey = reference.cost_uid;
				targetKind = 'cost';
				label = reference.label ?? spend.label;
			}
		}
		remember({
			source: 'petty_cash',
			movement_kind: 'petty_spend',
			movement_uid: `petty:${spend.rowId}`,
			settlement_uid: null,
			settlement_id: null,
			target_kind: targetKind,
			target_key: targetKey,
			target_label: label,
			target_nature: 'operating',
			amount: spend.debit,
			currency: spend.currency,
			settled_on: spend.spentOn,
			reference: spend.label,
			destination: spend.destination,
			evidence_reference: null,
			actor_user_id: null,
			financial_version: null,
		});
	}

	const inMonth = [...movements.values()];
	const byCurrency = new Map<
		string,
		{
			paid: number;
			count: number;
			settlement: number;
			payroll: number;
			petty: number;
		}
	>();
	for (const movement of inMonth) {
		if (!movement.currency) continue;
		const bucket = byCurrency.get(movement.currency) ?? {
			paid: 0,
			count: 0,
			settlement: 0,
			payroll: 0,
			petty: 0,
		};
		bucket.paid = toNumber(add(bucket.paid, movement.amount));
		bucket.count += 1;
		if (movement.source === 'settlement') {
			bucket.settlement = toNumber(add(bucket.settlement, movement.amount));
		} else if (movement.source === 'payroll') {
			bucket.payroll = toNumber(add(bucket.payroll, movement.amount));
		} else if (movement.source === 'petty_cash') {
			bucket.petty = toNumber(add(bucket.petty, movement.amount));
		}
		byCurrency.set(movement.currency, bucket);
	}

	const { targets, unresolved } = await buildCashTargets(db, month, inMonth);

	let settledTargets = 0;
	let partialTargets = 0;
	let unsettledTargets = 0;
	const remainingByCurrency = new Map<string, number>();
	let remainingComplete = true;
	for (const target of targets) {
		if (target.state === 'settled') settledTargets += 1;
		else if (target.state === 'partial' || target.state === 'over_settled') {
			partialTargets += 1;
		} else unsettledTargets += 1;
		if (target.remaining === null || target.currency === null) {
			if (target.remaining !== null && target.remaining !== 0) {
				remainingComplete = false;
			}
			continue;
		}
		remainingByCurrency.set(
			target.currency,
			toNumber(
				add(remainingByCurrency.get(target.currency) ?? 0, target.remaining)
			)
		);
	}
	const outstanding =
		remainingComplete && remainingByCurrency.size === 1
			? [...remainingByCurrency.values()][0]
			: null;

	const [undated, unlinked, entries, receivables, invoices, transfers] =
		await Promise.all([
			sumLegacy(
				db,
				`SELECT COUNT(*) AS count, COALESCE(SUM(paid_amount), 0) AS amount
           FROM payment_payables
          WHERE isDelete = 0 AND paid_amount > 0 AND paid_date IS NULL`,
				[]
			),
			sumLegacy(
				db,
				`SELECT COUNT(*) AS count, COALESCE(SUM(net_amount), 0) AS amount
           FROM payment_issues
          WHERE isDelete = 0 AND issue_date BETWEEN ? AND ?`,
				[bounds.start, bounds.end]
			),
			sumLegacy(
				db,
				`SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
           FROM payment_entries
          WHERE isDelete = 0
            AND (receipt_date BETWEEN ? AND ?
              OR (receipt_date IS NULL AND payment_date BETWEEN ? AND ?))`,
				[bounds.start, bounds.end, bounds.start, bounds.end]
			),
			sumLegacy(
				db,
				`SELECT COUNT(*) AS count, COALESCE(SUM(paid_amount), 0) AS amount
           FROM payment_receivables
          WHERE isDelete = 0 AND received_date BETWEEN ? AND ?`,
				[bounds.start, bounds.end]
			),
			sumLegacy(
				db,
				`SELECT COUNT(*) AS count, COALESCE(SUM(amount_paid), 0) AS amount
           FROM invoices
          WHERE isDelete = 0 AND amount_paid > 0 AND invoice_date BETWEEN ? AND ?`,
				[bounds.start, bounds.end]
			),
			sumLegacy(
				db,
				`SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
           FROM account_transactions
          WHERE type = 'transfer' AND transaction_date BETWEEN ? AND ?`,
				[bounds.start, bounds.end]
			),
		]);
	const clientReceipts = {
		count: entries.count + receivables.count + invoices.count,
		amount:
			entries.amount === null ||
			receivables.amount === null ||
			invoices.amount === null
				? null
				: toNumber(
						add(add(entries.amount, receivables.amount), invoices.amount)
					),
	};

	const fundingMovements: CashMovementJson[] = [];
	const fundingByVoucher = new Map<
		string,
		{
			amount: number;
			currency: string | null;
			fundedOn: string;
			voucherNumber: string | null;
		}
	>();
	let unlinkedVouchers = 0;
	for (const row of funding) {
		if (row.voucherId === null) {
			fundingMovements.push({
				source: 'funding',
				movement_kind: 'payment',
				movement_uid: `fund:manual:${row.rowId}`,
				settlement_uid: null,
				settlement_id: null,
				target_kind: 'none',
				target_key: `fund:manual:${row.rowId}`,
				target_label: row.voucherNumber,
				target_nature: null,
				amount: row.credit,
				currency: row.currency,
				settled_on: row.fundedOn,
				reference: row.voucherNumber,
				destination: null,
				evidence_reference: null,
				actor_user_id: null,
				financial_version: null,
			});
			continue;
		}
		if (row.voucherNumber === null) unlinkedVouchers += 1;
		const key = `fund:${row.voucherId}`;
		const bucket = fundingByVoucher.get(key) ?? {
			amount: 0,
			currency: row.currency,
			fundedOn: row.fundedOn,
			voucherNumber: row.voucherNumber,
		};
		bucket.amount = toNumber(add(bucket.amount, row.credit));
		fundingByVoucher.set(key, bucket);
	}
	for (const [uid, bucket] of fundingByVoucher) {
		fundingMovements.push({
			source: 'funding',
			movement_kind: 'payment',
			movement_uid: uid,
			settlement_uid: null,
			settlement_id: null,
			target_kind: 'none',
			target_key: uid,
			target_label: bucket.voucherNumber,
			target_nature: null,
			amount: bucket.amount,
			currency: bucket.currency,
			settled_on: bucket.fundedOn,
			reference: bucket.voucherNumber,
			destination: null,
			evidence_reference: null,
			actor_user_id: null,
			financial_version: null,
		});
	}
	const fundingKnown = new Map<string, { amount: number; count: number }>();
	for (const movement of fundingMovements) {
		if (!movement.currency) continue;
		const bucket = fundingKnown.get(movement.currency) ?? {
			amount: 0,
			count: 0,
		};
		bucket.amount = toNumber(add(bucket.amount, movement.amount));
		bucket.count += 1;
		fundingKnown.set(movement.currency, bucket);
	}

	const currencies = [...byCurrency.keys()].sort();
	// No dated movement in the month is a known zero, not an unknown: every
	// source was read and stated nothing. Null is reserved for months whose
	// movements cannot be stated together (mixed or unknown currencies).
	let paid: number | null;
	if (currencies.length === 1) {
		paid = byCurrency.get(currencies[0])?.paid ?? 0;
	} else if (inMonth.length === 0) {
		paid = 0;
	} else {
		paid = null;
	}
	return {
		month,
		currency: currencies.length === 1 ? currencies[0] : null,
		paid,
		by_currency: currencies.map((currency) => {
			const bucket = byCurrency.get(currency) ?? {
				paid: 0,
				count: 0,
				settlement: 0,
				payroll: 0,
				petty: 0,
			};
			return {
				currency,
				paid: bucket.paid,
				movement_count: bucket.count,
				settlement: bucket.settlement,
				payroll: bucket.payroll,
				petty_spend: bucket.petty,
			};
		}),
		funding: {
			by_currency: [...fundingKnown.entries()]
				.map(([currency, bucket]) => ({
					currency,
					amount: bucket.amount,
					movement_count: bucket.count,
				}))
				.sort((left, right) => left.currency.localeCompare(right.currency)),
			movements: fundingMovements.sort((left, right) =>
				left.settled_on < right.settled_on ? -1 : 1
			),
			unlinked_vouchers: { count: unlinkedVouchers },
		},
		targets,
		coverage: {
			settled_targets: settledTargets,
			partial_targets: partialTargets,
			unsettled_targets: unsettledTargets,
			outstanding,
		},
		unresolved_targets: unresolved,
		legacy: {
			outward_unlinked: unlinked,
			undated_balances: undated,
			client_receipts: clientReceipts,
			internal_transfers: transfers,
		},
	};
}

async function buildCashTargets(
	db: SqlConnection,
	month: string,
	inMonth: CashMovementJson[]
): Promise<{
	targets: CashSection['targets'];
	unresolved: CashSection['unresolved_targets'];
}> {
	const bounds = monthBounds(month);
	interface TargetAcc {
		kind: 'cost' | 'payroll';
		key: string;
		label: string | null;
		nature: CostNature | null;
		currency: string | null;
		liability: number | null;
		settledAll: number;
		settledMonth: number;
		movements: CashMovementJson[];
	}
	const acc = new Map<string, TargetAcc>();
	const ensureCost = async (costUid: string): Promise<TargetAcc | null> => {
		const key = `cost:${costUid}`;
		const existing = acc.get(key);
		if (existing) return existing;
		const reference = await resolveCostReference(db, costUid);
		if (!reference) return null;
		const liability = reference.recognized_amount ?? reference.gross_amount;
		const entry: TargetAcc = {
			kind: 'cost',
			key: costUid,
			label: reference.label,
			nature: reference.nature ?? null,
			currency: reference.currency,
			liability,
			settledAll: 0,
			settledMonth: 0,
			movements: [],
		};
		acc.set(key, entry);
		return entry;
	};
	const ensureSlip = async (slipId: number): Promise<TargetAcc | null> => {
		const key = `payroll:${slipId}`;
		const existing = acc.get(key);
		if (existing) return existing;
		const slip = await loadSlip(db, slipId);
		if (!slip) return null;
		const entry: TargetAcc = {
			kind: 'payroll',
			key: String(slipId),
			label: slip.employeeName,
			nature: 'operating',
			currency: PAYROLL_CURRENCY,
			liability: slip.employerCost,
			settledAll: 0,
			settledMonth: 0,
			movements: [],
		};
		acc.set(key, entry);
		return entry;
	};

	let unresolvedCount = 0;
	const unresolvedCurrencies = new Set<string>();
	let unresolvedAmount = 0;
	const noteUnresolved = (movement: CashMovementJson): void => {
		unresolvedCount += 1;
		if (movement.currency) {
			unresolvedCurrencies.add(movement.currency);
			unresolvedAmount = toNumber(add(unresolvedAmount, movement.amount));
		}
	};

	for (const movement of inMonth) {
		let entry: TargetAcc | null = null;
		if (movement.target_kind === 'cost') {
			entry = await ensureCost(movement.target_key);
		} else if (movement.target_kind === 'payroll') {
			entry = await ensureSlip(Number(movement.target_key));
		} else {
			entry = {
				kind: 'cost',
				key: movement.target_key,
				label: movement.target_label,
				nature: movement.target_nature,
				currency: movement.currency,
				liability: null,
				settledAll: 0,
				settledMonth: 0,
				movements: [],
			};
			acc.set(`own:${movement.target_key}`, entry);
		}
		if (!entry) {
			noteUnresolved(movement);
			continue;
		}
		entry.movements.push(movement);
		if (movement.target_label && !entry.label)
			entry.label = movement.target_label;
		// A movement that is its own purpose (an unlinked petty spend) is
		// the target's entire cover: no settlement or payout sum will ever
		// name it, so its amount settles the target here.
		if (movement.target_kind === 'none') {
			entry.settledAll = toNumber(add(entry.settledAll, movement.amount));
		}
	}

	const [costSettled, slipSettled, payoutSettled] = await Promise.all([
		db.execute(
			`SELECT target_cost_uid, COALESCE(SUM(amount), 0) AS settled
         FROM financial_settlements
        WHERE isDelete = 0 AND status = 'recorded' AND target_kind = 'cost'
          AND target_cost_uid IS NOT NULL
        GROUP BY target_cost_uid`
		),
		db.execute(
			`SELECT payroll_slip_id, COALESCE(SUM(amount), 0) AS settled
         FROM financial_settlements
        WHERE isDelete = 0 AND status = 'recorded' AND target_kind = 'payroll'
          AND payroll_slip_id IS NOT NULL
        GROUP BY payroll_slip_id`
		),
		db.execute(
			`SELECT id, net_pay FROM payroll_slips
        WHERE payment_status = 'paid' AND payment_date IS NOT NULL`
		),
	]);
	const costSettledRows = (costSettled as [DbRow[], unknown])[0];
	for (const row of costSettledRows) {
		const uid = s(row, 'target_cost_uid');
		if (!uid) continue;
		const entry = await ensureCost(uid);
		if (!entry) continue;
		entry.settledAll = toNumber(
			add(entry.settledAll, num(row, 'settled') ?? 0)
		);
	}
	const slipSettledRows = (slipSettled as [DbRow[], unknown])[0];
	for (const row of slipSettledRows) {
		const id = Number(num(row, 'payroll_slip_id') ?? 0);
		if (!id) continue;
		const entry = await ensureSlip(id);
		if (!entry) continue;
		entry.settledAll = toNumber(
			add(entry.settledAll, num(row, 'settled') ?? 0)
		);
	}
	const payoutRows = (payoutSettled as [DbRow[], unknown])[0];
	for (const row of payoutRows) {
		const id = Number(num(row, 'id') ?? 0);
		const netPay = num(row, 'net_pay');
		if (!id || netPay === null) continue;
		const entry = await ensureSlip(id);
		if (!entry) continue;
		entry.settledAll = toNumber(add(entry.settledAll, netPay));
	}

	for (const entry of acc.values()) {
		let monthSum = 0;
		for (const movement of entry.movements) {
			monthSum = toNumber(add(monthSum, movement.amount));
		}
		entry.settledMonth = monthSum;
	}

	await includeMonthCosts(db, bounds.start, bounds.end, ensureCost);
	await includeMonthSlips(db, month, ensureSlip);

	const targets: CashSection['targets'] = [];
	for (const entry of acc.values()) {
		const remaining =
			entry.liability === null
				? null
				: toNumber(sub(entry.liability, entry.settledAll));
		let state: CashTargetJson['state'];
		if (entry.liability === null) {
			state = entry.settledAll === 0 ? 'unsettled' : 'partial';
		} else if (entry.settledAll === 0) {
			state = 'unsettled';
		} else if (
			gte(entry.liability, entry.settledAll) &&
			gte(entry.settledAll, entry.liability)
		) {
			state = 'settled';
		} else if (gte(entry.settledAll, entry.liability)) {
			state = 'over_settled';
		} else {
			state = 'partial';
		}
		targets.push({
			target_kind: entry.kind,
			target_key: entry.key,
			label: entry.label,
			nature: entry.nature,
			currency: entry.currency,
			liability: entry.liability,
			settled: entry.settledAll,
			settled_this_month: entry.settledMonth,
			remaining,
			state,
			movements: entry.movements,
		});
	}
	targets.sort((left, right) =>
		left.target_key < right.target_key
			? -1
			: left.target_key > right.target_key
				? 1
				: 0
	);
	return {
		targets,
		unresolved: {
			count: unresolvedCount,
			amount:
				unresolvedCount === 0
					? 0
					: unresolvedCurrencies.size === 1
						? unresolvedAmount
						: null,
		},
	};
}

async function includeMonthCosts(
	db: SqlConnection,
	start: string,
	end: string,
	ensureCost: (costUid: string) => Promise<unknown>
): Promise<void> {
	const queries = [
		`SELECT cost_uid FROM expenses
        WHERE isDelete = 0 AND recognition_state = 'recognized'
          AND recognition_period BETWEEN ? AND ?`,
		`SELECT cost_uid FROM purchase_invoices
        WHERE isDelete = 0 AND recognition_state = 'recognized'
          AND recognition_period BETWEEN ? AND ?`,
		`SELECT cost_uid FROM other_expenses
        WHERE isDelete = 0 AND recognition_state = 'recognized'
          AND recognition_period BETWEEN ? AND ?`,
		`SELECT cost_uid FROM cost_accruals
        WHERE isDelete = 0 AND recognition_state = 'recognized'
          AND recognition_period BETWEEN ? AND ?`,
		`SELECT cost_uid FROM petty_cash_expenses
        WHERE isDelete = 0 AND entry_kind = 'spend'
          AND recognition_state = 'recognized' AND linked_cost_uid IS NULL
          AND ((recognition_period BETWEEN ? AND ?)
            OR (recognition_period IS NULL AND bill_date BETWEEN ? AND ?))`,
	];
	for (const sql of queries) {
		const params =
			queries.indexOf(sql) === queries.length - 1
				? [start, end, start, end]
				: [start, end];
		const [rows] = (await db.execute(sql, params)) as [DbRow[], unknown];
		for (const row of rows) {
			const uid = s(row, 'cost_uid');
			if (uid) await ensureCost(uid);
		}
	}
}

async function includeMonthSlips(
	db: SqlConnection,
	month: string,
	ensureSlip: (slipId: number) => Promise<unknown>
): Promise<void> {
	const [rows] = (await db.execute(
		`SELECT id FROM payroll_slips WHERE month = ?`,
		[`${month}-01`]
	)) as [DbRow[], unknown];
	for (const row of rows) {
		const id = Number(num(row, 'id') ?? 0);
		if (id) await ensureSlip(id);
	}
}
