/**
 * The write path for approved Project cost budgets: record a budget, then move
 * it through the approval lifecycle with versioned commands.
 *
 * Invariants this module owns:
 *  - one row per budget, one version, one append-only journal entry per
 *    accepted command (`project_cost_budget_events`);
 *  - a command must present the version it expects, so two operators (or one
 *    replayed request) cannot both apply to the same state;
 *  - a budget becomes an approved budget only through an explicit `approve`
 *    that carries its approval evidence; nothing else sets `approved`;
 *  - approving a later budget that overlaps an earlier approved one supersedes
 *    the earlier row — it keeps its amount, evidence, version history, and
 *    journal, so a closed period can still be explained;
 *  - a budget is never converted into another currency and never deleted;
 *    withdrawal is the lifecycle act.
 *
 * Atomicity: pass `connection` to run inside the caller's transaction (the
 * financial-close slice must see one coherent snapshot); otherwise the module
 * opens its own.
 */

import { randomUUID } from 'node:crypto';
import type Decimal from 'decimal.js';
import { R, toNumber } from '@/lib/money';
import { withTransaction } from '@/utils/database';
import { CostError } from './commands';
import type { CostActor, CommandOptions } from './commands';
import { mapBudgetRow } from './budget-records';
import type { DbRow, SqlConnection } from './records';
import { s } from './records';
import {
	isCostBudgetScope,
	type CostBudgetCommandInput,
	type CostBudgetCommandResult,
	type CostBudgetJournalCommand,
	type CostBudgetPatch,
	type CostBudgetRecord,
	type CostBudgetScope,
	type CostBudgetState,
	type RecordCostBudgetInput,
} from './types';

/** The command API vocabulary paired with the journal's past-tense one. */
const JOURNAL_COMMAND: Record<
	Exclude<CostBudgetCommandInput['command'], 'update'>,
	CostBudgetJournalCommand
> = {
	submit: 'submitted',
	approve: 'approved',
	withdraw: 'withdrawn',
};

const UPDATEABLE_STATES: readonly CostBudgetState[] = ['draft', 'submitted'];
const WITHDRAWABLE_STATES: readonly CostBudgetState[] = [
	'draft',
	'submitted',
	'approved',
];

function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function amountOrThrow(value: unknown): number {
	const source =
		typeof value === 'number' ? String(value) : String(value ?? '').trim();
	if (source === '') {
		throw new CostError('invalid_amount', 'A budget amount is required', 422, {
			field: 'amount',
		});
	}
	let parsed: Decimal;
	try {
		parsed = R(source);
	} catch {
		throw new CostError(
			'invalid_amount',
			'Amount must be a positive number',
			422
		);
	}
	if (!parsed.isFinite() || parsed.lt(0)) {
		throw new CostError(
			'invalid_amount',
			'Amount must be a positive number',
			422
		);
	}
	return toNumber(parsed.toDecimalPlaces(2));
}

function currencyOrThrow(value: unknown): string {
	const code = String(value ?? '')
		.trim()
		.toUpperCase();
	if (!/^[A-Z]{3}$/.test(code)) {
		throw new CostError(
			'invalid_currency',
			'Currency must be a three-letter code',
			422
		);
	}
	return code;
}

function dateOrThrow(value: unknown, field: string): string {
	const trimmed = String(value ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new CostError('invalid_period', `Invalid ${field}: ${trimmed}`, 422, {
			field,
		});
	}
	return trimmed;
}

function scopeOrThrow(value: unknown): CostBudgetScope {
	if (!isCostBudgetScope(value)) {
		throw new CostError(
			'invalid_scope',
			`Unknown budget scope: ${String(value ?? '')}`,
			422,
			{ field: 'scope' }
		);
	}
	return value;
}

/**
 * The approved period. Both dates are required when a budget is recorded; an
 * `update` may move one end, and the other comes from the current row.
 */
function periodOrThrow(
	start: unknown,
	end: unknown,
	fallback?: { start: string; end: string }
): { start: string; end: string } {
	if (start === undefined && end === undefined && fallback) return fallback;
	const startDate = dateOrThrow(
		start === undefined ? fallback?.start : start,
		'period_start'
	);
	const endDate = dateOrThrow(
		end === undefined ? fallback?.end : end,
		'period_end'
	);
	if (startDate > endDate) {
		throw new CostError(
			'invalid_period',
			'The budget period must start on or before it ends',
			422
		);
	}
	return { start: startDate, end: endDate };
}

interface JournalInput {
	budgetUid: string;
	sourceId: number;
	version: number;
	command: CostBudgetJournalCommand;
	actorId: number | null;
	reason: string | null;
	evidenceReference: string | null;
	snapshot: Record<string, unknown>;
}

async function writeBudgetJournal(db: SqlConnection, entry: JournalInput) {
	await db.execute(
		`INSERT INTO project_cost_budget_events
       (budget_uid, source_table, source_id, version, command, actor_user_id, reason,
        evidence_reference, snapshot)
     VALUES (?, 'project_cost_budgets', ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.budgetUid,
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

function snapshotOf(row: {
	state: CostBudgetState;
	currency: string;
	amount: number;
	scope: CostBudgetScope;
	period_start: string;
	period_end: string;
	approval_evidence_reference: string | null;
	financial_version: number;
}): Record<string, unknown> {
	return {
		state: row.state,
		currency: row.currency,
		amount: row.amount.toFixed(2),
		scope: row.scope,
		period_start: row.period_start,
		period_end: row.period_end,
		approval_evidence_reference: row.approval_evidence_reference,
		financial_version: row.financial_version,
	};
}

async function inBudgetTransaction<T>(
	options: CommandOptions | undefined,
	work: (db: SqlConnection) => Promise<T>
): Promise<T> {
	if (options?.connection) return work(options.connection);
	return withTransaction((db) => work(db)) as Promise<T>;
}

/**
 * The Project a budget belongs to, read without a lock. The command takes the
 * Project's row lock first and only then locks the budget row, so two commands
 * always acquire their locks in the same order.
 */
async function loadBudgetProject(
	db: SqlConnection,
	id: number
): Promise<{ projectId: number } | null> {
	const [rows] = (await db.execute(
		`SELECT project_id FROM project_cost_budgets
      WHERE id = ? AND isDelete = 0
      LIMIT 1`,
		[id]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	return { projectId: Number(rows[0].project_id ?? 0) };
}

async function loadBudgetForUpdate(
	db: SqlConnection,
	id: number
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`SELECT id, budget_uid, project_id, currency, amount, scope, period_start,
            period_end, basis_note, state, approval_evidence_reference,
            approved_by, approved_at, financial_version
       FROM project_cost_budgets
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/** A budget names a real, live Project; anything else is refused. */
async function assertLiveProject(
	db: SqlConnection,
	projectId: number
): Promise<void> {
	const [rows] = (await db.execute(
		`SELECT project_id FROM projects WHERE project_id = ? AND isDelete = 0 LIMIT 1`,
		[projectId]
	)) as [DbRow[], unknown];
	if (rows.length === 0) {
		throw new CostError(
			'invalid_project',
			`Unknown Project: ${projectId}`,
			422,
			{ field: 'project_id' }
		);
	}
}

/** Record a cost budget. It starts as a draft: recording approves nothing. */
export async function recordCostBudget(
	input: RecordCostBudgetInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<CostBudgetRecord> {
	const projectId = Number(input.projectId);
	if (!Number.isInteger(projectId) || projectId <= 0) {
		throw new CostError('invalid_project', 'A Project is required', 422, {
			field: 'project_id',
		});
	}
	const currency = currencyOrThrow(input.currency);
	const amount = amountOrThrow(input.amount);
	const scope = scopeOrThrow(input.scope);
	const period = periodOrThrow(input.periodStart, input.periodEnd);
	const basisNote = text(input.basisNote, 500);
	const budgetUid = `costbudget-${randomUUID()}`;

	return inBudgetTransaction(options, async (db) => {
		await assertLiveProject(db, projectId);
		await db.execute(
			`INSERT INTO project_cost_budgets
         (budget_uid, project_id, currency, amount, scope, period_start, period_end,
          basis_note, state, financial_version, created_by, isDelete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, 0)`,
			[
				budgetUid,
				projectId,
				currency,
				amount,
				scope,
				period.start,
				period.end,
				basisNote,
				actor.id,
			]
		);
		const [rows] = (await db.execute(
			`SELECT b.id, b.budget_uid, b.project_id, b.currency, b.amount, b.scope,
              b.period_start, b.period_end, b.basis_note, b.state,
              b.approval_evidence_reference, b.approved_by, b.approved_at,
              b.financial_version, b.created_by, b.created_at, b.updated_at,
              p.project_code, COALESCE(p.project_title, p.name) AS project_name
         FROM project_cost_budgets b
         LEFT JOIN projects p ON p.project_id = b.project_id AND p.isDelete = 0
        WHERE b.budget_uid = ?`,
			[budgetUid]
		)) as [DbRow[], unknown];
		const record = mapBudgetRow(rows[0]);
		await writeBudgetJournal(db, {
			budgetUid,
			sourceId: record.id,
			version: 1,
			command: 'recorded',
			actorId: actor.id,
			reason: basisNote,
			evidenceReference: null,
			snapshot: snapshotOf(record),
		});
		return record;
	});
}

/**
 * Apply one versioned command to a cost budget. A stale version, a disallowed
 * transition, a missing approval evidence, or a missing withdrawal reason fails
 * explicitly and writes nothing.
 */
export async function executeBudgetCommand(
	input: CostBudgetCommandInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<CostBudgetCommandResult> {
	const id = Number(input.id);
	if (!Number.isInteger(id) || id <= 0) {
		throw new CostError('invalid_budget', 'Valid budget id is required', 422);
	}
	const command = input.command;
	const expectedVersion = Number(input.expectedVersion);
	if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
		throw new CostError(
			'version_required',
			'expected_version is required',
			400
		);
	}

	return inBudgetTransaction(options, async (db) => {
		const target = await loadBudgetProject(db, id);
		if (!target) {
			throw new CostError('budget_not_found', 'Cost budget not found', 404);
		}
		// Every budget command takes the Project's row lock first. Two approvals
		// that overlap in period then serialize here, so each one supersedes
		// what the other approved instead of both reading it as unapproved, and
		// no pair of commands can lock Project and budget rows in opposite
		// orders. Precedent: the Project quotation route locks the same row.
		await db.execute(
			`SELECT project_id FROM projects WHERE project_id = ? FOR UPDATE`,
			[target.projectId]
		);
		const row = await loadBudgetForUpdate(db, id);
		if (!row) {
			throw new CostError('budget_not_found', 'Cost budget not found', 404);
		}
		const budgetUid = s(row, 'budget_uid', '') ?? '';
		const state = (s(row, 'state', 'draft') as CostBudgetState) ?? 'draft';
		const currentVersion = Number(row.financial_version ?? 1);
		if (currentVersion !== expectedVersion) {
			throw new CostError(
				'stale_version',
				`This cost budget is at version ${currentVersion}; the command expected ${expectedVersion}`,
				409,
				{ expected_version: expectedVersion, current_version: currentVersion }
			);
		}

		const current: CostBudgetRecord = {
			id,
			budget_uid: budgetUid,
			project_id: Number(row.project_id ?? 0),
			project_code: '',
			project_name: '',
			currency: s(row, 'currency', 'INR') ?? 'INR',
			amount: Number(row.amount ?? 0),
			scope:
				(s(row, 'scope') as CostBudgetScope | null) ?? 'project_incurred_cost',
			state,
			period_start: (s(row, 'period_start') ?? '').slice(0, 10),
			period_end: (s(row, 'period_end') ?? '').slice(0, 10),
			basis_note: s(row, 'basis_note'),
			approval_evidence_reference: s(row, 'approval_evidence_reference'),
			approved_by: row.approved_by === null ? null : Number(row.approved_by),
			approved_at: s(row, 'approved_at'),
			financial_version: currentVersion,
			created_by: null,
			created_at: '',
			updated_at: '',
		};
		const next: CostBudgetRecord = {
			...current,
			financial_version: currentVersion + 1,
		};
		const reason = text(input.reason, 500);

		if (command === 'update') {
			if (!UPDATEABLE_STATES.includes(state)) {
				throw new CostError(
					'invalid_transition',
					`A ${state} budget cannot be edited; withdraw it and record a new version through approval`,
					409
				);
			}
			const patch: CostBudgetPatch = input.patch ?? {};
			if (patch.currency !== undefined) {
				next.currency = currencyOrThrow(patch.currency);
			}
			if (patch.amount !== undefined) {
				next.amount = amountOrThrow(patch.amount);
			}
			if (patch.scope !== undefined) {
				next.scope = scopeOrThrow(patch.scope);
			}
			if (patch.periodStart !== undefined || patch.periodEnd !== undefined) {
				const period = periodOrThrow(patch.periodStart, patch.periodEnd, {
					start: current.period_start,
					end: current.period_end,
				});
				next.period_start = period.start;
				next.period_end = period.end;
			}
			if (patch.basisNote !== undefined) {
				next.basis_note = text(patch.basisNote, 500);
			}
			await db.execute(
				`UPDATE project_cost_budgets
            SET currency = ?, amount = ?, scope = ?, period_start = ?, period_end = ?,
                basis_note = ?, financial_version = ?
          WHERE id = ?`,
				[
					next.currency,
					next.amount,
					next.scope,
					next.period_start,
					next.period_end,
					next.basis_note,
					next.financial_version,
					id,
				]
			);
			await writeBudgetJournal(db, {
				budgetUid,
				sourceId: id,
				version: next.financial_version,
				command: 'updated',
				actorId: actor.id,
				reason,
				evidenceReference: text(input.evidenceReference, 500),
				snapshot: snapshotOf(next),
			});
		} else if (command === 'submit') {
			if (state !== 'draft') {
				throw new CostError(
					'invalid_transition',
					`Only a draft budget can be submitted; this budget is ${state}`,
					409
				);
			}
			next.state = 'submitted';
			await db.execute(
				`UPDATE project_cost_budgets SET state = ?, financial_version = ? WHERE id = ?`,
				[next.state, next.financial_version, id]
			);
			await writeBudgetJournal(db, {
				budgetUid,
				sourceId: id,
				version: next.financial_version,
				command: JOURNAL_COMMAND.submit,
				actorId: actor.id,
				reason,
				evidenceReference: null,
				snapshot: snapshotOf(next),
			});
		} else if (command === 'approve') {
			if (state !== 'submitted') {
				throw new CostError(
					'invalid_transition',
					`Only a submitted budget can be approved; this budget is ${state}`,
					409
				);
			}
			const evidence = text(input.evidenceReference, 500);
			if (!evidence) {
				throw new CostError(
					'approval_evidence_required',
					'Approving a cost budget requires its approval evidence',
					422
				);
			}
			next.state = 'approved';
			next.approval_evidence_reference = evidence;
			next.approved_by = actor.id;
			await db.execute(
				`UPDATE project_cost_budgets
            SET state = 'approved', approval_evidence_reference = ?, approved_by = ?,
                approved_at = NOW(), financial_version = ?
          WHERE id = ?`,
				[evidence, actor.id, next.financial_version, id]
			);
			await writeBudgetJournal(db, {
				budgetUid,
				sourceId: id,
				version: next.financial_version,
				command: JOURNAL_COMMAND.approve,
				actorId: actor.id,
				reason,
				evidenceReference: evidence,
				snapshot: snapshotOf(next),
			});

			// Approving a later budget that overlaps an earlier approved budget
			// of the same Project, currency, and scope supersedes the earlier
			// one. It is never deleted: its amount, evidence, version, and
			// journal stay readable.
			const [supersededRows] = (await db.execute(
				`SELECT id, budget_uid, currency, amount, scope, period_start, period_end,
                approval_evidence_reference, financial_version
           FROM project_cost_budgets
          WHERE isDelete = 0 AND id <> ? AND project_id = ? AND currency = ? AND scope = ?
            AND state = 'approved' AND period_start <= ? AND period_end >= ?
          FOR UPDATE`,
				[
					id,
					current.project_id,
					next.currency,
					next.scope,
					next.period_end,
					next.period_start,
				]
			)) as [DbRow[], unknown];
			for (const earlier of supersededRows) {
				const supersededId = Number(earlier.id);
				const supersededVersion = Number(earlier.financial_version ?? 1) + 1;
				await db.execute(
					`UPDATE project_cost_budgets SET state = 'superseded', financial_version = ? WHERE id = ?`,
					[supersededVersion, supersededId]
				);
				await writeBudgetJournal(db, {
					budgetUid: s(earlier, 'budget_uid', '') ?? '',
					sourceId: supersededId,
					version: supersededVersion,
					command: 'superseded',
					actorId: actor.id,
					reason: `Superseded by approved cost budget ${budgetUid}`,
					evidenceReference: s(earlier, 'approval_evidence_reference'),
					snapshot: {
						state: 'superseded',
						currency: s(earlier, 'currency', 'INR'),
						amount: Number(earlier.amount ?? 0).toFixed(2),
						scope: s(earlier, 'scope'),
						period_start: (s(earlier, 'period_start') ?? '').slice(0, 10),
						period_end: (s(earlier, 'period_end') ?? '').slice(0, 10),
						financial_version: supersededVersion,
						superseded_by: budgetUid,
					},
				});
			}
		} else if (command === 'withdraw') {
			if (!WITHDRAWABLE_STATES.includes(state)) {
				throw new CostError(
					'invalid_transition',
					`A ${state} budget cannot be withdrawn`,
					409
				);
			}
			if (!reason) {
				throw new CostError(
					'reason_required',
					'Withdrawing a cost budget requires a reason',
					422
				);
			}
			// Withdrawing an approved budget removes the basis the report was
			// comparing with, so it carries the same privilege that approved it.
			if (state === 'approved' && input.actorCanApprove !== true) {
				throw new CostError(
					'approval_privilege_required',
					'Withdrawing an approved cost budget requires the approval privilege',
					403
				);
			}
			next.state = 'withdrawn';
			await db.execute(
				`UPDATE project_cost_budgets SET state = 'withdrawn', financial_version = ? WHERE id = ?`,
				[next.financial_version, id]
			);
			await writeBudgetJournal(db, {
				budgetUid,
				sourceId: id,
				version: next.financial_version,
				command: JOURNAL_COMMAND.withdraw,
				actorId: actor.id,
				reason,
				evidenceReference: text(input.evidenceReference, 500),
				snapshot: snapshotOf(next),
			});
		} else {
			throw new CostError(
				'invalid_command',
				`Unknown command: ${String(command)}`,
				400
			);
		}

		return {
			id,
			budget_uid: budgetUid,
			state: next.state,
			financial_version: next.financial_version,
			currency: next.currency,
			amount: next.amount,
			scope: next.scope,
			period_start: next.period_start,
			period_end: next.period_end,
			component: command,
		};
	});
}
