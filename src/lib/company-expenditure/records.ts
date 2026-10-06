/**
 * Database access for direct cost — the only place the expenditure module
 * reads or writes `expenses` financial fields.
 *
 * Every function takes the connection to work on. A caller that already holds
 * a transaction (a route that must keep a close check and the recognition
 * update atomic) passes its own connection; callers without one get a pooled
 * connection from the helper in `commands.ts`. Nothing here opens its own
 * transaction.
 */

import { add, R, toNumber } from '@/lib/money';
import {
	conversionStatusOf,
	currencyCodeOf,
	evidenceOf,
	reportingCurrencyOf,
} from './currency';
import { toPeriodChargeJson } from './non-operating';
import { evaluateCost } from './recognition';
import type {
	CostClassification,
	CostNature,
	CostRecordJson,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
	CostRecord,
	PeriodCharge,
	PeriodChargeBasis,
	PeriodChargeState,
	RecognitionState,
	TaxTreatment,
} from './types';

/** The slice of a mysql2 connection this module needs. */
export interface SqlConnection {
	execute(
		sql: string,
		params?: Array<string | number | boolean | null>
	): Promise<[unknown, unknown]>;
}

/** A raw database row; shared with the budget loaders (`budget-records.ts`). */
export type DbRow = Record<string, unknown>;

export function s(
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

export function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A DECIMAL kept as its exact string: a DECIMAL(20,10) rate holds more digits
 * than a JS number can state, so it is never routed through `Number()`.
 */
function dec(row: DbRow, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text.length === 0 ? null : text;
}

/** The projection the module maps into `CostRecord`. */
const COST_SELECT = `
  SELECT e.id, e.cost_uid, e.expense_number, e.expense_date, e.created_at,
         e.cost_classification,
         e.cost_nature,
         e.recognition_state, e.recognition_period, e.period_basis,
         e.service_period_start, e.service_period_end, e.tax_treatment,
         e.tax_evidence_reference, e.recognized_amount, e.source_reference,
         e.evidence_reference, e.financial_version, e.recognized_by, e.recognized_at,
         e.currency, e.reporting_currency, e.conversion_rate, e.conversion_date,
         e.conversion_evidence_reference, e.converted_amount,
         e.amount, e.tax_amount, e.total_amount,
         e.vendor_name, e.description, e.status,
         e.project_id, p.project_code,
         COALESCE(p.project_title, p.name) AS project_name, p.client_name
    FROM expenses e
    LEFT JOIN projects p ON p.project_id = e.project_id AND p.isDelete = 0`;

/** First and last day of a `YYYY-MM` month. */
export function monthBounds(month: string): { start: string; end: string } {
	const [year, monthNumber] = month.split('-').map(Number);
	const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return {
		start: `${month}-01`,
		end: `${month}-${String(days).padStart(2, '0')}`,
	};
}

/**
 * A cost belongs to the month of its Recognition Period; a cost that has no
 * period yet belongs to the month of its expense date. A record with neither
 * cannot be placed in a month, and the reconciliation counts it separately
 * through the coverage notices rather than guessing.
 */
const MONTH_PREDICATE = `(
  (e.recognition_period BETWEEN ? AND ?)
  OR (e.recognition_period IS NULL AND e.expense_date BETWEEN ? AND ?)
)`;

export function mapCostRow(row: DbRow): CostRecord {
	const financial = {
		classification:
			(s(row, 'cost_classification') as CostClassification | null) ?? null,
		nature: (s(row, 'cost_nature', 'operating') as CostNature) ?? 'operating',
		state:
			(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
		// A missing original currency stays missing: it is never read as INR.
		currency: currencyCodeOf(s(row, 'currency')),
		reportingCurrency: currencyCodeOf(s(row, 'reporting_currency')),
		conversionRate: dec(row, 'conversion_rate'),
		conversionDate: s(row, 'conversion_date'),
		conversionEvidenceReference: s(row, 'conversion_evidence_reference'),
		convertedAmount: num(row, 'converted_amount'),
		grossAmount: num(row, 'total_amount'),
		taxAmount: num(row, 'tax_amount'),
		taxTreatment:
			(s(row, 'tax_treatment', 'unresolved') as TaxTreatment) ?? 'unresolved',
		taxEvidenceReference: s(row, 'tax_evidence_reference'),
		servicePeriodStart: s(row, 'service_period_start'),
		servicePeriodEnd: s(row, 'service_period_end'),
		billDate: s(row, 'expense_date'),
		sourceReference: s(row, 'source_reference'),
		evidenceReference: s(row, 'evidence_reference'),
		recognitionPeriod: s(row, 'recognition_period'),
		periodBasis:
			(s(row, 'period_basis', 'unresolved') as CostRecord['periodBasis']) ??
			'unresolved',
		recognizedAmount: num(row, 'recognized_amount'),
	};
	return {
		...financial,
		id: Number(num(row, 'id') ?? 0),
		costUid: s(row, 'cost_uid'),
		expenseNumber: s(row, 'expense_number', '') ?? '',
		expenseDate: s(row, 'expense_date'),
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
		evaluation: evaluateCost(financial),
	};
}

/** The record as the report endpoints publish it, in the requested basis. */
function toCostRecordJson(
	record: CostRecord,
	reporting: string
): CostRecordJson {
	return {
		id: record.id,
		cost_uid: record.costUid,
		expense_number: record.expenseNumber,
		recognition_state: record.state,
		cost_classification: record.classification,
		cost_nature: record.nature,
		recognized_amount: record.recognizedAmount,
		recognition_period: record.recognitionPeriod,
		period_basis: record.periodBasis,
		service_period_start: record.servicePeriodStart,
		service_period_end: record.servicePeriodEnd,
		expense_date: record.expenseDate,
		created_at: record.createdAt,
		currency: record.currency,
		reporting_currency: record.reportingCurrency,
		conversion_rate: record.conversionRate,
		conversion_date: record.conversionDate,
		conversion_evidence_reference: record.conversionEvidenceReference,
		converted_amount: record.convertedAmount,
		conversion_status: conversionStatusOf(evidenceOf(record), reporting),
		gross_amount: record.grossAmount,
		tax_amount: record.taxAmount,
		tax_treatment: record.taxTreatment,
		effective_tax_treatment: record.evaluation.effectiveTaxTreatment,
		tax_evidence_reference: record.taxEvidenceReference,
		source_reference: record.sourceReference,
		evidence_reference: record.evidenceReference,
		project_id: record.projectId,
		project_code: record.projectCode,
		project_name: record.projectName,
		client_name: record.clientName,
		vendor_name: record.vendorName,
		description: record.description,
		financial_version: record.financialVersion,
		recognized_at: record.recognizedAt,
		recognized_by: record.recognizedBy,
		missing_amount: record.grossAmount === null,
		known_zero: record.grossAmount === 0,
		reconstructed: record.reconstructed === true,
		exceptions: record.evaluation.exceptions,
	};
}

/** Every cost of one month, in any recognition state. */
export async function loadMonthRecords(
	db: SqlConnection,
	month: string
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`${COST_SELECT}
      WHERE e.isDelete = 0 AND ${MONTH_PREDICATE}
      ORDER BY e.expense_date DESC, e.id DESC`,
		[start, end, start, end]
	);
	return (rows as DbRow[]).map(mapCostRow);
}

/**
 * Non-operating records of one month (any recognition state): advances,
 * deposits, prepayments, capital items, and records whose treatment is still
 * unresolved. They are read back so the report can show their balances,
 * consumption, and evidence separately from operating cost.
 */
export async function loadNonOperatingSources(
	db: SqlConnection,
	month: string
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`${COST_SELECT}
      WHERE e.isDelete = 0 AND e.cost_nature <> 'operating'
        AND ${MONTH_PREDICATE}
      ORDER BY e.expense_date DESC, e.id DESC`,
		[start, end, start, end]
	);
	return (rows as DbRow[]).map(mapCostRow);
}

/**
 * The records behind a set of expense ids: the sources of a month's period
 * charges, which may have been recognized in an earlier month.
 */
export async function loadCostRecordsByIds(
	db: SqlConnection,
	ids: number[]
): Promise<CostRecord[]> {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`${COST_SELECT}
      WHERE e.isDelete = 0 AND e.id IN (${placeholders})
      ORDER BY e.id`,
		ids
	);
	return (rows as DbRow[]).map(mapCostRow);
}

/** The source row a period charge draws down, as the write path needs it. */
export interface ChargeSource {
	id: number;
	costUid: string;
	expenseNumber: string;
	nature: CostNature;
	state: RecognitionState;
	classification: CostClassification | null;
	projectId: number | null;
	recognizedAmount: number | null;
	/** The source's original currency; null is unknown, never read as INR. */
	currency: string | null;
}

/**
 * Lock the source cost of a period charge (`SELECT ... FOR UPDATE`). The lock
 * serializes concurrent captures on one source, so two operators cannot both
 * read "no approved charge" and then insert one for the same period.
 */
export async function loadChargeSourceForUpdate(
	db: SqlConnection,
	id: number
): Promise<ChargeSource | null> {
	const [rows] = await db.execute(
		`SELECT id, cost_uid, expense_number, cost_nature, recognition_state,
            cost_classification, project_id, recognized_amount, currency
       FROM expenses
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[id]
	);
	const row = (rows as DbRow[])[0];
	if (!row) return null;
	return {
		id: Number(num(row, 'id') ?? 0),
		costUid: s(row, 'cost_uid', '') ?? '',
		expenseNumber: s(row, 'expense_number', '') ?? '',
		nature: (s(row, 'cost_nature', 'operating') as CostNature) ?? 'operating',
		state:
			(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
		classification:
			(s(row, 'cost_classification') as CostClassification | null) ?? null,
		projectId: num(row, 'project_id'),
		recognizedAmount: num(row, 'recognized_amount'),
		currency: s(row, 'currency'),
	};
}

/**
 * The projection the module maps into `PeriodCharge`: the charge plus the
 * source it draws down (identity, nature, destination, currency, balance).
 */
const CHARGE_SELECT = `
  SELECT c.id, c.charge_uid, c.source_id, c.source_cost_uid, c.charge_period,
         c.basis, c.amount, c.currency, c.evidence_reference, c.state,
         c.financial_version, c.sequence, c.approved_by, c.approved_at,
         c.cancel_reason,
         e.expense_number, e.cost_nature, e.recognition_state AS source_state,
         e.cost_classification, e.project_id,
         e.recognized_amount AS source_recognized_amount,
         e.reporting_currency AS source_reporting_currency,
         e.conversion_rate AS source_conversion_rate,
         e.conversion_date AS source_conversion_date,
         e.conversion_evidence_reference AS source_conversion_evidence_reference,
         p.project_code, COALESCE(p.project_title, p.name) AS project_name,
         p.client_name
    FROM expense_period_charges c
    JOIN expenses e ON e.id = c.source_id
    LEFT JOIN projects p ON p.project_id = e.project_id AND p.isDelete = 0`;

export function mapChargeRow(row: DbRow): PeriodCharge {
	return {
		id: Number(num(row, 'id') ?? 0),
		chargeUid: s(row, 'charge_uid', '') ?? '',
		sourceId: Number(num(row, 'source_id') ?? 0),
		sourceCostUid: s(row, 'source_cost_uid', '') ?? '',
		sourceExpenseNumber: s(row, 'expense_number', '') ?? '',
		sourceNature:
			(s(row, 'cost_nature', 'operating') as CostNature) ?? 'operating',
		sourceState:
			(s(row, 'source_state', 'draft') as RecognitionState) ?? 'draft',
		classification:
			(s(row, 'cost_classification') as CostClassification | null) ?? null,
		projectId: num(row, 'project_id'),
		projectCode: s(row, 'project_code'),
		projectName: s(row, 'project_name'),
		clientName: s(row, 'client_name'),
		currency: s(row, 'currency', 'INR') ?? 'INR',
		period: (s(row, 'charge_period', '') ?? '').slice(0, 10),
		basis:
			(s(row, 'basis', 'consumption') as PeriodChargeBasis) ?? 'consumption',
		amount: num(row, 'amount') ?? 0,
		evidenceReference: s(row, 'evidence_reference', '') ?? '',
		state: (s(row, 'state', 'approved') as PeriodChargeState) ?? 'approved',
		financialVersion: Number(num(row, 'financial_version') ?? 1),
		sequence: Number(num(row, 'sequence') ?? 1),
		approvedBy: num(row, 'approved_by'),
		approvedAt: s(row, 'approved_at'),
		cancelReason: s(row, 'cancel_reason'),
		sourceRecognizedAmount: num(row, 'source_recognized_amount'),
		// The source's conversion evidence (#319): a charge never converts
		// independently, it is stated through what its cost carries.
		reportingCurrency: currencyCodeOf(s(row, 'source_reporting_currency')),
		conversionRate: s(row, 'source_conversion_rate'),
		conversionDate: s(row, 'source_conversion_date'),
		conversionEvidenceReference: s(row, 'source_conversion_evidence_reference'),
	};
}

/** One charge by its identity, in any state. */
export async function loadChargeByUid(
	db: SqlConnection,
	chargeUid: string
): Promise<PeriodCharge | null> {
	const [rows] = await db.execute(
		`${CHARGE_SELECT} WHERE c.charge_uid = ? AND e.isDelete = 0`,
		[chargeUid]
	);
	const row = (rows as DbRow[])[0];
	return row ? mapChargeRow(row) : null;
}

/**
 * Every charge already recorded against one source, in any state and period:
 * the balance and duplicate rules need the full history, cancelled rows
 * included. A soft-deleted source has no history to read.
 */
export async function loadSourceCharges(
	db: SqlConnection,
	sourceCostUid: string
): Promise<PeriodCharge[]> {
	const [rows] = await db.execute(
		`${CHARGE_SELECT}
      WHERE c.source_cost_uid = ? AND e.isDelete = 0
      ORDER BY c.charge_period, c.basis, c.sequence`,
		[sourceCostUid]
	);
	return (rows as DbRow[]).map(mapChargeRow);
}

export interface MonthChargeQuery {
	/** `YYYY-MM`; charges are dated by their own month, not the source's. */
	month: string;
	classification?: CostClassification | 'unresolved' | 'all';
	nature?: CostNature | 'non_operating' | 'all';
	projectId?: number | null;
}

/**
 * Every charge dated in one month whose source matches the filter, approved
 * and cancelled alike; the caller decides which of them count as cost.
 */
export async function loadMonthCharges(
	db: SqlConnection,
	query: MonthChargeQuery
): Promise<PeriodCharge[]> {
	const { start, end } = monthBounds(query.month);
	const where = ['c.charge_period BETWEEN ? AND ?', 'e.isDelete = 0'];
	const params: Array<string | number> = [start, end];
	if (query.classification && query.classification !== 'all') {
		if (query.classification === 'unresolved') {
			where.push('e.cost_classification IS NULL');
		} else {
			where.push('e.cost_classification = ?');
			params.push(query.classification);
		}
	}
	if (query.nature && query.nature !== 'all') {
		if (query.nature === 'non_operating') {
			where.push(
				"e.cost_nature IN ('advance','deposit','prepayment','capital')"
			);
		} else {
			where.push('e.cost_nature = ?');
			params.push(query.nature);
		}
	}
	if (query.projectId !== undefined && query.projectId !== null) {
		where.push('e.project_id = ?');
		params.push(query.projectId);
	}
	const [rows] = await db.execute(
		`${CHARGE_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY c.charge_period, c.id`,
		params
	);
	return (rows as DbRow[]).map(mapChargeRow);
}

/**
 * Approved charges to date per source identity, across every month. A source
 * with no approved charge is absent; the caller reads that as a known zero.
 */
export async function loadChargeTotals(
	db: SqlConnection,
	costUids: string[]
): Promise<Map<string, number>> {
	const totals = new Map<string, number>();
	if (costUids.length === 0) return totals;
	const placeholders = costUids.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`SELECT c.source_cost_uid, SUM(c.amount) AS amount
       FROM expense_period_charges c
       JOIN expenses e ON e.id = c.source_id
      WHERE c.state = 'approved' AND e.isDelete = 0
        AND c.source_cost_uid IN (${placeholders})
      GROUP BY c.source_cost_uid`,
		costUids
	);
	for (const row of rows as DbRow[]) {
		const uid = s(row, 'source_cost_uid');
		if (uid) totals.set(uid, num(row, 'amount') ?? 0);
	}
	return totals;
}

/**
 * Confirmed Project cost of a month, keyed by Project id and then currency.
 * A Project can hold more than one currency in a month, and those figures are
 * never combined; a group whose recognized amount is missing carries null.
 */
export async function loadMonthProjectCost(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const { start, end } = monthBounds(month);
	// Recognized Project cost plus the approved period charges dated in the
	// month: a prior-month comparison must measure the same cost the
	// reconciliation states, charges included.
	const [rows] = await db.execute(
		`SELECT project_id, currency,
              SUM(amount) AS amount,
              SUM(unknown_amounts) AS unknown_amounts
         FROM (
           SELECT e.project_id, e.currency AS currency,
                  e.recognized_amount AS amount,
                  CASE WHEN e.recognized_amount IS NULL THEN 1 ELSE 0 END AS unknown_amounts
             FROM expenses e
            WHERE e.isDelete = 0
              AND e.recognition_state = 'recognized'
              AND e.cost_nature = 'operating'
              AND e.cost_classification = 'project'
              AND e.project_id IS NOT NULL
              AND e.currency IS NOT NULL
              AND e.recognition_period BETWEEN ? AND ?
           UNION ALL
           SELECT e.project_id, e.currency AS currency,
                  c.amount AS amount, 0 AS unknown_amounts
             FROM expense_period_charges c
             JOIN expenses e ON e.id = c.source_id
            WHERE c.state = 'approved'
              AND e.isDelete = 0
              AND e.recognition_state = 'recognized'
              AND e.cost_classification = 'project'
              AND e.project_id IS NOT NULL
              AND e.currency IS NOT NULL
              AND c.charge_period BETWEEN ? AND ?
         ) cost
        GROUP BY project_id, currency`,
		[start, end, start, end]
	);
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows as DbRow[]) {
		const id = num(row, 'project_id');
		if (id === null) continue;
		const currency = s(row, 'currency');
		if (!currency) continue;
		const unknownAmounts = num(row, 'unknown_amounts') ?? 0;
		const perCurrency = costs.get(id) ?? new Map<string, number | null>();
		// A missing recognized amount is unknown, never zero.
		perCurrency.set(currency, unknownAmounts > 0 ? null : num(row, 'amount'));
		costs.set(id, perCurrency);
	}
	return costs;
}

/**
 * Cumulative confirmed Project cost of every month before `month`, keyed by
 * Project id and then currency — the base Cost to Date adds the reported
 * window to. It counts the same cost the reconciliation states (recognized
 * operating cost plus approved period charges), bounded before the month, and
 * a group whose recognized amount is missing carries null because an unknown
 * amount is not zero.
 */
export async function loadProjectCostBefore(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const [rows] = await db.execute(
		`SELECT project_id, currency,
              SUM(amount) AS amount,
              SUM(unknown_amounts) AS unknown_amounts
         FROM (
           SELECT e.project_id, e.currency AS currency,
                  e.recognized_amount AS amount,
                  CASE WHEN e.recognized_amount IS NULL THEN 1 ELSE 0 END AS unknown_amounts
             FROM expenses e
            WHERE e.isDelete = 0
              AND e.recognition_state = 'recognized'
              AND e.cost_nature = 'operating'
              AND e.cost_classification = 'project'
              AND e.project_id IS NOT NULL
              AND e.currency IS NOT NULL
              AND e.recognition_period < ?
           UNION ALL
           SELECT e.project_id, e.currency AS currency,
                  c.amount AS amount, 0 AS unknown_amounts
             FROM expense_period_charges c
             JOIN expenses e ON e.id = c.source_id
            WHERE c.state = 'approved'
              AND e.isDelete = 0
              AND e.recognition_state = 'recognized'
              AND e.cost_classification = 'project'
              AND e.project_id IS NOT NULL
              AND e.currency IS NOT NULL
              AND c.charge_period < ?
         ) cost
        GROUP BY project_id, currency`,
		[`${month}-01`, `${month}-01`]
	);
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows as DbRow[]) {
		const id = num(row, 'project_id');
		if (id === null) continue;
		const currency = s(row, 'currency');
		if (!currency) continue;
		const unknownAmounts = num(row, 'unknown_amounts') ?? 0;
		const perCurrency = costs.get(id) ?? new Map<string, number | null>();
		// A missing recognized amount is unknown, never zero.
		perCurrency.set(currency, unknownAmounts > 0 ? null : num(row, 'amount'));
		costs.set(id, perCurrency);
	}
	return costs;
}

export interface ProjectOption {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
}

export async function loadProjectOptions(
	db: SqlConnection
): Promise<ProjectOption[]> {
	const [rows] = await db.execute(
		`SELECT project_id, project_code, COALESCE(project_title, name) AS project_name,
              client_name
         FROM projects
        WHERE isDelete = 0
        ORDER BY project_code`
	);
	return (rows as DbRow[]).map((row) => ({
		project_id: Number(num(row, 'project_id') ?? 0),
		project_code: s(row, 'project_code', '') ?? '',
		project_name: s(row, 'project_name', '') ?? '',
		client_name: s(row, 'client_name'),
	}));
}

/** Months with direct cost recorded, newest first, always including today's. */
export async function loadExpenditureMonths(
	db: SqlConnection,
	currentMonth: string
): Promise<string[]> {
	const [rows] = await db.execute(
		`SELECT DISTINCT DATE_FORMAT(COALESCE(e.recognition_period, e.expense_date), '%Y-%m') AS month
       FROM expenses e
      WHERE e.isDelete = 0
        AND (e.recognition_period IS NOT NULL OR e.expense_date IS NOT NULL)`
	);
	// A month whose only cost is approved period consumption must still be
	// reachable, so the charge's own month counts as an expenditure month.
	const [chargeRows] = await db.execute(
		`SELECT DISTINCT DATE_FORMAT(c.charge_period, '%Y-%m') AS month
       FROM expense_period_charges c
       JOIN expenses e ON e.id = c.source_id
      WHERE c.state = 'approved' AND e.isDelete = 0`
	);
	const months = new Set<string>([currentMonth]);
	for (const row of [...(rows as DbRow[]), ...(chargeRows as DbRow[])]) {
		const month = s(row, 'month');
		if (month) months.add(month);
	}
	return [...months].sort().reverse();
}

/** The append-only command journal of one cost, oldest first. */
export async function loadCostEvents(
	db: SqlConnection,
	costUid: string
): Promise<CostJournalEntry[]> {
	const [rows] = await db.execute(
		`SELECT version, command, actor_user_id, reason, evidence_reference, created_at, snapshot
       FROM financial_cost_events
      WHERE cost_uid = ?
      ORDER BY version ASC`,
		[costUid]
	);
	return (rows as DbRow[]).map((row) => ({
		version: Number(num(row, 'version') ?? 0),
		command: (s(row, 'command') as CostJournalEntry['command']) ?? 'recorded',
		actor_user_id: num(row, 'actor_user_id'),
		reason: s(row, 'reason'),
		evidence_reference: s(row, 'evidence_reference'),
		created_at: s(row, 'created_at', '') ?? '',
		snapshot:
			typeof row.snapshot === 'string' && row.snapshot.length > 0
				? (JSON.parse(row.snapshot) as Record<string, unknown>)
				: null,
	}));
}

function stateFilterClause(state: CostDrilldownQuery['state']): {
	clause: string;
	params: Array<string | number>;
} {
	if (!state || state === 'all') return { clause: '1=1', params: [] };
	if (state === 'unconfirmed') {
		return {
			clause: "e.recognition_state IN ('draft','pending_evidence')",
			params: [],
		};
	}
	if (state === 'unresolved') {
		return { clause: 'e.cost_classification IS NULL', params: [] };
	}
	return { clause: 'e.recognition_state = ?', params: [state] };
}

function natureFilterClause(nature: CostDrilldownQuery['nature']): {
	clause: string;
	params: Array<string | number>;
} {
	if (!nature || nature === 'all') return { clause: '1=1', params: [] };
	if (nature === 'non_operating') {
		return {
			clause: "e.cost_nature IN ('advance','deposit','prepayment','capital')",
			params: [],
		};
	}
	return { clause: 'e.cost_nature = ?', params: [nature] };
}

/**
 * A drilldown subtotal that may only be stated in one currency: one unknown
 * amount or a second currency makes it null, because an unknown amount is not
 * zero and currencies are never added.
 */
function statedSubtotal(input: {
	amount: number | null;
	unknown: number;
	currencies: number;
	currency: string | null;
}): { amount: number | null; currency: string | null } {
	if (input.unknown > 0 || input.currencies > 1) {
		return { amount: null, currency: null };
	}
	return {
		amount: input.amount ?? 0,
		currency: input.currencies === 1 ? input.currency : null,
	};
}

/**
 * The source drilldown: the same rows the reconciliation counted, read back
 * with their identity, evidence, and journal version — plus the period charges
 * dated in the month, so consumption is traceable to the balance it draws
 * down. A cancelled charge is shown as history but never counted as cost.
 */
export async function loadDrilldown(
	db: SqlConnection,
	query: CostDrilldownQuery
): Promise<CostDrilldown> {
	const { start, end } = monthBounds(query.month);
	const reporting = reportingCurrencyOf({
		reportingCurrency: query.reportingCurrency ?? null,
	});
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
	const offset = Math.max(query.offset ?? 0, 0);
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
	const whereSql = where.join(' AND ');
	// Operating cost, non-operating balances, and unresolved treatment are
	// counted apart: only operating confirmed cost is Company Incurred Cost.
	const operating =
		"e.recognition_state = 'recognized' AND e.cost_nature = 'operating'";
	const nonOperating =
		"e.recognition_state = 'recognized' AND e.cost_nature IN ('advance','deposit','prepayment','capital')";
	const unresolved =
		"e.recognition_state = 'recognized' AND e.cost_nature = 'unresolved'";

	const [countRows] = await db.execute(
		`SELECT COUNT(*) AS total,
              SUM(CASE WHEN ${operating} THEN 1 ELSE 0 END) AS cost_records,
              SUM(CASE WHEN ${operating} AND (e.recognized_amount IS NULL OR e.currency IS NULL) THEN 1 ELSE 0 END) AS cost_unknown,
              COUNT(DISTINCT CASE WHEN ${operating} THEN e.currency END) AS cost_currencies,
              MIN(CASE WHEN ${operating} THEN e.currency END) AS cost_currency,
              SUM(CASE WHEN ${operating} THEN e.recognized_amount ELSE 0 END) AS cost_amount,
              SUM(CASE WHEN ${nonOperating} THEN 1 ELSE 0 END) AS non_operating_records,
              SUM(CASE WHEN ${nonOperating} AND (e.recognized_amount IS NULL OR e.currency IS NULL) THEN 1 ELSE 0 END) AS non_operating_unknown,
              COUNT(DISTINCT CASE WHEN ${nonOperating} THEN e.currency END) AS non_operating_currencies,
              MIN(CASE WHEN ${nonOperating} THEN e.currency END) AS non_operating_currency,
              SUM(CASE WHEN ${nonOperating} THEN e.recognized_amount ELSE 0 END) AS non_operating_amount,
              SUM(CASE WHEN ${unresolved} THEN 1 ELSE 0 END) AS unresolved_records,
              SUM(CASE WHEN ${unresolved} AND (e.recognized_amount IS NULL OR e.currency IS NULL) THEN 1 ELSE 0 END) AS unresolved_unknown,
              COUNT(DISTINCT CASE WHEN ${unresolved} THEN e.currency END) AS unresolved_currencies,
              MIN(CASE WHEN ${unresolved} THEN e.currency END) AS unresolved_currency,
              SUM(CASE WHEN ${unresolved} THEN e.recognized_amount ELSE 0 END) AS unresolved_amount
         FROM expenses e
        WHERE ${whereSql}`,
		params
	);
	const count = (countRows as DbRow[])[0] ?? {};
	const confirmed = statedSubtotal({
		amount: num(count, 'cost_amount'),
		unknown: num(count, 'cost_unknown') ?? 0,
		currencies: num(count, 'cost_currencies') ?? 0,
		currency: s(count, 'cost_currency'),
	});
	const nonOperatingTotal = statedSubtotal({
		amount: num(count, 'non_operating_amount'),
		unknown: num(count, 'non_operating_unknown') ?? 0,
		currencies: num(count, 'non_operating_currencies') ?? 0,
		currency: s(count, 'non_operating_currency'),
	});
	const unresolvedTotal = statedSubtotal({
		amount: num(count, 'unresolved_amount'),
		unknown: num(count, 'unresolved_unknown') ?? 0,
		currencies: num(count, 'unresolved_currencies') ?? 0,
		currency: s(count, 'unresolved_currency'),
	});
	const [rows] = await db.execute(
		`${COST_SELECT}
      WHERE ${whereSql}
      ORDER BY e.recognition_period DESC, e.expense_date DESC, e.id DESC
      LIMIT ? OFFSET ?`,
		[...params, limit, offset]
	);

	// Charges are confirmed cost of their own month, so they belong to the
	// confirmed-cost filters only; a cancelled charge is returned as history.
	const includeCharges =
		!query.state || query.state === 'all' || query.state === 'recognized';
	const charges = includeCharges
		? await loadMonthCharges(db, {
				month: query.month,
				classification: query.classification,
				nature: query.nature,
				projectId: query.projectId,
			})
		: [];
	const countedCharges = charges.filter(
		(charge) =>
			charge.state === 'approved' && charge.sourceState === 'recognized'
	);
	const chargeCurrencies = new Set(
		countedCharges.map((charge) => charge.currency)
	);
	const periodChargeAmount =
		chargeCurrencies.size > 1
			? null
			: toNumber(
					countedCharges
						.reduce((total, charge) => add(total, charge.amount), R(0))
						.toDecimalPlaces(2)
				);

	return {
		month: query.month,
		scope: 'month',
		total: Number(num(count, 'total') ?? 0),
		limit,
		offset,
		records: (rows as DbRow[])
			.map(mapCostRow)
			.map((record) => toCostRecordJson(record, reporting)),
		period_charges: charges.map(toPeriodChargeJson),
		totals: {
			confirmed_amount: confirmed.amount,
			currency: confirmed.currency,
			records: Number(num(count, 'total') ?? 0),
			non_operating_amount: nonOperatingTotal.amount,
			nature_unresolved_amount: unresolvedTotal.amount,
			period_charge_amount: periodChargeAmount,
			period_charge_records: countedCharges.length,
		},
	};
}
