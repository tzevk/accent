/**
 * The other-expense source (#315). The voucher register is a cost-bearing
 * source of the shared financial module: it adopts the module's financial
 * column vocabulary, registers its canonical `cost_uid`, appends one journal
 * row per accepted command, and mints its own `OEX-#####` register number.
 *
 * Two rules make it a source rather than a second store:
 *
 *  - a standalone voucher is its own cost (`linked_cost_uid IS NULL`) and is
 *    counted once, by recognition state, in the one reconciliation;
 *  - a receipt copy (`linked_cost_uid` set) evidences an already recognized
 *    cost and is never a cost itself — it is excluded from every cost read and
 *    refused by every command.
 *
 * Duplicate identity is never automatic: a text/vendor/similar-amount match is
 * preserved as a `candidate` link pending review, which blocks recognition
 * until a reviewer confirms the copy or rejects the match. Only a reviewer's
 * decision merges identity.
 *
 * Every function takes the caller's `SqlConnection` when one is supplied, so a
 * command, the identity/link row, and the journal stay one transaction.
 */

import { randomUUID } from 'node:crypto';
import { add, sub, R, toNumber } from '@/lib/money';
import { isRetryableNumberError } from '@/utils/db-number-retry';
import { CostError } from './errors';
import type { CommandOptions, CostActor } from './commands';
import { inTransaction } from './commands';
import {
	convertToReporting,
	currencyCodeOf,
	evidenceOf,
	isCurrencyCode,
	parseConversionRate,
	reportingCurrencyOf,
} from './currency';
import {
	evaluateCost,
	nextState,
	recognitionBlockers,
	resolveRecognitionPeriod,
} from './recognition';
import {
	linkCostReference,
	registerCostIdentity,
	registerCostSource,
	resolveCostReference,
} from './sources';
import {
	costSelectFrom,
	mapCostRow,
	MONTH_PREDICATE,
	monthBounds,
	natureFilterClause,
	stateFilterClause,
	type SqlConnection,
} from './records';
import type {
	CostClassification,
	CostDrilldownQuery,
	CostJournalCommand,
	CostRecord,
	PeriodBasis,
	RecognitionState,
	TaxTreatment,
} from './types';

/**
 * The other-expense source expression: the canonical column vocabulary over the
 * register's own row, with receipt copies excluded once (a copy evidences a
 * cost, it is not one). These are operating costs — the non-operating balances
 * are their own source (#317) — so the nature is stated as such rather than
 * guessed from anything else.
 */
const OTHER_EXPENSE_SOURCE = `SELECT 'operating' AS cost_nature,
    o.row_no AS id, o.cost_uid, o.voucher_number AS expense_number,
    COALESCE(o.bill_date, o.voucher_date) AS expense_date,
    o.cost_classification, o.recognition_state, o.recognition_period, o.period_basis,
    o.service_period_start, o.service_period_end, o.tax_treatment,
    o.tax_evidence_reference, o.recognized_amount, o.source_reference,
    o.evidence_reference, o.financial_version, o.recognized_by, o.recognized_at,
    o.currency, o.reporting_currency, o.conversion_rate, o.conversion_date,
    o.conversion_evidence_reference, o.converted_amount,
    o.bill_amount AS amount, o.gst_amount AS tax_amount, o.net_amount AS total_amount,
    o.created_at,
    COALESCE(o.vendor_name, o.employee_name) AS vendor_name,
    o.description, o.status, o.project_id, o.isDelete,
    CAST(o.id AS CHAR) COLLATE utf8mb4_general_ci AS source_row_id
  FROM other_expenses o
 WHERE o.linked_cost_uid IS NULL`;

const OTHER_EXPENSE_COST_SELECT = costSelectFrom(OTHER_EXPENSE_SOURCE);

/** Every other-expense cost of one month, in any recognition state. */
export async function loadOtherExpenseMonthRecords(
	db: SqlConnection,
	month: string
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = (await db.execute(
		`${OTHER_EXPENSE_COST_SELECT}
      WHERE e.isDelete = 0 AND ${MONTH_PREDICATE}
      ORDER BY e.recognition_period DESC, e.expense_date DESC, e.id DESC`,
		[start, end, start, end]
	)) as [DbRow[], unknown];
	return rows.map((row) => mapCostRow(row, 'other_expense'));
}

/**
 * Confirmed Project cost of a month, keyed by Project id and then currency,
 * exactly as the direct-expense reader states it: a Project can hold more than
 * one currency in a month, and a missing recognized amount is unknown, not
 * zero.
 */
export async function loadOtherExpenseMonthProjectCost(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const { start, end } = monthBounds(month);
	const [rows] = (await db.execute(
		`SELECT e.project_id, e.currency AS currency,
              SUM(e.recognized_amount) AS amount,
              SUM(CASE WHEN e.recognized_amount IS NULL THEN 1 ELSE 0 END) AS unknown_amounts
       FROM (${OTHER_EXPENSE_SOURCE}) e
      WHERE e.isDelete = 0
        AND e.recognition_state = 'recognized'
        AND e.cost_classification = 'project'
        AND e.project_id IS NOT NULL
        AND e.currency IS NOT NULL
        AND e.recognition_period BETWEEN ? AND ?
      GROUP BY e.project_id, e.currency`,
		[start, end]
	)) as [DbRow[], unknown];
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows) {
		const id = rowNumber(row, 'project_id');
		const currency = rowValue<string>(row, 'currency');
		if (id === null || !currency) continue;
		const unknownAmounts = rowNumber(row, 'unknown_amounts') ?? 0;
		const perCurrency = costs.get(id) ?? new Map<string, number | null>();
		perCurrency.set(
			currency,
			unknownAmounts > 0 ? null : rowNumber(row, 'amount')
		);
		costs.set(id, perCurrency);
	}
	return costs;
}

/**
 * Recognized other-expense Project cost of every month before `month`: the
 * Cost to Date base's other-expense side.
 */
export async function loadOtherExpenseProjectCostBefore(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const [rows] = (await db.execute(
		`SELECT e.project_id, e.currency AS currency,
              SUM(e.recognized_amount) AS amount,
              SUM(CASE WHEN e.recognized_amount IS NULL THEN 1 ELSE 0 END) AS unknown_amounts
       FROM (${OTHER_EXPENSE_SOURCE}) e
      WHERE e.isDelete = 0
        AND e.recognition_state = 'recognized'
        AND e.cost_classification = 'project'
        AND e.project_id IS NOT NULL
        AND e.currency IS NOT NULL
        AND e.recognition_period < ?
      GROUP BY e.project_id, e.currency`,
		[`${month}-01`]
	)) as [DbRow[], unknown];
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows) {
		const id = rowNumber(row, 'project_id');
		const currency = rowValue<string>(row, 'currency');
		if (id === null || !currency) continue;
		const unknownAmounts = rowNumber(row, 'unknown_amounts') ?? 0;
		const perCurrency = costs.get(id) ?? new Map<string, number | null>();
		perCurrency.set(
			currency,
			unknownAmounts > 0 ? null : rowNumber(row, 'amount')
		);
		costs.set(id, perCurrency);
	}
	return costs;
}

/** Months with other-expense cost recorded, newest first. */
export async function loadOtherExpenseMonths(
	db: SqlConnection,
	currentMonth: string
): Promise<string[]> {
	const [rows] = (await db.execute(
		`SELECT DISTINCT DATE_FORMAT(COALESCE(e.recognition_period, e.expense_date), '%Y-%m') AS month
       FROM (${OTHER_EXPENSE_SOURCE}) e
      WHERE e.isDelete = 0
        AND (e.recognition_period IS NOT NULL OR e.expense_date IS NOT NULL)`
	)) as [DbRow[], unknown];
	const months = new Set<string>([currentMonth]);
	for (const row of rows) {
		const month = rowValue<string>(row, 'month');
		if (month) months.add(month);
	}
	return [...months].sort().reverse();
}

/**
 * The register's matching records for one drilldown query. The filters are the
 * same clauses the direct-expense reader uses, so one page and one total
 * describe the same set for every source.
 */
export async function loadFilteredOtherExpenseRecords(
	db: SqlConnection,
	query: CostDrilldownQuery
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(query.month);
	const state = stateFilterClause(query.state);
	const nature = natureFilterClause(query.nature);
	const where = [
		'e.isDelete = 0',
		MONTH_PREDICATE,
		state.clause,
		nature.clause,
	];
	const params: Array<string | number> = [
		start,
		end,
		start,
		end,
		...state.params,
		...nature.params,
	];
	if (query.classification && query.classification !== 'all') {
		if (query.classification === 'unresolved') {
			where.push('e.cost_classification IS NULL');
		} else {
			where.push('e.cost_classification = ?');
			params.push(query.classification);
		}
	}
	if (query.projectId !== undefined && query.projectId !== null) {
		where.push('e.project_id = ?');
		params.push(query.projectId);
	}
	const [rows] = (await db.execute(
		`${OTHER_EXPENSE_COST_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY e.recognition_period DESC, e.expense_date DESC, e.id DESC`,
		params
	)) as [DbRow[], unknown];
	return rows.map((row) => mapCostRow(row, 'other_expense'));
}

/**
 * Merge two previous-month Project cost maps (project → currency → amount):
 * the same slice adds up, and an unknown contribution keeps the slice unknown.
 */
export function mergeProjectCostMaps(
	left: Map<number, Map<string, number | null>>,
	right: Map<number, Map<string, number | null>>
): Map<number, Map<string, number | null>> {
	const merged = new Map<number, Map<string, number | null>>();
	for (const source of [left, right]) {
		for (const [projectId, perCurrency] of source) {
			const target = merged.get(projectId) ?? new Map<string, number | null>();
			for (const [currency, amount] of perCurrency) {
				const existing = target.get(currency);
				if (existing === undefined) {
					target.set(currency, amount);
				} else if (existing === null || amount === null) {
					target.set(currency, null);
				} else {
					target.set(currency, toNumber(add(R(existing), R(amount))));
				}
			}
			merged.set(projectId, target);
		}
	}
	return merged;
}

const CLASSIFICATIONS = ['project', 'company_overhead', 'unallocated'] as const;
const TAX_TREATMENTS = [
	'none',
	'recoverable',
	'non_recoverable',
	'unresolved',
] as const;
const PAYEE_TYPES = ['vendor', 'employee'] as const;
const OPERATIONAL_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'reimbursed',
] as const;

const STATE_TO_STATUS: Record<RecognitionState, string> = {
	draft: 'draft',
	pending_evidence: 'submitted',
	recognized: 'approved',
	rejected: 'rejected',
	cancelled: 'submitted',
};

const JOURNAL_COMMAND: Record<string, CostJournalCommand> = {
	update: 'updated',
	submit: 'submitted',
	recognize: 'recognized',
	reject: 'rejected',
	cancel: 'cancelled',
};

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

function idOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new CostError(
			'invalid_project',
			'project_id must be an integer',
			422
		);
	}
	return parsed;
}

function pickEnum<T extends string>(
	value: unknown,
	allowed: readonly T[]
): T | null {
	if (value === null || value === undefined) return null;
	const candidate = String(value).trim();
	return (allowed as readonly string[]).includes(candidate)
		? (candidate as T)
		: null;
}

function enumOrThrow<T extends string>(
	value: unknown,
	allowed: readonly T[],
	code: string,
	field: string
): T | null {
	const picked = pickEnum(value, allowed);
	if (
		value !== null &&
		value !== undefined &&
		String(value).trim() !== '' &&
		!picked
	) {
		throw new CostError(code, `Unknown ${field}: ${String(value)}`, 422, {
			field,
		});
	}
	return picked;
}

/**
 * Untrusted capture input, as the register route receives it. Every field is
 * validated in the module: strings are trimmed and bounded, amounts parsed,
 * dates checked, and enums refused when unknown.
 */
export interface OtherExpenseCaptureInput {
	voucher_number?: unknown;
	voucher_date?: unknown;
	expense_category?: unknown;
	payee_type?: unknown;
	vendor_id?: unknown;
	vendor_name?: unknown;
	employee_id?: unknown;
	employee_name?: unknown;
	bill_no?: unknown;
	bill_date?: unknown;
	bill_amount?: unknown;
	gst_amount?: unknown;
	net_amount?: unknown;
	description?: unknown;
	status?: unknown;
	/** Module fields. */
	gross_amount?: unknown;
	amount?: unknown;
	tax_amount?: unknown;
	currency?: unknown;
	cost_classification?: unknown;
	project_id?: unknown;
	service_period_start?: unknown;
	service_period_end?: unknown;
	tax_treatment?: unknown;
	tax_evidence_reference?: unknown;
	source_reference?: unknown;
	evidence_reference?: unknown;
	receipt_url?: unknown;
	/** Conversion evidence (#319): reporting target, rate, date, reference. */
	reporting_currency?: unknown;
	conversion_rate?: unknown;
	conversion_date?: unknown;
	conversion_evidence_reference?: unknown;
	/** Set to make this row a receipt copy of an already recognized cost. */
	linked_cost_uid?: unknown;
	/** Enter the recognition queue instead of staying a draft. */
	submit?: unknown;
}

export interface DuplicateCandidate {
	cost_uid: string;
	label: string | null;
	source_table: string;
	recognition_state: string;
}

export interface RecordedOtherExpense {
	id: string;
	voucher_number: string;
	cost_uid: string;
	linked_cost_uid: string | null;
	recognition_state: RecognitionState;
	financial_version: number;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	recognized_amount: number | null;
	cost_classification: CostClassification | null;
	duplicate_candidates: DuplicateCandidate[];
}

export interface OtherExpenseRow {
	id: string;
	/** The numeric register key; the journal's `source_id` for this row. */
	rowNo: number;
	voucher_number: string;
	cost_uid: string | null;
	linked_cost_uid: string | null;
	project_id: number | null;
	cost_classification: CostClassification | null;
	recognition_state: RecognitionState;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	service_period_start: string | null;
	service_period_end: string | null;
	bill_date: string | null;
	currency: string | null;
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
	receipt_url: string | null;
	recognized_amount: number | null;
	recognized_by: number | null;
	recognized_at: string | null;
	financial_version: number;
	operational_status: string | null;
}

/** Field changes an `update` may state; every value is validated. */
export interface OtherExpensePatch {
	classification?: unknown;
	project_id?: unknown;
	service_period_start?: unknown;
	service_period_end?: unknown;
	bill_date?: unknown;
	currency?: unknown;
	reporting_currency?: unknown;
	conversion_rate?: unknown;
	conversion_date?: unknown;
	conversion_evidence_reference?: unknown;
	gross_amount?: unknown;
	tax_amount?: unknown;
	tax_treatment?: unknown;
	tax_evidence_reference?: unknown;
	source_reference?: unknown;
	evidence_reference?: unknown;
}

/** The command input for this source: the direct-expense contract, verbatim. */
export interface OtherExpenseCommandInput {
	id: string;
	command: 'update' | 'submit' | 'recognize' | 'reject' | 'cancel';
	expected_version: number;
	reason?: unknown;
	evidence_reference?: unknown;
	patch?: OtherExpensePatch;
}

export interface OtherExpenseCommandResult {
	id: string;
	cost_uid: string | null;
	recognition_state: RecognitionState;
	financial_version: number;
	recognized_amount: number | null;
	recognition_period: string | null;
	component: string;
	linked_cost_uid: string | null;
}

export type CopyReviewAction = 'confirm_copy' | 'reject_copy' | 'unlink_copy';

export interface CopyReviewInput {
	id: string;
	action: CopyReviewAction;
	expected_version: number;
	reason?: string | null;
	evidence_reference?: string | null;
	/** Explicit target for a copy that has no pending candidate yet. */
	target_cost_uid?: string | null;
}

export interface CopyReviewResult {
	id: string;
	cost_uid: string | null;
	recognition_state: RecognitionState;
	financial_version: number;
	linked_cost_uid: string | null;
	review: CopyReviewAction;
}

export interface PendingCopyReview {
	link_id: number;
	copy_id: string;
	voucher_number: string;
	/** The copy row's version the reviewer read. */
	financial_version: number;
	gross_amount: number | null;
	currency: string | null;
	vendor_name: string | null;
	created_at: string | null;
	target: {
		cost_uid: string;
		label: string | null;
		source_table: string;
		recognition_state: string | null;
	};
}

export interface LinkedCopyReview {
	link_id: number;
	copy_id: string;
	voucher_number: string;
	basis: string;
	review_state: string;
	target_cost_uid: string;
}

export interface UnresolvedOtherExpense {
	id: string;
	voucher_number: string;
	recognition_state: RecognitionState;
	financial_version: number;
	gross_amount: number | null;
	cost_classification: CostClassification | null;
	missing: string[];
}

export interface OtherExpenseReviewQueue {
	pending_copies: PendingCopyReview[];
	linked_copies: LinkedCopyReview[];
	unresolved: UnresolvedOtherExpense[];
}

type DbRow = Record<string, unknown>;

function rowValue<T>(row: DbRow, key: string): T | null {
	const value = row[key];
	return value === null || value === undefined ? null : (value as T);
}

function rowNumber(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** The register's own key, as a string (it is a CHAR(36) UUID). */
function keyOf(value: unknown): string {
	return String(value ?? '').trim();
}

function asRow(row: DbRow): OtherExpenseRow {
	return {
		id: keyOf(row.id),
		rowNo: rowNumber(row, 'row_no') ?? 0,
		voucher_number: String(row.voucher_number ?? ''),
		cost_uid: rowValue<string>(row, 'cost_uid'),
		linked_cost_uid: rowValue<string>(row, 'linked_cost_uid'),
		project_id: rowNumber(row, 'project_id'),
		cost_classification:
			rowValue<CostClassification>(row, 'cost_classification') ?? null,
		recognition_state:
			rowValue<RecognitionState>(row, 'recognition_state') ?? 'draft',
		recognition_period: rowValue<string>(row, 'recognition_period'),
		period_basis: rowValue<PeriodBasis>(row, 'period_basis') ?? 'unresolved',
		service_period_start: rowValue<string>(row, 'service_period_start'),
		service_period_end: rowValue<string>(row, 'service_period_end'),
		bill_date: rowValue<string>(row, 'bill_date'),
		currency: rowValue<string>(row, 'currency'),
		reporting_currency: rowValue<string>(row, 'reporting_currency'),
		conversion_rate:
			row.conversion_rate === null || row.conversion_rate === undefined
				? null
				: String(row.conversion_rate),
		conversion_date: rowValue<string>(row, 'conversion_date'),
		conversion_evidence_reference: rowValue<string>(
			row,
			'conversion_evidence_reference'
		),
		converted_amount: rowNumber(row, 'converted_amount'),
		gross_amount: rowNumber(row, 'net_amount'),
		tax_amount: rowNumber(row, 'gst_amount'),
		tax_treatment: rowValue<TaxTreatment>(row, 'tax_treatment') ?? 'unresolved',
		tax_evidence_reference: rowValue<string>(row, 'tax_evidence_reference'),
		source_reference: rowValue<string>(row, 'source_reference'),
		evidence_reference: rowValue<string>(row, 'evidence_reference'),
		receipt_url: rowValue<string>(row, 'receipt_url'),
		recognized_amount: rowNumber(row, 'recognized_amount'),
		recognized_by: rowNumber(row, 'recognized_by'),
		recognized_at: rowValue<string>(row, 'recognized_at'),
		financial_version: rowNumber(row, 'financial_version') ?? 1,
		operational_status: rowValue<string>(row, 'status'),
	};
}

const ROW_COLUMNS = `id, row_no, voucher_number, cost_uid, linked_cost_uid, project_id,
  cost_classification, recognition_state, recognition_period, period_basis,
  service_period_start, service_period_end, bill_date, currency, reporting_currency,
  conversion_rate, conversion_date, conversion_evidence_reference, converted_amount,
  net_amount, gst_amount,
  tax_treatment, tax_evidence_reference, source_reference, evidence_reference,
  receipt_url, recognized_amount, recognized_by, recognized_at, financial_version, status`;

async function loadRowForUpdate(
	db: SqlConnection,
	id: string
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`SELECT ${ROW_COLUMNS} FROM other_expenses WHERE id = ? AND isDelete = 0 FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * Mint the register's own number (OEX-#####). The read takes a row lock so
 * concurrent creates serialize; the active-number unique index is the backstop
 * and the caller retries on a duplicate key.
 */
async function nextVoucherNumber(db: SqlConnection): Promise<string> {
	const [rows] = (await db.execute(
		`SELECT voucher_number FROM other_expenses
      WHERE voucher_number LIKE 'OEX-%' AND isDelete = 0
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
	)) as [Array<{ voucher_number: string }>, unknown];
	let next = 1;
	if (rows.length > 0) {
		const match = /OEX-(\d+)/.exec(rows[0].voucher_number ?? '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `OEX-${String(next).padStart(5, '0')}`;
}

/**
 * Append one journal row. `financial_cost_events.source_id` is INT, so an
 * other-expense command journals the register's numeric `row_no` — the native
 * UUID stays the row's own key, the registry/reference key, and the command
 * path's identity, and the journal never coerces it to a number.
 */
async function writeJournal(
	db: SqlConnection,
	entry: {
		costUid: string;
		sourceId: number;
		version: number;
		command: CostJournalCommand;
		actorId: number | null;
		reason: string | null;
		evidenceReference: string | null;
		snapshot: Record<string, unknown>;
	}
): Promise<void> {
	await db.execute(
		`INSERT INTO financial_cost_events
       (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
        evidence_reference, snapshot)
     VALUES (?, 'other_expenses', ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.costUid,
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
 * The best text/document match for a new standalone entry, if any. It is
 * evidence for review, never an automatic merge: same normalized vendor, same
 * gross amount, same currency. The register's own identity (bill numbers) is
 * display evidence only.
 */
async function findDuplicateCandidate(
	db: SqlConnection,
	input: {
		vendorName: string | null;
		grossAmount: number | null;
		/** NULL = unknown original currency; it can never match a candidate. */
		currency: string | null;
		excludeCostUid: string | null;
	}
): Promise<DuplicateCandidate | null> {
	if (!input.vendorName || input.grossAmount === null || !input.currency) {
		return null;
	}
	const [rows] = (await db.execute(
		`SELECT c.cost_uid, c.label, c.source_table, c.recognition_state
       FROM (
         SELECT e.cost_uid,
                e.expense_number AS label,
                'expenses' AS source_table,
                e.currency AS currency,
                e.total_amount AS gross_amount,
                e.vendor_name AS vendor_name,
                e.recognition_state AS recognition_state
           FROM expenses e
          WHERE e.isDelete = 0 AND e.recognition_state = 'recognized'
         UNION ALL
         SELECT o.cost_uid,
                o.voucher_number AS label,
                'other_expenses' AS source_table,
                o.currency AS currency,
                o.net_amount AS gross_amount,
                COALESCE(o.vendor_name, o.employee_name) AS vendor_name,
                o.recognition_state AS recognition_state
           FROM other_expenses o
          WHERE o.isDelete = 0 AND o.recognition_state = 'recognized'
            AND o.linked_cost_uid IS NULL
       ) c
      WHERE c.currency = ?
        AND c.gross_amount = ?
        AND LOWER(TRIM(c.vendor_name)) = LOWER(TRIM(?))
        AND (? IS NULL OR c.cost_uid <> ?)
      ORDER BY c.label
      LIMIT 1`,
		[
			input.currency,
			input.grossAmount,
			input.vendorName,
			input.excludeCostUid,
			input.excludeCostUid,
		]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	return {
		cost_uid: String(rows[0].cost_uid ?? ''),
		label: rows[0].label === null ? null : String(rows[0].label),
		source_table: String(rows[0].source_table ?? ''),
		recognition_state: String(rows[0].recognition_state ?? ''),
	};
}

/** The row's conversion evidence, as the module stores and reads it. */
interface ResolvedConversion {
	/** NULL = the original currency is unknown, never assumed to be INR. */
	currency: string | null;
	reportingCurrency: string;
	conversionRate: string | null;
	conversionDate: string | null;
	conversionEvidenceReference: string | null;
}

/**
 * Validate the original currency, the reporting target, and the optional
 * conversion triple, exactly as the direct-expense path does (#319): evidence
 * moves as a whole or not at all, and a rate for an amount already in its
 * reporting currency, or for an amount whose currency is unknown, is
 * contradictory and refused rather than dropped. No inverse or cross-rate is
 * ever derived.
 */
function resolveConversion(input: {
	currency: unknown;
	reportingCurrency: unknown;
	conversionRate: unknown;
	conversionDate: unknown;
	conversionEvidenceReference: unknown;
}): ResolvedConversion {
	if (!isCurrencyCode(input.currency)) {
		throw new CostError(
			'invalid_currency',
			'Currency must be a three-letter code',
			422,
			{ field: 'currency' }
		);
	}
	if (!isCurrencyCode(input.reportingCurrency)) {
		throw new CostError(
			'invalid_currency',
			'Reporting currency must be a three-letter code',
			422,
			{ field: 'reporting_currency' }
		);
	}
	const currency = currencyCodeOf(input.currency);
	const reportingCurrency = reportingCurrencyOf({
		reportingCurrency: currencyCodeOf(input.reportingCurrency),
	});
	const rawRate = input.conversionRate;
	const rateText =
		rawRate === null || rawRate === undefined ? null : String(rawRate).trim();
	const hasRate = rateText !== null && rateText.length > 0;
	const conversionDate = dateOrNull(input.conversionDate);
	const conversionEvidenceReference = text(
		input.conversionEvidenceReference,
		500
	);
	const hasAny =
		hasRate || conversionDate !== null || conversionEvidenceReference !== null;
	if (!hasAny) {
		return {
			currency,
			reportingCurrency,
			conversionRate: null,
			conversionDate: null,
			conversionEvidenceReference: null,
		};
	}
	// Conversion evidence needs the original currency first: an unknown
	// currency can never support a rate, and is refused rather than stored.
	if (currency === null) {
		throw new CostError(
			'conversion_requires_currency',
			'Conversion evidence needs the original currency first',
			422,
			{ field: 'conversion_rate' }
		);
	}
	if (currency === reportingCurrency) {
		throw new CostError(
			'conversion_not_applicable',
			'An amount already in its reporting currency carries no conversion evidence',
			422,
			{ field: 'conversion_rate' }
		);
	}
	if (hasRate && parseConversionRate(rateText) === null) {
		throw new CostError(
			'invalid_conversion_rate',
			'Conversion rate must be positive with at most 10 decimal places',
			422,
			{ field: 'conversion_rate' }
		);
	}
	const missing: string[] = [];
	if (!hasRate) missing.push('conversion_rate');
	if (conversionDate === null) missing.push('conversion_date');
	if (conversionEvidenceReference === null) {
		missing.push('conversion_evidence_reference');
	}
	if (missing.length > 0) {
		throw new CostError(
			'conversion_evidence_incomplete',
			'Conversion evidence needs the rate, its effective date, and its evidence reference together',
			422,
			{ missing }
		);
	}
	return {
		currency,
		reportingCurrency,
		conversionRate: rateText,
		conversionDate,
		conversionEvidenceReference,
	};
}

/**
 * The durable reporting-currency figure: the recognized amount at the stored
 * rate, or null while there is no confirmed amount or the evidence does not
 * support one. Recomputed by the module; a caller never states it.
 */
function convertedAmountOf(
	recognizedAmount: number | null,
	evidence: ResolvedConversion
): number | null {
	if (recognizedAmount === null) return null;
	return convertToReporting(
		recognizedAmount,
		evidenceOf(evidence),
		reportingCurrencyOf(evidence)
	).amount;
}

/** One capture's financial fields, resolved before the transaction opens. */
function captureFinancials(input: OtherExpenseCaptureInput) {
	const statedTax = amountOrNull(input.tax_amount ?? input.gst_amount);
	const statedGross = amountOrNull(input.gross_amount ?? input.net_amount);
	const legacyNet = amountOrNull(input.amount ?? input.bill_amount);
	const grossAmount =
		statedGross !== null
			? statedGross
			: legacyNet !== null
				? toNumber(add(R(legacyNet), R(statedTax ?? 0)))
				: null;
	const taxAmount = grossAmount === null ? null : (statedTax ?? 0);
	const netAmount =
		grossAmount === null
			? null
			: toNumber(sub(R(grossAmount), R(taxAmount ?? 0)));
	const servicePeriodStart = dateOrNull(input.service_period_start);
	const servicePeriodEnd = dateOrNull(input.service_period_end);
	const billDate = dateOrNull(input.bill_date);
	const classification = enumOrThrow(
		input.cost_classification,
		CLASSIFICATIONS,
		'invalid_classification',
		'cost_classification'
	);
	const projectId = idOrNull(input.project_id);
	const taxTreatment =
		enumOrThrow(
			input.tax_treatment,
			TAX_TREATMENTS,
			'invalid_tax_treatment',
			'tax_treatment'
		) ?? 'unresolved';
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
	if (grossAmount !== null && grossAmount < 0 && taxAmount === null) {
		throw new CostError(
			'invalid_amount',
			'A negative gross amount needs its tax amount',
			422
		);
	}
	return {
		grossAmount,
		taxAmount,
		netAmount,
		servicePeriodStart,
		servicePeriodEnd,
		billDate,
		classification,
		projectId,
		taxTreatment,
		taxEvidenceReference: text(input.tax_evidence_reference, 255),
		sourceReference: text(input.source_reference, 191),
		evidenceReference: text(input.evidence_reference, 500),
	};
}

/**
 * Record one other expense. A standalone voucher becomes its own cost and
 * registers its identity; a voucher carrying `linked_cost_uid` becomes a
 * receipt copy of an already recognized cost and registers only the reference,
 * so no second expense is created.
 */
export async function captureOtherExpense(
	input: OtherExpenseCaptureInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<RecordedOtherExpense> {
	const payeeType = enumOrThrow(
		input.payee_type,
		PAYEE_TYPES,
		'invalid_payee_type',
		'payee_type'
	);
	if (!payeeType) {
		throw new CostError('invalid_payee_type', 'payee_type is required', 422);
	}
	const category = text(input.expense_category, 100);
	if (!category) {
		throw new CostError(
			'expense_category_required',
			'expense_category is required',
			422
		);
	}
	const voucherDate = dateOrNull(input.voucher_date);
	if (!voucherDate) {
		throw new CostError(
			'voucher_date_required',
			'voucher_date is required',
			400
		);
	}
	const financial = captureFinancials(input);
	const conversion = resolveConversion({
		currency: input.currency,
		reportingCurrency: input.reporting_currency,
		conversionRate: input.conversion_rate,
		conversionDate: input.conversion_date,
		conversionEvidenceReference: input.conversion_evidence_reference,
	});
	const linkedCostUid = text(input.linked_cost_uid, 64);
	const { period, basis } = resolveRecognitionPeriod({
		servicePeriodStart: financial.servicePeriodStart,
		servicePeriodEnd: financial.servicePeriodEnd,
		billDate: financial.billDate,
	});
	const state: RecognitionState =
		input.submit === true || input.submit === 1 || input.submit === 'true'
			? 'pending_evidence'
			: 'draft';
	const operationalStatus =
		pickEnum(input.status, OPERATIONAL_STATUSES) ?? STATE_TO_STATUS[state];
	const vendorName =
		payeeType === 'vendor' ? text(input.vendor_name, 255) : null;
	const employeeName =
		payeeType === 'employee' ? text(input.employee_name, 255) : null;
	const vendorId = payeeType === 'vendor' ? idOrNull(input.vendor_id) : null;
	const employeeId =
		payeeType === 'employee' ? idOrNull(input.employee_id) : null;
	const evaluation = evaluateCost({
		classification: financial.classification,
		// An other expense is operating cost by definition; the non-operating
		// balances are their own source (#317).
		nature: 'operating',
		state,
		currency: conversion.currency,
		grossAmount: financial.grossAmount,
		taxAmount: financial.taxAmount,
		taxTreatment: financial.taxTreatment,
		taxEvidenceReference: financial.taxEvidenceReference,
		servicePeriodStart: financial.servicePeriodStart,
		servicePeriodEnd: financial.servicePeriodEnd,
		billDate: financial.billDate,
		sourceReference: financial.sourceReference,
		evidenceReference: financial.evidenceReference,
		recognitionPeriod: period,
		periodBasis: basis,
		recognizedAmount: null,
	});

	const ownsTransaction = !options?.connection;
	for (let attempt = 1; ; attempt++) {
		try {
			return await inTransaction(options, async (db) => {
				const id = randomUUID();
				const costUid = `cost-${randomUUID()}`;
				const voucherNumber =
					text(input.voucher_number, 50) ?? (await nextVoucherNumber(db));

				let linked: { cost_uid: string; label: string | null } | null = null;
				if (linkedCostUid) {
					const target = await resolveCostReference(db, linkedCostUid);
					if (!target) {
						throw new CostError(
							'cost_reference_unresolved',
							`No cost resolves to ${linkedCostUid}`,
							422,
							{ linked_cost_uid: linkedCostUid }
						);
					}
					if (target.recognition_state !== 'recognized') {
						throw new CostError(
							'cost_not_recognized',
							`${linkedCostUid} is ${target.recognition_state}, not an already recognized cost`,
							422,
							{ linked_cost_uid: linkedCostUid }
						);
					}
					linked = { cost_uid: target.cost_uid, label: target.label };
				}

				await db.execute(
					`INSERT INTO other_expenses
             (id, voucher_number, voucher_date, expense_category, payee_type,
              vendor_id, vendor_name, employee_id, employee_name,
              bill_no, bill_date, bill_amount, gst_amount, net_amount,
              description, status, created_by,
              cost_uid, cost_classification, recognition_state, recognition_period,
              period_basis, service_period_start, service_period_end, currency,
              tax_treatment, tax_evidence_reference, source_reference,
              evidence_reference, receipt_url, linked_cost_uid, project_id,
              financial_version, reporting_currency, conversion_rate,
              conversion_date, conversion_evidence_reference, converted_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
                   ?, ?, ?, ?, NULL)`,
					[
						id,
						voucherNumber,
						voucherDate,
						category,
						payeeType,
						vendorId,
						vendorName,
						employeeId,
						employeeName,
						text(input.bill_no, 100),
						financial.billDate,
						financial.netAmount,
						financial.taxAmount,
						financial.grossAmount,
						text(input.description, 65535),
						operationalStatus,
						actor.id,
						costUid,
						financial.classification,
						state,
						period,
						basis,
						financial.servicePeriodStart,
						financial.servicePeriodEnd,
						conversion.currency,
						financial.taxTreatment,
						financial.taxEvidenceReference,
						financial.sourceReference,
						financial.evidenceReference,
						text(input.receipt_url, 500),
						linked ? linked.cost_uid : null,
						financial.projectId,
						conversion.reportingCurrency,
						conversion.conversionRate,
						conversion.conversionDate,
						conversion.conversionEvidenceReference,
					]
				);

				// The journal's source key is the register's numeric `row_no`
				// (`financial_cost_events.source_id` is INT); the row's UUID stays
				// its native key, the registry key, and the command path's id.
				const [rowNoRows] = (await db.execute(
					`SELECT row_no FROM other_expenses WHERE id = ?`,
					[id]
				)) as [DbRow[], unknown];
				const rowNo = Number(rowNoRows[0]?.row_no ?? 0);
				if (!Number.isInteger(rowNo) || rowNo <= 0) {
					throw new CostError(
						'register_key_missing',
						'The register did not assign this entry its numeric key',
						500
					);
				}

				const duplicateCandidates: DuplicateCandidate[] = [];
				if (linked) {
					await linkCostReference(db, {
						costUid: linked.cost_uid,
						sourceTable: 'other_expenses',
						sourceId: id,
						role: 'receipt',
						basis: 'explicit',
						reviewState: 'confirmed',
						evidenceReference: financial.evidenceReference,
						createdBy: actor.id,
					});
				} else {
					await registerCostIdentity(db, {
						costUid,
						sourceTable: 'other_expenses',
						sourceId: id,
						createdBy: actor.id,
					});
					const candidate = await findDuplicateCandidate(db, {
						vendorName: vendorName ?? employeeName,
						grossAmount: financial.grossAmount,
						currency: conversion.currency,
						excludeCostUid: costUid,
					});
					if (candidate) {
						await linkCostReference(db, {
							costUid: candidate.cost_uid,
							sourceTable: 'other_expenses',
							sourceId: id,
							role: 'receipt',
							basis: 'candidate',
							reviewState: 'pending_review',
							evidenceReference: financial.evidenceReference,
							createdBy: actor.id,
						});
						duplicateCandidates.push(candidate);
					}
				}

				await writeJournal(db, {
					costUid,
					sourceId: rowNo,
					version: 1,
					command: 'recorded',
					actorId: actor.id,
					reason:
						state === 'pending_evidence' ? 'Submitted for recognition' : null,
					evidenceReference: financial.evidenceReference,
					snapshot: {
						classification: financial.classification,
						recognition_period: period,
						period_basis: basis,
						currency: conversion.currency,
						reporting_currency: conversion.reportingCurrency,
						conversion_rate: conversion.conversionRate,
						conversion_date: conversion.conversionDate,
						conversion_evidence_reference:
							conversion.conversionEvidenceReference,
						gross_amount: financial.grossAmount,
						tax_amount: financial.taxAmount,
						recognized_amount: null,
						converted_amount: null,
						state,
						linked_cost_uid: linked ? linked.cost_uid : null,
						exceptions: evaluation.exceptions,
					},
				});

				return {
					id,
					voucher_number: voucherNumber,
					cost_uid: costUid,
					linked_cost_uid: linked ? linked.cost_uid : null,
					recognition_state: state,
					financial_version: 1,
					recognition_period: period,
					period_basis: basis,
					recognized_amount: null,
					cost_classification: financial.classification,
					duplicate_candidates: duplicateCandidates,
				};
			});
		} catch (error) {
			if (
				ownsTransaction &&
				!input.voucher_number &&
				isRetryableNumberError(error) &&
				attempt < 5
			) {
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 15 * attempt);
				await promise;
				continue;
			}
			throw error;
		}
	}
}

/** The pending candidate link of one copy row, if any. */
async function findPendingCandidate(
	db: SqlConnection,
	id: string
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`SELECT id, cost_uid, basis, review_state, evidence_reference
       FROM financial_cost_links
      WHERE source_table = 'other_expenses' AND source_id = ?
        AND role = 'receipt' AND review_state = 'pending_review'
      LIMIT 1 FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * Apply one versioned command to a standalone voucher. The state check, the
 * version check, the update, and the journal entry are one transaction; a
 * receipt copy is refused here because it is not its own cost, and a pending
 * duplicate match must be resolved before anything becomes confirmed cost.
 */
export async function executeOtherExpenseCommand(
	input: OtherExpenseCommandInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<OtherExpenseCommandResult> {
	return inTransaction(options, async (db) => {
		const row = await loadRowForUpdate(db, keyOf(input.id));
		if (!row) throw new CostError('not_found', 'Other expense not found', 404);
		if (row.linked_cost_uid) {
			throw new CostError(
				'receipt_copy_not_cost',
				`This row is a receipt copy of ${String(row.linked_cost_uid)}; it is not its own cost`,
				422,
				{ linked_cost_uid: String(row.linked_cost_uid) }
			);
		}
		const current = asRow(row);
		if (current.financial_version !== input.expected_version) {
			throw new CostError(
				'version_conflict',
				`This entry changed since it was read (current version ${current.financial_version})`,
				409,
				{ current_version: current.financial_version }
			);
		}
		const target = nextState(current.recognition_state, input.command);
		if (!target) {
			throw new CostError(
				'command_not_allowed',
				`${input.command} is not allowed while the entry is ${current.recognition_state}`,
				422,
				{ state: current.recognition_state }
			);
		}
		if (
			(input.command === 'reject' || input.command === 'cancel') &&
			!text(input.reason, 500)
		) {
			throw new CostError(
				'reason_required',
				`A reason is required to ${input.command} an entry`,
				422
			);
		}

		const patch = input.patch ?? {};
		// A rate is evidence for ONE currency pair: changing either side never
		// inherits the stored triple, and a new convertible pair needs fresh
		// evidence in the same command (#319).
		const storedPair = {
			currency: current.currency,
			reportingCurrency: reportingCurrencyOf({
				reportingCurrency: current.reporting_currency,
			}),
		};
		const requestedPair = {
			currency:
				patch.currency !== undefined
					? currencyCodeOf(patch.currency)
					: storedPair.currency,
			reportingCurrency:
				patch.reporting_currency !== undefined
					? reportingCurrencyOf({
							reportingCurrency: currencyCodeOf(patch.reporting_currency),
						})
					: storedPair.reportingCurrency,
		};
		const pairChanged =
			requestedPair.currency !== storedPair.currency ||
			requestedPair.reportingCurrency !== storedPair.reportingCurrency;
		const suppliesConversionEvidence =
			patch.conversion_rate !== undefined ||
			patch.conversion_date !== undefined ||
			patch.conversion_evidence_reference !== undefined;
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
		const mergedRaw = {
			classification:
				patch.classification !== undefined
					? enumOrThrow(
							patch.classification,
							CLASSIFICATIONS,
							'invalid_classification',
							'cost_classification'
						)
					: current.cost_classification,
			projectId:
				patch.project_id !== undefined
					? idOrNull(patch.project_id)
					: current.project_id,
			servicePeriodStart:
				patch.service_period_start !== undefined
					? dateOrNull(patch.service_period_start)
					: current.service_period_start,
			servicePeriodEnd:
				patch.service_period_end !== undefined
					? dateOrNull(patch.service_period_end)
					: current.service_period_end,
			billDate:
				patch.bill_date !== undefined
					? dateOrNull(patch.bill_date)
					: current.bill_date,
			currency:
				patch.currency !== undefined ? patch.currency : current.currency,
			reportingCurrency:
				patch.reporting_currency !== undefined
					? patch.reporting_currency
					: current.reporting_currency,
			conversionRate: pairChanged
				? (patch.conversion_rate ?? null)
				: patch.conversion_rate !== undefined
					? patch.conversion_rate
					: current.conversion_rate,
			conversionDate: pairChanged
				? (patch.conversion_date ?? null)
				: patch.conversion_date !== undefined
					? patch.conversion_date
					: current.conversion_date,
			conversionEvidenceReference: pairChanged
				? (patch.conversion_evidence_reference ?? null)
				: patch.conversion_evidence_reference !== undefined
					? patch.conversion_evidence_reference
					: current.conversion_evidence_reference,
			grossAmount:
				patch.gross_amount !== undefined
					? amountOrNull(patch.gross_amount)
					: current.gross_amount,
			taxAmount:
				patch.tax_amount !== undefined
					? amountOrNull(patch.tax_amount)
					: current.tax_amount,
			taxTreatment:
				patch.tax_treatment !== undefined
					? (enumOrThrow(
							patch.tax_treatment,
							TAX_TREATMENTS,
							'invalid_tax_treatment',
							'tax_treatment'
						) ?? 'unresolved')
					: current.tax_treatment,
			taxEvidenceReference:
				patch.tax_evidence_reference !== undefined
					? text(patch.tax_evidence_reference, 255)
					: current.tax_evidence_reference,
			sourceReference:
				patch.source_reference !== undefined
					? text(patch.source_reference, 191)
					: current.source_reference,
			evidenceReference:
				patch.evidence_reference !== undefined
					? text(patch.evidence_reference, 500)
					: input.evidence_reference !== undefined
						? text(input.evidence_reference, 500)
						: current.evidence_reference,
		};
		// The currency and its conversion evidence are one validated unit (#319):
		// a rate without a known original currency, a rate on an amount already
		// in its reporting currency, or partial evidence is refused, not dropped.
		const merged = { ...mergedRaw, ...resolveConversion(mergedRaw) };
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
			patch.service_period_start !== undefined ||
			patch.service_period_end !== undefined ||
			patch.bill_date !== undefined;
		const resolved = datesChanged
			? resolveRecognitionPeriod(merged)
			: { period: current.recognition_period, basis: current.period_basis };

		let recognizedAmount = current.recognized_amount;
		let recognizedBy = current.recognized_by;
		const recognizedAt = current.recognized_at;

		if (input.command === 'recognize') {
			const candidate = await findPendingCandidate(db, current.id);
			if (candidate) {
				throw new CostError(
					'duplicate_review_pending',
					'A possible duplicate of this entry is waiting for review; confirm or reject it first',
					422,
					{ candidate_cost_uid: String(candidate.cost_uid ?? '') }
				);
			}
			const blockers = recognitionBlockers({
				grossAmount: merged.grossAmount,
				classification: merged.classification,
				projectId: merged.projectId,
				recognitionPeriod: resolved.period,
				currency: merged.currency,
			});
			if (blockers.length > 0) {
				throw new CostError(
					'not_ready_for_recognition',
					'This entry cannot become confirmed cost yet',
					422,
					{ missing: blockers }
				);
			}
			recognizedAmount = evaluateCost({
				...merged,
				nature: 'operating',
				state: target,
				servicePeriodStart: merged.servicePeriodStart,
				servicePeriodEnd: merged.servicePeriodEnd,
				billDate: merged.billDate,
				recognitionPeriod: resolved.period,
				periodBasis: resolved.basis,
				recognizedAmount: null,
			}).recognizedAmount;
			recognizedBy = actor.id;
			recognizedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
			// A recognized cost is cost-bearing by definition: make sure its
			// canonical identity exists (idempotent), so any source can resolve
			// it even if the row was unlinked or backfilled without one.
			await registerCostIdentity(db, {
				costUid: current.cost_uid ?? '',
				sourceTable: 'other_expenses',
				sourceId: current.id,
				createdBy: actor.id,
			});
		}

		const nextVersion = current.financial_version + 1;
		const netAmount =
			merged.grossAmount === null
				? null
				: toNumber(sub(R(merged.grossAmount), R(merged.taxAmount ?? 0)));
		// The durable reporting-currency figure at the stored rate; null while
		// there is no confirmed amount or the evidence does not support one.
		const convertedAmount = convertedAmountOf(recognizedAmount, merged);
		const [updated] = (await db.execute(
			`UPDATE other_expenses
          SET cost_classification = ?, recognition_state = ?, recognition_period = ?,
              period_basis = ?, service_period_start = ?, service_period_end = ?,
              bill_date = ?, tax_treatment = ?, tax_evidence_reference = ?,
              currency = ?, reporting_currency = ?, conversion_rate = ?,
              conversion_date = ?, conversion_evidence_reference = ?,
              bill_amount = ?, net_amount = ?, gst_amount = ?,
              converted_amount = ?,
              source_reference = ?, evidence_reference = ?, recognized_amount = ?,
              recognized_by = ?, recognized_at = IF(?, NOW(), ?), financial_version = ?
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[
				merged.classification,
				target,
				resolved.period,
				resolved.basis,
				merged.servicePeriodStart,
				merged.servicePeriodEnd,
				merged.billDate,
				merged.taxTreatment,
				merged.taxEvidenceReference,
				merged.currency,
				merged.reportingCurrency,
				merged.conversionRate,
				merged.conversionDate,
				merged.conversionEvidenceReference,
				netAmount,
				merged.grossAmount,
				merged.taxAmount,
				convertedAmount,
				merged.sourceReference,
				merged.evidenceReference,
				recognizedAmount,
				recognizedBy,
				input.command === 'recognize' ? 1 : 0,
				recognizedAt,
				nextVersion,
				current.id,
				current.financial_version,
			]
		)) as [Record<string, unknown>, unknown];
		if (Number(updated.affectedRows ?? 0) === 0) {
			throw new CostError(
				'version_conflict',
				'This entry changed while the command was applied',
				409
			);
		}

		await writeJournal(db, {
			costUid: current.cost_uid ?? '',
			sourceId: current.rowNo,
			version: nextVersion,
			command: JOURNAL_COMMAND[input.command] ?? 'updated',
			actorId: actor.id,
			reason: text(input.reason, 500),
			evidenceReference: merged.evidenceReference,
			snapshot: {
				classification: merged.classification,
				recognition_period: resolved.period,
				period_basis: resolved.basis,
				currency: merged.currency,
				reporting_currency: merged.reportingCurrency,
				conversion_rate: merged.conversionRate,
				conversion_date: merged.conversionDate,
				conversion_evidence_reference: merged.conversionEvidenceReference,
				gross_amount: merged.grossAmount,
				tax_amount: merged.taxAmount,
				tax_treatment: merged.taxTreatment,
				recognized_amount: recognizedAmount,
				converted_amount: convertedAmount,
				state: target,
			},
		});

		return {
			id: current.id,
			cost_uid: current.cost_uid,
			recognition_state: target,
			financial_version: nextVersion,
			recognized_amount: recognizedAmount,
			recognition_period: resolved.period,
			component: input.command,
			linked_cost_uid: null,
		};
	});
}

/**
 * Resolve one duplicate-reference decision. Confirming turns the row into a
 * receipt copy of an already recognized cost; rejecting keeps it a standalone
 * cost; unlinking undoes a mistaken link. Every decision appends a journal row
 * and keeps the link row's history.
 */
export async function resolveOtherExpenseCopy(
	input: CopyReviewInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<CopyReviewResult> {
	if (
		input.action !== 'confirm_copy' &&
		input.action !== 'reject_copy' &&
		input.action !== 'unlink_copy'
	) {
		throw new CostError(
			'unknown_review_action',
			`Unknown review action: ${String(input.action)}`,
			422
		);
	}
	return inTransaction(options, async (db) => {
		const row = await loadRowForUpdate(db, keyOf(input.id));
		if (!row) throw new CostError('not_found', 'Other expense not found', 404);
		const current = asRow(row);
		if (current.financial_version !== input.expected_version) {
			throw new CostError(
				'version_conflict',
				`This entry changed since it was read (current version ${current.financial_version})`,
				409,
				{ current_version: current.financial_version }
			);
		}
		if (current.recognition_state === 'recognized') {
			throw new CostError(
				'copy_recognized',
				'Cancel the recognized cost before linking it as a copy',
				409
			);
		}
		const candidate = await findPendingCandidate(db, current.id);
		const requestedUid = text(input.target_cost_uid, 64);

		if (input.action === 'unlink_copy') {
			if (!current.linked_cost_uid) {
				throw new CostError(
					'link_not_found',
					'This row is not linked to a cost',
					404
				);
			}
			if (requestedUid && requestedUid !== current.linked_cost_uid) {
				throw new CostError(
					'link_target_mismatch',
					'The requested target is not the cost this entry is linked to',
					422,
					{ linked_cost_uid: current.linked_cost_uid }
				);
			}
			await linkCostReference(db, {
				costUid: current.linked_cost_uid,
				sourceTable: 'other_expenses',
				sourceId: current.id,
				role: 'receipt',
				basis: 'explicit',
				reviewState: 'rejected',
				evidenceReference: text(input.evidence_reference, 500),
				createdBy: actor.id,
			});
			await releaseLink(db, current, nextVersionOf(current), actor, input, {
				review: 'unlink_copy',
				previous_link: current.linked_cost_uid,
			});
			// The row is cost-bearing again: register its canonical identity
			// idempotently, so a later reference to it still resolves.
			await registerCostIdentity(db, {
				costUid: current.cost_uid ?? '',
				sourceTable: 'other_expenses',
				sourceId: current.id,
				createdBy: actor.id,
			});
			return {
				id: current.id,
				cost_uid: current.cost_uid,
				recognition_state: current.recognition_state,
				financial_version: nextVersionOf(current),
				linked_cost_uid: null,
				review: input.action,
			};
		}

		if (input.action === 'reject_copy') {
			if (!candidate) {
				throw new CostError(
					'link_not_found',
					'No pending duplicate reference to reject',
					404
				);
			}
			const candidateUid = String(candidate.cost_uid ?? '');
			// The decision is about the stored candidate: a different requested
			// target is refused, never written over the preserved reference.
			if (requestedUid && requestedUid !== candidateUid) {
				throw new CostError(
					'link_target_mismatch',
					'The requested target is not the pending candidate for this entry',
					422,
					{ candidate_cost_uid: candidateUid }
				);
			}
			await rejectCandidateLink(
				db,
				current.id,
				candidateUid,
				candidate,
				input,
				actor
			);
			await releaseLink(db, current, nextVersionOf(current), actor, input, {
				review: 'reject_copy',
				candidate_cost_uid: candidateUid,
			});
			return {
				id: current.id,
				cost_uid: current.cost_uid,
				recognition_state: current.recognition_state,
				financial_version: nextVersionOf(current),
				linked_cost_uid: null,
				review: input.action,
			};
		}

		// confirm_copy: the target must resolve to an already recognized cost.
		const targetUid =
			requestedUid ?? (candidate ? String(candidate.cost_uid) : '');
		if (!targetUid) {
			throw new CostError(
				'link_not_found',
				'No possible duplicate to confirm; state the target cost',
				404
			);
		}
		const target = await resolveCostReference(db, targetUid);
		if (!target) {
			throw new CostError(
				'cost_reference_unresolved',
				`No cost resolves to ${targetUid}`,
				422,
				{ linked_cost_uid: targetUid }
			);
		}
		if (target.recognition_state !== 'recognized') {
			throw new CostError(
				'cost_not_recognized',
				`${targetUid} is ${target.recognition_state}, not an already recognized cost`,
				422,
				{ linked_cost_uid: targetUid }
			);
		}
		await linkCostReference(db, {
			costUid: target.cost_uid,
			sourceTable: 'other_expenses',
			sourceId: current.id,
			role: 'receipt',
			// An operator-stated target is an explicit reference; a resolved
			// candidate is a document-backed review decision.
			basis: requestedUid ? 'explicit' : 'document',
			reviewState: 'confirmed',
			evidenceReference:
				text(input.evidence_reference, 500) ?? current.evidence_reference,
			createdBy: actor.id,
		});
		const version = nextVersionOf(current);
		const [updated] = (await db.execute(
			`UPDATE other_expenses
          SET linked_cost_uid = ?, financial_version = ?
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[target.cost_uid, version, current.id, current.financial_version]
		)) as [Record<string, unknown>, unknown];
		if (Number(updated.affectedRows ?? 0) === 0) {
			throw new CostError(
				'version_conflict',
				'This entry changed while the review was applied',
				409
			);
		}
		await writeJournal(db, {
			costUid: current.cost_uid ?? '',
			sourceId: current.rowNo,
			version,
			command: 'updated',
			actorId: actor.id,
			reason: text(input.reason, 500),
			evidenceReference:
				text(input.evidence_reference, 500) ?? current.evidence_reference,
			snapshot: {
				review: 'confirm_copy',
				linked_cost_uid: target.cost_uid,
				target_source_table: target.source_table,
				target_source_id: target.source_id,
				target_label: target.label,
			},
		});
		return {
			id: current.id,
			cost_uid: current.cost_uid,
			recognition_state: current.recognition_state,
			financial_version: version,
			linked_cost_uid: target.cost_uid,
			review: input.action,
		};
	});
}

function nextVersionOf(current: OtherExpenseRow): number {
	return current.financial_version + 1;
}

/**
 * Mark the stored pending candidate as rejected. The link row keeps its
 * history: the identity it proposed stays readable, only its review state
 * changes, and the caller never writes a different target over it.
 */
async function rejectCandidateLink(
	db: SqlConnection,
	id: string,
	uid: string,
	candidate: DbRow,
	input: CopyReviewInput,
	actor: CostActor
): Promise<void> {
	await linkCostReference(db, {
		costUid: uid,
		sourceTable: 'other_expenses',
		sourceId: id,
		role: 'receipt',
		basis: 'candidate',
		reviewState: 'rejected',
		evidenceReference:
			text(input.evidence_reference, 500) ??
			(String(candidate.evidence_reference ?? '') || null),
		createdBy: actor.id,
	});
}

/**
 * Bump the row's financial version and journal the review decision. The row's
 * cost fields do not change here, so the journal entry is the record of the
 * decision itself.
 */
async function releaseLink(
	db: SqlConnection,
	current: OtherExpenseRow,
	version: number,
	actor: CostActor,
	input: CopyReviewInput,
	snapshot: Record<string, unknown>
): Promise<void> {
	const [updated] = (await db.execute(
		`UPDATE other_expenses
        SET linked_cost_uid = NULL, financial_version = ?
      WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
		[version, current.id, current.financial_version]
	)) as [Record<string, unknown>, unknown];
	if (Number(updated.affectedRows ?? 0) === 0) {
		throw new CostError(
			'version_conflict',
			'This entry changed while the review was applied',
			409
		);
	}
	await writeJournal(db, {
		costUid: current.cost_uid ?? '',
		sourceId: current.rowNo,
		version,
		command: 'updated',
		actorId: actor.id,
		reason: text(input.reason, 500),
		evidenceReference: text(input.evidence_reference, 500),
		snapshot,
	});
}

/**
 * The review queue: candidate copies waiting for a decision, confirmed copies,
 * and standalone entries whose classification or evidence is unresolved.
 */
export async function loadOtherExpenseReview(
	db: SqlConnection
): Promise<OtherExpenseReviewQueue> {
	const [copyRows] = (await db.execute(
		`SELECT l.id AS link_id, l.cost_uid AS target_cost_uid, l.basis, l.review_state,
              o.id AS copy_id, o.voucher_number, o.net_amount, o.currency,
              o.financial_version, COALESCE(o.vendor_name, o.employee_name) AS vendor_name,
              o.created_at, o.cost_uid AS copy_cost_uid
         FROM financial_cost_links l
         -- The link table is utf8mb4_unicode_ci and the register is
         -- utf8mb4_general_ci; the register's collation is stated explicitly
         -- so the comparison is legal, and the register side stays indexable.
         JOIN other_expenses o
           ON l.source_id COLLATE utf8mb4_general_ci = o.id AND o.isDelete = 0
        WHERE l.source_table = 'other_expenses' AND l.role = 'receipt'
        ORDER BY o.created_at DESC`
	)) as [DbRow[], unknown];

	const pending: PendingCopyReview[] = [];
	const linked: LinkedCopyReview[] = [];
	for (const row of copyRows) {
		const reviewState = String(row.review_state ?? '');
		const targetCostUid = String(row.target_cost_uid ?? '');
		if (reviewState === 'pending_review') {
			const target = await resolveCostReference(db, targetCostUid);
			pending.push({
				link_id: Number(rowNumber(row, 'link_id') ?? 0),
				copy_id: keyOf(row.copy_id),
				voucher_number: String(row.voucher_number ?? ''),
				financial_version: rowNumber(row, 'financial_version') ?? 1,
				gross_amount: rowNumber(row, 'net_amount'),
				currency: rowValue<string>(row, 'currency'),
				vendor_name: rowValue<string>(row, 'vendor_name'),
				created_at:
					row.created_at === null || row.created_at === undefined
						? null
						: String(row.created_at),
				target: {
					cost_uid: targetCostUid,
					label: target?.label ?? null,
					source_table: target?.source_table ?? '',
					recognition_state: target?.recognition_state ?? null,
				},
			});
		} else if (reviewState === 'confirmed') {
			linked.push({
				link_id: Number(rowNumber(row, 'link_id') ?? 0),
				copy_id: keyOf(row.copy_id),
				voucher_number: String(row.voucher_number ?? ''),
				basis: String(row.basis ?? ''),
				review_state: reviewState,
				target_cost_uid: targetCostUid,
			});
		}
	}

	const [unresolvedRows] = (await db.execute(
		`SELECT id, voucher_number, recognition_state, financial_version, net_amount,
              cost_classification, recognition_period, source_reference, evidence_reference,
              (cost_classification IS NULL) AS missing_classification,
              (recognition_period IS NULL) AS missing_period,
              (source_reference IS NULL) AS missing_source_reference,
              (evidence_reference IS NULL) AS missing_evidence_reference
         FROM other_expenses
        WHERE isDelete = 0 AND linked_cost_uid IS NULL
          AND recognition_state IN ('draft','pending_evidence')
        ORDER BY voucher_date DESC, created_at DESC`
	)) as [DbRow[], unknown];

	const unresolved: UnresolvedOtherExpense[] = unresolvedRows.map((row) => {
		const missing: string[] = [];
		if (Number(rowNumber(row, 'missing_classification') ?? 0) !== 0) {
			missing.push('cost_classification');
		}
		if (Number(rowNumber(row, 'missing_period') ?? 0) !== 0) {
			missing.push('recognition_period');
		}
		if (Number(rowNumber(row, 'missing_source_reference') ?? 0) !== 0) {
			missing.push('source_reference');
		}
		if (Number(rowNumber(row, 'missing_evidence_reference') ?? 0) !== 0) {
			missing.push('evidence_reference');
		}
		return {
			id: keyOf(row.id),
			voucher_number: String(row.voucher_number ?? ''),
			recognition_state:
				rowValue<RecognitionState>(row, 'recognition_state') ?? 'draft',
			financial_version: rowNumber(row, 'financial_version') ?? 1,
			gross_amount: rowNumber(row, 'net_amount'),
			cost_classification:
				rowValue<CostClassification>(row, 'cost_classification') ?? null,
			missing,
		};
	});

	return { pending_copies: pending, linked_copies: linked, unresolved };
}

/**
 * The source adapter: so a foreign row (a petty-cash settlement, a later
 * receipt) can resolve an other-expense `cost_uid` through the shared seam.
 * Registered at import time, once per process.
 */
registerCostSource({
	source: 'other_expense',
	table: 'other_expenses',
	async load(db, sourceId) {
		const [rows] = (await db.execute(
			`SELECT cost_uid, voucher_number, currency, net_amount, gst_amount,
              recognized_amount, recognition_state, cost_classification, project_id
         FROM other_expenses
        WHERE id = ? AND isDelete = 0`,
			[sourceId]
		)) as [DbRow[], unknown];
		if (rows.length === 0) return null;
		const row = rows[0];
		return {
			cost_uid: String(row.cost_uid ?? ''),
			source: 'other_expense',
			source_table: 'other_expenses',
			source_id: String(sourceId),
			label: rowValue<string>(row, 'voucher_number'),
			currency: rowValue<string>(row, 'currency'),
			gross_amount: rowNumber(row, 'net_amount'),
			tax_amount: rowNumber(row, 'gst_amount'),
			recognized_amount: rowNumber(row, 'recognized_amount'),
			recognition_state:
				rowValue<RecognitionState>(row, 'recognition_state') ?? 'draft',
			classification:
				rowValue<CostClassification>(row, 'cost_classification') ?? null,
			project_id: rowNumber(row, 'project_id'),
		};
	},
});
