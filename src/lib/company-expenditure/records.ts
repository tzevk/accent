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

import { evaluateCost } from './recognition';
import type {
	CostClassification,
	CostRecordJson,
	CostDrilldownQuery,
	CostJournalEntry,
	CostRecord,
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

type DbRow = Record<string, unknown>;

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

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** The projection the module maps into `CostRecord`. */
const COST_SELECT = `
  SELECT e.id, e.cost_uid, e.expense_number, e.expense_date, e.cost_classification,
         e.recognition_state, e.recognition_period, e.period_basis,
         e.service_period_start, e.service_period_end, e.tax_treatment,
         e.tax_evidence_reference, e.recognized_amount, e.source_reference,
         e.evidence_reference, e.financial_version, e.recognized_by, e.recognized_at,
         e.currency, e.amount, e.tax_amount, e.total_amount,
         e.vendor_name, e.description, e.status,
         e.project_id, p.project_code,
         COALESCE(p.project_title, p.name) AS project_name, p.client_name
    FROM expenses e
    LEFT JOIN projects p ON p.project_id = e.project_id AND p.isDelete = 0`;

/** First and last day of a `YYYY-MM` month. */
function monthBounds(month: string): { start: string; end: string } {
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
		currency: s(row, 'currency', 'INR'),
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
		source: 'direct_expense',
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
export function toCostRecordJson(record: CostRecord): CostRecordJson {
	return {
		id: record.id,
		cost_uid: record.costUid,
		source: record.source,
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
 * Confirmed Project cost of a month, keyed by Project id and then currency.
 * A Project can hold more than one currency in a month, and those figures are
 * never combined; a group whose recognized amount is missing carries null.
 */
export async function loadMonthProjectCost(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`SELECT e.project_id, COALESCE(e.currency, 'INR') AS currency,
              SUM(e.recognized_amount) AS amount,
              SUM(CASE WHEN e.recognized_amount IS NULL THEN 1 ELSE 0 END) AS unknown_amounts
       FROM expenses e
      WHERE e.isDelete = 0
        AND e.recognition_state = 'recognized'
        AND e.cost_classification = 'project'
        AND e.project_id IS NOT NULL
        AND e.recognition_period BETWEEN ? AND ?
      GROUP BY e.project_id, COALESCE(e.currency, 'INR')`,
		[start, end]
	);
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows as DbRow[]) {
		const id = num(row, 'project_id');
		if (id === null) continue;
		const currency = s(row, 'currency', 'INR') ?? 'INR';
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
 * The direct-expense rows matching a drilldown query, unpaginated. The
 * combined drilldown (`drilldown.ts`) merges this with the other cost sources
 * before it sorts and pages, so one filter can never page one store's records
 * past another's.
 */
export async function loadFilteredExpenseRecords(
	db: SqlConnection,
	query: CostDrilldownQuery
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(query.month);
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
	const [rows] = (await db.execute(
		`${COST_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY e.recognition_period DESC, e.expense_date DESC, e.id DESC`,
		params
	)) as [DbRow[], unknown];
	return (rows as DbRow[]).map(mapCostRow);
}
