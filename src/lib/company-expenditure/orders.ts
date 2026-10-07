/**
 * Canonical orders — one explicit order identity for client and supplier
 * orders, and the document-backed review that classifies the legacy copies.
 *
 * Invariants this module owns:
 *  - an order has exactly one explicit direction, `client` or `supplier`; a
 *    legacy table name, a counterparty text match, or a client-invoice link is
 *    never used to assign one;
 *  - `order_uid` is the identity every consumer references; `order_number`
 *    stays a display/search document number shared freely across orders;
 *  - a legacy copy is queued in `order_legacy_mappings` and changes state only
 *    through a versioned, reasoned, evidence-backed review decision — the
 *    legacy rows themselves are never merged or deleted;
 *  - client order value is commercial context: it is never incurred cost, a
 *    supplier commitment, or recognized revenue, and only a client order may
 *    carry a client-invoice rollup;
 *  - an unknown amount stays NULL. Nothing here turns unknown into zero.
 *
 * Atomicity: pass `connection` to run inside the caller's transaction (an
 * invoice link that must commit with the invoice row, or a later financial
 * close that snapshots every source); otherwise the module opens its own.
 * Reads accept a caller connection for the same reason. Nothing here opens a
 * transaction while a caller connection is supplied.
 */

import { randomUUID } from 'node:crypto';
import type Decimal from 'decimal.js';
import { add, R, sub, toNumber } from '@/lib/money';
import { query, withTransaction } from '@/utils/database';
import type { SqlConnection } from './records';

export interface OrderActor {
	id: number | null;
	name?: string | null;
}

export interface OrderOptions {
	/** Use the caller's connection/transaction instead of opening one. */
	connection?: SqlConnection;
}

/** A command or validation failure the route maps onto an HTTP status. */
export class OrderError extends Error {
	readonly code: string;
	readonly status: number;
	readonly detail: Record<string, unknown>;

	constructor(
		code: string,
		message: string,
		status: number,
		detail: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'OrderError';
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

export type OrderDirection = 'client' | 'supplier';
export type OrderStatus =
	| 'draft'
	| 'pending'
	| 'approved'
	| 'completed'
	| 'cancelled';
export type OrderFirmness = 'firm' | 'cancellable' | 'unknown';
export type OrderAmountBasis = 'gross' | 'net' | 'unknown';

export type LegacyOrderStore =
	| 'purchase_orders'
	| 'outgoing_purchase_orders'
	| 'project_purchase_orders'
	| 'project_invoices';
export type LegacyReviewState =
	| 'pending'
	| 'resolved'
	| 'duplicate'
	| 'insufficient';
export type LegacyOrderDecision =
	| 'classify'
	| 'link'
	| 'duplicate'
	| 'insufficient';

export interface OrderRecord {
	/** Numeric row id — the entity id documents attach to. */
	id: number;
	orderUid: string;
	orderNumber: string;
	direction: OrderDirection;
	counterpartyName: string;
	companyId: number | null;
	projectId: number | null;
	projectCode: string | null;
	projectName: string | null;
	currency: string;
	amountBasis: OrderAmountBasis;
	grossAmount: number | null;
	taxAmount: number | null;
	netAmount: number | null;
	/** Value invoiced against this client order through linked client invoices. */
	clientInvoicedValue: number | null;
	/** Supported remaining client order value, or null when unsupported. */
	clientRemainingValue: number | null;
	orderDate: string | null;
	status: OrderStatus;
	firmness: OrderFirmness;
	firmnessEvidenceReference: string | null;
	sourceDocumentReference: string | null;
	evidenceReference: string | null;
	remarks: string | null;
	financialVersion: number;
	createdFrom: 'entry' | 'legacy_review';
	originMappingId: number | null;
	createdBy: number | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface OrderEventRecord {
	event: 'created' | 'updated' | 'client_invoiced';
	version: number | null;
	amount: number | null;
	reference: string | null;
	actorId: number | null;
	reason: string | null;
	createdAt: string | null;
}

export interface CreateOrderInput {
	direction: unknown;
	orderNumber: unknown;
	counterpartyName: unknown;
	projectId?: unknown;
	companyId?: unknown;
	currency?: unknown;
	amountBasis?: unknown;
	grossAmount?: unknown;
	taxAmount?: unknown;
	netAmount?: unknown;
	orderDate?: unknown;
	status?: unknown;
	firmness?: unknown;
	firmnessEvidenceReference?: unknown;
	sourceDocumentReference?: unknown;
	evidenceReference?: unknown;
	remarks?: unknown;
}

export interface OrderPatch {
	orderNumber?: unknown;
	counterpartyName?: unknown;
	projectId?: unknown;
	companyId?: unknown;
	currency?: unknown;
	amountBasis?: unknown;
	grossAmount?: unknown;
	taxAmount?: unknown;
	netAmount?: unknown;
	orderDate?: unknown;
	status?: unknown;
	firmness?: unknown;
	firmnessEvidenceReference?: unknown;
	sourceDocumentReference?: unknown;
	evidenceReference?: unknown;
	remarks?: unknown;
}

export interface UpdateOrderInput {
	orderUid: string;
	expectedVersion: number;
	patch: OrderPatch;
}

export interface OrderQuery {
	direction?: unknown;
	projectId?: unknown;
	status?: unknown;
	includeCancelled?: unknown;
	limit?: unknown;
	offset?: unknown;
}

/** A supported per-currency, per-basis subtotal; currencies never mix. */
export interface OrderValueTotal {
	direction: OrderDirection;
	currency: string;
	basis: 'gross' | 'net';
	orderValue: number;
	orderCount: number;
}

export interface OrderList {
	orders: OrderRecord[];
	totals: OrderValueTotal[];
	/** Orders whose supported value is unknown — never shown as zero. */
	unknownValueCount: number;
	counts: { total: number; client: number; supplier: number };
	limit: number;
	offset: number;
}

export interface LegacyCollision {
	mappingId: number;
	legacyStore: LegacyOrderStore;
	legacyId: number;
	documentNumber: string | null;
	reviewState: LegacyReviewState;
}

export interface LegacyOrderMapping {
	mappingId: number;
	legacyStore: LegacyOrderStore;
	legacyId: number;
	documentNumber: string | null;
	counterpartyName: string | null;
	legacyAmount: number | null;
	legacyDate: string | null;
	legacyStatus: string | null;
	projectId: number | null;
	reviewState: LegacyReviewState;
	resolvedDirection: OrderDirection | null;
	canonicalOrderUid: string | null;
	duplicateOfMappingId: number | null;
	version: number;
	reason: string | null;
	evidenceReference: string | null;
	reviewedBy: number | null;
	reviewedAt: string | null;
	/**
	 * Other legacy copies sharing this document number. A candidate list, not
	 * identity evidence: the reviewer still has to decide.
	 */
	collisions: LegacyCollision[];
}

export interface OrderReviewQueue {
	items: LegacyOrderMapping[];
	pendingCount: number;
	/** Canonical orders a `link` decision may target. */
	canonicalOrders: Array<{
		orderUid: string;
		orderNumber: string;
		direction: OrderDirection;
		counterpartyName: string;
	}>;
	/** Resolved copies a `duplicate` decision may target. */
	resolvedMappings: Array<{
		mappingId: number;
		legacyStore: LegacyOrderStore;
		legacyId: number;
		documentNumber: string | null;
		direction: OrderDirection | null;
		canonicalOrderUid: string | null;
	}>;
}

export interface LegacyOrderResolutionInput {
	mappingId: number;
	decision: LegacyOrderDecision;
	expectedVersion: number;
	reason: unknown;
	evidenceReference?: unknown;
	direction?: unknown;
	counterpartyName?: unknown;
	projectId?: unknown;
	currency?: unknown;
	amountBasis?: unknown;
	grossAmount?: unknown;
	taxAmount?: unknown;
	netAmount?: unknown;
	orderDate?: unknown;
	status?: unknown;
	firmness?: unknown;
	firmnessEvidenceReference?: unknown;
	sourceDocumentReference?: unknown;
	orderNumber?: unknown;
	remarks?: unknown;
	canonicalOrderUid?: unknown;
	duplicateOfMappingId?: unknown;
}

export interface LegacyOrderResolution {
	mapping: LegacyOrderMapping;
	order: OrderRecord | null;
	decision: LegacyOrderDecision;
}

export interface ClientInvoiceLinkInput {
	orderUid: string;
	/** Positive adds invoiced value; negative reverses it. */
	amountDelta: number;
	invoiceId: number | null;
	invoiceNumber: string | null;
	actorId: number | null;
}

export interface ClientInvoiceLinkResult {
	orderUid: string;
	clientInvoicedValue: number;
	clientRemainingValue: number | null;
}

type DbRow = Record<string, unknown>;

const DIRECTIONS: OrderDirection[] = ['client', 'supplier'];
const STATUSES: OrderStatus[] = [
	'draft',
	'pending',
	'approved',
	'completed',
	'cancelled',
];
const FIRMNESS: OrderFirmness[] = ['firm', 'cancellable', 'unknown'];
const BASES: OrderAmountBasis[] = ['gross', 'net', 'unknown'];
const DECISIONS: LegacyOrderDecision[] = [
	'classify',
	'link',
	'duplicate',
	'insufficient',
];

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

function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function requiredText(value: unknown, max: number, code: string): string {
	const parsed = text(value, max);
	if (!parsed) {
		throw new OrderError(code, 'This field is required', 422, { field: code });
	}
	return parsed;
}

function enumValue<T extends string>(
	value: unknown,
	allowed: T[],
	fallback: T | null,
	code: string
): T | null {
	const parsed = text(value, 40);
	if (parsed === null) return fallback;
	if (!(allowed as string[]).includes(parsed)) {
		throw new OrderError('invalid_value', `Invalid value for ${code}`, 422, {
			field: code,
			allowed,
		});
	}
	return parsed as T;
}

/**
 * Money is stored to the cent (`decimal(15,2)`), matching the rest of the
 * expenditure module (`reconciliation.ts`). Never whole units: a stated
 * 250000.75 must stay 250000.75, and a rollup of two 33333.33 invoices must be
 * 66666.66. A missing amount is NULL and never reaches this helper as zero.
 */
function canonicalMoney(value: Decimal.Value): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

function amountOrNull(value: unknown, code: string): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		throw new OrderError('invalid_amount', `${code} must be a number`, 422, {
			field: code,
		});
	}
	return canonicalMoney(parsed);
}

function dateOrNull(value: unknown): string | null {
	const trimmed = text(value, 10);
	if (!trimmed) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new OrderError('invalid_date', 'Dates must be YYYY-MM-DD', 422, {
			field: 'order_date',
		});
	}
	return trimmed;
}

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function s(
	row: DbRow,
	key: string,
	fallback: string | null = null
): string | null {
	const value = row[key];
	if (value === null || value === undefined) return fallback;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'bigint')
		return String(value);
	return fallback;
}

function iso(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return s({ value }, 'value');
}

function timestamp(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	const raw = s({ value }, 'value');
	if (!raw) return null;
	return raw.replace(' ', 'T');
}

/** The value an order's stated basis supports, or null when unknown. */
export function statedOrderValue(order: {
	amountBasis: OrderAmountBasis;
	grossAmount: number | null;
	netAmount: number | null;
}): number | null {
	if (order.amountBasis === 'gross') return order.grossAmount;
	if (order.amountBasis === 'net') return order.netAmount;
	return null;
}

function remainingClientValue(order: {
	direction: OrderDirection;
	amountBasis: OrderAmountBasis;
	grossAmount: number | null;
	netAmount: number | null;
	clientInvoicedValue: number | null;
}): number | null {
	if (order.direction !== 'client') return null;
	const stated = statedOrderValue(order);
	if (stated === null) return null;
	return canonicalMoney(sub(stated, order.clientInvoicedValue ?? 0));
}

const ORDER_SELECT = `
  SELECT o.*, p.project_code,
         COALESCE(p.project_title, p.name) AS project_name
    FROM orders o
    LEFT JOIN projects p ON p.project_id = o.project_id AND p.isDelete = 0`;

export function mapOrderRow(row: DbRow): OrderRecord {
	const direction = (s(row, 'direction', 'supplier') ??
		'supplier') as OrderDirection;
	const amountBasis = (s(row, 'amount_basis', 'unknown') ??
		'unknown') as OrderAmountBasis;
	const record: OrderRecord = {
		id: num(row, 'id') ?? 0,
		orderUid: s(row, 'order_uid', '') ?? '',
		orderNumber: s(row, 'order_number', '') ?? '',
		direction,
		counterpartyName: s(row, 'counterparty_name', '') ?? '',
		companyId: num(row, 'company_id'),
		projectId: num(row, 'project_id'),
		projectCode: s(row, 'project_code'),
		projectName: s(row, 'project_name'),
		currency: s(row, 'currency', 'INR') ?? 'INR',
		amountBasis,
		grossAmount: num(row, 'gross_amount'),
		taxAmount: num(row, 'tax_amount'),
		netAmount: num(row, 'net_amount'),
		clientInvoicedValue: num(row, 'client_invoiced_value'),
		clientRemainingValue: null,
		orderDate: iso(row.order_date),
		status: (s(row, 'status', 'draft') ?? 'draft') as OrderStatus,
		firmness: (s(row, 'firmness', 'unknown') ?? 'unknown') as OrderFirmness,
		firmnessEvidenceReference: s(row, 'firmness_evidence_reference'),
		sourceDocumentReference: s(row, 'source_document_reference'),
		evidenceReference: s(row, 'evidence_reference'),
		remarks: s(row, 'remarks'),
		financialVersion: num(row, 'financial_version') ?? 1,
		createdFrom: (s(row, 'created_from', 'entry') ?? 'entry') as
			| 'entry'
			| 'legacy_review',
		originMappingId: num(row, 'origin_mapping_id'),
		createdBy: num(row, 'created_by'),
		createdAt: timestamp(row.created_at),
		updatedAt: timestamp(row.updated_at),
	};
	record.clientRemainingValue = remainingClientValue(record);
	return record;
}

function mapMappingRow(row: DbRow): LegacyOrderMapping {
	return {
		mappingId: num(row, 'id') ?? 0,
		legacyStore: s(row, 'legacy_store', '') as LegacyOrderStore,
		legacyId: num(row, 'legacy_id') ?? 0,
		documentNumber: s(row, 'document_number'),
		counterpartyName: s(row, 'counterparty_name'),
		legacyAmount: num(row, 'legacy_amount'),
		legacyDate: iso(row.legacy_date),
		legacyStatus: s(row, 'legacy_status'),
		projectId: num(row, 'project_id'),
		reviewState: (s(row, 'review_state', 'pending') ??
			'pending') as LegacyReviewState,
		resolvedDirection: (s(row, 'resolved_direction') ??
			null) as OrderDirection | null,
		canonicalOrderUid: s(row, 'canonical_order_uid'),
		duplicateOfMappingId: num(row, 'duplicate_of_mapping_id'),
		version: num(row, 'version') ?? 1,
		reason: s(row, 'reason'),
		evidenceReference: s(row, 'evidence_reference'),
		reviewedBy: num(row, 'reviewed_by'),
		reviewedAt: timestamp(row.reviewed_at),
		collisions: [],
	};
}

/** Normalised, validated create/classify payload. */
interface NormalisedOrder {
	direction: OrderDirection;
	orderNumber: string | null;
	counterpartyName: string;
	companyId: number | null;
	projectId: number | null;
	currency: string;
	amountBasis: OrderAmountBasis;
	grossAmount: number | null;
	taxAmount: number | null;
	netAmount: number | null;
	orderDate: string | null;
	status: OrderStatus;
	firmness: OrderFirmness;
	firmnessEvidenceReference: string | null;
	sourceDocumentReference: string | null;
	evidenceReference: string | null;
	remarks: string | null;
}

/**
 * A reference to another record (Project, company) is either absent — an
 * explicit null/blank, which stays unknown — or a live positive integer id. A
 * code, typo, or negative/fractional value is refused, never dropped to NULL,
 * so a bad reference cannot quietly remove the order from its Project.
 */
function referenceIdOrNull(
	value: unknown,
	field: string,
	code: string
): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new OrderError(code, `${field} must be a positive integer`, 422, {
			field,
		});
	}
	return parsed;
}

function normaliseOrder(
	input: CreateOrderInput,
	options: { requireDirection: boolean; fallbackOrderNumber?: string | null }
): NormalisedOrder {
	const direction = enumValue<OrderDirection>(
		input.direction,
		DIRECTIONS,
		null,
		'direction'
	);
	if (!direction) {
		throw new OrderError(
			'direction_required',
			'Order direction must be explicitly client or supplier',
			422,
			{ field: 'direction', allowed: DIRECTIONS }
		);
	}

	const orderNumber =
		text(input.orderNumber, 100) ?? options.fallbackOrderNumber ?? null;
	if (!orderNumber) {
		throw new OrderError(
			'order_number_required',
			'An order number is required',
			422,
			{ field: 'order_number' }
		);
	}

	const currencyRaw = text(input.currency, 64) ?? 'INR';
	const currency = currencyRaw.toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) {
		throw new OrderError('invalid_currency', 'Currency must be ISO 4217', 422, {
			field: 'currency',
		});
	}

	const amountBasis =
		enumValue<OrderAmountBasis>(
			input.amountBasis,
			BASES,
			'unknown',
			'amount_basis'
		) ?? 'unknown';
	const grossAmount = amountOrNull(input.grossAmount, 'gross_amount');
	const taxAmount = amountOrNull(input.taxAmount, 'tax_amount');
	const netAmount = amountOrNull(input.netAmount, 'net_amount');

	if (amountBasis === 'unknown') {
		if (grossAmount !== null || taxAmount !== null || netAmount !== null) {
			throw new OrderError(
				'amount_basis_unknown_with_amounts',
				'An unknown amount basis cannot carry amounts',
				422,
				{ field: 'amount_basis' }
			);
		}
	} else if (amountBasis === 'gross' && grossAmount === null) {
		throw new OrderError(
			'amount_missing_for_basis',
			'A gross-basis order needs its gross amount',
			422,
			{ field: 'gross_amount' }
		);
	} else if (amountBasis === 'net' && netAmount === null) {
		throw new OrderError(
			'amount_missing_for_basis',
			'A net-basis order needs its net amount',
			422,
			{ field: 'net_amount' }
		);
	}

	if (
		grossAmount !== null &&
		netAmount !== null &&
		taxAmount !== null &&
		Math.abs(grossAmount - (netAmount + taxAmount)) > 0.01
	) {
		throw new OrderError(
			'amounts_inconsistent',
			'Gross must equal net plus tax',
			422,
			{ field: 'gross_amount' }
		);
	}

	const firmness =
		enumValue<OrderFirmness>(input.firmness, FIRMNESS, 'unknown', 'firmness') ??
		'unknown';
	const firmnessEvidenceReference = text(input.firmnessEvidenceReference, 255);
	if (firmness !== 'unknown' && !firmnessEvidenceReference) {
		throw new OrderError(
			'firmness_evidence_required',
			`A ${firmness} order needs the firmness evidence reference`,
			422,
			{ field: 'firmness_evidence_reference' }
		);
	}

	return {
		direction,
		orderNumber,
		counterpartyName: requiredText(
			input.counterpartyName,
			255,
			'counterparty_required'
		),
		companyId: referenceIdOrNull(
			input.companyId,
			'company_id',
			'invalid_company'
		),
		projectId: referenceIdOrNull(
			input.projectId,
			'project_id',
			'invalid_project'
		),
		currency,
		amountBasis,
		grossAmount,
		taxAmount,
		netAmount,
		orderDate: dateOrNull(input.orderDate),
		status:
			enumValue<OrderStatus>(input.status, STATUSES, 'draft', 'status') ??
			'draft',
		firmness,
		firmnessEvidenceReference,
		sourceDocumentReference: text(input.sourceDocumentReference, 255),
		evidenceReference: text(input.evidenceReference, 255),
		remarks: text(input.remarks, 2000),
	};
}

async function assertProjectExists(
	db: SqlConnection,
	projectId: number | null
): Promise<void> {
	if (projectId === null) return;
	const [found] = (await db.execute(
		'SELECT project_id FROM projects WHERE project_id = ? AND isDelete = 0',
		[projectId]
	)) as [DbRow[], unknown];
	if (found.length === 0) {
		throw new OrderError('project_not_found', 'Project not found', 422, {
			field: 'project_id',
		});
	}
}

function mintOrderUid(): string {
	return `ord-${randomUUID()}`;
}

async function insertOrder(
	db: SqlConnection,
	orderUid: string,
	normalised: NormalisedOrder,
	options: {
		originMappingId: number | null;
		createdFrom: 'entry' | 'legacy_review';
		actor: OrderActor;
	}
): Promise<void> {
	await db.execute(
		`INSERT INTO orders (
      order_uid, order_number, direction, counterparty_name, company_id, project_id,
      currency, amount_basis, gross_amount, tax_amount, net_amount, order_date,
      status, firmness, firmness_evidence_reference, source_document_reference,
      evidence_reference, remarks, origin_mapping_id, created_from, financial_version, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			orderUid,
			normalised.orderNumber ?? '',
			normalised.direction,
			normalised.counterpartyName,
			normalised.companyId,
			normalised.projectId,
			normalised.currency,
			normalised.amountBasis,
			normalised.grossAmount,
			normalised.taxAmount,
			normalised.netAmount,
			normalised.orderDate,
			normalised.status,
			normalised.firmness,
			normalised.firmnessEvidenceReference,
			normalised.sourceDocumentReference,
			normalised.evidenceReference,
			normalised.remarks,
			options.originMappingId,
			options.createdFrom,
			1,
			options.actor.id,
		]
	);
}

async function appendOrderEvent(
	db: SqlConnection,
	orderUid: string,
	event: 'created' | 'updated' | 'client_invoiced',
	options: {
		version?: number | null;
		amount?: number | null;
		reference?: string | null;
		actorId: number | null;
		reason?: string | null;
		payload?: Record<string, unknown> | null;
	}
): Promise<void> {
	await db.execute(
		`INSERT INTO order_events (order_uid, version, event, amount, reference, actor_id, reason, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			orderUid,
			options.version ?? null,
			event,
			options.amount ?? null,
			options.reference ?? null,
			options.actorId,
			options.reason ?? null,
			options.payload ? JSON.stringify(options.payload) : null,
		]
	);
}

async function loadOrderByUid(
	db: SqlConnection,
	orderUid: string
): Promise<OrderRecord | null> {
	const [rows] = (await db.execute(
		`${ORDER_SELECT} WHERE o.order_uid = ? AND o.isDelete = 0`,
		[orderUid]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? mapOrderRow(rows[0]) : null;
}

/** Create one canonical order with an explicit direction. */
export async function createOrder(
	input: CreateOrderInput,
	actor: OrderActor,
	options?: OrderOptions
): Promise<OrderRecord> {
	const normalised = normaliseOrder(input, { requireDirection: true });
	return inTransaction(options, async (db) => {
		await assertProjectExists(db, normalised.projectId);
		const orderUid = mintOrderUid();
		await insertOrder(db, orderUid, normalised, {
			originMappingId: null,
			createdFrom: 'entry',
			actor,
		});
		await appendOrderEvent(db, orderUid, 'created', {
			version: 1,
			actorId: actor.id,
			payload: {
				direction: normalised.direction,
				order_number: normalised.orderNumber,
				status: normalised.status,
				amount_basis: normalised.amountBasis,
				gross_amount: normalised.grossAmount,
				net_amount: normalised.netAmount,
				currency: normalised.currency,
			},
		});
		const created = await loadOrderByUid(db, orderUid);
		if (!created) {
			throw new OrderError('order_write_failed', 'Order was not stored', 500);
		}
		return created;
	});
}

/**
 * Apply an operational/financial update to one order under the version the
 * caller expects. A stale or replayed update changes nothing.
 */
export async function updateOrder(
	input: UpdateOrderInput,
	actor: OrderActor,
	options?: OrderOptions
): Promise<OrderRecord> {
	return inTransaction(options, async (db) => {
		const [rows] = (await db.execute(
			`SELECT * FROM orders WHERE order_uid = ? AND isDelete = 0 FOR UPDATE`,
			[input.orderUid]
		)) as [DbRow[], unknown];
		if (rows.length === 0) {
			throw new OrderError('order_not_found', 'Order not found', 404);
		}
		const current = mapOrderRow(rows[0]);
		if (current.financialVersion !== Number(input.expectedVersion)) {
			throw new OrderError(
				'stale_version',
				'The order has moved on since it was loaded',
				409,
				{ currentVersion: current.financialVersion }
			);
		}

		const patch = input.patch ?? {};
		const merged: CreateOrderInput = {
			direction: current.direction,
			orderNumber:
				patch.orderNumber !== undefined
					? patch.orderNumber
					: current.orderNumber,
			counterpartyName:
				patch.counterpartyName !== undefined
					? patch.counterpartyName
					: current.counterpartyName,
			companyId:
				patch.companyId !== undefined ? patch.companyId : current.companyId,
			projectId:
				patch.projectId !== undefined ? patch.projectId : current.projectId,
			currency:
				patch.currency !== undefined ? patch.currency : current.currency,
			amountBasis:
				patch.amountBasis !== undefined
					? patch.amountBasis
					: current.amountBasis,
			grossAmount:
				patch.grossAmount !== undefined
					? patch.grossAmount
					: current.grossAmount,
			taxAmount:
				patch.taxAmount !== undefined ? patch.taxAmount : current.taxAmount,
			netAmount:
				patch.netAmount !== undefined ? patch.netAmount : current.netAmount,
			orderDate:
				patch.orderDate !== undefined ? patch.orderDate : current.orderDate,
			status: patch.status !== undefined ? patch.status : current.status,
			firmness:
				patch.firmness !== undefined ? patch.firmness : current.firmness,
			firmnessEvidenceReference:
				patch.firmnessEvidenceReference !== undefined
					? patch.firmnessEvidenceReference
					: current.firmnessEvidenceReference,
			sourceDocumentReference:
				patch.sourceDocumentReference !== undefined
					? patch.sourceDocumentReference
					: current.sourceDocumentReference,
			evidenceReference:
				patch.evidenceReference !== undefined
					? patch.evidenceReference
					: current.evidenceReference,
			remarks: patch.remarks !== undefined ? patch.remarks : current.remarks,
		};
		const normalised = normaliseOrder(merged, {
			requireDirection: true,
			fallbackOrderNumber: current.orderNumber,
		});
		await assertProjectExists(db, normalised.projectId);

		const nextVersion = current.financialVersion + 1;
		await db.execute(
			`UPDATE orders SET
         order_number = ?, counterparty_name = ?, company_id = ?, project_id = ?,
         currency = ?, amount_basis = ?, gross_amount = ?, tax_amount = ?, net_amount = ?,
         order_date = ?, status = ?, firmness = ?, firmness_evidence_reference = ?,
         source_document_reference = ?, evidence_reference = ?, remarks = ?,
         financial_version = ?
       WHERE order_uid = ? AND isDelete = 0`,
			[
				normalised.orderNumber ?? current.orderNumber,
				normalised.counterpartyName,
				normalised.companyId,
				normalised.projectId,
				normalised.currency,
				normalised.amountBasis,
				normalised.grossAmount,
				normalised.taxAmount,
				normalised.netAmount,
				normalised.orderDate,
				normalised.status,
				normalised.firmness,
				normalised.firmnessEvidenceReference,
				normalised.sourceDocumentReference,
				normalised.evidenceReference,
				normalised.remarks,
				nextVersion,
				input.orderUid,
			]
		);
		await appendOrderEvent(db, input.orderUid, 'updated', {
			version: nextVersion,
			actorId: actor.id,
			reason: text(patch.remarks, 2000),
			payload: {
				status: normalised.status,
				firmness: normalised.firmness,
				amount_basis: normalised.amountBasis,
			},
		});
		const updated = await loadOrderByUid(db, input.orderUid);
		if (!updated) {
			throw new OrderError('order_write_failed', 'Order was not stored', 500);
		}
		return updated;
	});
}

interface ListFilter {
	direction: OrderDirection | null;
	projectId: number | null;
	status: OrderStatus | null;
	includeCancelled: boolean;
	limit: number;
	offset: number;
}

function normaliseQuery(queryInput: OrderQuery = {}): ListFilter {
	const rawLimit = queryInput.limit;
	let limit = 100;
	if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
		const parsed = Number(rawLimit);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
			throw new OrderError(
				'invalid_pagination',
				'limit must be an integer between 1 and 200',
				400,
				{ field: 'limit' }
			);
		}
		limit = parsed;
	}
	const rawOffset = queryInput.offset;
	let offset = 0;
	if (rawOffset !== undefined && rawOffset !== null && rawOffset !== '') {
		const parsed = Number(rawOffset);
		if (!Number.isInteger(parsed) || parsed < 0) {
			throw new OrderError(
				'invalid_pagination',
				'offset must be a non-negative integer',
				400,
				{ field: 'offset' }
			);
		}
		offset = parsed;
	}
	let projectId: number | null = null;
	if (
		queryInput.projectId !== undefined &&
		queryInput.projectId !== null &&
		queryInput.projectId !== ''
	) {
		const parsed = Number(queryInput.projectId);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new OrderError(
				'invalid_project',
				'project_id must be a positive integer',
				400,
				{ field: 'project_id' }
			);
		}
		projectId = parsed;
	}
	return {
		direction: enumValue<OrderDirection>(
			queryInput.direction,
			DIRECTIONS,
			null,
			'direction'
		),
		projectId,
		status: enumValue<OrderStatus>(queryInput.status, STATUSES, null, 'status'),
		includeCancelled:
			queryInput.includeCancelled === true ||
			queryInput.includeCancelled === '1' ||
			queryInput.includeCancelled === 'true',
		limit,
		offset,
	};
}

function filterSql(filter: ListFilter): {
	where: string;
	params: Array<string | number>;
} {
	const clauses = ['o.isDelete = 0'];
	const params: Array<string | number> = [];
	if (filter.direction) {
		clauses.push('o.direction = ?');
		params.push(filter.direction);
	}
	if (filter.projectId !== null) {
		clauses.push('o.project_id = ?');
		params.push(filter.projectId);
	}
	if (filter.status) {
		clauses.push('o.status = ?');
		params.push(filter.status);
	} else if (!filter.includeCancelled) {
		clauses.push("o.status <> 'cancelled'");
	}
	return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

const SUPPORTED_VALUE_SQL = `(
  (o.amount_basis = 'gross' AND o.gross_amount IS NOT NULL)
  OR (o.amount_basis = 'net' AND o.net_amount IS NOT NULL)
)`;

/** List canonical orders with supported per-currency/per-basis subtotals. */
export async function fetchOrders(
	queryInput: OrderQuery = {},
	options?: OrderOptions
): Promise<OrderList> {
	const filter = normaliseQuery(queryInput);
	const db = connectionFor(options);
	const { where, params } = filterSql(filter);

	const [rows] = (await db.execute(
		`${ORDER_SELECT} ${where}
      ORDER BY (o.order_date IS NULL), o.order_date DESC, o.id DESC
      LIMIT ? OFFSET ?`,
		[...params, filter.limit, filter.offset]
	)) as [DbRow[], unknown];

	const [totalsRows] = (await db.execute(
		`SELECT o.direction, o.currency,
            (CASE WHEN o.amount_basis = 'gross' THEN 'gross' ELSE 'net' END) AS basis,
            SUM(CASE WHEN o.amount_basis = 'gross' THEN o.gross_amount ELSE o.net_amount END) AS order_value,
            COUNT(*) AS order_count
       FROM orders o ${where} AND ${SUPPORTED_VALUE_SQL}
      GROUP BY o.direction, o.currency, basis
      ORDER BY o.direction, o.currency, basis`,
		params
	)) as [DbRow[], unknown];

	const [unknownRows] = (await db.execute(
		`SELECT COUNT(*) AS n FROM orders o ${where} AND NOT ${SUPPORTED_VALUE_SQL}`,
		params
	)) as [DbRow[], unknown];

	const [countRows] = (await db.execute(
		`SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN o.direction = 'client' THEN 1 ELSE 0 END) AS client,
         SUM(CASE WHEN o.direction = 'supplier' THEN 1 ELSE 0 END) AS supplier
       FROM orders o ${where}`,
		params
	)) as [DbRow[], unknown];

	const counts = countRows[0] ?? {};
	return {
		orders: rows.map(mapOrderRow),
		totals: totalsRows.map((row) => ({
			direction: s(row, 'direction', 'supplier') as OrderDirection,
			currency: s(row, 'currency', 'INR') ?? 'INR',
			basis: s(row, 'basis', 'net') as 'gross' | 'net',
			orderValue: num(row, 'order_value') ?? 0,
			orderCount: num(row, 'order_count') ?? 0,
		})),
		unknownValueCount: num(unknownRows[0] ?? {}, 'n') ?? 0,
		counts: {
			total: num(counts, 'total') ?? 0,
			client: num(counts, 'client') ?? 0,
			supplier: num(counts, 'supplier') ?? 0,
		},
		limit: filter.limit,
		offset: filter.offset,
	};
}

/** One order with its append-only journal. */
export async function fetchOrder(
	orderUid: string,
	options?: OrderOptions
): Promise<{ order: OrderRecord; events: OrderEventRecord[] }> {
	const db = connectionFor(options);
	const order = await loadOrderByUid(db, orderUid);
	if (!order) {
		throw new OrderError('order_not_found', 'Order not found', 404);
	}
	const [eventRows] = (await db.execute(
		`SELECT event, version, amount, reference, actor_id, reason, created_at
       FROM order_events WHERE order_uid = ? ORDER BY id`,
		[orderUid]
	)) as [DbRow[], unknown];
	return {
		order,
		events: eventRows.map((row) => ({
			event: s(row, 'event', 'updated') as OrderEventRecord['event'],
			version: num(row, 'version'),
			amount: num(row, 'amount'),
			reference: s(row, 'reference'),
			actorId: num(row, 'actor_id'),
			reason: s(row, 'reason'),
			createdAt: timestamp(row.created_at),
		})),
	};
}

/**
 * Register any legacy copy that is not queued yet. The migration backfills the
 * rows that existed then; this keeps the queue complete for rows written by a
 * legacy endpoint afterwards. Idempotent: the unique copy key is the backstop.
 */
export async function syncLegacyOrderMappings(
	db: SqlConnection
): Promise<void> {
	const statements: Array<
		[string, string, Array<string | number | boolean | null>]
	> = [
		[
			`purchase_orders`,
			`INSERT INTO order_legacy_mappings
         (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
       SELECT 'purchase_orders', po.id, po.po_number, po.vendor_name,
              COALESCE(po.po_amount, po.total, po.net_amount), po.po_date, po.status, po.project_id
         FROM purchase_orders po
        WHERE (po.isDelete = 0 OR po.isDelete IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM order_legacy_mappings m
             WHERE m.legacy_store = 'purchase_orders' AND m.legacy_id = po.id)`,
			[],
		],
		[
			`outgoing_purchase_orders`,
			`INSERT INTO order_legacy_mappings
         (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
       SELECT 'outgoing_purchase_orders', po.id, po.po_number, po.company_name,
              po.po_amount, po.po_date, po.status, NULL
         FROM outgoing_purchase_orders po
        WHERE po.isDelete = 0
          AND NOT EXISTS (
            SELECT 1 FROM order_legacy_mappings m
             WHERE m.legacy_store = 'outgoing_purchase_orders' AND m.legacy_id = po.id)`,
			[],
		],
		[
			`project_purchase_orders`,
			`INSERT INTO order_legacy_mappings
         (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
       SELECT 'project_purchase_orders', po.id, po.po_number,
              CONCAT_WS(' / ', po.client_name, po.vendor_name),
              po.net_amount, po.po_date, NULL, po.project_id
         FROM project_purchase_orders po
        WHERE NOT EXISTS (
            SELECT 1 FROM order_legacy_mappings m
             WHERE m.legacy_store = 'project_purchase_orders' AND m.legacy_id = po.id)`,
			[],
		],
		[
			`project_invoices`,
			`INSERT INTO order_legacy_mappings
         (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
       SELECT 'project_invoices', pi.id, pi.po_number, pi.client_name,
              COALESCE(pi.po_amount, pi.invoice_amount), pi.po_date, pi.status, pi.project_id
         FROM project_invoices pi
        WHERE pi.isDelete = 0 AND pi.tab_type = 'purchase_order'
          AND NOT EXISTS (
            SELECT 1 FROM order_legacy_mappings m
             WHERE m.legacy_store = 'project_invoices' AND m.legacy_id = pi.id)`,
			[],
		],
	];
	for (const [, sql, params] of statements) {
		try {
			await db.execute(sql, params);
		} catch (error) {
			// A concurrent sync may have inserted the same copy first (1062).
			const code = (error as { errno?: number; code?: string })?.errno;
			const name = (error as { code?: string })?.code;
			if (code !== 1062 && name !== 'ER_DUP_ENTRY') throw error;
		}
	}
}

/** The legacy review queue with collision candidates. */
export async function fetchOrderReviewQueue(
	queryInput: { limit?: unknown; state?: unknown } = {},
	options?: OrderOptions
): Promise<OrderReviewQueue> {
	const db = connectionFor(options);
	await syncLegacyOrderMappings(db);

	const limitRaw = queryInput.limit;
	let limit = 200;
	if (limitRaw !== undefined && limitRaw !== null && limitRaw !== '') {
		const parsed = Number(limitRaw);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
			throw new OrderError(
				'invalid_pagination',
				'limit must be an integer between 1 and 500',
				400,
				{ field: 'limit' }
			);
		}
		limit = parsed;
	}
	const state = enumValue<LegacyReviewState>(
		queryInput.state,
		['pending', 'resolved', 'duplicate', 'insufficient'],
		null,
		'state'
	);

	const [rows] = (await db.execute(
		`SELECT * FROM order_legacy_mappings
      ${state ? 'WHERE review_state = ?' : ''}
      ORDER BY (review_state = 'pending') DESC, id DESC
      LIMIT ?`,
		state ? [state, limit] : [limit]
	)) as [DbRow[], unknown];

	const items = rows.map(mapMappingRow);

	const documentNumbers = [
		...new Set(
			items
				.map((item) => item.documentNumber)
				.filter((value): value is string => Boolean(value))
		),
	];
	if (documentNumbers.length > 0) {
		const placeholders = documentNumbers.map(() => '?').join(', ');
		const [collisionRows] = (await db.execute(
			`SELECT id, legacy_store, legacy_id, document_number, review_state
         FROM order_legacy_mappings WHERE document_number IN (${placeholders})
         ORDER BY id`,
			documentNumbers
		)) as [DbRow[], unknown];
		for (const row of collisionRows) {
			const mappingId = num(row, 'id') ?? 0;
			const documentNumber = s(row, 'document_number');
			for (const item of items) {
				if (item.documentNumber !== documentNumber) continue;
				// A copy is never its own collision candidate; two queued copies
				// sharing a number must see each other whether or not both are
				// on the returned page.
				if (item.mappingId === mappingId) continue;
				item.collisions.push({
					mappingId,
					legacyStore: s(row, 'legacy_store', '') as LegacyOrderStore,
					legacyId: num(row, 'legacy_id') ?? 0,
					documentNumber,
					reviewState: (s(row, 'review_state', 'pending') ??
						'pending') as LegacyReviewState,
				});
			}
		}
	}

	const [pendingRows] = (await db.execute(
		`SELECT COUNT(*) AS n FROM order_legacy_mappings WHERE review_state = 'pending'`
	)) as [DbRow[], unknown];

	const [canonicalRows] = (await db.execute(
		`SELECT order_uid, order_number, direction, counterparty_name FROM orders
      WHERE isDelete = 0 ORDER BY id LIMIT 200`
	)) as [DbRow[], unknown];

	const [resolvedRows] = (await db.execute(
		`SELECT id, legacy_store, legacy_id, document_number, resolved_direction, canonical_order_uid
       FROM order_legacy_mappings
      WHERE review_state IN ('resolved', 'duplicate') AND canonical_order_uid IS NOT NULL
      ORDER BY id LIMIT 200`
	)) as [DbRow[], unknown];

	return {
		items,
		pendingCount: num(pendingRows[0] ?? {}, 'n') ?? 0,
		canonicalOrders: canonicalRows.map((row) => ({
			orderUid: s(row, 'order_uid', '') ?? '',
			orderNumber: s(row, 'order_number', '') ?? '',
			direction: s(row, 'direction', 'supplier') as OrderDirection,
			counterpartyName: s(row, 'counterparty_name', '') ?? '',
		})),
		resolvedMappings: resolvedRows.map((row) => ({
			mappingId: num(row, 'id') ?? 0,
			legacyStore: s(row, 'legacy_store', '') as LegacyOrderStore,
			legacyId: num(row, 'legacy_id') ?? 0,
			documentNumber: s(row, 'document_number'),
			direction: (s(row, 'resolved_direction') ??
				null) as OrderDirection | null,
			canonicalOrderUid: s(row, 'canonical_order_uid'),
		})),
	};
}

/**
 * Apply one document-backed review decision. The decision carries the version
 * it was made against, so a replayed or concurrent review changes nothing; a
 * legacy copy is never merged or deleted, only linked.
 */
export async function resolveLegacyOrder(
	input: LegacyOrderResolutionInput,
	actor: OrderActor,
	options?: OrderOptions
): Promise<LegacyOrderResolution> {
	const decision = enumValue<LegacyOrderDecision>(
		input.decision,
		DECISIONS,
		null,
		'decision'
	);
	if (!decision) {
		throw new OrderError(
			'decision_required',
			'A review decision is required',
			422,
			{ field: 'decision', allowed: DECISIONS }
		);
	}
	const reason = requiredText(input.reason, 2000, 'reason_required');
	const evidenceReference = text(input.evidenceReference, 255);
	if (decision !== 'insufficient' && !evidenceReference) {
		throw new OrderError(
			'evidence_required',
			'A document-backed decision needs its evidence reference',
			422,
			{ field: 'evidence_reference' }
		);
	}

	return inTransaction(options, async (db) => {
		const [rows] = (await db.execute(
			`SELECT * FROM order_legacy_mappings WHERE id = ? FOR UPDATE`,
			[input.mappingId]
		)) as [DbRow[], unknown];
		if (rows.length === 0) {
			throw new OrderError('mapping_not_found', 'Legacy copy not found', 404);
		}
		const current = mapMappingRow(rows[0]);
		if (current.version !== Number(input.expectedVersion)) {
			throw new OrderError(
				'stale_version',
				'The legacy copy has been reviewed since it was loaded',
				409,
				{ currentVersion: current.version }
			);
		}

		let order: OrderRecord | null = null;
		let canonicalOrderUid: string | null = null;
		let direction: OrderDirection | null = null;
		let duplicateOfMappingId: number | null = null;
		let nextState: LegacyReviewState = 'pending';

		if (decision === 'classify') {
			const normalised = normaliseOrder(
				{
					direction: input.direction,
					orderNumber: input.orderNumber,
					counterpartyName: input.counterpartyName,
					projectId: input.projectId ?? current.projectId,
					currency: input.currency,
					amountBasis: input.amountBasis,
					grossAmount: input.grossAmount,
					taxAmount: input.taxAmount,
					netAmount: input.netAmount,
					orderDate: input.orderDate ?? current.legacyDate,
					status: input.status,
					firmness: input.firmness,
					firmnessEvidenceReference: input.firmnessEvidenceReference,
					sourceDocumentReference: input.sourceDocumentReference,
					evidenceReference,
					remarks:
						text(input.remarks, 2000) ??
						`Classified from ${current.legacyStore}#${current.legacyId}`,
				},
				{
					requireDirection: true,
					fallbackOrderNumber: current.documentNumber,
				}
			);
			await assertProjectExists(db, normalised.projectId);
			canonicalOrderUid = mintOrderUid();
			direction = normalised.direction;
			await insertOrder(db, canonicalOrderUid, normalised, {
				originMappingId: current.mappingId,
				createdFrom: 'legacy_review',
				actor,
			});
			await appendOrderEvent(db, canonicalOrderUid, 'created', {
				version: 1,
				actorId: actor.id,
				reason,
				payload: {
					origin: `${current.legacyStore}#${current.legacyId}`,
					evidence_reference: evidenceReference,
					direction: normalised.direction,
					status: normalised.status,
					amount_basis: normalised.amountBasis,
					currency: normalised.currency,
				},
			});
			const created = await loadOrderByUid(db, canonicalOrderUid);
			if (!created) {
				throw new OrderError('order_write_failed', 'Order was not stored', 500);
			}
			order = created;
			nextState = 'resolved';
		} else if (decision === 'link') {
			const targetUid = requiredText(
				input.canonicalOrderUid,
				64,
				'link_target_required'
			);
			const target = await loadOrderByUid(db, targetUid);
			if (!target) {
				throw new OrderError(
					'link_target_not_found',
					'The order to link does not exist',
					422,
					{ field: 'canonical_order_uid' }
				);
			}
			canonicalOrderUid = target.orderUid;
			direction = target.direction;
			order = target;
			nextState = 'resolved';
		} else if (decision === 'duplicate') {
			const targetId = num({ value: input.duplicateOfMappingId }, 'value');
			if (targetId === null || !Number.isInteger(targetId) || targetId <= 0) {
				throw new OrderError(
					'duplicate_target_required',
					'A duplicate target copy is required',
					422,
					{ field: 'duplicate_of_mapping_id' }
				);
			}
			if (targetId === current.mappingId) {
				throw new OrderError(
					'duplicate_self',
					'A copy cannot duplicate itself',
					422,
					{ field: 'duplicate_of_mapping_id' }
				);
			}
			const [targetRows] = (await db.execute(
				`SELECT * FROM order_legacy_mappings WHERE id = ?`,
				[targetId]
			)) as [DbRow[], unknown];
			if (targetRows.length === 0) {
				throw new OrderError(
					'duplicate_target_not_found',
					'The duplicate target copy does not exist',
					422,
					{ field: 'duplicate_of_mapping_id' }
				);
			}
			const target = mapMappingRow(targetRows[0]);
			if (
				!target.canonicalOrderUid ||
				(target.reviewState !== 'resolved' &&
					target.reviewState !== 'duplicate')
			) {
				throw new OrderError(
					'duplicate_target_unresolved',
					'The target copy has no reviewed canonical order yet',
					422,
					{ field: 'duplicate_of_mapping_id' }
				);
			}
			duplicateOfMappingId = target.mappingId;
			canonicalOrderUid = target.canonicalOrderUid;
			direction = target.resolvedDirection;
			order = await loadOrderByUid(db, target.canonicalOrderUid);
			nextState = 'duplicate';
		} else {
			nextState = 'insufficient';
		}

		await db.execute(
			`UPDATE order_legacy_mappings SET
         review_state = ?, resolved_direction = ?, canonical_order_uid = ?,
         duplicate_of_mapping_id = ?, version = version + 1, reason = ?,
         evidence_reference = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ?`,
			[
				nextState,
				direction,
				canonicalOrderUid,
				duplicateOfMappingId,
				reason,
				evidenceReference,
				actor.id,
				current.mappingId,
			]
		);
		await db.execute(
			`INSERT INTO order_review_decisions
         (mapping_id, decision, version, direction, canonical_order_uid,
          duplicate_of_mapping_id, reason, evidence_reference, actor_id, actor_name, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				current.mappingId,
				decision,
				current.version,
				direction,
				canonicalOrderUid,
				duplicateOfMappingId,
				reason,
				evidenceReference,
				actor.id,
				actor.name ?? null,
				JSON.stringify({
					legacy_store: current.legacyStore,
					legacy_id: current.legacyId,
					document_number: current.documentNumber,
					next_state: nextState,
				}),
			]
		);

		const [updatedRows] = (await db.execute(
			`SELECT * FROM order_legacy_mappings WHERE id = ?`,
			[current.mappingId]
		)) as [DbRow[], unknown];
		return {
			mapping: mapMappingRow(updatedRows[0]),
			order,
			decision,
		};
	});
}

/**
 * Apply a client-invoice delta to the canonical client order it references.
 * Runs inside the caller's transaction: the invoice row and the order rollup
 * commit together. A supplier order can never carry a client-invoice rollup.
 */
export async function linkClientInvoice(
	input: ClientInvoiceLinkInput,
	connection: SqlConnection
): Promise<ClientInvoiceLinkResult> {
	if (!Number.isFinite(input.amountDelta)) {
		throw new OrderError(
			'invalid_amount',
			'An invoice link needs a finite amount',
			422,
			{ field: 'total' }
		);
	}
	const [rows] = (await connection.execute(
		`SELECT order_uid, direction, amount_basis, gross_amount, net_amount, client_invoiced_value
       FROM orders WHERE order_uid = ? AND isDelete = 0 FOR UPDATE`,
		[input.orderUid]
	)) as [DbRow[], unknown];
	if (rows.length === 0) {
		throw new OrderError('order_not_found', 'Order not found', 422, {
			field: 'order_uid',
		});
	}
	const order = mapOrderRow(rows[0]);
	if (order.direction !== 'client') {
		throw new OrderError(
			'order_not_client',
			'A client invoice can only reference a client order',
			422,
			{ field: 'order_uid' }
		);
	}
	const delta = canonicalMoney(input.amountDelta);
	const nextInvoiced = canonicalMoney(
		add(order.clientInvoicedValue ?? 0, delta)
	);
	await connection.execute(
		`UPDATE orders SET client_invoiced_value = ? WHERE order_uid = ? AND isDelete = 0`,
		[nextInvoiced, input.orderUid]
	);
	await appendOrderEvent(connection, input.orderUid, 'client_invoiced', {
		amount: delta,
		reference: input.invoiceNumber,
		actorId: input.actorId,
		payload: { invoice_id: input.invoiceId },
	});
	return {
		orderUid: input.orderUid,
		clientInvoicedValue: nextInvoiced,
		clientRemainingValue: remainingClientValue({
			...order,
			clientInvoicedValue: nextInvoiced,
		}),
	};
}
