/**
 * Supplier commitment consumption (ticket #312) — the durable link from a
 * recognized supplier cost to the canonical supplier order it consumes, and
 * the Outstanding Supplier Commitment rollforward.
 *
 * Invariants this module owns (contract:
 * C:/Files/OCDSE/Work/expenditure-commitment-contract.md):
 *  - consumption is addressed by `orders.order_uid` plus the cost's `cost_uid`
 *    and native Recognition Period; a text PO number is never identity;
 *  - one native slice (`cost_uid` + period) is consumed into exactly one
 *    order: `UNIQUE (cost_uid, recognized_period, active_key)` is the global
 *    active source-slice backstop, so two competing orders can never consume
 *    the same slice, even partially or concurrently;
 *  - the amount is native (the source's frozen slice gross, or gross minus
 *    tax on a net-basis order) and is never taken from the request; a missing
 *    or non-positive amount refuses rather than reading as zero;
 *  - every command locks the order row and the authoritative source row,
 *    checks both `expectedOrderVersion` and `expectedSourceVersion`, and
 *    writes nothing on a stale or no-longer-recognized source;
 *  - a correction is release + re-record (reasoned and versioned) — there is
 *    no in-place amount edit, so a duplicate can never appear;
 *  - the rollforward is reconstructed as of each month from the order journal
 *    (never from the order's current status): a later cancellation cannot
 *    erase an earlier month's new/opening commitment, and the cancellation
 *    amount uses consumption through its effective month, never consumption
 *    dated after it. Application `created_at` is never invented as a business
 *    date: an unprovable eligibility or cancellation act stays out of the
 *    month buckets and is disclosed as `unsupported_timing`;
 *  - payments and client-side invoice links are never read here.
 *
 * Atomicity: pass `connection` to run inside the caller's transaction (a
 * later accrual replacement transfer or financial close); otherwise the
 * module opens its own. Reads accept a caller connection for the same reason.
 */

import type Decimal from 'decimal.js';
import { add, R, sub, toNumber } from '@/lib/money';
import { query, withTransaction } from '@/utils/database';
import type {
	OrderActor,
	OrderAmountBasis,
	OrderOptions,
	OrderRecord,
	OrderStatus,
} from './orders';
import { mapOrderRow, OrderError } from './orders';
import type { SqlConnection } from './records';
import { num, s } from './records';
import type { CostSliceReference } from './sources';
import { resolveCostReference, resolveCostSlices } from './sources';
import type { RecognitionState } from './types';

type DbRow = Record<string, unknown>;

/** Where a consumption came from: a recognized invoice, or a Cost Accrual. */
export type ConsumptionSource = 'invoice' | 'accrual';
export type ConsumptionState = 'active' | 'released';
/** The tax basis consumption is stated on; must match the order's basis. */
export type CommitmentBasis = 'gross' | 'net';

/** One consumed native slice, as the procurement view and the rollforward read it. */
export interface OrderConsumptionRecord {
	id: number;
	orderUid: string;
	orderNumber: string;
	costUid: string;
	costSource: string;
	costLabel: string | null;
	source: ConsumptionSource;
	amount: number;
	taxBasis: CommitmentBasis;
	currency: string;
	/** First day of the consumed month. */
	recognizedPeriod: string;
	/** The source row's financial_version when this row was recorded. */
	sourceVersion: number;
	state: ConsumptionState;
	version: number;
	/** Resolved cost recognition state; null = the identity does not resolve. */
	costState: RecognitionState | null;
	/** `active` while the cost is still recognized — what the rollforward counts. */
	effective: boolean;
	actorId: number | null;
	reason: string | null;
	evidenceReference: string | null;
	createdAt: string | null;
	releasedAt: string | null;
	releasedBy: number | null;
	releaseReason: string | null;
	releaseEvidenceReference: string | null;
}

/** One recognized cost slice a control can offer for an order. */
export interface OrderConsumptionCandidate {
	costUid: string;
	costSource: string;
	costSourceId: string;
	label: string | null;
	currency: string;
	recognizedPeriod: string;
	grossAmount: number | null;
	taxAmount: number | null;
	recognizedAmount: number | null;
	/** The amount this slice would consume on the order's basis, or null. */
	amount: number | null;
	financialVersion: number;
}

/** One order's commitment detail: what is consumed, and what remains. */
export interface OrderCommitmentDetail {
	order: OrderRecord;
	consumptions: OrderConsumptionRecord[];
	effectiveConsumption: number;
	/** null when the order's supported value is unknown. */
	remainingCommitment: number | null;
	eligible: boolean;
	/** Why this order is not in the supported commitment (empty = it is). */
	exceptions: string[];
	candidates: OrderConsumptionCandidate[];
}

export interface RecordOrderConsumptionInput {
	orderUid: string;
	costUid: string;
	/** Must equal a native frozen slice period of the cost (`YYYY-MM`). */
	recognizedPeriod: string;
	/** Must equal the order's `amount_basis`. */
	taxBasis: CommitmentBasis;
	/** The order's `financial_version` the caller read. */
	expectedOrderVersion: number;
	/** The authoritative source row's `financial_version` the caller read. */
	expectedSourceVersion: number;
	source?: ConsumptionSource;
	reason?: unknown;
	evidenceReference?: unknown;
}

export interface RecordOrderConsumptionResult {
	consumption: OrderConsumptionRecord;
	/** The order after its version advance. */
	order: OrderRecord;
	/** Stated value minus effective consumption, on the order's basis. */
	remainingCommitment: number;
}

export interface ReleaseOrderConsumptionInput {
	orderUid: string;
	consumptionId: number;
	/** The consumption row's version the caller read. */
	expectedVersion: number;
	reason: unknown;
	evidenceReference?: unknown;
}

export interface CommitmentRollforwardMonth {
	month: string;
	opening: number;
	newCommitment: number;
	consumption: number;
	cancellation: number;
	closing: number;
}

/** One currency-and-basis pair; currencies and bases are never mixed. */
export interface SupplierCommitmentTotal {
	currency: string;
	basis: CommitmentBasis;
	months: CommitmentRollforwardMonth[];
	closingCommitment: number;
	/** The selected month's consumption. */
	consumptionInMonth: number;
	unconsumedOrderCount: number;
}

export interface CommitmentException {
	code: string;
	orderCount: number;
	/** Σ statable value of the affected orders, or null when unknown. */
	value: number | null;
	currency: string | null;
	basis: CommitmentBasis | null;
	detail: string;
}

/** One supplier order behind the section, stated at the selected month. */
export interface SupplierCommitmentOrderRow {
	orderUid: string;
	orderNumber: string;
	counterpartyName: string;
	currency: string;
	basis: OrderAmountBasis;
	value: number | null;
	/** Effective consumption through the selected month. */
	consumption: number;
	remaining: number | null;
	status: OrderStatus;
	projectId: number | null;
	projectCode: string | null;
	projectName: string | null;
	/** Set when the order's timeline is unprovable; it is not in the buckets. */
	timingUnsupported: boolean;
}

/** The Outstanding Supplier Commitment section of the report. */
export interface SupplierCommitmentSection {
	month: string;
	totals: SupplierCommitmentTotal[];
	exceptions: CommitmentException[];
	/** Orders behind the month, newest activity first. */
	orders: SupplierCommitmentOrderRow[];
	/** Consumption whose cost is no longer recognized (disclosed, not counted). */
	ineffectiveConsumption: number;
}

export interface CommitmentRollforwardQuery {
	month: string;
	/** Window length in months, ending at `month` (default 12, max 24). */
	months?: number;
}

/** The pooled connection the module reads through when no caller supplies one. */
const pool: SqlConnection = {
	execute: (sql, params) => query(sql, params),
};

function connectionFor(options?: OrderOptions): SqlConnection {
	return options?.connection ?? pool;
}

async function inTransaction<T>(
	options: OrderOptions | undefined,
	work: (db: SqlConnection) => Promise<T>
): Promise<T> {
	if (options?.connection) return work(options.connection);
	return withTransaction((db) => work(db)) as Promise<T>;
}

const ELIGIBLE_STATUSES: OrderStatus[] = ['approved', 'completed'];
const COMMITMENT_BASES: CommitmentBasis[] = ['gross', 'net'];

function isEligibleStatus(status: string | null): boolean {
	return status !== null && ELIGIBLE_STATUSES.includes(status as OrderStatus);
}

function money(value: number | null): number | null {
	if (value === null) return null;
	return toNumber(R(value).toDecimalPlaces(2));
}

/** `YYYY-MM-01` of a `YYYY-MM` or `YYYY-MM-DD` input, or null. */
function firstOfMonth(value: string): string | null {
	if (!/^\d{4}-\d{2}/.test(value)) return null;
	return `${value.slice(0, 7)}-01`;
}

function shiftMonth(month: string, delta: number): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
	return date.toISOString().slice(0, 7);
}

function monthRange(start: string, end: string): string[] {
	const months: string[] = [];
	let current = start;
	while (current <= end) {
		months.push(current);
		current = shiftMonth(current, 1);
	}
	return months;
}

/** One order journal row with its recorded status, as the timeline reads it. */
interface OrderJournalAct {
	at: string;
	event: string;
	status: string | null;
	amountBasis: string | null;
}

/** The reconstructed timeline of one supplier order. */
interface OrderTimeline {
	order: OrderRecord;
	/** When the order first became eligible (a recorded act), or null. */
	eligibleAt: string | null;
	/** When it left the eligible statuses (cancelled, reverted), or null. */
	endedAt: string | null;
	/** True when no journal act proves eligibility or cancellation. */
	timingUnsupported: boolean;
	/** A recorded basis change: the current basis is stated, disclosed. */
	basisChanged: boolean;
}

/**
 * Reconstruct one order's eligibility/cancellation timeline from its journal.
 * The recorded act is the journal row the command wrote; the order's own
 * `created_at` is never used as a business date.
 */
function computeTimeline(
	order: OrderRecord,
	acts: OrderJournalAct[]
): OrderTimeline {
	let eligibleAt: string | null = null;
	let endedAt: string | null = null;
	for (const act of acts) {
		if (eligibleAt === null) {
			if (isEligibleStatus(act.status)) eligibleAt = act.at;
			continue;
		}
		if (!isEligibleStatus(act.status)) {
			endedAt = act.at;
			break;
		}
	}
	let timingUnsupported = false;
	if (eligibleAt === null) {
		if (isEligibleStatus(order.status)) {
			// Created already eligible: the create command is the recorded act.
			const created = acts.find((act) => act.event === 'created');
			eligibleAt = created?.at ?? null;
			if (!eligibleAt) timingUnsupported = true;
		} else if (order.status === 'cancelled') {
			// Cancelled with no eligible act and no status-bearing act: whether
			// it was ever eligible is unprovable. Never invent a date.
			timingUnsupported = true;
		}
	} else if (endedAt === null && order.status === 'cancelled') {
		// The commitment is provable but the cancellation act is not: keep the
		// order in the timeline as committed and disclose the gap.
		timingUnsupported = true;
	}

	const bases = acts
		.map((act) => act.amountBasis)
		.filter((basis): basis is string => basis !== null);
	let basisChanged = false;
	for (let index = 1; index < bases.length; index += 1) {
		if (bases[index] !== bases[index - 1]) {
			basisChanged = true;
			break;
		}
	}
	return { order, eligibleAt, endedAt, timingUnsupported, basisChanged };
}

const ORDER_TIMELINE_SELECT = `
  SELECT o.*, p.project_code,
         COALESCE(p.project_title, p.name) AS project_name,
         e.event AS event, e.created_at AS event_at,
         JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$.status')) AS event_status,
         JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$.amount_basis')) AS event_basis
    FROM orders o
    LEFT JOIN projects p ON p.project_id = o.project_id AND p.isDelete = 0
    LEFT JOIN order_events e ON e.order_uid = o.order_uid
   WHERE o.direction = 'supplier' AND o.isDelete = 0`;

/** Every supplier order with its journal, oldest act first. */
async function loadSupplierTimelines(
	db: SqlConnection
): Promise<OrderTimeline[]> {
	const [rows] = (await db.execute(
		`${ORDER_TIMELINE_SELECT}
      ORDER BY o.order_uid ASC, e.created_at ASC, e.id ASC`
	)) as [DbRow[], unknown];
	const byUid = new Map<
		string,
		{ order: OrderRecord; acts: OrderJournalAct[] }
	>();
	for (const row of rows) {
		const uid = s(row, 'order_uid', '') ?? '';
		let entry = byUid.get(uid);
		if (!entry) {
			entry = { order: mapOrderRow(row), acts: [] };
			byUid.set(uid, entry);
		}
		const at = s(row, 'event_at');
		if (at) {
			entry.acts.push({
				at,
				event: s(row, 'event', '') ?? '',
				status: s(row, 'event_status'),
				amountBasis: s(row, 'event_basis'),
			});
		}
	}
	return [...byUid.values()].map((entry) =>
		computeTimeline(entry.order, entry.acts)
	);
}

/** One supplier order's journal, oldest act first. */
async function loadOrderTimeline(
	db: SqlConnection,
	orderUid: string
): Promise<OrderTimeline | null> {
	const [rows] = (await db.execute(
		`${ORDER_TIMELINE_SELECT} AND o.order_uid = ?
      ORDER BY e.created_at ASC, e.id ASC`,
		[orderUid]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	const order = mapOrderRow(rows[0]);
	const acts: OrderJournalAct[] = [];
	for (const row of rows) {
		const at = s(row, 'event_at');
		if (at) {
			acts.push({
				at,
				event: s(row, 'event', '') ?? '',
				status: s(row, 'event_status'),
				amountBasis: s(row, 'event_basis'),
			});
		}
	}
	return computeTimeline(order, acts);
}

interface ConsumptionRow {
	id: number;
	orderUid: string;
	costUid: string;
	costSource: string;
	source: ConsumptionSource;
	amount: number;
	taxBasis: CommitmentBasis;
	currency: string;
	recognizedPeriod: string;
	sourceVersion: number;
	state: ConsumptionState;
	version: number;
	actorId: number | null;
	reason: string | null;
	evidenceReference: string | null;
	createdAt: string | null;
	releasedAt: string | null;
	releasedBy: number | null;
	releaseReason: string | null;
	releaseEvidenceReference: string | null;
}

function mapConsumptionRow(row: DbRow): ConsumptionRow {
	return {
		id: Number(num(row, 'id') ?? 0),
		orderUid: s(row, 'order_uid', '') ?? '',
		costUid: s(row, 'cost_uid', '') ?? '',
		costSource: s(row, 'cost_source', '') ?? '',
		source: (s(row, 'source', 'invoice') ?? 'invoice') as ConsumptionSource,
		amount: Number(num(row, 'amount') ?? 0),
		taxBasis: (s(row, 'tax_basis', 'gross') ?? 'gross') as CommitmentBasis,
		currency: s(row, 'currency', 'INR') ?? 'INR',
		recognizedPeriod: String(s(row, 'recognized_period') ?? ''),
		sourceVersion: Number(num(row, 'source_version') ?? 0),
		state: (s(row, 'state', 'active') ?? 'active') as ConsumptionState,
		version: Number(num(row, 'version') ?? 1),
		actorId: num(row, 'actor_id'),
		reason: s(row, 'reason'),
		evidenceReference: s(row, 'evidence_reference'),
		createdAt: s(row, 'created_at'),
		releasedAt: s(row, 'released_at'),
		releasedBy: num(row, 'released_by'),
		releaseReason: s(row, 'release_reason'),
		releaseEvidenceReference: s(row, 'release_evidence_reference'),
	};
}

const CONSUMPTION_SELECT = `SELECT * FROM order_consumptions`;

async function loadConsumptions(
	db: SqlConnection,
	orderUid?: string
): Promise<ConsumptionRow[]> {
	const [rows] = orderUid
		? ((await db.execute(
				`${CONSUMPTION_SELECT} WHERE order_uid = ? ORDER BY recognized_period ASC, id ASC`,
				[orderUid]
			)) as [DbRow[], unknown])
		: ((await db.execute(
				`${CONSUMPTION_SELECT} ORDER BY recognized_period ASC, id ASC`
			)) as [DbRow[], unknown]);
	return rows.map(mapConsumptionRow);
}

/**
 * Resolve the recognition state of every distinct cost a consumption points
 * at. A cost whose identity no longer resolves (or is no longer recognized) is
 * disclosed and excluded from the counted consumption, never silently kept.
 */
async function resolveCostStates(
	db: SqlConnection,
	costUids: string[]
): Promise<Map<string, RecognitionState | null>> {
	const states = new Map<string, RecognitionState | null>();
	const unique = [...new Set(costUids)];
	await Promise.all(
		unique.map(async (costUid) => {
			const reference = await resolveCostReference(db, costUid);
			states.set(costUid, reference?.recognition_state ?? null);
		})
	);
	return states;
}

function recordWithState(
	row: ConsumptionRow,
	states: Map<string, RecognitionState | null>,
	orderNumber: string,
	costLabel: string | null
): OrderConsumptionRecord {
	const costState = states.get(row.costUid) ?? null;
	return {
		...row,
		orderNumber,
		costLabel,
		costState,
		effective: row.state === 'active' && costState === 'recognized',
	};
}

/** Effective consumption of one order: active rows whose cost is recognized. */
function effectiveThrough(
	rows: ConsumptionRow[],
	states: Map<string, RecognitionState | null>,
	throughMonth: string | null
): number {
	return toNumber(
		rows.reduce((total, row) => {
			if (row.state !== 'active') return total;
			if (states.get(row.costUid) !== 'recognized') return total;
			if (
				throughMonth !== null &&
				row.recognizedPeriod.slice(0, 7) > throughMonth
			) {
				return total;
			}
			return add(total, R(row.amount));
		}, R(0))
	);
}

/** The amount a native slice consumes on one basis, or null when unstatable. */
function sliceAmount(
	slice: { gross_amount: number | null; tax_amount: number | null },
	basis: CommitmentBasis
): number | null {
	if (slice.gross_amount === null) return null;
	if (basis === 'gross') return money(slice.gross_amount);
	if (slice.tax_amount === null) return null;
	return money(toNumber(sub(R(slice.gross_amount), R(slice.tax_amount))));
}

/** Sum same-period native slices into one period amount, on the order basis. */
function periodSliceAmount(
	slices: CostSliceReference[],
	period: string,
	basis: CommitmentBasis
): { amount: number | null; gross: number | null; tax: number | null } {
	const rows = slices.filter(
		(slice) => slice.recognition_period.slice(0, 7) === period.slice(0, 7)
	);
	if (rows.length === 0) return { amount: null, gross: null, tax: null };
	let gross: Decimal | null = null;
	let tax: Decimal | null = null;
	for (const row of rows) {
		if (row.gross_amount === null)
			return { amount: null, gross: null, tax: null };
		gross = add(gross ?? R(0), R(row.gross_amount));
		tax = add(tax ?? R(0), R(row.tax_amount ?? 0));
	}
	const grossAmount = toNumber(gross ?? R(0));
	const taxAmount = toNumber(tax ?? R(0));
	return {
		amount: sliceAmount(
			{ gross_amount: grossAmount, tax_amount: taxAmount },
			basis
		),
		gross: grossAmount,
		tax: taxAmount,
	};
}

async function consumptionEvent(
	db: SqlConnection,
	row: ConsumptionRow,
	event: 'recorded' | 'released',
	actorId: number | null,
	reason: string | null,
	evidenceReference: string | null
): Promise<void> {
	await db.execute(
		`INSERT INTO order_consumption_events
       (consumption_id, order_uid, cost_uid, event, version, amount, tax_basis,
        currency, recognized_period, actor_user_id, reason, evidence_reference, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			row.id,
			row.orderUid,
			row.costUid,
			event,
			row.version,
			row.amount,
			row.taxBasis,
			row.currency,
			row.recognizedPeriod,
			actorId,
			reason,
			evidenceReference,
			JSON.stringify({
				state: row.state,
				amount: row.amount,
				tax_basis: row.taxBasis,
				currency: row.currency,
				recognized_period: row.recognizedPeriod,
				source_version: row.sourceVersion,
			}),
		]
	);
}

/** Advance one order's version under the version the caller read. */
async function advanceOrderVersion(
	db: SqlConnection,
	orderUid: string,
	expectedVersion: number
): Promise<void> {
	const result = (await db.execute(
		`UPDATE orders SET financial_version = financial_version + 1
      WHERE order_uid = ? AND financial_version = ? AND isDelete = 0`,
		[orderUid, expectedVersion]
	)) as [{ affectedRows?: number }, unknown];
	const affected = Number(result[0]?.affectedRows ?? 0);
	if (affected !== 1) {
		throw new OrderError(
			'stale_version',
			'The order moved on since it was read',
			409
		);
	}
}

/**
 * Record one native recognized slice as consumed by one supplier order.
 * Versioned on both sides, atomic, and refused without partial writes.
 */
export async function recordOrderConsumption(
	input: RecordOrderConsumptionInput,
	actor: OrderActor,
	options?: OrderOptions
): Promise<RecordOrderConsumptionResult> {
	const period = firstOfMonth(String(input.recognizedPeriod ?? ''));
	const taxBasis = input.taxBasis;
	return inTransaction(options, async (db) => {
		if (!COMMITMENT_BASES.includes(taxBasis)) {
			throw new OrderError(
				'tax_basis_mismatch',
				'Consumption must state a gross or net tax basis',
				422,
				{ field: 'tax_basis' }
			);
		}
		if (!period) {
			throw new OrderError(
				'unknown_recognition_period',
				'A recognition period is required',
				422,
				{ field: 'recognized_period' }
			);
		}
		const expectedOrderVersion = Number(input.expectedOrderVersion);
		if (!Number.isInteger(expectedOrderVersion) || expectedOrderVersion < 1) {
			throw new OrderError(
				'version_required',
				'expected_order_version is required',
				400
			);
		}
		const expectedSourceVersion = Number(input.expectedSourceVersion);
		if (!Number.isInteger(expectedSourceVersion) || expectedSourceVersion < 1) {
			throw new OrderError(
				'source_version_required',
				'expected_source_version is required',
				400
			);
		}
		const source: ConsumptionSource =
			input.source === 'accrual' ? 'accrual' : 'invoice';

		// Lock order first, then the authoritative source: one fixed lock order
		// keeps concurrent commands from deadlocking.
		const [orderRows] = (await db.execute(
			`SELECT * FROM orders WHERE order_uid = ? AND isDelete = 0 FOR UPDATE`,
			[input.orderUid]
		)) as [DbRow[], unknown];
		if (orderRows.length === 0) {
			throw new OrderError('order_not_found', 'Order not found', 404, {
				field: 'order_uid',
			});
		}
		const order = mapOrderRow(orderRows[0]);
		if (order.direction !== 'supplier') {
			throw new OrderError(
				'order_not_supplier',
				'Only a supplier order carries a supplier commitment',
				422,
				{ field: 'order_uid' }
			);
		}
		if (order.status === 'cancelled') {
			throw new OrderError(
				'order_cancelled',
				'A cancelled order cannot consume recognized cost',
				422,
				{ field: 'order_uid' }
			);
		}
		if (!ELIGIBLE_STATUSES.includes(order.status)) {
			throw new OrderError(
				'order_not_eligible',
				'Only an approved supplier order enters the supported commitment',
				422,
				{ status: order.status }
			);
		}
		if (order.amountBasis === 'unknown') {
			throw new OrderError(
				'order_basis_unknown',
				'An order without a supported tax basis cannot consume cost',
				422,
				{ field: 'amount_basis' }
			);
		}
		if (order.amountBasis !== taxBasis) {
			throw new OrderError(
				'tax_basis_mismatch',
				"Consumption must be stated on the order's tax basis",
				422,
				{ order_basis: order.amountBasis, requested_basis: taxBasis }
			);
		}
		const stated = statedValueOf(order);
		if (stated === null) {
			throw new OrderError(
				'order_value_unknown',
				'The order has no supported value to consume',
				422,
				{ field: 'amount_basis' }
			);
		}
		if (order.financialVersion !== expectedOrderVersion) {
			throw new OrderError(
				'stale_version',
				'The order moved on since it was read',
				409,
				{ currentVersion: order.financialVersion }
			);
		}

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
		const head = slices[0];
		if (head.recognition_state !== 'recognized') {
			throw new OrderError(
				'cost_not_recognized',
				'Only a recognized cost consumes a supplier commitment',
				422,
				{ state: head.recognition_state }
			);
		}
		if (head.financial_version !== expectedSourceVersion) {
			throw new OrderError(
				'source_stale_version',
				'The source moved on since it was read',
				409,
				{ currentVersion: head.financial_version }
			);
		}
		if (
			head.currency === null ||
			head.currency.toUpperCase() !== order.currency.toUpperCase()
		) {
			throw new OrderError(
				'currency_mismatch',
				"Consumption must be stated in the order's currency",
				422,
				{ order_currency: order.currency, cost_currency: head.currency }
			);
		}

		const periodSlice = periodSliceAmount(slices, period, taxBasis);
		if (periodSlice.amount === null) {
			const periodExists = slices.some(
				(slice) => slice.recognition_period.slice(0, 7) === period.slice(0, 7)
			);
			if (!periodExists) {
				throw new OrderError(
					'unknown_recognition_period',
					'The cost has no native slice in that month',
					422,
					{ field: 'recognized_period', recognized_period: period }
				);
			}
			if (taxBasis === 'net' && periodSlice.gross !== null) {
				throw new OrderError(
					'tax_amount_unknown',
					"A net-basis consumption needs the slice's recorded tax amount",
					422,
					{ field: 'tax_amount' }
				);
			}
			throw new OrderError(
				'missing_amount',
				'The native slice has no amount to consume',
				422,
				{ field: 'gross_amount' }
			);
		}
		if (periodSlice.amount <= 0) {
			throw new OrderError(
				'missing_amount',
				'The native slice amount must be positive',
				422,
				{ amount: periodSlice.amount }
			);
		}

		const orderConsumptions = await loadConsumptions(db, order.orderUid);
		const states = await resolveCostStates(
			db,
			orderConsumptions.map((row) => row.costUid)
		);
		const consumed = effectiveThrough(orderConsumptions, states, null);
		const remaining = toNumber(sub(R(stated), R(consumed)));
		if (periodSlice.amount > remaining) {
			throw new OrderError(
				'consumption_exceeds_commitment',
				"The consumption exceeds the order's remaining commitment",
				422,
				{ remaining, requested: periodSlice.amount }
			);
		}

		const costReference = await resolveCostReference(db, input.costUid);
		const costSource = costReference?.source ?? head.source_table;
		const reason = trimTo(input.reason, 500);
		const evidenceReference = trimTo(input.evidenceReference, 500);
		let insertId = 0;
		try {
			const result = (await db.execute(
				`INSERT INTO order_consumptions
           (order_uid, cost_uid, cost_source, source, amount, tax_basis, currency,
            recognized_period, source_version, state, version, actor_id, reason,
            evidence_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
				[
					order.orderUid,
					head.cost_uid || input.costUid,
					String(costSource),
					source,
					periodSlice.amount,
					taxBasis,
					order.currency,
					period,
					head.financial_version,
					actor.id,
					reason,
					evidenceReference,
				]
			)) as [{ insertId?: number }, unknown];
			insertId = Number(result[0]?.insertId ?? 0);
		} catch (error) {
			const errno = (error as { errno?: number; code?: string })?.errno;
			const code = (error as { code?: string })?.code;
			if (errno === 1062 || code === 'ER_DUP_ENTRY') {
				const existing = await findActiveSliceConsumption(
					db,
					head.cost_uid || input.costUid,
					period
				);
				throw new OrderError(
					'slice_already_consumed',
					'That native slice is already consumed',
					409,
					{
						consumption_id: existing?.id ?? null,
						order_uid: existing?.orderUid ?? null,
					}
				);
			}
			throw error;
		}

		await advanceOrderVersion(db, order.orderUid, expectedOrderVersion);
		const [inserted] = (await db.execute(
			`SELECT * FROM order_consumptions WHERE id = ?`,
			[insertId]
		)) as [DbRow[], unknown];
		const row = mapConsumptionRow(inserted[0]);
		await consumptionEvent(
			db,
			row,
			'recorded',
			actor.id,
			reason,
			evidenceReference
		);
		const [orderAfter] = (await db.execute(
			`SELECT * FROM orders WHERE order_uid = ? AND isDelete = 0`,
			[order.orderUid]
		)) as [DbRow[], unknown];
		const updatedOrder = mapOrderRow(orderAfter[0]);
		const statesAfter = new Map(states);
		statesAfter.set(row.costUid, 'recognized');
		const nextRemaining = toNumber(
			sub(
				R(stated),
				R(effectiveThrough([...orderConsumptions, row], statesAfter, null))
			)
		);
		return {
			consumption: recordWithState(
				row,
				statesAfter,
				order.orderNumber,
				costReference?.label ?? null
			),
			order: updatedOrder,
			remainingCommitment: nextRemaining,
		};
	});
}

/** The active consumption of one native slice, or null. */
async function findActiveSliceConsumption(
	db: SqlConnection,
	costUid: string,
	period: string
): Promise<ConsumptionRow | null> {
	const [rows] = (await db.execute(
		`${CONSUMPTION_SELECT}
      WHERE cost_uid = ? AND recognized_period = ? AND state = 'active'
      LIMIT 1`,
		[costUid, period]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? mapConsumptionRow(rows[0]) : null;
}

/**
 * Release one consumption with its reason and evidence. Corrections are
 * release + re-record: the released row keeps its history, and its slice
 * becomes available again in the same transaction.
 */
export async function releaseOrderConsumption(
	input: ReleaseOrderConsumptionInput,
	actor: OrderActor,
	options?: OrderOptions
): Promise<RecordOrderConsumptionResult> {
	return inTransaction(options, async (db) => {
		const expectedVersion = Number(input.expectedVersion);
		if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
			throw new OrderError(
				'version_required',
				'expected_version is required',
				400
			);
		}
		const reason = trimTo(input.reason, 500);
		if (!reason) {
			throw new OrderError(
				'reason_required',
				'A reason is required to release a consumption',
				422
			);
		}
		const [orderRows] = (await db.execute(
			`SELECT * FROM orders WHERE order_uid = ? AND isDelete = 0 FOR UPDATE`,
			[input.orderUid]
		)) as [DbRow[], unknown];
		if (orderRows.length === 0) {
			throw new OrderError('order_not_found', 'Order not found', 404);
		}
		const order = mapOrderRow(orderRows[0]);
		const [rows] = (await db.execute(
			`SELECT * FROM order_consumptions
        WHERE id = ? AND order_uid = ?
        FOR UPDATE`,
			[Number(input.consumptionId), input.orderUid]
		)) as [DbRow[], unknown];
		if (rows.length === 0) {
			throw new OrderError(
				'consumption_not_found',
				'Consumption not found',
				404
			);
		}
		const row = mapConsumptionRow(rows[0]);
		if (row.state !== 'active') {
			throw new OrderError(
				'consumption_already_released',
				'That consumption is already released',
				422
			);
		}
		if (row.version !== expectedVersion) {
			throw new OrderError(
				'stale_version',
				'The consumption moved on since it was read',
				409,
				{ currentVersion: row.version }
			);
		}
		const evidenceReference = trimTo(input.evidenceReference, 500);
		await db.execute(
			`UPDATE order_consumptions
          SET state = 'released', version = version + 1,
              released_at = CURRENT_TIMESTAMP, released_by = ?,
              release_reason = ?, release_evidence_reference = ?
        WHERE id = ? AND version = ?`,
			[actor.id, reason, evidenceReference, row.id, expectedVersion]
		);
		await advanceOrderVersion(db, order.orderUid, order.financialVersion);
		const [after] = (await db.execute(
			`SELECT * FROM order_consumptions WHERE id = ?`,
			[row.id]
		)) as [DbRow[], unknown];
		const released = mapConsumptionRow(after[0]);
		await consumptionEvent(
			db,
			released,
			'released',
			actor.id,
			reason,
			evidenceReference
		);
		const [orderAfter] = (await db.execute(
			`SELECT * FROM orders WHERE order_uid = ? AND isDelete = 0`,
			[order.orderUid]
		)) as [DbRow[], unknown];
		const updatedOrder = mapOrderRow(orderAfter[0]);
		const orderConsumptions = await loadConsumptions(db, order.orderUid);
		const states = await resolveCostStates(
			db,
			orderConsumptions.map((entry) => entry.costUid)
		);
		const stated = statedValueOf(order);
		const remaining = toNumber(
			sub(R(stated ?? 0), R(effectiveThrough(orderConsumptions, states, null)))
		);
		return {
			consumption: recordWithState(released, states, order.orderNumber, null),
			order: updatedOrder,
			remainingCommitment: remaining,
		};
	});
}

function trimTo(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/** The value an order's stated basis supports, or null when unknown. */
function statedValueOf(order: OrderRecord): number | null {
	if (order.amountBasis === 'gross') return order.grossAmount;
	if (order.amountBasis === 'net') return order.netAmount;
	return null;
}

/**
 * One order's commitment detail: the order, every recorded consumption (with
 * its cost's resolved state and release evidence), the effective consumption,
 * the remaining commitment, and the recognized slices a control can offer.
 */
export async function fetchOrderCommitment(
	orderUid: string,
	options?: OrderOptions
): Promise<OrderCommitmentDetail | null> {
	const db = connectionFor(options);
	const timeline = await loadOrderTimeline(db, orderUid);
	if (!timeline) return null;
	const { order } = timeline;
	const rows = await loadConsumptions(db, orderUid);
	const states = await resolveCostStates(
		db,
		rows.map((row) => row.costUid)
	);
	const labels = new Map<string, string | null>();
	await Promise.all(
		[...new Set(rows.map((row) => row.costUid))].map(async (costUid) => {
			const reference = await resolveCostReference(db, costUid);
			labels.set(costUid, reference?.label ?? null);
		})
	);
	const consumptions = rows.map((row) =>
		recordWithState(
			row,
			states,
			order.orderNumber,
			labels.get(row.costUid) ?? null
		)
	);
	const effectiveConsumption = effectiveThrough(rows, states, null);
	const stated = statedValueOf(order);
	const exceptions = orderExceptions(timeline, stated);
	const candidates =
		order.direction === 'supplier' ? await loadCandidates(db, order) : [];
	// A cancelled order's commitment has ended: nothing remains outstanding,
	// whatever consumption was recorded before the cancellation.
	const remainingCommitment =
		stated === null || timeline.endedAt !== null
			? stated === null
				? null
				: 0
			: toNumber(sub(R(stated), R(effectiveConsumption)));
	return {
		order,
		consumptions,
		effectiveConsumption,
		remainingCommitment,
		eligible: exceptions.length === 0,
		exceptions,
		candidates,
	};
}

/** Why an order is not in the supported commitment (empty = it is in it). */
function orderExceptions(
	timeline: OrderTimeline,
	stated: number | null
): string[] {
	const { order } = timeline;
	const exceptions: string[] = [];
	if (order.status === 'draft' || order.status === 'pending') {
		exceptions.push('pending_approval');
	} else if (order.status === 'cancelled' && timeline.eligibleAt === null) {
		exceptions.push('cancelled');
	}
	if (order.amountBasis === 'unknown') exceptions.push('unsupported_basis');
	else if (stated === null) exceptions.push('missing_value');
	if (timeline.timingUnsupported) exceptions.push('unsupported_timing');
	return exceptions;
}

/**
 * Recognized cost slices a control can offer for one order: matching currency
 * and basis, with a native period that no active consumption has taken.
 */
async function loadCandidates(
	db: SqlConnection,
	order: OrderRecord
): Promise<OrderConsumptionCandidate[]> {
	if (order.amountBasis === 'unknown') return [];
	const [rows] = (await db.execute(
		`SELECT i.id, i.cost_uid, i.invoice_number, i.currency, i.total, i.tax_amount,
            i.recognized_amount, i.recognition_period, i.financial_version,
            sp.id AS split_id, sp.recognition_period AS split_period,
            sp.amount AS split_amount, sp.tax_amount AS split_tax,
            sp.recognized_amount AS split_recognized
       FROM purchase_invoices i
       LEFT JOIN supplier_invoice_periods sp ON sp.invoice_id = i.id
      WHERE i.isDelete = 0 AND i.recognition_state = 'recognized'
        AND i.cost_uid IS NOT NULL AND i.currency = ?
      ORDER BY i.id ASC, sp.recognition_period ASC, sp.id ASC
      LIMIT 400`,
		[order.currency]
	)) as [DbRow[], unknown];
	const [takenRows] = (await db.execute(
		`SELECT cost_uid, recognized_period FROM order_consumptions WHERE state = 'active'`
	)) as [DbRow[], unknown];
	const taken = new Set(
		takenRows.map(
			(row) =>
				`${s(row, 'cost_uid', '')}|${String(s(row, 'recognized_period') ?? '')}`
		)
	);
	const byCost = new Map<string, DbRow[]>();
	for (const row of rows) {
		const uid = s(row, 'cost_uid', '') ?? '';
		const list = byCost.get(uid) ?? [];
		list.push(row);
		byCost.set(uid, list);
	}
	const candidates: OrderConsumptionCandidate[] = [];
	for (const [costUid, costRows] of byCost) {
		const head = costRows[0];
		const currency = s(head, 'currency', 'INR') ?? 'INR';
		if (currency.toUpperCase() !== order.currency.toUpperCase()) continue;
		const hasSplit = costRows.some((row) => row.split_id !== null);
		const periods = new Map<string, { gross: number; tax: number }>();
		if (hasSplit) {
			for (const row of costRows) {
				const period = String(s(row, 'split_period') ?? '');
				if (!period) continue;
				const entry = periods.get(period) ?? { gross: 0, tax: 0 };
				entry.gross += Number(num(row, 'split_amount') ?? 0);
				entry.tax += Number(num(row, 'split_tax') ?? 0);
				periods.set(period, entry);
			}
		} else {
			const period = s(head, 'recognition_period');
			if (!period) continue;
			periods.set(period, {
				gross: Number(num(head, 'total') ?? 0),
				tax: Number(num(head, 'tax_amount') ?? 0),
			});
		}
		for (const [period, amounts] of periods) {
			if (taken.has(`${costUid}|${period}`)) continue;
			const amount = sliceAmount(
				{ gross_amount: amounts.gross, tax_amount: amounts.tax },
				order.amountBasis as CommitmentBasis
			);
			candidates.push({
				costUid,
				costSource: 'purchase_invoices',
				costSourceId: String(num(head, 'id') ?? ''),
				label: s(head, 'invoice_number'),
				currency,
				recognizedPeriod: period,
				grossAmount: money(amounts.gross),
				taxAmount: money(amounts.tax),
				recognizedAmount: num(head, 'recognized_amount'),
				amount,
				financialVersion: Number(num(head, 'financial_version') ?? 1),
			});
		}
	}
	return candidates.sort((left, right) =>
		`${left.label ?? ''}${left.recognizedPeriod}`.localeCompare(
			`${right.label ?? ''}${right.recognizedPeriod}`
		)
	);
}

/** The report month the rollforward window ends at, as `YYYY-MM`. */
function normalizeRollforwardMonth(value: string): string {
	const month = String(value ?? '').slice(0, 7);
	if (!/^\d{4}-\d{2}$/.test(month)) {
		throw new OrderError(
			'invalid_month',
			'A month is required as YYYY-MM',
			400,
			{ field: 'month' }
		);
	}
	return month;
}

/**
 * The Outstanding Supplier Commitment rollforward: opening, new commitment,
 * consumption, cancellation, and closing per (currency, basis) pair, each
 * month reconstructed from the recorded acts and consumption — never from the
 * order's current status, and never inventing a business date.
 */
export async function fetchSupplierCommitmentRollforward(
	queryInput: CommitmentRollforwardQuery,
	options?: OrderOptions
): Promise<SupplierCommitmentSection> {
	const db = connectionFor(options);
	const month = normalizeRollforwardMonth(queryInput.month);
	const requested = Number(queryInput.months ?? 12);
	const window = Number.isFinite(requested)
		? Math.min(Math.max(Math.trunc(requested), 1), 24)
		: 12;
	const start = shiftMonth(month, -(window - 1));

	const timelines = await loadSupplierTimelines(db);
	const consumptions = await loadConsumptions(db);
	const states = await resolveCostStates(
		db,
		consumptions.map((row) => row.costUid)
	);

	// Effective consumption per order and month; ineffective rows are disclosed
	// separately and never counted.
	const perOrder = new Map<string, Map<string, number>>();
	let ineffectiveConsumption = 0;
	for (const row of consumptions) {
		const effective =
			row.state === 'active' && states.get(row.costUid) === 'recognized';
		if (!effective) {
			if (row.state === 'active') ineffectiveConsumption += row.amount;
			continue;
		}
		const months = perOrder.get(row.orderUid) ?? new Map<string, number>();
		const key = row.recognizedPeriod.slice(0, 7);
		months.set(key, toNumber(add(R(months.get(key) ?? 0), R(row.amount))));
		perOrder.set(row.orderUid, months);
	}
	const consumptionOf = (orderUid: string): Map<string, number> =>
		perOrder.get(orderUid) ?? new Map<string, number>();
	const effectiveThroughMonth = (
		orderUid: string,
		through: string | null
	): number => {
		let total = 0;
		for (const [key, amount] of consumptionOf(orderUid)) {
			if (through === null || key <= through) total += amount;
		}
		return toNumber(R(total).toDecimalPlaces(2));
	};

	// Exceptions and the bucket rows.
	const exceptionBuckets = new Map<
		string,
		{
			code: string;
			count: number;
			value: number;
			currency: string | null;
			basis: CommitmentBasis | null;
			detail: string;
		}
	>();
	const addException = (
		code: string,
		value: number | null,
		currency: string | null,
		basis: CommitmentBasis | null,
		detail: string
	): void => {
		const key = `${code}|${currency ?? ''}|${basis ?? ''}`;
		const entry = exceptionBuckets.get(key) ?? {
			code,
			count: 0,
			value: 0,
			currency,
			basis,
			detail,
		};
		entry.count += 1;
		if (value !== null) entry.value = toNumber(add(R(entry.value), R(value)));
		else entry.value = Number.NaN;
		exceptionBuckets.set(key, entry);
	};

	interface BucketOrder {
		timeline: OrderTimeline;
		value: number;
		currency: string;
		basis: CommitmentBasis;
		eligibleMonth: string;
		endedMonth: string | null;
	}
	const buckets = new Map<string, BucketOrder[]>();
	const monthRows: SupplierCommitmentOrderRow[] = [];

	for (const timeline of timelines) {
		const { order } = timeline;
		const stated = statedValueOf(order);
		const basis =
			order.amountBasis === 'unknown'
				? null
				: (order.amountBasis as CommitmentBasis);
		if (order.status === 'draft' || order.status === 'pending') {
			addException(
				'pending_approval',
				stated,
				order.currency,
				basis,
				'Supplier order awaiting approval: never in the supported commitment.'
			);
			continue;
		}
		if (order.amountBasis === 'unknown') {
			addException(
				'unsupported_basis',
				null,
				order.currency,
				null,
				'No supported tax basis: the value stays unknown, never zero.'
			);
			continue;
		}
		if (stated === null) {
			addException(
				'missing_value',
				null,
				order.currency,
				basis,
				'Supported basis without a recorded value: unknown, never zero.'
			);
			continue;
		}
		if (timeline.timingUnsupported) {
			addException(
				'unsupported_timing',
				stated,
				order.currency,
				basis,
				'No journal act proves the eligibility or cancellation date; the value stays out of the month buckets.'
			);
			continue;
		}
		if (timeline.eligibleAt === null) {
			// Never eligible and not cancelled: nothing to state.
			addException(
				'pending_approval',
				stated,
				order.currency,
				basis,
				'No recorded eligibility act: never in the supported commitment.'
			);
			continue;
		}
		if (timeline.basisChanged) {
			addException(
				'basis_changed',
				stated,
				order.currency,
				basis,
				'A recorded basis change: the current basis is stated and earlier values are not reconstructed.'
			);
		}
		const entry: BucketOrder = {
			timeline,
			value: stated,
			currency: order.currency.toUpperCase(),
			// Narrowed: an unknown basis already left above as unsupported_basis.
			basis: order.amountBasis,
			eligibleMonth: timeline.eligibleAt.slice(0, 7),
			endedMonth: timeline.endedAt ? timeline.endedAt.slice(0, 7) : null,
		};
		const key = `${entry.currency}|${entry.basis}`;
		const list = buckets.get(key) ?? [];
		list.push(entry);
		buckets.set(key, list);
	}

	// Disclosed pre-eligibility consumption: folded into the order's own
	// eligibility month, with its amount stated in the exception.
	for (const entries of buckets.values()) {
		for (const entry of entries) {
			const uid = entry.timeline.order.orderUid;
			for (const [key] of consumptionOf(uid)) {
				if (key < entry.eligibleMonth) {
					addException(
						'consumption_before_commitment',
						effectiveThroughMonth(uid, key) -
							effectiveThroughMonth(uid, shiftMonth(key, -1)),
						entry.currency,
						entry.basis,
						"Consumption dated before the order's eligibility month: folded into that month, never clamped."
					);
					break;
				}
			}
		}
	}

	// Pending legacy copies: direction is ambiguous until a document-backed
	// review resolves it, so they can never enter the commitment.
	const [legacyRows] = (await db.execute(
		`SELECT COUNT(*) AS n
       FROM order_legacy_mappings
      WHERE review_state = 'pending' AND resolved_direction IS NULL`
	)) as [DbRow[], unknown];
	const legacyCount = Number(num(legacyRows[0], 'n') ?? 0);
	if (legacyCount > 0) {
		addException(
			'ambiguous_direction',
			null,
			null,
			null,
			`${legacyCount} pre-canonical copies await a document-backed direction review.`
		);
	}
	if (ineffectiveConsumption > 0) {
		addException(
			'cost_not_recognized',
			ineffectiveConsumption,
			null,
			null,
			'Consumption whose cost is no longer recognized: excluded from the counted consumption and shown for release.'
		);
	}

	const totals: SupplierCommitmentTotal[] = [];
	const months = monthRange(start, month);
	for (const [key, entries] of [...buckets.entries()].sort()) {
		const separator = key.indexOf('|');
		const currency = key.slice(0, separator);
		const basis = key.slice(separator + 1) as CommitmentBasis;
		let closing = 0;
		for (const entry of entries) {
			const uid = entry.timeline.order.orderUid;
			const before = shiftMonth(start, -1);
			closing = toNumber(
				add(
					R(closing),
					R(remainingAt(entry, uid, before, effectiveThroughMonth))
				)
			);
		}
		const rows: CommitmentRollforwardMonth[] = [];
		for (const monthKey of months) {
			const opening = closing;
			let newCommitment = 0;
			let consumption = 0;
			let cancellation = 0;
			for (const entry of entries) {
				const uid = entry.timeline.order.orderUid;
				if (entry.eligibleMonth === monthKey) {
					newCommitment += entry.value;
					// Consumption dated before eligibility is folded into the
					// month the commitment becomes visible.
					for (const [consumptionMonth, amount] of consumptionOf(uid)) {
						if (consumptionMonth < monthKey) consumption += amount;
					}
				}
				if (entry.eligibleMonth <= monthKey) {
					consumption +=
						consumptionOf(uid).get(monthKey) !== undefined
							? (consumptionOf(uid).get(monthKey) as number)
							: 0;
				}
				if (entry.endedMonth === monthKey && entry.eligibleMonth <= monthKey) {
					cancellation += toNumber(
						sub(R(entry.value), R(effectiveThroughMonth(uid, monthKey)))
					);
				}
			}
			newCommitment = toNumber(R(newCommitment).toDecimalPlaces(2));
			consumption = toNumber(R(consumption).toDecimalPlaces(2));
			cancellation = toNumber(R(cancellation).toDecimalPlaces(2));
			const nextClosing = toNumber(
				add(
					add(R(opening), R(newCommitment)),
					sub(R(0), add(R(consumption), R(cancellation)))
				)
			);
			rows.push({
				month: monthKey,
				opening,
				newCommitment,
				consumption,
				cancellation,
				closing: nextClosing,
			});
			closing = nextClosing;
		}
		const unconsumedOrderCount = entries.filter((entry) => {
			const uid = entry.timeline.order.orderUid;
			const remaining = remainingAt(entry, uid, month, effectiveThroughMonth);
			return remaining > 0;
		}).length;
		totals.push({
			currency,
			basis,
			months: rows,
			closingCommitment: closing,
			consumptionInMonth: toNumber(
				R(rows.length > 0 ? rows[rows.length - 1].consumption : 0)
			),
			unconsumedOrderCount,
		});
	}

	// The orders behind the month: every eligible order still relevant to it.
	for (const entries of buckets.values()) {
		for (const entry of entries) {
			const uid = entry.timeline.order.orderUid;
			const remaining = remainingAt(entry, uid, month, effectiveThroughMonth);
			const activeThisMonth =
				entry.eligibleMonth === month ||
				entry.endedMonth === month ||
				consumptionOf(uid).has(month);
			if (remaining === 0 && !activeThisMonth) continue;
			const { order } = entry.timeline;
			monthRows.push({
				orderUid: uid,
				orderNumber: order.orderNumber,
				counterpartyName: order.counterpartyName,
				currency: entry.currency,
				basis: entry.basis,
				value: entry.value,
				consumption: effectiveThroughMonth(uid, month),
				remaining,
				status: order.status,
				projectId: order.projectId,
				projectCode: order.projectCode,
				projectName: order.projectName,
				timingUnsupported: false,
			});
		}
	}
	monthRows.sort((left, right) =>
		left.orderNumber.localeCompare(right.orderNumber)
	);

	return {
		month,
		totals,
		exceptions: [...exceptionBuckets.values()]
			.map((entry) => ({
				code: entry.code,
				orderCount: entry.count,
				value: Number.isNaN(entry.value) ? null : entry.value,
				currency: entry.currency,
				basis: entry.basis,
				detail: entry.detail,
			}))
			.sort((left, right) => left.code.localeCompare(right.code)),
		orders: monthRows,
		ineffectiveConsumption: toNumber(
			R(ineffectiveConsumption).toDecimalPlaces(2)
		),
	};
}

/** One order's remaining commitment at the end of one month. */
function remainingAt(
	entry: {
		value: number;
		endedMonth: string | null;
		eligibleMonth: string;
	},
	orderUid: string,
	throughMonth: string,
	effectiveThroughMonth: (orderUid: string, through: string | null) => number
): number {
	if (entry.eligibleMonth > throughMonth) return 0;
	const consumed = effectiveThroughMonth(orderUid, throughMonth);
	if (entry.endedMonth !== null && entry.endedMonth <= throughMonth) {
		return 0;
	}
	return toNumber(sub(R(entry.value), R(consumed)));
}

/**
 * Months with supplier-order activity (a recorded act or a consumption), so an
 * order-only historical month stays reachable through the report controls.
 */
export async function loadOrderCommitmentMonths(
	db: SqlConnection
): Promise<string[]> {
	const [rows] = (await db.execute(
		`SELECT DISTINCT DATE_FORMAT(e.created_at, '%Y-%m') AS month
       FROM order_events e
       JOIN orders o ON o.order_uid = e.order_uid
      WHERE o.direction = 'supplier' AND o.isDelete = 0`
	)) as [DbRow[], unknown];
	const [consumptionRows] = (await db.execute(
		`SELECT DISTINCT DATE_FORMAT(c.recognized_period, '%Y-%m') AS month
       FROM order_consumptions c
       JOIN orders o ON o.order_uid = c.order_uid
      WHERE o.direction = 'supplier' AND o.isDelete = 0`
	)) as [DbRow[], unknown];
	const months = new Set<string>();
	for (const row of [...rows, ...consumptionRows]) {
		const value = s(row, 'month');
		if (value) months.add(value);
	}
	return [...months].sort().reverse();
}
