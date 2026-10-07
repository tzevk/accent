/**
 * The shared source identity and link seam (#311). Contract:
 * C:/Files/OCDSE/Work/expenditure-source-contract.md.
 *
 * Every financial cost is one row in one cost-bearing source table
 * (`expenses`, `purchase_invoices`, later source stores). Its `cost_uid` is the
 * canonical identity a foreign row stores to reference that cost without
 * creating another one. `financial_cost_links` is the single durable mapping:
 * one `role='cost'` row registers each cost-bearing row (so a `cost_uid`
 * resolves with one indexed lookup), and the other roles record foreign
 * references (payable follow-up, receipt copy, settlement, petty-cash funding)
 * with the basis and review state of the mapping.
 *
 * Only `review_state='confirmed'` links are authoritative. A candidate text
 * match stays `pending_review` and never merges identity or totals.
 *
 * Every function works on the caller's connection so a command, a link update,
 * and the financial journal can be one transaction.
 */

import { CostError } from './errors';
import type { SqlConnection } from './records';
import type { CostClassification, CostSource, RecognitionState } from './types';

export type CostLinkRole =
	| 'cost'
	| 'liability'
	| 'receipt'
	| 'settlement'
	| 'funding'
	| 'mirror'
	| 'split'
	/** A replacement invoice superseding a Cost Accrual's matched amount (#313). */
	| 'replacement';

export type CostLinkBasis = 'system' | 'explicit' | 'document' | 'candidate';

export type CostLinkReviewState = 'confirmed' | 'pending_review' | 'rejected';

/** One cost as a source reference sees it: identity, money, and evidence state. */
export interface CostReference {
	cost_uid: string;
	/** null when the owning source has no registered adapter yet. */
	source: CostSource | null;
	source_table: string;
	source_id: string;
	/** Document number / description for display, when the source can state one. */
	label: string | null;
	currency: string | null;
	/** null = unknown, never 0. */
	gross_amount: number | null;
	tax_amount: number | null;
	recognized_amount: number | null;
	recognition_state: RecognitionState;
	classification: CostClassification | null;
	project_id: number | null;
}

export interface CostSourceAdapter {
	source: CostSource;
	/** Native table name, matching `financial_cost_links.source_table`. */
	table: string;
	load(db: SqlConnection, sourceId: string): Promise<CostReference | null>;
	/**
	 * Native Recognition Period slices, for consumers that address one month of
	 * a cost (supplier-order consumption, #312). A source without this method
	 * states no slices: consumption refuses rather than guessing a period.
	 */
	loadSlices?(
		db: SqlConnection,
		sourceId: string,
		options?: { forUpdate?: boolean }
	): Promise<CostSliceReference[]>;
}

const adapters = new Map<string, CostSourceAdapter>();

/** Register a source adapter so `resolveCostReference` can read its rows. */
export function registerCostSource(adapter: CostSourceAdapter): void {
	adapters.set(adapter.table, adapter);
}

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

async function loadRow(
	db: SqlConnection,
	sql: string,
	params: Array<string | number>
): Promise<DbRow | null> {
	const [rows] = (await db.execute(sql, params)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * The direct-expense source (#306): costs live in `expenses`. Registered here
 * so a supplier receipt, payable, or later source can resolve an expense
 * `cost_uid` without importing the write path.
 */
const DIRECT_EXPENSE_ADAPTER: CostSourceAdapter = {
	source: 'direct_expense',
	table: 'expenses',
	async load(db, sourceId) {
		const id = Number(sourceId);
		if (!Number.isInteger(id) || id <= 0) return null;
		const row = await loadRow(
			db,
			`SELECT cost_uid, expense_number, currency, total_amount, tax_amount,
              recognized_amount, recognition_state, cost_classification, project_id
         FROM expenses
        WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (!row) return null;
		return {
			cost_uid: s(row, 'cost_uid', '') ?? '',
			source: 'direct_expense',
			source_table: 'expenses',
			source_id: String(id),
			label: s(row, 'expense_number'),
			currency: s(row, 'currency', 'INR'),
			gross_amount: num(row, 'total_amount'),
			tax_amount: num(row, 'tax_amount'),
			recognized_amount: num(row, 'recognized_amount'),
			recognition_state:
				(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
			classification:
				(s(row, 'cost_classification') as CostClassification | null) ?? null,
			project_id: num(row, 'project_id'),
		};
	},
};

registerCostSource(DIRECT_EXPENSE_ADAPTER);

/**
 * Register the cost-bearing row itself (role='cost'), in the same transaction
 * that inserts it. Idempotent: re-registering keeps one row per source row.
 */
export async function registerCostIdentity(
	db: SqlConnection,
	input: {
		costUid: string;
		sourceTable: string;
		sourceId: string | number;
		createdBy?: number | null;
	}
): Promise<void> {
	const costUid = input.costUid?.trim();
	if (!costUid) {
		throw new CostError('invalid_cost_uid', 'A cost identity is required', 422);
	}
	await db.execute(
		`INSERT INTO financial_cost_links
       (cost_uid, source_table, source_id, role, basis, review_state, created_by)
     VALUES (?, ?, ?, 'cost', 'system', 'confirmed', ?)
     ON DUPLICATE KEY UPDATE
       cost_uid = VALUES(cost_uid),
       basis = 'system',
       review_state = 'confirmed'`,
		[
			costUid,
			input.sourceTable,
			String(input.sourceId),
			input.createdBy ?? null,
		]
	);
}

const LINK_ROLES: readonly CostLinkRole[] = [
	'cost',
	'liability',
	'receipt',
	'settlement',
	'funding',
	'mirror',
	'split',
	'replacement',
];
const LINK_BASES: readonly CostLinkBasis[] = [
	'system',
	'explicit',
	'document',
	'candidate',
];
const LINK_REVIEW_STATES: readonly CostLinkReviewState[] = [
	'confirmed',
	'pending_review',
	'rejected',
];

function enumOrThrow<T extends string>(
	value: T | undefined,
	allowed: readonly T[],
	fallback: T,
	field: string
): T {
	if (value === undefined) return fallback;
	if (!allowed.includes(value)) {
		throw new CostError(
			'invalid_link_value',
			`Unknown ${field}: ${value}`,
			422,
			{
				field,
			}
		);
	}
	return value;
}

/**
 * Record/refresh a foreign reference to a cost. `role='cost'` belongs to
 * `registerCostIdentity`; this is for liability, receipt, settlement, funding,
 * mirror, and split rows. One row per (source_table, source_id, role): a later
 * call updates the mapping (for example a review decision).
 */
export async function linkCostReference(
	db: SqlConnection,
	input: {
		costUid: string;
		sourceTable: string;
		sourceId: string | number;
		role: CostLinkRole;
		basis?: CostLinkBasis;
		reviewState?: CostLinkReviewState;
		evidenceReference?: string | null;
		createdBy?: number | null;
	}
): Promise<void> {
	const costUid = input.costUid?.trim();
	if (!costUid) {
		throw new CostError('invalid_cost_uid', 'A cost identity is required', 422);
	}
	const role = enumOrThrow(input.role, LINK_ROLES, 'settlement', 'role');
	if (role === 'cost') {
		throw new CostError(
			'invalid_link_role',
			"Use registerCostIdentity for the role='cost' row",
			422
		);
	}
	const basis = enumOrThrow(input.basis, LINK_BASES, 'explicit', 'basis');
	const reviewState = enumOrThrow(
		input.reviewState,
		LINK_REVIEW_STATES,
		'confirmed',
		'review_state'
	);
	await db.execute(
		`INSERT INTO financial_cost_links
       (cost_uid, source_table, source_id, role, basis, review_state,
        evidence_reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       cost_uid = VALUES(cost_uid),
       basis = VALUES(basis),
       review_state = VALUES(review_state),
       evidence_reference = VALUES(evidence_reference)`,
		[
			costUid,
			input.sourceTable,
			String(input.sourceId),
			role,
			basis,
			reviewState,
			input.evidenceReference?.trim() || null,
			input.createdBy ?? null,
		]
	);
}

/**
 * Resolve a `cost_uid` to its authoritative source row. Returns null when the
 * identity is unknown or its source has no registered adapter — a failed
 * resolution is never treated as a new cost, and null amounts in the returned
 * reference mean unknown, not zero.
 */
export async function resolveCostReference(
	db: SqlConnection,
	costUid: string
): Promise<CostReference | null> {
	const uid = costUid?.trim();
	if (!uid) return null;
	const row = await loadRow(
		db,
		`SELECT source_table, source_id
       FROM financial_cost_links
      WHERE cost_uid = ? AND role = 'cost'
      LIMIT 1`,
		[uid]
	);
	if (!row) return null;
	const sourceTable = s(row, 'source_table', '') ?? '';
	const sourceId = s(row, 'source_id', '') ?? '';
	const adapter = adapters.get(sourceTable);
	if (!adapter) return null;
	const reference = await adapter.load(db, sourceId);
	if (!reference) return null;
	return { ...reference, cost_uid: reference.cost_uid || uid };
}

/**
 * One native Recognition Period slice of a cost, as its source states it. A
 * source with several slices in one month (a duplicate-month split) returns
 * one row per native slice; the consumer sums them by period — it never picks
 * the first row it finds.
 */
export interface CostSliceReference {
	cost_uid: string;
	source_table: string;
	source_id: string;
	label: string | null;
	currency: string | null;
	/** First day of the month this slice belongs to (`YYYY-MM-01`). */
	recognition_period: string;
	/** null = unknown, never 0. */
	gross_amount: number | null;
	tax_amount: number | null;
	recognized_amount: number | null;
	recognition_state: RecognitionState;
	/** The source row's `financial_version` at read time. */
	financial_version: number;
}

/**
 * Read a cost's native slices. Returns null when the identity does not resolve
 * or the source has no slice reader; an empty list means the source exists but
 * states no slice (for example a cost that is not recognized yet). With
 * `forUpdate` the source row is locked, so a version-guarded command can
 * refuse a stale or cancelled source before it writes anything.
 */
export async function resolveCostSlices(
	db: SqlConnection,
	costUid: string,
	options?: { forUpdate?: boolean }
): Promise<CostSliceReference[] | null> {
	const uid = costUid?.trim();
	if (!uid) return null;
	const row = await loadRow(
		db,
		`SELECT source_table, source_id
       FROM financial_cost_links
      WHERE cost_uid = ? AND role = 'cost'
      LIMIT 1`,
		[uid]
	);
	if (!row) return null;
	const sourceTable = s(row, 'source_table', '') ?? '';
	const sourceId = s(row, 'source_id', '') ?? '';
	const adapter = adapters.get(sourceTable);
	if (!adapter?.loadSlices) return null;
	const slices = await adapter.loadSlices(db, sourceId, options);
	return slices.map((slice) => ({
		...slice,
		cost_uid: slice.cost_uid || uid,
	}));
}
