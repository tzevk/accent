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

import { conversionStatusOf, currencyCodeOf, evidenceOf } from './currency';
import { evaluateCost } from './recognition';
import type {
	CostClassification,
	CostRecordJson,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
	CostRecord,
	CostSource,
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

/**
 * The canonical column vocabulary every cost source projects into. A source is
 * a SELECT over its own table that emits exactly these names (plus
 * `source_kind` and `source_row_id`), so one set of reads serves every source
 * and the reconciliation cannot grow a second aggregation.
 */
const COST_SOURCE_COLUMNS = `id, cost_uid, expense_number, expense_date, cost_classification,
  recognition_state, recognition_period, period_basis, service_period_start, service_period_end,
  tax_treatment, tax_evidence_reference, recognized_amount, source_reference, evidence_reference,
  financial_version, recognized_by, recognized_at, currency, reporting_currency,
  conversion_rate, conversion_date, conversion_evidence_reference, converted_amount,
  amount, tax_amount, total_amount,
  vendor_name, description, status, project_id, isDelete`;

/** The direct-expense source (#306): costs live in `expenses`. */
export const DIRECT_EXPENSE_COST_SOURCE =
	`SELECT 'direct_expense' AS source_kind, ${COST_SOURCE_COLUMNS}, ` +
	`CAST(id AS CHAR) AS source_row_id FROM expenses`;

/**
 * The module's one source expression: the union of every wired source. Callers
 * wrap it in a derived table (`FROM (${source}) e`), so each source is a plain
 * projected SELECT over its own table.
 */
export function costSourceUnion(sources: readonly string[]): string {
	return sources.join(' UNION ALL ');
}

/** The read projection over any source expression (aliased `e`). */
function costSelect(source: string): string {
	return `
  SELECT e.source_kind, e.source_row_id,
         e.id, e.cost_uid, e.expense_number, e.expense_date, e.cost_classification,
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
    FROM (${source}) e
    LEFT JOIN projects p ON p.project_id = e.project_id AND p.isDelete = 0`;
}

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
		source: (s(row, 'source_kind') as CostSource | null) ?? 'direct_expense',
		sourceId: s(row, 'source_row_id', String(num(row, 'id') ?? '')) ?? '',
		split: null,
		id: Number(num(row, 'id') ?? 0),
		costUid: s(row, 'cost_uid'),
		expenseNumber: s(row, 'expense_number', '') ?? '',
		expenseDate: s(row, 'expense_date'),
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

/** The record as the report endpoints publish it. */
function toCostRecordJson(record: CostRecord): CostRecordJson {
	return {
		id: record.id,
		cost_uid: record.costUid,
		source: record.source,
		source_id: record.sourceId,
		split: record.split,
		expense_number: record.expenseNumber,
		recognition_state: record.state,
		cost_classification: record.classification,
		recognized_amount: record.recognizedAmount,
		recognition_period: record.recognitionPeriod,
		period_basis: record.periodBasis,
		service_period_start: record.servicePeriodStart,
		service_period_end: record.servicePeriodEnd,
		expense_date: record.expenseDate,
		currency: record.currency,
		reporting_currency: record.reportingCurrency,
		conversion_rate: record.conversionRate,
		conversion_date: record.conversionDate,
		conversion_evidence_reference: record.conversionEvidenceReference,
		converted_amount: record.convertedAmount,
		conversion_status: conversionStatusOf(evidenceOf(record)),
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
		exceptions: record.evaluation.exceptions,
	};
}

/** Every cost of one month, in any recognition state. */
export async function loadMonthRecords(
	db: SqlConnection,
	month: string,
	source: string = DIRECT_EXPENSE_COST_SOURCE
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`${costSelect(source)}
      WHERE e.isDelete = 0 AND ${MONTH_PREDICATE}
      ORDER BY e.expense_date DESC, e.id DESC`,
		[start, end, start, end]
	);
	return (rows as DbRow[]).map(mapCostRow);
}

/**
 * Confirmed Project cost of a month, keyed by Project id and then currency.
 * A Project can hold more than one currency in a month, and those figures are
 * never combined; a group whose recognized amount is missing carries null.
 */
export async function loadMonthProjectCost(
	db: SqlConnection,
	month: string,
	source: string = DIRECT_EXPENSE_COST_SOURCE
): Promise<Map<number, Map<string, number | null>>> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`SELECT e.project_id, e.currency AS currency,
              SUM(e.recognized_amount) AS amount,
              SUM(CASE WHEN e.recognized_amount IS NULL THEN 1 ELSE 0 END) AS unknown_amounts
       FROM (${source}) e
      WHERE e.isDelete = 0
        AND e.recognition_state = 'recognized'
        AND e.cost_classification = 'project'
        AND e.project_id IS NOT NULL
        AND e.currency IS NOT NULL
        AND e.recognition_period BETWEEN ? AND ?
      GROUP BY e.project_id, e.currency`,
		[start, end]
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
	currentMonth: string,
	source: string = DIRECT_EXPENSE_COST_SOURCE
): Promise<string[]> {
	const [rows] = await db.execute(
		`SELECT DISTINCT DATE_FORMAT(COALESCE(e.recognition_period, e.expense_date), '%Y-%m') AS month
       FROM (${source}) e
      WHERE e.isDelete = 0
        AND (e.recognition_period IS NOT NULL OR e.expense_date IS NOT NULL)`
	);
	const months = new Set<string>([currentMonth]);
	for (const row of rows as DbRow[]) {
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

/**
 * The source drilldown: the same rows the reconciliation counted, read back
 * with their identity, evidence, and journal version.
 */
export async function loadDrilldown(
	db: SqlConnection,
	query: CostDrilldownQuery,
	source: string = DIRECT_EXPENSE_COST_SOURCE
): Promise<CostDrilldown> {
	const { start, end } = monthBounds(query.month);
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
	const offset = Math.max(query.offset ?? 0, 0);
	const state = stateFilterClause(query.state);
	const where = ['e.isDelete = 0', MONTH_PREDICATE, state.clause];
	const params: Array<string | number> = [
		start,
		end,
		start,
		end,
		...state.params,
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

	const [countRows] = await db.execute(
		`SELECT COUNT(*) AS total,
              SUM(CASE WHEN e.recognition_state = 'recognized' THEN 1 ELSE 0 END) AS confirmed_records,
              SUM(CASE WHEN e.recognition_state = 'recognized' AND e.recognized_amount IS NULL THEN 1 ELSE 0 END) AS unknown_amounts,
              COUNT(DISTINCT CASE WHEN e.recognition_state = 'recognized' THEN e.currency END) AS confirmed_currencies,
              MIN(CASE WHEN e.recognition_state = 'recognized' THEN e.currency END) AS confirmed_currency,
              SUM(CASE WHEN e.recognition_state = 'recognized' AND e.currency IS NULL THEN 1 ELSE 0 END) AS unknown_currency_records,
              SUM(CASE WHEN e.recognition_state = 'recognized' THEN e.recognized_amount ELSE 0 END) AS confirmed
         FROM (${source}) e
        WHERE ${whereSql}`,
		params
	);
	const count = (countRows as DbRow[])[0] ?? {};
	const unknownAmounts = num(count, 'unknown_amounts') ?? 0;
	const confirmedCurrencies = num(count, 'confirmed_currencies') ?? 0;
	const unknownCurrencyRecords = num(count, 'unknown_currency_records') ?? 0;
	// Unknown amounts, an unknown original currency, and mixed currencies
	// cannot be stated as one figure; with no confirmed record at all the
	// subtotal is a known zero.
	const confirmedAmount =
		unknownAmounts > 0 ||
		confirmedCurrencies > 1 ||
		unknownCurrencyRecords > 0
			? null
			: (num(count, 'confirmed') ?? 0);
	const [rows] = await db.execute(
		`${costSelect(source)}
      WHERE ${whereSql}
      ORDER BY e.recognition_period DESC, e.expense_date DESC, e.id DESC
      LIMIT ? OFFSET ?`,
		[...params, limit, offset]
	);
	return {
		month: query.month,
		scope: 'month',
		total: Number(num(count, 'total') ?? 0),
		limit,
		offset,
		records: (rows as DbRow[]).map(mapCostRow).map(toCostRecordJson),
		totals: {
			confirmed_amount: confirmedAmount,
			currency:
				confirmedCurrencies === 1 ? s(count, 'confirmed_currency') : null,
			records: Number(num(count, 'total') ?? 0),
		},
	};
}
