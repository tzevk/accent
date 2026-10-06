/**
 * Database access for approved Project cost budgets — the only place the
 * expenditure module reads `project_cost_budgets` or its journal.
 *
 * Every function takes the connection to work on, exactly like `records.ts`:
 * a caller that already holds a transaction (the later financial-close slice
 * reads one coherent snapshot across every source) passes its own connection,
 * and nothing here opens its own transaction.
 *
 * Budgets never convert currency, so nothing here joins a rate or a Project
 * default: the stored currency is the currency the approval is stated in.
 */

import type { SqlConnection, DbRow } from './records';
import { monthBounds, num, s } from './records';
import type {
	CostBudgetCandidate,
	CostBudgetJournalEntry,
	CostBudgetRecord,
} from './types';

/** The projection the module maps into `CostBudgetRecord`. */
const BUDGET_SELECT = `
  SELECT b.id, b.budget_uid, b.project_id, b.currency, b.amount, b.scope,
         b.period_start, b.period_end, b.basis_note, b.state,
         b.approval_evidence_reference, b.approved_by, b.approved_at,
         b.financial_version, b.created_by, b.created_at, b.updated_at,
         p.project_code, COALESCE(p.project_title, p.name) AS project_name
    FROM project_cost_budgets b
    LEFT JOIN projects p ON p.project_id = b.project_id AND p.isDelete = 0`;

/** One stored budget row, with the Project it belongs to. */
export function mapBudgetRow(row: DbRow): CostBudgetRecord {
	return {
		id: Number(num(row, 'id') ?? 0),
		budget_uid: s(row, 'budget_uid', '') ?? '',
		project_id: Number(num(row, 'project_id') ?? 0),
		project_code: s(row, 'project_code', '') ?? '',
		project_name: s(row, 'project_name', '') ?? '',
		currency: s(row, 'currency', 'INR') ?? 'INR',
		amount: num(row, 'amount') ?? 0,
		scope:
			(s(row, 'scope') as CostBudgetRecord['scope'] | null) ??
			'project_incurred_cost',
		state: (s(row, 'state') as CostBudgetRecord['state'] | null) ?? 'draft',
		period_start: (s(row, 'period_start') ?? '').slice(0, 10),
		period_end: (s(row, 'period_end') ?? '').slice(0, 10),
		basis_note: s(row, 'basis_note'),
		approval_evidence_reference: s(row, 'approval_evidence_reference'),
		approved_by: num(row, 'approved_by'),
		approved_at: s(row, 'approved_at'),
		financial_version: Number(num(row, 'financial_version') ?? 1),
		created_by: num(row, 'created_by'),
		created_at: s(row, 'created_at', '') ?? '',
		updated_at: s(row, 'updated_at', '') ?? '',
	};
}

/** The comparable facts of one budget, for the report's budget section. */
export function toBudgetCandidate(budget: CostBudgetRecord): CostBudgetCandidate {
	return {
		budget_id: budget.id,
		budget_uid: budget.budget_uid,
		state: budget.state,
		currency: budget.currency,
		scope: budget.scope,
		amount: budget.amount,
		period_start: budget.period_start,
		period_end: budget.period_end,
		basis_note: budget.basis_note,
		financial_version: budget.financial_version,
		approval_evidence_reference: budget.approval_evidence_reference,
		approved_at: budget.approved_at,
	};
}

/**
 * Every live budget whose approval period covers `month`, in any state. A
 * budget that covers the month is a candidate even before it is approved, so
 * the report can say that a budget exists but is not approved yet.
 */
export async function loadBudgetsCoveringMonth(
	db: SqlConnection,
	month: string
): Promise<CostBudgetRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`${BUDGET_SELECT}
      WHERE b.isDelete = 0 AND b.period_start <= ? AND b.period_end >= ?
      ORDER BY b.budget_uid`,
		[end, start]
	);
	return (rows as DbRow[]).map(mapBudgetRow);
}

/**
 * Every live budget of the given Projects, whatever its period. This is what
 * lets the report state that an approved budget exists but covers a different
 * period, rather than reporting the Project as having no budget at all.
 */
export async function loadBudgetsForProjects(
	db: SqlConnection,
	projectIds: number[]
): Promise<CostBudgetRecord[]> {
	if (projectIds.length === 0) return [];
	const placeholders = projectIds.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`${BUDGET_SELECT}
      WHERE b.isDelete = 0 AND b.project_id IN (${placeholders})
      ORDER BY b.budget_uid`,
		projectIds
	);
	return (rows as DbRow[]).map(mapBudgetRow);
}

/** Every live budget of one Project, newest first. */
export async function loadBudgetsForProject(
	db: SqlConnection,
	projectId: number
): Promise<CostBudgetRecord[]> {
	const [rows] = await db.execute(
		`${BUDGET_SELECT}
      WHERE b.isDelete = 0 AND b.project_id = ?
      ORDER BY b.created_at DESC, b.id DESC`,
		[projectId]
	);
	return (rows as DbRow[]).map(mapBudgetRow);
}

/** One live budget by id, or null. */
export async function loadBudget(
	db: SqlConnection,
	id: number
): Promise<CostBudgetRecord | null> {
	const [rows] = await db.execute(
		`${BUDGET_SELECT}
      WHERE b.isDelete = 0 AND b.id = ?
      LIMIT 1`,
		[id]
	);
	const list = rows as DbRow[];
	return list.length > 0 ? mapBudgetRow(list[0]) : null;
}

/** The append-only journal of one budget, oldest first. */
export async function loadBudgetEvents(
	db: SqlConnection,
	budgetUid: string
): Promise<CostBudgetJournalEntry[]> {
	const [rows] = await db.execute(
		`SELECT version, command, actor_user_id, reason, evidence_reference, created_at,
            snapshot
       FROM project_cost_budget_events
      WHERE budget_uid = ?
      ORDER BY version ASC`,
		[budgetUid]
	);
	return (rows as DbRow[]).map((row) => ({
		version: Number(num(row, 'version') ?? 0),
		command:
			(s(row, 'command') as CostBudgetJournalEntry['command'] | null) ??
			'recorded',
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
