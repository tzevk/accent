/**
 * Cost Accrual recognition (#313). Contract:
 * C:/Files/OCDSE/Work/expenditure-accrual-contract.md.
 *
 * An evidenced Cost Accrual is the estimated cost of supplier work already
 * received but not yet invoiced. It is its own cost-bearing row with its own
 * `cost_uid` (registered in the shared registry), recognised under the same
 * rules as every other source: received-work period wins, a missing amount is
 * unknown, evidenced recoverable tax is excluded, and only `recognized` is
 * confirmed cost.
 *
 * The accrual-specific rules:
 *  - only received goods/services with evidence, or an explicitly identified
 *    supported estimate, create cost. An unused PO balance is not evidence
 *    (`po_balance_not_evidence`) and is refused at capture and recognition;
 *  - a replacement invoice supersedes only the matching accrual amount. The
 *    accrual's `recognized_amount` is explicitly reduced (`replaced_amount`
 *    accumulates), so the unmatched remainder stays visible and the invoice is
 *    never mutated;
 *  - an estimate-versus-actual difference is recorded with its period, reason,
 *    and evidence on the replacement row;
 *  - cancelling a replacement invoice atomically releases its live
 *    replacements in the same transaction (the caller's cancel command), so no
 *    committed state ever counts the invoice and the restored estimate
 *    together. The released row keeps its reason, actor, and journal.
 *
 * Reads and writes take the caller's `SqlConnection`; a command, its
 * replacement row, its registry link, and its journal row are one transaction.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '@/utils/database';
import { div, gt, gte, mul, R, sub, toNumber } from '@/lib/money';
import {
	convertToReporting,
	currencyCodeOf,
	evidenceOf,
	reportingCurrencyOf,
	resolveConversion,
} from './currency';
import { CostError } from './errors';
import { writeCostEvent, JOURNAL_COMMAND } from './journal';
import {
	evaluateCost,
	firstOfMonth,
	nextState,
	recognitionBlockers,
	resolveRecognitionPeriod,
} from './recognition';
import { monthBounds, type SqlConnection } from './records';
import {
	linkCostReference,
	registerCostIdentity,
	type CostSliceReference,
	type CostSourceAdapter,
} from './sources';
import type {
	AccrualRecordInfo,
	CostClassification,
	CostCommandName,
	CostCommandResult,
	CostJournalCommand,
	CostRecord,
	PeriodBasis,
	RecognitionState,
	TaxTreatment,
} from './types';

export const ACCRUAL_TABLE = 'cost_accruals';
export const ACCRUAL_SOURCE = 'cost_accrual' as const;

type DbRow = Record<string, unknown>;

function s(
	row: DbRow,
	key: string,
	fallback: string | null = null
): string | null {
	const value = row[key];
	if (value === null || value === undefined) return fallback;
	return typeof value === 'string' ? value : String(value);
}

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** A DECIMAL kept as its exact text (a rate holds more digits than a number). */
function dec(row: DbRow, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text.length === 0 ? null : text;
}

function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function amountOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		throw new CostError('invalid_amount', 'Amount must be a number', 422);
	}
	return parsed;
}

function dateOrNull(value: unknown): string | null {
	const trimmed = text(value, 10);
	if (!trimmed) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new CostError('invalid_date', `Invalid date: ${trimmed}`, 422);
	}
	return trimmed;
}

const CLASSIFICATIONS = ['project', 'company_overhead', 'unallocated'] as const;
const TAX_TREATMENTS = [
	'none',
	'recoverable',
	'non_recoverable',
	'unresolved',
] as const;
const EVIDENCE_BASES = [
	'received_work',
	'supported_estimate',
	'purchase_order',
] as const;

type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

function enumOrThrow<T extends string>(
	value: unknown,
	allowed: readonly T[],
	code: string,
	field: string
): T | null {
	if (value === null || value === undefined) return null;
	const candidate = String(value).trim();
	if (candidate === '') return null;
	if (!(allowed as readonly string[]).includes(candidate)) {
		throw new CostError(code, `Unknown ${field}: ${candidate}`, 422, { field });
	}
	return candidate as T;
}

/** The accrual register's own number (ACR-#####). */
async function nextAccrualNumber(db: SqlConnection): Promise<string> {
	const [rows] = (await db.execute(
		`SELECT accrual_number FROM cost_accruals
      WHERE accrual_number LIKE 'ACR-%'
      ORDER BY id DESC LIMIT 1 FOR UPDATE`
	)) as [Array<{ accrual_number: string }>, unknown];
	let next = 1;
	if (rows.length > 0) {
		const parsed = parseInt(rows[0].accrual_number.replace('ACR-', ''), 10);
		if (Number.isFinite(parsed)) next = parsed + 1;
	}
	return `ACR-${String(next).padStart(5, '0')}`;
}

/** Retryable MySQL errors for the module-owned capture transaction. */
function isRetryableNumberError(error: unknown): boolean {
	const code = (error as { code?: string } | null)?.code;
	if (typeof code === 'string') {
		return [
			'ER_DUP_ENTRY',
			'ER_LOCK_DEADLOCK',
			'ER_LOCK_WAIT_TIMEOUT',
		].includes(code);
	}
	const errno = (error as { errno?: number } | null)?.errno;
	return errno === 1062 || errno === 1213 || errno === 1205;
}

export interface AccrualCaptureInput {
	description: string;
	vendorName?: string | null;
	vendorReference?: string | null;
	/** Canonical supplier order (#310); consumption is #312/#314. */
	orderUid?: string | null;
	evidenceBasis?: EvidenceBasis | string | null;
	costClassification?: CostClassification | null;
	projectId?: number | null;
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	grossAmount?: number | string | null;
	taxAmount?: number | string | null;
	taxTreatment?: TaxTreatment;
	taxEvidenceReference?: string | null;
	currency?: string | null;
	reportingCurrency?: string | null;
	conversionRate?: number | string | null;
	conversionDate?: string | null;
	conversionEvidenceReference?: string | null;
	sourceReference?: string | null;
	evidenceReference?: string | null;
	ownerUserId?: number | null;
	submit?: boolean;
}

/** The financial fields an accrual may carry or change. */
export interface AccrualPatch {
	description?: string | null;
	vendorName?: string | null;
	vendorReference?: string | null;
	orderUid?: string | null;
	evidenceBasis?: EvidenceBasis | string | null;
	costClassification?: CostClassification | null;
	projectId?: number | null;
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	grossAmount?: number | string | null;
	taxAmount?: number | string | null;
	taxTreatment?: TaxTreatment;
	taxEvidenceReference?: string | null;
	currency?: string | null;
	reportingCurrency?: string | null;
	conversionRate?: number | string | null;
	conversionDate?: string | null;
	conversionEvidenceReference?: string | null;
	sourceReference?: string | null;
	evidenceReference?: string | null;
	ownerUserId?: number | null;
}

export interface AccrualCommandInput {
	/** `cost_accruals.id`. */
	id: number;
	command: CostCommandName;
	expectedVersion: number;
	reason?: string | null;
	evidenceReference?: string | null;
	patch?: AccrualPatch;
}

export interface RecordedAccrual {
	id: number;
	accrual_number: string;
	cost_uid: string;
	recognition_state: RecognitionState;
	financial_version: number;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	recognized_amount: number | null;
	cost_classification: CostClassification | null;
}

export interface AccrualReplacementInput {
	accrualId: number;
	invoiceId: number;
	/** Supersede the whole remaining estimate (an actual below it releases the variance). */
	final?: boolean;
	/** Explicit matched portion; default min(invoice amount, remaining estimate). */
	replacedAmount?: number | string | null;
	differenceReason?: string | null;
	differencePeriod?: string | null;
	evidenceReference?: string | null;
	reason?: string | null;
	expectedAccrualVersion: number;
	expectedInvoiceVersion: number;
}

export interface AccrualReplacementResult {
	replacement_id: number;
	accrual_id: number;
	accrual_cost_uid: string;
	invoice_id: number;
	invoice_cost_uid: string;
	replaced_amount: number;
	invoice_amount: number;
	difference_amount: number;
	accrual_remaining_amount: number;
	final: boolean;
	accrual_version: number;
	invoice_version: number;
}

export interface AccrualReplacementRow {
	id: number;
	invoice_id: number;
	invoice_cost_uid: string;
	replaced_amount: number;
	invoice_amount: number | null;
	difference_amount: number;
	difference_period: string | null;
	difference_reason: string | null;
	evidence_reference: string | null;
	replacement_period: string | null;
	is_final: boolean;
	state: 'active' | 'released';
	accrual_version: number;
	invoice_version: number;
	released_at: string | null;
	released_by: number | null;
	release_reason: string | null;
	release_evidence_reference: string | null;
}

export interface AccrualLinkRow {
	cost_uid: string;
	source_table: string;
	source_id: string;
	role: string;
	basis: string;
	review_state: string;
	evidence_reference: string | null;
}

export interface AccrualReplacementCandidate {
	invoice_id: number;
	invoice_number: string;
	cost_uid: string;
	currency: string | null;
	recognized_amount: number | null;
	recognition_period: string | null;
	financial_version: number;
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
}

export interface AccrualDetail {
	id: number;
	accrual_number: string;
	cost_uid: string;
	description: string;
	vendor_name: string | null;
	vendor_reference: string | null;
	order_uid: string | null;
	evidence_basis: EvidenceBasis;
	recognition_state: RecognitionState;
	financial_version: number;
	cost_classification: CostClassification | null;
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	service_period_start: string | null;
	service_period_end: string | null;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	currency: string;
	reporting_currency: string | null;
	conversion_rate: string | null;
	conversion_date: string | null;
	conversion_evidence_reference: string | null;
	converted_amount: number | null;
	gross_amount: number | null;
	tax_amount: number | null;
	tax_treatment: TaxTreatment;
	tax_evidence_reference: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	recognized_amount: number | null;
	replaced_amount: number;
	owner_user_id: number | null;
	recognized_by: number | null;
	recognized_at: string | null;
	replacements: AccrualReplacementRow[];
	links: AccrualLinkRow[];
	replacement_candidates: AccrualReplacementCandidate[];
}

/** One accrual's remaining estimate and its superseded portions (#312/#314). */
export interface AccrualConsumptionRow {
	accrual_id: number;
	accrual_cost_uid: string;
	order_uid: string | null;
	recognition_state: RecognitionState;
	recognition_period: string | null;
	currency: string | null;
	remaining_amount: number | null;
	replacements: Array<{
		replacement_id: number;
		invoice_id: number;
		invoice_cost_uid: string;
		replaced_amount: number;
		replacement_period: string | null;
		difference_amount: number;
		state: 'active' | 'released';
	}>;
}

/**
 * The remaining accrual slice is the shared `CostSliceReference` #312's
 * `CostSourceAdapter.loadSlices` consumes (one slice interface for every
 * cost source; the alias keeps the published #313 name).
 */
export type AccrualSliceReference = CostSliceReference;

const ACCRUAL_SELECT = `SELECT a.*,
    p.project_code,
    COALESCE(p.project_title, p.name) AS project_name,
    p.client_name,
    (SELECT COUNT(*) FROM cost_accrual_replacements r WHERE r.accrual_id = a.id) AS replacement_count`;

const ACCRUAL_FROM = `FROM cost_accruals a
    LEFT JOIN projects p ON p.project_id = a.project_id AND p.isDelete = 0`;

async function loadAccrualForUpdate(
	db: SqlConnection,
	id: number
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`${ACCRUAL_SELECT}
       ${ACCRUAL_FROM}
      WHERE a.id = ? AND a.isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * Register the accrual source's cost rows so `resolveCostReference` can read
 * them, and expose the remaining slice #312's consumption command reads.
 */
export const ACCRUAL_ADAPTER: CostSourceAdapter &
	Required<Pick<CostSourceAdapter, 'loadSlices'>> = {
	source: ACCRUAL_SOURCE,
	table: ACCRUAL_TABLE,
	async load(db, sourceId) {
		const id = Number(sourceId);
		if (!Number.isInteger(id) || id <= 0) return null;
		const [rows] = (await db.execute(
			`SELECT cost_uid, accrual_number, currency, gross_amount, tax_amount,
              recognized_amount, recognition_state, cost_classification, project_id
         FROM cost_accruals
        WHERE id = ? AND isDelete = 0`,
			[id]
		)) as [DbRow[], unknown];
		if (rows.length === 0) return null;
		const row = rows[0];
		return {
			cost_uid: s(row, 'cost_uid', '') ?? '',
			source: ACCRUAL_SOURCE,
			source_table: ACCRUAL_TABLE,
			source_id: String(id),
			label: s(row, 'accrual_number'),
			currency: s(row, 'currency', 'INR'),
			gross_amount: num(row, 'gross_amount'),
			tax_amount: num(row, 'tax_amount'),
			recognized_amount: num(row, 'recognized_amount'),
			recognition_state:
				(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
			classification:
				(s(row, 'cost_classification') as CostClassification | null) ?? null,
			project_id: num(row, 'project_id'),
		};
	},
	async loadSlices(db, sourceId, options) {
		const id = Number(sourceId);
		if (!Number.isInteger(id) || id <= 0) return [];
		// `forUpdate` locks the accrual row so #312's version-guarded
		// consumption command refuses a stale or replaced accrual before writing.
		const lock = options?.forUpdate ? ' FOR UPDATE' : '';
		const [rows] = (await db.execute(
			`SELECT cost_uid, accrual_number, currency, gross_amount, tax_amount,
              recognized_amount, replaced_amount, recognition_state, recognition_period,
              financial_version
         FROM cost_accruals
        WHERE id = ? AND isDelete = 0${lock}`,
			[id]
		)) as [DbRow[], unknown];
		if (rows.length === 0) return [];
		const row = rows[0];
		const state =
			(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft';
		const period = s(row, 'recognition_period');
		const recognized = num(row, 'recognized_amount');
		if (state !== 'recognized' || recognized === null || !period) return [];
		// The remaining slice: R0 = recognized at first recognition
		// (recognized + replaced), R' = recognized now, s = R'/R0. Amounts are
		// stated on the order's basis from this, so no caller-supplied amount is
		// ever needed (#312 contract §3/§10).
		const recognizedDecimal = R(recognized);
		const firstRecognized = recognizedDecimal.add(
			R(num(row, 'replaced_amount') ?? 0)
		);
		// R0 = 0 means there is nothing to scale; the zero slice then refuses
		// downstream through `missing_amount`.
		const scale = firstRecognized.isZero()
			? R(0)
			: div(recognizedDecimal, firstRecognized);
		const grossValue = num(row, 'gross_amount');
		const taxValue = num(row, 'tax_amount');
		return [
			{
				cost_uid: s(row, 'cost_uid', '') ?? '',
				source_table: ACCRUAL_TABLE,
				source_id: String(id),
				label: s(row, 'accrual_number'),
				currency: s(row, 'currency', 'INR'),
				recognition_period: period,
				gross_amount:
					grossValue === null
						? null
						: toNumber(mul(R(grossValue), scale).toDecimalPlaces(2)),
				tax_amount:
					taxValue === null
						? null
						: toNumber(mul(R(taxValue), scale).toDecimalPlaces(2)),
				recognized_amount: toNumber(recognizedDecimal.toDecimalPlaces(2)),
				recognition_state: state,
				financial_version: Number(num(row, 'financial_version') ?? 1),
			},
		];
	},
};

function accrualProjectCost(
	records: CostRecord[]
): Map<number, Map<string, number | null>> {
	const costs = new Map<number, Map<string, number | null>>();
	for (const record of records) {
		if (
			record.state !== 'recognized' ||
			record.classification !== 'project' ||
			record.projectId === null ||
			record.currency === null
		) {
			continue;
		}
		const perCurrency =
			costs.get(record.projectId) ?? new Map<string, number | null>();
		const existing = perCurrency.get(record.currency);
		if (existing === null || record.recognizedAmount === null) {
			perCurrency.set(record.currency, null);
		} else {
			perCurrency.set(
				record.currency,
				toNumber(R(existing ?? 0).add(R(record.recognizedAmount)))
			);
		}
		costs.set(record.projectId, perCurrency);
	}
	return costs;
}

/** Map one accrual row into the module's record shape. */
export function mapAccrualRecordRow(row: DbRow): CostRecord {
	const classification =
		(s(row, 'cost_classification') as CostClassification | null) ?? null;
	const state =
		(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft';
	const financial = {
		classification,
		// An accrual is operating cost: never an advance, deposit, prepayment,
		// or capital balance.
		nature: 'operating' as const,
		state,
		currency: currencyCodeOf(s(row, 'currency')),
		reportingCurrency: currencyCodeOf(s(row, 'reporting_currency')),
		conversionRate: dec(row, 'conversion_rate'),
		conversionDate: s(row, 'conversion_date'),
		conversionEvidenceReference: s(row, 'conversion_evidence_reference'),
		convertedAmount: num(row, 'converted_amount'),
		grossAmount: num(row, 'gross_amount'),
		taxAmount: num(row, 'tax_amount'),
		taxTreatment:
			(s(row, 'tax_treatment', 'unresolved') as TaxTreatment) ?? 'unresolved',
		taxEvidenceReference: s(row, 'tax_evidence_reference'),
		servicePeriodStart: s(row, 'service_period_start'),
		servicePeriodEnd: s(row, 'service_period_end'),
		// An accrual has no bill date: the period comes only from the
		// received-work/service period, never from a document that does not
		// exist yet.
		billDate: null,
		sourceReference: s(row, 'source_reference'),
		evidenceReference: s(row, 'evidence_reference'),
		recognitionPeriod: s(row, 'recognition_period'),
		periodBasis:
			(s(row, 'period_basis', 'unresolved') as PeriodBasis) ?? 'unresolved',
		recognizedAmount: num(row, 'recognized_amount'),
	};
	const accrual: AccrualRecordInfo = {
		evidence_basis:
			(s(row, 'evidence_basis', 'received_work') as EvidenceBasis) ??
			'received_work',
		order_uid: s(row, 'order_uid'),
		owner_user_id: num(row, 'owner_user_id'),
		replaced_amount: num(row, 'replaced_amount') ?? 0,
		remaining_amount: num(row, 'recognized_amount'),
		replacement_count: Number(num(row, 'replacement_count') ?? 0),
	};
	return {
		...financial,
		source: ACCRUAL_SOURCE,
		sourceId: String(num(row, 'id') ?? ''),
		split: null,
		id: Number(num(row, 'id') ?? 0),
		costUid: s(row, 'cost_uid'),
		expenseNumber: s(row, 'accrual_number', '') ?? '',
		expenseDate: null,
		createdAt: s(row, 'created_at'),
		vendorName: s(row, 'vendor_name'),
		description: s(row, 'description'),
		projectId: num(row, 'project_id'),
		projectCode: s(row, 'project_code'),
		projectName: s(row, 'project_name'),
		clientName: s(row, 'client_name'),
		financialVersion: Number(num(row, 'financial_version') ?? 1),
		recognizedAt: s(row, 'recognized_at'),
		recognizedBy: num(row, 'recognized_by'),
		accrual,
		evaluation: evaluateCost(financial),
	};
}

/** Every accrual slice that belongs to one month, any state. */
export async function loadAccrualMonthRecords(
	db: SqlConnection,
	month: string
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = (await db.execute(
		`${ACCRUAL_SELECT}
       ${ACCRUAL_FROM}
      WHERE a.isDelete = 0 AND a.recognition_period BETWEEN ? AND ?
      ORDER BY a.id`,
		[start, end]
	)) as [DbRow[], unknown];
	return rows.map(mapAccrualRecordRow);
}

/** Recognized accrual Project cost of one month, per Project and currency. */
export async function loadAccrualMonthProjectCost(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const { start, end } = monthBounds(month);
	const [rows] = (await db.execute(
		`${ACCRUAL_SELECT}
       ${ACCRUAL_FROM}
      WHERE a.isDelete = 0 AND a.recognition_period BETWEEN ? AND ?
      ORDER BY a.id`,
		[start, end]
	)) as [DbRow[], unknown];
	return accrualProjectCost(rows.map(mapAccrualRecordRow));
}

/** The same cost of every month before `month`: the Cost to Date base. */
export async function loadAccrualProjectCostBefore(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const [rows] = (await db.execute(
		`${ACCRUAL_SELECT}
       ${ACCRUAL_FROM}
      WHERE a.isDelete = 0 AND a.recognition_period < ?
      ORDER BY a.id`,
		[`${month}-01`]
	)) as [DbRow[], unknown];
	return accrualProjectCost(rows.map(mapAccrualRecordRow));
}

function accrualStateFilter(state: string | undefined): {
	clause: string;
	params: Array<string | number>;
} {
	if (!state || state === 'all') return { clause: '1=1', params: [] };
	if (state === 'unconfirmed') {
		return {
			clause: "a.recognition_state IN ('draft','pending_evidence')",
			params: [],
		};
	}
	if (state === 'unresolved') {
		return { clause: 'a.cost_classification IS NULL', params: [] };
	}
	return { clause: 'a.recognition_state = ?', params: [state] };
}

/** The accrual source's records matching a drilldown query, unpaginated. */
export async function loadFilteredAccrualRecords(
	db: SqlConnection,
	query: {
		month: string;
		state?: string;
		classification?: string;
		nature?: string;
		projectId?: number | null;
	}
): Promise<CostRecord[]> {
	// An accrual is operating cost: a filter for a non-operating balance or an
	// unresolved treatment matches no accrual row.
	if (
		query.nature !== undefined &&
		query.nature !== 'all' &&
		query.nature !== 'operating'
	) {
		return [];
	}
	const { start, end } = monthBounds(query.month);
	const state = accrualStateFilter(query.state);
	const where = [
		'a.isDelete = 0',
		'a.recognition_period BETWEEN ? AND ?',
		state.clause,
	];
	const params: Array<string | number> = [start, end, ...state.params];
	if (query.classification && query.classification !== 'all') {
		if (query.classification === 'unresolved') {
			where.push('a.cost_classification IS NULL');
		} else {
			where.push('a.cost_classification = ?');
			params.push(query.classification);
		}
	}
	if (query.projectId !== undefined && query.projectId !== null) {
		where.push('a.project_id = ?');
		params.push(query.projectId);
	}
	const [rows] = (await db.execute(
		`${ACCRUAL_SELECT}
       ${ACCRUAL_FROM}
      WHERE ${where.join(' AND ')}
      ORDER BY a.id`,
		params
	)) as [DbRow[], unknown];
	return rows.map(mapAccrualRecordRow);
}

/** Months with accrual cost recorded, newest first. */
export async function loadAccrualMonths(
	db: SqlConnection,
	currentMonth: string
): Promise<string[]> {
	const [rows] = (await db.execute(
		`SELECT DISTINCT DATE_FORMAT(recognition_period, '%Y-%m') AS month
       FROM cost_accruals
      WHERE isDelete = 0 AND recognition_period IS NOT NULL`
	)) as [DbRow[], unknown];
	const months = new Set<string>([currentMonth]);
	for (const row of rows) {
		const month = s(row, 'month');
		if (month) months.add(month);
	}
	return [...months].sort().reverse();
}

/**
 * Capture an accrual with its financial identity. Without `submit` it stays a
 * draft; the caller's connection is used when supplied, otherwise the module
 * owns the transaction and retries a retryable number race from a fresh read.
 */
export async function captureAccrualCost(
	input: AccrualCaptureInput,
	actor: { id: number | null },
	options?: { connection?: SqlConnection }
): Promise<RecordedAccrual> {
	const run = async (db: SqlConnection): Promise<RecordedAccrual> => {
		const description = text(input.description, 500);
		if (!description) {
			throw new CostError(
				'description_required',
				'A description is required',
				422
			);
		}
		const evidenceBasis =
			enumOrThrow(
				input.evidenceBasis,
				EVIDENCE_BASES,
				'invalid_evidence_basis',
				'evidence_basis'
			) ?? 'received_work';
		if (evidenceBasis === 'purchase_order') {
			throw new CostError(
				'po_balance_not_evidence',
				'An unused PO balance is not evidence of received work',
				422,
				{ evidence_basis: evidenceBasis }
			);
		}
		const projectId = input.projectId ?? null;
		const classification =
			enumOrThrow(
				input.costClassification,
				CLASSIFICATIONS,
				'invalid_classification',
				'cost_classification'
			) ?? (projectId ? ('project' as const) : null);
		if (classification === 'project' && !projectId) {
			throw new CostError(
				'classification_conflict',
				'A Project classification needs a project_id',
				422,
				{ missing: ['project_id'] }
			);
		}
		if (classification && classification !== 'project' && projectId) {
			throw new CostError(
				'classification_conflict',
				'Company Overhead and Unallocated Cost cannot carry a project_id',
				422,
				{ missing: ['project_id_not_allowed'] }
			);
		}
		const currency = currencyCodeOf(input.currency) ?? 'INR';
		const conversion = resolveConversion({
			currency,
			reportingCurrency: input.reportingCurrency,
			conversionRate: input.conversionRate,
			conversionDate: input.conversionDate,
			conversionEvidenceReference: input.conversionEvidenceReference,
		});
		const grossAmount = amountOrNull(input.grossAmount);
		const taxAmount = amountOrNull(input.taxAmount);
		const taxTreatment =
			enumOrThrow(
				input.taxTreatment,
				TAX_TREATMENTS,
				'invalid_tax_treatment',
				'tax_treatment'
			) ?? 'unresolved';
		const servicePeriodStart = dateOrNull(input.servicePeriodStart);
		const servicePeriodEnd = dateOrNull(input.servicePeriodEnd);
		const { period, basis } = resolveRecognitionPeriod({
			servicePeriodStart,
			servicePeriodEnd,
		});
		const state: RecognitionState = input.submit ? 'pending_evidence' : 'draft';
		const costUid = `cost-${randomUUID()}`;
		const accrualNumber = await nextAccrualNumber(db);
		const [inserted] = (await db.execute(
			`INSERT INTO cost_accruals
         (accrual_number, cost_uid, description, vendor_name, vendor_reference,
          order_uid, evidence_basis, cost_classification, project_id,
          recognition_state, recognition_period, period_basis,
          service_period_start, service_period_end,
          gross_amount, tax_amount, tax_treatment, tax_evidence_reference,
          currency, reporting_currency, conversion_rate, conversion_date,
          conversion_evidence_reference, converted_amount, source_reference,
          evidence_reference, recognized_amount, replaced_amount, owner_user_id,
          financial_version, isDelete, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
               ?, ?, NULL, 0, ?, 1, 0, ?)`,
			[
				accrualNumber,
				costUid,
				description,
				text(input.vendorName, 255),
				text(input.vendorReference, 191),
				text(input.orderUid, 64),
				evidenceBasis,
				classification,
				projectId,
				state,
				period,
				basis,
				servicePeriodStart,
				servicePeriodEnd,
				grossAmount,
				taxAmount,
				taxTreatment,
				text(input.taxEvidenceReference, 255),
				currency,
				conversion.reportingCurrency,
				conversion.conversionRate,
				conversion.conversionDate,
				conversion.conversionEvidenceReference,
				text(input.sourceReference, 191),
				text(input.evidenceReference, 500),
				input.ownerUserId ?? actor.id,
				actor.id,
			]
		)) as [Record<string, unknown>, unknown];
		const id = Number(inserted.insertId);
		await registerCostIdentity(db, {
			costUid,
			sourceTable: ACCRUAL_TABLE,
			sourceId: id,
			createdBy: actor.id,
		});
		await writeCostEvent(db, {
			costUid,
			sourceTable: ACCRUAL_TABLE,
			sourceId: id,
			version: 1,
			command: 'recorded',
			actorId: actor.id,
			reason: state === 'pending_evidence' ? 'Submitted for recognition' : null,
			evidenceReference: text(input.evidenceReference, 500),
			snapshot: {
				classification,
				recognition_period: period,
				period_basis: basis,
				evidence_basis: evidenceBasis,
				currency,
				reporting_currency: conversion.reportingCurrency,
				conversion_rate: conversion.conversionRate,
				conversion_date: conversion.conversionDate,
				conversion_evidence_reference: conversion.conversionEvidenceReference,
				gross_amount: grossAmount,
				tax_amount: taxAmount,
				recognized_amount: null,
				state,
			},
		});
		return {
			id,
			accrual_number: accrualNumber,
			cost_uid: costUid,
			recognition_state: state,
			financial_version: 1,
			recognition_period: period,
			period_basis: basis,
			recognized_amount: null,
			cost_classification: classification,
		};
	};

	if (options?.connection) return run(options.connection);
	for (let attempt = 1; ; attempt++) {
		try {
			return await withTransaction((db) => run(db));
		} catch (error) {
			if (attempt < 5 && isRetryableNumberError(error)) {
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 15 * attempt);
				await promise;
				continue;
			}
			throw error;
		}
	}
}

/**
 * Apply one versioned command to an accrual. Everything happens in one
 * transaction: state check, version check, update, journal.
 */
export async function executeAccrualCommand(
	input: AccrualCommandInput,
	actor: { id: number | null },
	options?: { connection?: SqlConnection }
): Promise<CostCommandResult> {
	const run = async (db: SqlConnection): Promise<CostCommandResult> => {
		const row = await loadAccrualForUpdate(db, input.id);
		if (!row) {
			throw new CostError('not_found', 'Cost accrual not found', 404);
		}
		const state = (s(row, 'recognition_state', 'draft') ??
			'draft') as RecognitionState;
		const version = Number(num(row, 'financial_version') ?? 1);
		if (version !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				`This cost changed since it was read (current version ${version})`,
				409,
				{ current_version: version }
			);
		}
		const target = nextState(state, input.command);
		if (!target) {
			throw new CostError(
				'command_not_allowed',
				`${input.command} is not allowed while the cost is ${state}`,
				422,
				{ state }
			);
		}
		if (
			(input.command === 'reject' || input.command === 'cancel') &&
			!text(input.reason, 500)
		) {
			throw new CostError(
				'reason_required',
				`A reason is required to ${input.command} a cost`,
				422
			);
		}

		const patch = input.patch ?? {};
		const merged = {
			description:
				patch.description !== undefined
					? text(patch.description, 500)
					: text(s(row, 'description'), 500),
			vendorName:
				patch.vendorName !== undefined
					? text(patch.vendorName, 255)
					: text(s(row, 'vendor_name'), 255),
			vendorReference:
				patch.vendorReference !== undefined
					? text(patch.vendorReference, 191)
					: text(s(row, 'vendor_reference'), 191),
			orderUid:
				patch.orderUid !== undefined
					? text(patch.orderUid, 64)
					: text(s(row, 'order_uid'), 64),
			evidenceBasis:
				patch.evidenceBasis !== undefined
					? ((enumOrThrow(
							patch.evidenceBasis,
							EVIDENCE_BASES,
							'invalid_evidence_basis',
							'evidence_basis'
						) ?? 'received_work') as EvidenceBasis)
					: ((s(row, 'evidence_basis', 'received_work') ??
							'received_work') as EvidenceBasis),
			classification:
				patch.costClassification !== undefined
					? enumOrThrow(
							patch.costClassification,
							CLASSIFICATIONS,
							'invalid_classification',
							'cost_classification'
						)
					: ((s(row, 'cost_classification') as CostClassification | null) ??
						null),
			projectId:
				patch.projectId !== undefined
					? patch.projectId
					: num(row, 'project_id'),
			servicePeriodStart:
				patch.servicePeriodStart !== undefined
					? dateOrNull(patch.servicePeriodStart)
					: dateOrNull(s(row, 'service_period_start')),
			servicePeriodEnd:
				patch.servicePeriodEnd !== undefined
					? dateOrNull(patch.servicePeriodEnd)
					: dateOrNull(s(row, 'service_period_end')),
			currency:
				patch.currency !== undefined
					? (currencyCodeOf(patch.currency) ??
						s(row, 'currency', 'INR') ??
						'INR')
					: (s(row, 'currency', 'INR') ?? 'INR'),
			grossAmount:
				patch.grossAmount !== undefined
					? amountOrNull(patch.grossAmount)
					: num(row, 'gross_amount'),
			taxAmount:
				patch.taxAmount !== undefined
					? amountOrNull(patch.taxAmount)
					: num(row, 'tax_amount'),
			taxTreatment:
				patch.taxTreatment !== undefined
					? (enumOrThrow(
							patch.taxTreatment,
							TAX_TREATMENTS,
							'invalid_tax_treatment',
							'tax_treatment'
						) ?? 'unresolved')
					: ((s(row, 'tax_treatment', 'unresolved') ??
							'unresolved') as TaxTreatment),
			taxEvidenceReference:
				patch.taxEvidenceReference !== undefined
					? text(patch.taxEvidenceReference, 255)
					: text(s(row, 'tax_evidence_reference'), 255),
			sourceReference:
				patch.sourceReference !== undefined
					? text(patch.sourceReference, 191)
					: text(s(row, 'source_reference'), 191),
			evidenceReference:
				patch.evidenceReference !== undefined
					? text(patch.evidenceReference, 500)
					: input.evidenceReference !== undefined
						? text(input.evidenceReference, 500)
						: text(s(row, 'evidence_reference'), 500),
			ownerUserId:
				patch.ownerUserId !== undefined
					? patch.ownerUserId
					: num(row, 'owner_user_id'),
		};
		if (!merged.description) {
			throw new CostError(
				'description_required',
				'A description is required',
				422
			);
		}

		// A rate is evidence for one currency pair: a changed pair never
		// inherits the stored rate/date/reference; a convertible new pair
		// demands the complete fresh triple in this same command.
		const storedPair = {
			currency: currencyCodeOf(s(row, 'currency')),
			reportingCurrency: reportingCurrencyOf({
				reportingCurrency: s(row, 'reporting_currency'),
			}),
		};
		const requestedPair = {
			currency:
				patch.currency !== undefined
					? currencyCodeOf(patch.currency)
					: storedPair.currency,
			reportingCurrency:
				patch.reportingCurrency !== undefined
					? reportingCurrencyOf({
							reportingCurrency: currencyCodeOf(patch.reportingCurrency),
						})
					: storedPair.reportingCurrency,
		};
		const pairChanged =
			requestedPair.currency !== storedPair.currency ||
			requestedPair.reportingCurrency !== storedPair.reportingCurrency;
		const suppliesConversionEvidence =
			patch.conversionRate !== undefined ||
			patch.conversionDate !== undefined ||
			patch.conversionEvidenceReference !== undefined;
		if (
			pairChanged &&
			!suppliesConversionEvidence &&
			requestedPair.currency !== null &&
			requestedPair.currency !== requestedPair.reportingCurrency
		) {
			throw new CostError(
				'conversion_evidence_required',
				'Changing the original/reporting currency pair requires fresh conversion evidence for the new pair',
				422,
				{
					fields: [
						'conversion_rate',
						'conversion_date',
						'conversion_evidence_reference',
					],
				}
			);
		}
		const conversion = resolveConversion({
			currency: requestedPair.currency ?? currencyCodeOf(merged.currency),
			reportingCurrency: requestedPair.reportingCurrency,
			conversionRate: pairChanged
				? (patch.conversionRate ?? null)
				: patch.conversionRate !== undefined
					? patch.conversionRate
					: dec(row, 'conversion_rate'),
			conversionDate: pairChanged
				? (patch.conversionDate ?? null)
				: patch.conversionDate !== undefined
					? patch.conversionDate
					: s(row, 'conversion_date'),
			conversionEvidenceReference: pairChanged
				? (patch.conversionEvidenceReference ?? null)
				: patch.conversionEvidenceReference !== undefined
					? patch.conversionEvidenceReference
					: s(row, 'conversion_evidence_reference'),
		});

		if (!merged.classification && merged.projectId) {
			merged.classification = 'project';
		}
		if (merged.classification === 'project' && !merged.projectId) {
			throw new CostError(
				'classification_conflict',
				'A Project classification needs a project_id',
				422,
				{ missing: ['project_id'] }
			);
		}
		if (
			merged.classification &&
			merged.classification !== 'project' &&
			merged.projectId
		) {
			throw new CostError(
				'classification_conflict',
				'Company Overhead and Unallocated Cost cannot carry a project_id',
				422,
				{ missing: ['project_id_not_allowed'] }
			);
		}

		const datesChanged =
			patch.servicePeriodStart !== undefined ||
			patch.servicePeriodEnd !== undefined;
		const resolved = datesChanged
			? resolveRecognitionPeriod(merged)
			: {
					period: s(row, 'recognition_period'),
					basis: (s(row, 'period_basis', 'unresolved') ??
						'unresolved') as PeriodBasis,
				};

		const financial = {
			...merged,
			nature: 'operating' as const,
			reportingCurrency: conversion.reportingCurrency,
			conversionRate: conversion.conversionRate,
			conversionDate: conversion.conversionDate,
			conversionEvidenceReference: conversion.conversionEvidenceReference,
			convertedAmount: null,
			billDate: null,
			state: target,
			recognitionPeriod: resolved.period,
			periodBasis: resolved.basis,
			recognizedAmount: null,
		};

		let recognizedAmount: number | null = num(row, 'recognized_amount');
		let recognizedBy: number | null = num(row, 'recognized_by');
		const recognizedAt: string | null = s(row, 'recognized_at');

		if (input.command === 'recognize') {
			if (merged.evidenceBasis === 'purchase_order') {
				throw new CostError(
					'po_balance_not_evidence',
					'An unused PO balance is not evidence of received work',
					422,
					{ evidence_basis: merged.evidenceBasis }
				);
			}
			const blockers = recognitionBlockers({
				grossAmount: merged.grossAmount,
				classification: merged.classification,
				projectId: merged.projectId,
				recognitionPeriod: resolved.period,
				currency: merged.currency,
			});
			// Only received work with evidence, or an explicitly identified
			// supported estimate, becomes cost.
			if (!merged.evidenceReference) blockers.push('evidence_reference');
			if (blockers.length > 0) {
				throw new CostError(
					'not_ready_for_recognition',
					'This cost cannot become confirmed cost yet',
					422,
					{ missing: blockers }
				);
			}
			recognizedAmount = evaluateCost(financial).recognizedAmount;
			recognizedBy = actor.id;
		}

		const nextVersion = version + 1;
		const conversionEvidence = evidenceOf({
			currency: merged.currency,
			reportingCurrency: conversion.reportingCurrency,
			conversionRate: conversion.conversionRate,
			conversionDate: conversion.conversionDate,
			conversionEvidenceReference: conversion.conversionEvidenceReference,
		});
		const convertedAmount: number | null =
			target === 'recognized'
				? convertToReporting(recognizedAmount, conversionEvidence).amount
				: state === 'recognized'
					? num(row, 'converted_amount')
					: null;
		await db.execute(
			`UPDATE cost_accruals
          SET description = ?, vendor_name = ?, vendor_reference = ?, order_uid = ?,
              evidence_basis = ?, cost_classification = ?, project_id = ?,
              recognition_state = ?, recognition_period = ?,
              period_basis = ?, service_period_start = ?,
              service_period_end = ?, gross_amount = ?, tax_amount = ?,
              tax_treatment = ?, tax_evidence_reference = ?, currency = ?,
              reporting_currency = ?, conversion_rate = ?, conversion_date = ?,
              conversion_evidence_reference = ?, converted_amount = ?,
              source_reference = ?, evidence_reference = ?, recognized_amount = ?,
              recognized_by = ?, recognized_at = IF(?, NOW(), ?), owner_user_id = ?,
              financial_version = ?
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[
				merged.description,
				merged.vendorName,
				merged.vendorReference,
				merged.orderUid,
				merged.evidenceBasis,
				merged.classification,
				merged.projectId,
				target,
				resolved.period,
				resolved.basis,
				merged.servicePeriodStart,
				merged.servicePeriodEnd,
				merged.grossAmount,
				merged.taxAmount,
				merged.taxTreatment,
				merged.taxEvidenceReference,
				merged.currency,
				conversion.reportingCurrency,
				conversion.conversionRate,
				conversion.conversionDate,
				conversion.conversionEvidenceReference,
				convertedAmount,
				merged.sourceReference,
				merged.evidenceReference,
				recognizedAmount,
				recognizedBy,
				input.command === 'recognize' ? 1 : 0,
				recognizedAt,
				merged.ownerUserId,
				nextVersion,
				input.id,
				version,
			]
		);

		await writeCostEvent(db, {
			costUid: s(row, 'cost_uid', '') ?? '',
			sourceTable: ACCRUAL_TABLE,
			sourceId: input.id,
			version: nextVersion,
			command: JOURNAL_COMMAND[input.command] as CostJournalCommand,
			actorId: actor.id,
			reason: text(input.reason, 500),
			evidenceReference: merged.evidenceReference,
			snapshot: {
				classification: merged.classification,
				recognition_period: resolved.period,
				period_basis: resolved.basis,
				evidence_basis: merged.evidenceBasis,
				currency: merged.currency,
				reporting_currency: conversion.reportingCurrency,
				conversion_rate: conversion.conversionRate,
				conversion_date: conversion.conversionDate,
				conversion_evidence_reference: conversion.conversionEvidenceReference,
				conversion_pair_changed: pairChanged,
				converted_amount: convertedAmount,
				gross_amount: merged.grossAmount,
				tax_amount: merged.taxAmount,
				tax_treatment: merged.taxTreatment,
				recognized_amount: recognizedAmount,
				replaced_amount: num(row, 'replaced_amount') ?? 0,
				state: target,
			},
		});

		return {
			id: input.id,
			cost_uid: s(row, 'cost_uid'),
			recognition_state: target,
			financial_version: nextVersion,
			recognized_amount: recognizedAmount,
			recognition_period: resolved.period,
			component: input.command,
		};
	};

	if (options?.connection) return run(options.connection);
	return withTransaction((db) => run(db)) as Promise<CostCommandResult>;
}

async function loadInvoiceForUpdate(
	db: SqlConnection,
	id: number
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`SELECT id, cost_uid, invoice_number, currency, total, tax_amount,
            recognized_amount, recognition_state, recognition_period, invoice_date,
            financial_version, isDelete
       FROM purchase_invoices
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * Supersede part or all of one recognized accrual with one recognized
 * invoice. The invoice row is locked first and the accrual second (the same
 * order the cancel transition uses, so the two can never deadlock), the
 * accrual version is guarded, and the replacement row, registry link, and
 * journal row are written in one transaction.
 */
export async function executeAccrualReplacement(
	input: AccrualReplacementInput,
	actor: { id: number | null },
	options?: { connection?: SqlConnection }
): Promise<AccrualReplacementResult> {
	const run = async (db: SqlConnection): Promise<AccrualReplacementResult> => {
		const invoice = await loadInvoiceForUpdate(db, input.invoiceId);
		if (!invoice) {
			throw new CostError('not_found', 'Replacement invoice not found', 404);
		}
		const invoiceVersion = Number(num(invoice, 'financial_version') ?? 1);
		if (invoiceVersion !== input.expectedInvoiceVersion) {
			throw new CostError(
				'version_conflict',
				`The invoice changed since it was read (current version ${invoiceVersion})`,
				409,
				{ current_version: invoiceVersion, target: 'invoice' }
			);
		}
		const invoiceState =
			(s(invoice, 'recognition_state', 'draft') as RecognitionState) ?? 'draft';
		if (invoiceState !== 'recognized') {
			throw new CostError(
				'invoice_not_recognized',
				'Only a recognized invoice can replace an accrual',
				422,
				{ state: invoiceState }
			);
		}
		const invoiceRecognized = num(invoice, 'recognized_amount');
		if (invoiceRecognized === null) {
			throw new CostError(
				'invoice_amount_unknown',
				'The invoice has no recognized amount to match',
				422
			);
		}

		const accrual = await loadAccrualForUpdate(db, input.accrualId);
		if (!accrual) {
			throw new CostError('not_found', 'Cost accrual not found', 404);
		}
		const accrualState =
			(s(accrual, 'recognition_state', 'draft') as RecognitionState) ?? 'draft';
		if (accrualState !== 'recognized') {
			throw new CostError(
				'not_recognized',
				'Only a recognized accrual can be replaced',
				422,
				{ state: accrualState }
			);
		}
		const accrualVersion = Number(num(accrual, 'financial_version') ?? 1);
		if (accrualVersion !== input.expectedAccrualVersion) {
			throw new CostError(
				'version_conflict',
				`This cost changed since it was read (current version ${accrualVersion})`,
				409,
				{ current_version: accrualVersion, target: 'accrual' }
			);
		}
		const remaining = num(accrual, 'recognized_amount');
		if (remaining === null || !gt(remaining, 0)) {
			throw new CostError(
				'accrual_already_replaced',
				'This accrual has no remaining estimate to replace',
				422
			);
		}
		const existing = await db.execute(
			`SELECT id FROM cost_accrual_replacements
        WHERE accrual_id = ? AND invoice_id = ?
        LIMIT 1`,
			[input.accrualId, input.invoiceId]
		);
		if ((existing[0] as DbRow[]).length > 0) {
			throw new CostError(
				'replacement_exists',
				'This invoice already replaces this accrual',
				409
			);
		}
		const otherLink = await db.execute(
			`SELECT accrual_id FROM cost_accrual_replacements
        WHERE invoice_id = ? AND state = 'active'
        LIMIT 1`,
			[input.invoiceId]
		);
		const otherRows = otherLink[0] as DbRow[];
		if (otherRows.length > 0) {
			throw new CostError(
				'invoice_already_replacement',
				'This invoice already supersedes another accrual',
				409,
				{ accrual_id: num(otherRows[0], 'accrual_id') }
			);
		}

		const remainingDecimal = R(remaining);
		const invoiceDecimal = R(invoiceRecognized);
		const requested = amountOrNull(input.replacedAmount);
		const replacedDecimal =
			input.final === true
				? remainingDecimal
				: requested !== null
					? R(requested)
					: invoiceDecimal.lt(remainingDecimal)
						? invoiceDecimal
						: remainingDecimal;
		if (!gt(replacedDecimal, 0) || !gte(remainingDecimal, replacedDecimal)) {
			throw new CostError(
				'invalid_replaced_amount',
				'The replaced amount must be positive and at most the remaining estimate',
				422,
				{ remaining: remaining, requested: toNumber(replacedDecimal) }
			);
		}
		const differenceDecimal = invoiceDecimal.minus(replacedDecimal);
		const differenceAmount = toNumber(differenceDecimal.toDecimalPlaces(2));
		const evidenceReference = text(input.evidenceReference, 500);
		const differenceReason = text(input.differenceReason, 500);
		if (differenceAmount !== 0 && (!differenceReason || !evidenceReference)) {
			throw new CostError(
				'difference_evidence_required',
				'A difference between the estimate and the actual invoice needs its reason and evidence',
				422,
				{ fields: ['difference_reason', 'evidence_reference'] }
			);
		}
		const invoicePeriod = s(invoice, 'recognition_period');
		const invoiceDate = s(invoice, 'invoice_date');
		const replacementPeriod =
			invoicePeriod ?? (invoiceDate ? firstOfMonth(invoiceDate) : null);
		const differencePeriod =
			dateOrNull(input.differencePeriod) ??
			(differenceAmount !== 0 ? replacementPeriod : null);
		const isFinal = replacedDecimal.eq(remainingDecimal);
		const remainingAfter = toNumber(
			sub(remainingDecimal, replacedDecimal).toDecimalPlaces(2)
		);
		const replacedAfter = toNumber(
			R(num(accrual, 'replaced_amount') ?? 0)
				.add(replacedDecimal)
				.toDecimalPlaces(2)
		);
		const nextVersion = accrualVersion + 1;
		const [updateResult] = (await db.execute(
			`UPDATE cost_accruals
          SET recognized_amount = ?, replaced_amount = ?, financial_version = ?
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[
				remainingAfter,
				replacedAfter,
				nextVersion,
				input.accrualId,
				accrualVersion,
			]
		)) as [Record<string, unknown>, unknown];
		if (Number(updateResult.affectedRows ?? 0) !== 1) {
			throw new CostError(
				'version_conflict',
				'This cost changed while the replacement was applied',
				409
			);
		}
		const [inserted] = (await db.execute(
			`INSERT INTO cost_accrual_replacements
         (accrual_id, accrual_cost_uid, invoice_id, invoice_cost_uid, replaced_amount,
          invoice_amount, difference_amount, difference_period, difference_reason,
          evidence_reference, replacement_period, is_final, state, accrual_version,
          invoice_version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
			[
				input.accrualId,
				s(accrual, 'cost_uid', '') ?? '',
				input.invoiceId,
				s(invoice, 'cost_uid', '') ?? '',
				toNumber(replacedDecimal.toDecimalPlaces(2)),
				toNumber(invoiceDecimal.toDecimalPlaces(2)),
				differenceAmount,
				differencePeriod,
				differenceReason,
				evidenceReference,
				replacementPeriod,
				isFinal ? 1 : 0,
				nextVersion,
				invoiceVersion,
				actor.id,
			]
		)) as [Record<string, unknown>, unknown];
		await linkCostReference(db, {
			costUid: s(accrual, 'cost_uid', '') ?? '',
			sourceTable: 'purchase_invoices',
			sourceId: input.invoiceId,
			role: 'replacement',
			basis: 'explicit',
			reviewState: 'confirmed',
			evidenceReference,
			createdBy: actor.id,
		});
		await writeCostEvent(db, {
			costUid: s(accrual, 'cost_uid', '') ?? '',
			sourceTable: ACCRUAL_TABLE,
			sourceId: input.accrualId,
			version: nextVersion,
			command: 'replaced',
			actorId: actor.id,
			reason: text(input.reason, 500),
			evidenceReference,
			snapshot: {
				replacement_id: Number(inserted.insertId),
				invoice_id: input.invoiceId,
				invoice_cost_uid: s(invoice, 'cost_uid', '') ?? '',
				replaced_amount: toNumber(replacedDecimal.toDecimalPlaces(2)),
				invoice_amount: toNumber(invoiceDecimal.toDecimalPlaces(2)),
				difference_amount: differenceAmount,
				difference_period: differencePeriod,
				difference_reason: differenceReason,
				replacement_period: replacementPeriod,
				final: isFinal,
				recognized_amount_after: remainingAfter,
				replaced_amount_after: replacedAfter,
			},
		});
		return {
			replacement_id: Number(inserted.insertId),
			accrual_id: input.accrualId,
			accrual_cost_uid: s(accrual, 'cost_uid', '') ?? '',
			invoice_id: input.invoiceId,
			invoice_cost_uid: s(invoice, 'cost_uid', '') ?? '',
			replaced_amount: toNumber(replacedDecimal.toDecimalPlaces(2)),
			invoice_amount: toNumber(invoiceDecimal.toDecimalPlaces(2)),
			difference_amount: differenceAmount,
			accrual_remaining_amount: remainingAfter,
			final: isFinal,
			accrual_version: nextVersion,
			invoice_version: invoiceVersion,
		};
	};

	if (options?.connection) return run(options.connection);
	return withTransaction((db) => run(db)) as Promise<AccrualReplacementResult>;
}

/**
 * Release every live replacement of one invoice inside the caller's
 * transaction (the supplier cancel command). Each matched amount returns to
 * its accrual, the replacement row keeps its release reason/actor/evidence,
 * and the accrual journal records the `released` transition — so cancelling an
 * invoice can never leave both the invoice cost and the matched estimate
 * excluded, and never counts both at once.
 */
export async function releaseAccrualReplacementsForInvoice(
	db: SqlConnection,
	invoiceId: number,
	actorId: number | null,
	reason: string | null,
	evidenceReference: string | null
): Promise<number[]> {
	const [rows] = (await db.execute(
		`SELECT id, accrual_id, replaced_amount
       FROM cost_accrual_replacements
      WHERE invoice_id = ? AND state = 'active'
      ORDER BY accrual_id, id
      FOR UPDATE`,
		[invoiceId]
	)) as [DbRow[], unknown];
	const released: number[] = [];
	for (const row of rows) {
		const replacementId = Number(num(row, 'id') ?? 0);
		const accrualId = Number(num(row, 'accrual_id') ?? 0);
		const replaced = num(row, 'replaced_amount') ?? 0;
		const accrual = await loadAccrualForUpdate(db, accrualId);
		if (!accrual) continue;
		const version = Number(num(accrual, 'financial_version') ?? 1);
		const remaining = num(accrual, 'recognized_amount');
		const restored =
			remaining === null
				? replaced
				: toNumber(R(remaining).add(R(replaced)).toDecimalPlaces(2));
		const replacedAfter = toNumber(
			R(
				Math.max((num(accrual, 'replaced_amount') ?? 0) - replaced, 0)
			).toDecimalPlaces(2)
		);
		const nextVersion = version + 1;
		await db.execute(
			`UPDATE cost_accruals
          SET recognized_amount = ?, replaced_amount = ?, financial_version = ?
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[restored, replacedAfter, nextVersion, accrualId, version]
		);
		await db.execute(
			`UPDATE cost_accrual_replacements
          SET state = 'released', released_at = NOW(), released_by = ?,
              release_reason = ?, release_evidence_reference = ?
        WHERE id = ? AND state = 'active'`,
			[actorId, text(reason, 500), text(evidenceReference, 500), replacementId]
		);
		await writeCostEvent(db, {
			costUid: s(accrual, 'cost_uid', '') ?? '',
			sourceTable: ACCRUAL_TABLE,
			sourceId: accrualId,
			version: nextVersion,
			command: 'released',
			actorId,
			reason: text(reason, 500),
			evidenceReference: text(evidenceReference, 500),
			snapshot: {
				released_replacement_id: replacementId,
				invoice_id: invoiceId,
				replaced_amount: replaced,
				recognized_amount_after: restored,
				replaced_amount_after: replacedAfter,
				cause: 'replacement_invoice_cancelled',
			},
		});
		released.push(replacementId);
	}
	return released;
}

/** One accrual's financial detail: identity, replacements, and links. */
export async function loadAccrualDetail(
	db: SqlConnection,
	id: number
): Promise<AccrualDetail | null> {
	const [rows] = (await db.execute(
		`${ACCRUAL_SELECT}
       ${ACCRUAL_FROM}
      WHERE a.id = ? AND a.isDelete = 0`,
		[id]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	const row = rows[0];
	const costUid = s(row, 'cost_uid', '') ?? '';
	const [replacementRows] = (await db.execute(
		`SELECT id, invoice_id, invoice_cost_uid, replaced_amount, invoice_amount,
            difference_amount, difference_period, difference_reason,
            evidence_reference, replacement_period, is_final, state, accrual_version,
            invoice_version, released_at, released_by, release_reason,
            release_evidence_reference
       FROM cost_accrual_replacements
      WHERE accrual_id = ?
      ORDER BY id`,
		[id]
	)) as [DbRow[], unknown];
	const replacements: AccrualReplacementRow[] = replacementRows.map(
		(entry) => ({
			id: Number(num(entry, 'id') ?? 0),
			invoice_id: Number(num(entry, 'invoice_id') ?? 0),
			invoice_cost_uid: s(entry, 'invoice_cost_uid', '') ?? '',
			replaced_amount: num(entry, 'replaced_amount') ?? 0,
			invoice_amount: num(entry, 'invoice_amount'),
			difference_amount: num(entry, 'difference_amount') ?? 0,
			difference_period: s(entry, 'difference_period'),
			difference_reason: s(entry, 'difference_reason'),
			evidence_reference: s(entry, 'evidence_reference'),
			replacement_period: s(entry, 'replacement_period'),
			is_final: Number(num(entry, 'is_final') ?? 0) === 1,
			state: (s(entry, 'state', 'active') as 'active' | 'released') ?? 'active',
			accrual_version: Number(num(entry, 'accrual_version') ?? 1),
			invoice_version: Number(num(entry, 'invoice_version') ?? 1),
			released_at: s(entry, 'released_at'),
			released_by: num(entry, 'released_by'),
			release_reason: s(entry, 'release_reason'),
			release_evidence_reference: s(entry, 'release_evidence_reference'),
		})
	);
	const links: AccrualLinkRow[] = [];
	if (costUid) {
		const [linkRows] = (await db.execute(
			`SELECT cost_uid, source_table, source_id, role, basis, review_state,
              evidence_reference
         FROM financial_cost_links
        WHERE cost_uid = ?
        ORDER BY role, source_table, source_id`,
			[costUid]
		)) as [DbRow[], unknown];
		for (const link of linkRows) {
			links.push({
				cost_uid: s(link, 'cost_uid', '') ?? '',
				source_table: s(link, 'source_table', '') ?? '',
				source_id: s(link, 'source_id', '') ?? '',
				role: s(link, 'role', '') ?? '',
				basis: s(link, 'basis', '') ?? '',
				review_state: s(link, 'review_state', '') ?? '',
				evidence_reference: s(link, 'evidence_reference'),
			});
		}
	}
	// Recognized invoices offered to the replacement control: one liability
	// with one cost, not already superseding an accrual.
	const [candidateRows] = (await db.execute(
		`SELECT i.id AS invoice_id, i.invoice_number, i.cost_uid, i.currency,
            i.recognized_amount, i.recognition_period, i.financial_version,
            i.project_id, p.project_code,
            COALESCE(p.project_title, p.name) AS project_name
       FROM purchase_invoices i
       LEFT JOIN projects p ON p.project_id = i.project_id AND p.isDelete = 0
      WHERE i.isDelete = 0 AND i.recognition_state = 'recognized'
        AND i.cost_uid IS NOT NULL AND i.recognized_amount IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM cost_accrual_replacements r
           WHERE r.invoice_id = i.id AND r.state = 'active'
        )
      ORDER BY i.id DESC
      LIMIT 200`,
		[]
	)) as [DbRow[], unknown];
	const replacement_candidates: AccrualReplacementCandidate[] =
		candidateRows.map((candidate) => ({
			invoice_id: Number(num(candidate, 'invoice_id') ?? 0),
			invoice_number: s(candidate, 'invoice_number', '') ?? '',
			cost_uid: s(candidate, 'cost_uid', '') ?? '',
			currency: s(candidate, 'currency'),
			recognized_amount: num(candidate, 'recognized_amount'),
			recognition_period: s(candidate, 'recognition_period'),
			financial_version: Number(num(candidate, 'financial_version') ?? 1),
			project_id: num(candidate, 'project_id'),
			project_code: s(candidate, 'project_code'),
			project_name: s(candidate, 'project_name'),
		}));
	return {
		id: Number(num(row, 'id') ?? 0),
		accrual_number: s(row, 'accrual_number', '') ?? '',
		cost_uid: costUid,
		description: s(row, 'description', '') ?? '',
		vendor_name: s(row, 'vendor_name'),
		vendor_reference: s(row, 'vendor_reference'),
		order_uid: s(row, 'order_uid'),
		evidence_basis:
			(s(row, 'evidence_basis', 'received_work') as EvidenceBasis) ??
			'received_work',
		recognition_state:
			(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
		financial_version: Number(num(row, 'financial_version') ?? 1),
		cost_classification:
			(s(row, 'cost_classification') as CostClassification | null) ?? null,
		project_id: num(row, 'project_id'),
		project_code: s(row, 'project_code'),
		project_name: s(row, 'project_name'),
		service_period_start: s(row, 'service_period_start'),
		service_period_end: s(row, 'service_period_end'),
		recognition_period: s(row, 'recognition_period'),
		period_basis:
			(s(row, 'period_basis', 'unresolved') as PeriodBasis) ?? 'unresolved',
		currency: s(row, 'currency', 'INR') ?? 'INR',
		reporting_currency: currencyCodeOf(s(row, 'reporting_currency')),
		conversion_rate: dec(row, 'conversion_rate'),
		conversion_date: s(row, 'conversion_date'),
		conversion_evidence_reference: s(row, 'conversion_evidence_reference'),
		converted_amount: num(row, 'converted_amount'),
		gross_amount: num(row, 'gross_amount'),
		tax_amount: num(row, 'tax_amount'),
		tax_treatment:
			(s(row, 'tax_treatment', 'unresolved') as TaxTreatment) ?? 'unresolved',
		tax_evidence_reference: s(row, 'tax_evidence_reference'),
		source_reference: s(row, 'source_reference'),
		evidence_reference: s(row, 'evidence_reference'),
		recognized_amount: num(row, 'recognized_amount'),
		replaced_amount: num(row, 'replaced_amount') ?? 0,
		owner_user_id: num(row, 'owner_user_id'),
		recognized_by: num(row, 'recognized_by'),
		recognized_at: s(row, 'recognized_at'),
		replacements,
		links,
		replacement_candidates,
	};
}

/**
 * One supplier order's accrual consumption view (#312/#314): the remaining
 * estimate and every superseded portion, so the commitment transfer can be
 * composed without re-deriving it.
 */
export async function loadAccrualConsumption(
	db: SqlConnection,
	orderUid: string
): Promise<AccrualConsumptionRow[]> {
	const uid = orderUid?.trim();
	if (!uid) return [];
	const [rows] = (await db.execute(
		`SELECT id, cost_uid, order_uid, recognition_state, recognition_period,
            currency, recognized_amount
       FROM cost_accruals
      WHERE isDelete = 0 AND order_uid = ?
      ORDER BY id`,
		[uid]
	)) as [DbRow[], unknown];
	const result: AccrualConsumptionRow[] = [];
	for (const row of rows) {
		const accrualId = Number(num(row, 'id') ?? 0);
		const [replacementRows] = (await db.execute(
			`SELECT id, invoice_id, invoice_cost_uid, replaced_amount,
                replacement_period, difference_amount, state
           FROM cost_accrual_replacements
          WHERE accrual_id = ?
          ORDER BY id`,
			[accrualId]
		)) as [DbRow[], unknown];
		result.push({
			accrual_id: accrualId,
			accrual_cost_uid: s(row, 'cost_uid', '') ?? '',
			order_uid: s(row, 'order_uid'),
			recognition_state:
				(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
			recognition_period: s(row, 'recognition_period'),
			currency: s(row, 'currency'),
			remaining_amount: num(row, 'recognized_amount'),
			replacements: replacementRows.map((entry) => ({
				replacement_id: Number(num(entry, 'id') ?? 0),
				invoice_id: Number(num(entry, 'invoice_id') ?? 0),
				invoice_cost_uid: s(entry, 'invoice_cost_uid', '') ?? '',
				replaced_amount: num(entry, 'replaced_amount') ?? 0,
				replacement_period: s(entry, 'replacement_period'),
				difference_amount: num(entry, 'difference_amount') ?? 0,
				state:
					(s(entry, 'state', 'active') as 'active' | 'released') ?? 'active',
			})),
		});
	}
	return result;
}
