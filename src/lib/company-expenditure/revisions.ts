/**
 * Financial revisions (ticket #323) — correct closed-period cost through an
 * explicit, reasoned workflow that preserves prior figures.
 *
 * A closed month refuses ordinary writes (`409 month_closed`, #322); this
 * module is the authorized path those refusals point at. One accepted
 * revision, in one transaction:
 *  - checks the caller saw the current cost version (`expectedVersion`) and
 *    the frozen closed version it targets (`targetCloseVersion`);
 *  - requires a reason and an evidence reference, and records the actor and
 *    timestamp;
 *  - applies the correction through the source's own command path
 *    (`update` or `cancel` on a direct cost, supplier invoice, accrual, or
 *    settlement), so every validation the ordinary path performs still runs;
 *  - carries linked order consumptions forward (release + re-record on an
 *    amount/period correction, release on a cancellation), so the remaining
 *    commitment restates coherently instead of pointing at stale slices;
 *  - increments `financial_version`, appends exactly one journal row to the
 *    source's journal, and appends one `financial_revision_events` header
 *    carrying the prior and new figures with their reconstructed labels.
 *
 * A repeated revision key returns the existing successful result instead of
 * writing a duplicate; a stale version, a competing revision, and an
 * unauthorized caller fail safely with nothing partially written.
 *
 * Out of scope by design: payroll attribution (it keeps its allocation
 * revision contract, which never rewrites a Payroll Slip), accrual
 * replacement, split-invoice slice restatement, and non-cost sources
 * (other expenses, petty cash, period charges, budgets, orders) — those
 * stay refused with `month_closed` until their own revision slice lands.
 */

import { randomUUID } from 'node:crypto';
import { CostError } from './errors';
import {
	isMonthClosed,
	loadCloseSnapshot,
	monthOfPeriod,
	type ClosedRevision,
} from './close';
import type { CloseSnapshot } from './types';
import {
	executeCommand,
	inTransaction,
	type CommandOptions,
	type CostActor,
} from './commands';
import { executeSupplierCommand } from './supplier-invoices';
import type { SupplierInvoicePatch } from './supplier-invoices';
import { executeAccrualCommand } from './accruals';
import type { AccrualPatch } from './accruals';
import { executeSettlementCommand } from './cash';
import { recordOrderConsumption, releaseOrderConsumption } from './commitments';
import type { SqlConnection } from './records';
import type {
	CompanyReconciliation,
	CostPatch,
	RevisionCandidate,
	RevisionCommandInput,
	RevisionCommandResult,
	RevisionConsumptionStep,
	RevisionFigures,
	RevisionHistoryEntry,
	RevisionTargetKind,
} from './types';

/** Cost kinds this workflow revises, and the tables behind them. */
const COST_SOURCES: Record<
	Exclude<RevisionTargetKind, 'settlement'>,
	{ table: string; idColumn: string }
> = {
	direct: { table: 'expenses', idColumn: 'id' },
	supplier: { table: 'purchase_invoices', idColumn: 'id' },
	accrual: { table: 'cost_accruals', idColumn: 'id' },
};

function text(value: unknown, max = 500): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	if (trimmed.length === 0) return null;
	return trimmed.slice(0, max);
}

type DbRow = Record<string, unknown>;

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function str(row: DbRow, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	return typeof value === 'string' ? value : String(value);
}

/** Whether the error is a MySQL duplicate-key on a unique key. */
function isDuplicateKeyError(error: unknown): boolean {
	if (error === null || typeof error !== 'object') return false;
	const record = error as Record<string, unknown>;
	return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
}

function isRevisionKind(value: unknown): value is RevisionTargetKind {
	return (
		value === 'direct' ||
		value === 'supplier' ||
		value === 'accrual' ||
		value === 'settlement'
	);
}

/* ── target reads ──────────────────────────────────────────────────── */

interface RevisionTarget {
	kind: RevisionTargetKind;
	sourceTable: string;
	sourceId: number;
	uid: string;
	label: string | null;
	month: string;
	version: number;
	figures: RevisionFigures;
	projectId: number | null;
	replacedAmount: number;
}

async function loadProjectLabels(
	db: SqlConnection,
	projectIds: readonly number[],
	snapshot: CloseSnapshot | null
): Promise<Map<number, { code: string | null; name: string | null }>> {
	const labels = new Map<
		number,
		{ code: string | null; name: string | null }
	>();
	const ids = [...new Set(projectIds.filter((id) => Number.isInteger(id)))];
	if (ids.length > 0) {
		// No soft-delete filter: a revision labels the Project the cost
		// belongs to even after the master is renamed or soft-deleted.
		const placeholders = ids.map(() => '?').join(', ');
		const [rows] = (await db.execute(
			`SELECT project_id, project_code, COALESCE(project_title, name) AS project_name
        FROM projects WHERE project_id IN (${placeholders})`,
			[...ids]
		)) as [DbRow[], unknown];
		for (const row of rows) {
			const projectId = num(row, 'project_id');
			if (projectId === null) continue;
			labels.set(projectId, {
				code: str(row, 'project_code'),
				name: str(row, 'project_name'),
			});
		}
	}
	// Whatever the live masters no longer state, the frozen snapshot still
	// holds: reconstruct those labels from the close, never invent them.
	const frozen = snapshot?.snapshot?.projects ?? [];
	for (const entry of frozen) {
		if (!labels.has(entry.project_id)) {
			labels.set(entry.project_id, {
				code: entry.project_code ?? null,
				name: entry.project_name ?? null,
			});
		}
	}
	return labels;
}

function figuresOf(
	row: DbRow,
	kind: RevisionTargetKind,
	labels: Map<number, { code: string | null; name: string | null }>
): { figures: RevisionFigures; projectId: number | null } {
	const projectId = num(row, 'project_id');
	const label = projectId === null ? null : (labels.get(projectId) ?? null);
	if (kind === 'settlement') {
		return {
			figures: {
				amount: num(row, 'amount'),
				currency: str(row, 'currency'),
				classification: null,
				period: (str(row, 'settled_on') ?? '').slice(0, 10),
				state: str(row, 'status'),
				project_code: null,
				project_name: null,
				source_label: str(row, 'reference') ?? str(row, 'destination') ?? null,
			},
			projectId: null,
		};
	}
	const amountKey =
		kind === 'accrual'
			? 'gross_amount'
			: kind === 'supplier'
				? 'total'
				: 'total_amount';
	return {
		figures: {
			amount: num(row, amountKey),
			currency: str(row, 'currency'),
			classification: str(row, 'cost_classification'),
			period: (str(row, 'recognition_period') ?? '').slice(0, 10),
			state: str(row, 'recognition_state'),
			project_code: label?.code ?? null,
			project_name: label?.name ?? null,
			source_label:
				str(row, 'expense_number') ??
				str(row, 'invoice_number') ??
				str(row, 'accrual_number') ??
				null,
		},
		projectId,
	};
}

/**
 * The revision target as one row: its month, version, figures, and labels.
 * Read without a lock; the source command re-reads under lock and enforces
 * the version, so a concurrent writer between this read and the command
 * fails the revision instead of slipping past it.
 */
async function loadRevisionTarget(
	db: SqlConnection,
	kind: RevisionTargetKind,
	id: number | null,
	uid: string | null,
	snapshot: CloseSnapshot | null
): Promise<RevisionTarget | null> {
	let row: DbRow | null = null;
	let sourceTable = '';
	if (kind === 'settlement') {
		const key = id !== null ? 'id = ?' : 'settlement_uid = ?';
		const value = id !== null ? id : (uid ?? '');
		const [rows] = (await db.execute(
			`SELECT id, settlement_uid, target_cost_uid, amount, currency, settled_on,
               reference, destination, status, financial_version
          FROM financial_settlements
         WHERE ${key} AND isDelete = 0`,
			[value]
		)) as [DbRow[], unknown];
		row = rows[0] ?? null;
		sourceTable = 'financial_settlements';
		if (!row) return null;
		const labels = await loadProjectLabels(db, [], snapshot);
		const built = figuresOf(row, kind, labels);
		return {
			kind,
			sourceTable,
			sourceId: Number(num(row, 'id') ?? 0),
			uid: str(row, 'settlement_uid') ?? '',
			label: built.figures.source_label,
			month: (str(row, 'settled_on') ?? '').slice(0, 7),
			version: Number(num(row, 'financial_version') ?? 1),
			figures: built.figures,
			projectId: null,
			replacedAmount: 0,
		};
	}
	const source = COST_SOURCES[kind];
	sourceTable = source.table;
	const amountColumn =
		kind === 'accrual'
			? 'gross_amount'
			: kind === 'supplier'
				? 'total'
				: 'total_amount';
	const numberColumn =
		kind === 'accrual'
			? 'accrual_number'
			: kind === 'supplier'
				? 'invoice_number'
				: 'expense_number';
	const key = id !== null ? 'id = ?' : 'cost_uid = ?';
	const value = id !== null ? id : (uid ?? '');
	const [rows] = (await db.execute(
		`SELECT id, cost_uid, ${numberColumn}, ${amountColumn}, currency,
           cost_classification, recognition_period, recognition_state,
           financial_version, project_id${
							kind === 'accrual' ? ', replaced_amount' : ''
						}
      FROM ${sourceTable}
     WHERE ${key} AND isDelete = 0`,
		[value]
	)) as [DbRow[], unknown];
	row = rows[0] ?? null;
	if (!row) return null;
	const projectId = num(row, 'project_id');
	const labels = await loadProjectLabels(
		db,
		projectId === null ? [] : [projectId],
		snapshot
	);
	const built = figuresOf(row, kind, labels);
	return {
		kind,
		sourceTable,
		sourceId: Number(num(row, 'id') ?? 0),
		uid: str(row, 'cost_uid') ?? '',
		label: built.figures.source_label,
		month: (str(row, 'recognition_period') ?? '').slice(0, 7),
		version: Number(num(row, 'financial_version') ?? 1),
		figures: built.figures,
		projectId: built.projectId,
		replacedAmount:
			kind === 'accrual' ? Number(num(row, 'replaced_amount') ?? 0) : 0,
	};
}

/* ── consumption coherence ─────────────────────────────────────────── */

/** Patch keys that change the slices a consumption was recorded against. */
const SLICE_KEYS = new Set([
	'grossAmount',
	'taxAmount',
	'withholdingTaxAmount',
	'servicePeriodStart',
	'servicePeriodEnd',
	'billDate',
	'currency',
	'reportingCurrency',
	'conversionRate',
	'conversionDate',
	'conversionEvidenceReference',
	'splits',
]);

interface ActiveConsumption {
	id: number;
	orderUid: string;
	recognizedPeriod: string;
	version: number;
	taxBasis: 'gross' | 'net';
	source: 'invoice' | 'accrual';
}

/**
 * Keep linked order consumptions coherent with the revised cost, in the same
 * transaction. A cancellation releases every active consumption (the estimate
 * returns to the commitment, documented with the revision reason); an
 * amount/period correction releases and re-records each one, so the carried
 * consumption states the revised slice amount, period, and source version.
 * Corrections that touch no slice figure leave consumptions alone.
 */
async function reconcileConsumptions(
	db: SqlConnection,
	args: {
		costUid: string;
		command: 'update' | 'cancel';
		postPeriod: string | null;
		newVersion: number;
		patch: Record<string, unknown>;
		reason: string;
		evidenceReference: string | null;
		actorId: number | null;
		revision: ClosedRevision;
	}
): Promise<RevisionConsumptionStep[]> {
	const [rows] = (await db.execute(
		`SELECT id, order_uid, recognized_period, version, tax_basis, source
      FROM order_consumptions
     WHERE cost_uid = ? AND state = 'active'`,
		[args.costUid]
	)) as [DbRow[], unknown];
	const active: ActiveConsumption[] = (rows as DbRow[]).map((row) => ({
		id: Number(num(row, 'id') ?? 0),
		orderUid: str(row, 'order_uid') ?? '',
		recognizedPeriod: (str(row, 'recognized_period') ?? '').slice(0, 10),
		version: Number(num(row, 'version') ?? 1),
		taxBasis: (str(row, 'tax_basis') ?? 'gross') as 'gross' | 'net',
		source: (str(row, 'source') ?? 'invoice') as 'invoice' | 'accrual',
	}));
	if (active.length === 0) return [];
	if (
		args.command === 'update' &&
		!Object.keys(args.patch).some((key) => SLICE_KEYS.has(key))
	) {
		return [];
	}
	const steps: RevisionConsumptionStep[] = [];
	for (const consumption of active) {
		await releaseOrderConsumption(
			{
				orderUid: consumption.orderUid,
				consumptionId: consumption.id,
				expectedVersion: consumption.version,
				reason: args.reason,
				evidenceReference: args.evidenceReference,
			},
			{ id: args.actorId },
			{ connection: db, revision: args.revision }
		);
		if (args.command === 'cancel') {
			steps.push({ consumption_id: consumption.id, action: 'released' });
			continue;
		}
		const [orderRows] = (await db.execute(
			`SELECT financial_version FROM orders WHERE order_uid = ?`,
			[consumption.orderUid]
		)) as [DbRow[], unknown];
		const orderVersion = Number(
			num(orderRows[0] ?? {}, 'financial_version') ?? 0
		);
		const rerecorded = await recordOrderConsumption(
			{
				orderUid: consumption.orderUid,
				costUid: args.costUid,
				recognizedPeriod: (
					args.postPeriod ?? consumption.recognizedPeriod
				).slice(0, 7),
				taxBasis: consumption.taxBasis,
				expectedOrderVersion: orderVersion,
				expectedSourceVersion: args.newVersion,
				source: consumption.source,
				reason: args.reason,
				evidenceReference: args.evidenceReference,
			},
			{ id: args.actorId },
			{ connection: db, revision: args.revision }
		);
		steps.push({
			consumption_id: rerecorded.consumption.id,
			action: 'carried',
		});
	}
	return steps;
}

/* ── the revision command ──────────────────────────────────────────── */

function kindOfSourceTable(sourceTable: string): RevisionTargetKind {
	if (sourceTable === 'purchase_invoices') return 'supplier';
	if (sourceTable === 'cost_accruals') return 'accrual';
	if (sourceTable === 'financial_settlements') return 'settlement';
	return 'direct';
}

function resultOfEntry(
	entry: RevisionHistoryEntry,
	repeated: boolean
): RevisionCommandResult {
	return {
		id: entry.id,
		revision_uid: entry.revision_uid,
		month: entry.month,
		close_uid: entry.close_uid,
		close_version: entry.close_version,
		target_kind: kindOfSourceTable(entry.source_table),
		target_uid: entry.target_uid,
		target_label: entry.target_label,
		command: entry.command,
		prior_version: entry.prior_version,
		new_version: entry.new_version,
		prior_figures: entry.prior_figures,
		new_figures: entry.new_figures,
		repeated,
		consumptions: [],
	};
}

async function loadEntryByUid(
	db: SqlConnection,
	revisionUid: string
): Promise<RevisionHistoryEntry | null> {
	const [rows] = (await db.execute(
		`SELECT id, revision_uid, month, close_uid, close_version, target_kind,
           target_uid, source_table, source_id, command, prior_version,
           new_version, prior_snapshot, new_snapshot, reason,
           evidence_reference, actor_user_id, created_at
      FROM financial_revision_events
     WHERE revision_uid = ? AND isDelete = 0
     LIMIT 1`,
		[revisionUid]
	)) as [DbRow[], unknown];
	const row = rows[0];
	if (!row) return null;
	const actorNames = await resolveActorNames(db, [num(row, 'actor_user_id')]);
	const targetUid = str(row, 'target_uid') ?? '';
	const sourceTable = str(row, 'source_table') ?? '';
	let targetLabel: string | null = null;
	if (targetUid.length > 0) {
		if (sourceTable === 'financial_settlements') {
			const [labelRows] = (await db.execute(
				`SELECT reference FROM financial_settlements WHERE settlement_uid = ?`,
				[targetUid]
			)) as [DbRow[], unknown];
			targetLabel = str((labelRows as DbRow[])[0] ?? {}, 'reference');
		} else if (
			sourceTable === 'expenses' ||
			sourceTable === 'purchase_invoices' ||
			sourceTable === 'cost_accruals'
		) {
			const numberColumn =
				sourceTable === 'expenses'
					? 'expense_number'
					: sourceTable === 'purchase_invoices'
						? 'invoice_number'
						: 'accrual_number';
			const [labelRows] = (await db.execute(
				`SELECT ${numberColumn} AS number FROM ${sourceTable} WHERE cost_uid = ?`,
				[targetUid]
			)) as [DbRow[], unknown];
			targetLabel = str((labelRows as DbRow[])[0] ?? {}, 'number');
		}
	}
	return {
		id: Number(num(row, 'id') ?? 0),
		revision_uid: str(row, 'revision_uid') ?? '',
		month: str(row, 'month') ?? '',
		close_uid: str(row, 'close_uid') ?? '',
		close_version: Number(num(row, 'close_version') ?? 0),
		target_kind: (str(row, 'target_kind') ??
			'cost') as RevisionHistoryEntry['target_kind'],
		target_uid: targetUid,
		target_label: targetLabel,
		source_table: sourceTable,
		command: (str(row, 'command') ??
			'updated') as RevisionHistoryEntry['command'],
		prior_version: Number(num(row, 'prior_version') ?? 0),
		new_version: Number(num(row, 'new_version') ?? 0),
		prior_figures: parseFigures(row['prior_snapshot']),
		new_figures: parseFigures(row['new_snapshot']),
		reason: str(row, 'reason'),
		evidence_reference: str(row, 'evidence_reference'),
		actor_user_id: num(row, 'actor_user_id'),
		actor_name: actorNames.get(Number(num(row, 'actor_user_id') ?? -1)) ?? null,
		created_at: str(row, 'created_at') ?? '',
	};
}

function parseFigures(value: unknown): RevisionFigures {
	const fallback: RevisionFigures = {
		amount: null,
		currency: null,
		classification: null,
		period: null,
		state: null,
		project_code: null,
		project_name: null,
		source_label: null,
	};
	if (value === null || value === undefined) return fallback;
	// The driver usually returns LONGTEXT as a string, but it has been
	// observed returning JSON snapshots already parsed (plain object) or
	// as a Buffer — accept every shape rather than assuming one (the same
	// shapes `loadCloseSnapshot` handles).
	try {
		if (typeof value === 'string') {
			return { ...fallback, ...JSON.parse(value) };
		}
		if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
			return { ...fallback, ...JSON.parse(value.toString('utf8')) };
		}
		if (typeof value === 'object') {
			return { ...fallback, ...(value as Partial<RevisionFigures>) };
		}
	} catch {
		// A stored snapshot that no longer parses reads as unknown figures,
		// never as invented ones.
	}
	return fallback;
}

async function resolveActorNames(
	db: SqlConnection,
	actorIds: Array<number | null>
): Promise<Map<number, string>> {
	const names = new Map<number, string>();
	const ids = [...new Set(actorIds.filter((id): id is number => id !== null))];
	if (ids.length === 0) return names;
	const placeholders = ids.map(() => '?').join(', ');
	const [rows] = (await db.execute(
		`SELECT id, full_name FROM users WHERE id IN (${placeholders})`,
		[...ids]
	)) as [DbRow[], unknown];
	for (const row of rows) {
		const id = num(row, 'id');
		if (id === null) continue;
		names.set(id, str(row, 'full_name') ?? '');
	}
	return names;
}

/**
 * Apply one authorized financial revision in one transaction: the close
 * binding, the version check, the source command, the consumption
 * carry-forward, and the two journal appends commit or roll back together.
 * A stale version, a refused month, or an invalid correction writes nothing;
 * a repeated revision key returns the existing result.
 */
export async function executeRevision(
	input: RevisionCommandInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<RevisionCommandResult> {
	return inTransaction(options, async (db) => {
		if (input.command !== 'update' && input.command !== 'cancel') {
			throw new CostError(
				'revision_command_not_supported',
				'A revision corrects (update) or reverses (cancel) a closed cost',
				422,
				{ command: input.command ?? null }
			);
		}
		const kind = input.targetKind;
		if (kind === 'allocation' || kind === 'payroll') {
			// Payroll attribution keeps its allocation revision contract: it
			// never rewrites a Payroll Slip, and the closed-period guard on
			// that contract stays the authority for closed months.
			throw new CostError(
				'use_allocation_revision',
				'Payroll attribution is corrected through the allocation revision contract, not a financial revision',
				422,
				{ target_kind: kind }
			);
		}
		if (!isRevisionKind(kind)) {
			throw new CostError(
				'invalid_target_kind',
				'A revision targets a direct cost, supplier invoice, accrual, or settlement',
				400,
				{ target_kind: (input.targetKind as unknown) ?? null }
			);
		}
		if (!Number.isInteger(input.expectedVersion)) {
			throw new CostError(
				'version_required',
				'The revision must present the version it read (expected_version)',
				400,
				{ field: 'expected_version' }
			);
		}
		if (!Number.isInteger(input.targetCloseVersion)) {
			throw new CostError(
				'version_required',
				'The revision must present the closed version it targets (target_close_version)',
				400,
				{ field: 'target_close_version' }
			);
		}
		const reason = text(input.reason, 500);
		if (!reason) {
			throw new CostError(
				'reason_required',
				'A reason is required for a financial revision',
				422
			);
		}
		const evidenceReference = text(input.evidenceReference, 500);
		if (!evidenceReference) {
			throw new CostError(
				'evidence_required',
				'An evidence reference is required for a financial revision',
				422
			);
		}
		const revisionUid = text(input.revisionUid, 64) ?? `rev-${randomUUID()}`;

		// A repeated key returns the existing successful result: the second
		// delivery of a revision is not a second revision.
		const repeated = await loadEntryByUid(db, revisionUid);
		if (repeated) return resultOfEntry(repeated, true);

		const id =
			input.id === null || input.id === undefined ? null : Number(input.id);
		const uid = text(input.uid, 64);
		if ((id === null || !Number.isInteger(id)) && !uid) {
			throw new CostError(
				'target_required',
				'A revision names its target by id or by cost/settlement UID',
				400
			);
		}

		// The month must already be closed: an open cost is corrected
		// through the ordinary command path, never a revision.
		const unlabelled = await loadRevisionTarget(db, kind, id, uid, null);
		if (!unlabelled) {
			throw new CostError(
				'not_found',
				'The revision target does not exist',
				404,
				{ target_kind: kind }
			);
		}
		const period = monthOfPeriod(unlabelled.month);
		if (!period || !(await isMonthClosed(db, period))) {
			throw new CostError(
				'revision_not_required',
				'The month is open; correct the cost through the ordinary command path instead of a revision',
				422,
				{ month: unlabelled.month || null }
			);
		}
		const snapshot = await loadCloseSnapshot(db, period);
		if (!snapshot) {
			throw new CostError(
				'revision_not_required',
				'The month is open; correct the cost through the ordinary command path instead of a revision',
				422,
				{ month: period }
			);
		}
		if (snapshot.financial_version !== input.targetCloseVersion) {
			throw new CostError(
				'stale_version',
				`The close moved on since it was read (current version ${snapshot.financial_version})`,
				409,
				{ current_version: snapshot.financial_version }
			);
		}
		// Re-read with the frozen snapshot behind the labels, so the prior
		// figures carry the identities the month closed with even when a
		// master has since been renamed or soft-deleted.
		const preTarget = await loadRevisionTarget(db, kind, id, uid, snapshot);
		if (!preTarget) {
			throw new CostError(
				'not_found',
				'The revision target does not exist',
				404,
				{ target_kind: kind }
			);
		}
		if (preTarget.version !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				`This cost changed since it was read (current version ${preTarget.version})`,
				409,
				{ current_version: preTarget.version }
			);
		}
		if (kind === 'accrual' && preTarget.replacedAmount > 0) {
			// A partly or fully replaced accrual is already superseded by
			// its replacement chain; revising it as well would count the
			// estimate twice.
			throw new CostError(
				'revision_replaced_accrual',
				'This accrual is superseded by a replacement; correct the replacement chain instead',
				409
			);
		}
		const patch = { ...(input.patch ?? {}) } as Record<string, unknown>;
		const patchProject =
			patch.projectId === null || patch.projectId === undefined
				? null
				: Number(patch.projectId);
		if (patchProject !== null) {
			// A correction never resurrects a soft-deleted Project: the
			// destination must be live now, while history keeps its frozen
			// labels.
			const [projectRows] = (await db.execute(
				`SELECT 1 FROM projects WHERE project_id = ? AND isDelete = 0 LIMIT 1`,
				[patchProject]
			)) as [unknown[], unknown];
			if (projectRows.length === 0) {
				throw new CostError(
					'unknown_project',
					`Project ${patchProject} is not a live Project`,
					422,
					{ project_id: patchProject }
				);
			}
		}

		const revision: ClosedRevision = {
			closeUid: snapshot.close_uid,
			revisionUid,
			sourceMonth: period,
		};
		const commandOptions = { connection: db, revision };
		let newVersion = preTarget.version + 1;
		let postPeriod: string | null = null;
		if (kind === 'direct') {
			const result = await executeCommand(
				{
					id: preTarget.sourceId,
					command: input.command,
					expectedVersion: input.expectedVersion,
					reason,
					evidenceReference,
					patch: patch as CostPatch,
				},
				actor,
				commandOptions
			);
			newVersion = result.financial_version;
			postPeriod = result.recognition_period;
		} else if (kind === 'supplier') {
			const result = await executeSupplierCommand(
				{
					id: preTarget.sourceId,
					command: input.command,
					expectedVersion: input.expectedVersion,
					reason,
					evidenceReference,
					patch: patch as SupplierInvoicePatch,
				},
				actor,
				commandOptions
			);
			newVersion = result.financial_version;
			postPeriod = result.recognition_period;
		} else if (kind === 'accrual') {
			const result = await executeAccrualCommand(
				{
					id: preTarget.sourceId,
					command: input.command,
					expectedVersion: input.expectedVersion,
					reason,
					evidenceReference,
					patch: patch as AccrualPatch,
				},
				actor,
				commandOptions
			);
			newVersion = result.financial_version;
			postPeriod = result.recognition_period;
		} else {
			const result = await executeSettlementCommand(
				{
					id: preTarget.sourceId,
					command: input.command,
					expectedVersion: input.expectedVersion,
					reason,
					evidenceReference,
					patch: patch as {
						amount?: number | null;
						currency?: string | null;
						settledOn?: string | null;
						reference?: string | null;
						destination?: string | null;
						evidenceReference?: string | null;
					},
				},
				actor,
				commandOptions
			);
			newVersion = result.financial_version;
			postPeriod = result.settled_on;
		}

		const consumptions =
			kind === 'settlement'
				? []
				: await reconcileConsumptions(db, {
						costUid: preTarget.uid,
						command: input.command,
						postPeriod,
						newVersion,
						patch,
						reason,
						evidenceReference,
						actorId: actor.id,
						revision,
					});

		const postTarget = await loadRevisionTarget(
			db,
			kind,
			preTarget.sourceId,
			null,
			snapshot
		);
		if (!postTarget) {
			throw new CostError(
				'revision_failed',
				'The revision applied but its result cannot be read back',
				500
			);
		}
		const journalCommand = input.command === 'cancel' ? 'cancelled' : 'updated';
		let headerId = 0;
		try {
			const [inserted] = (await db.execute(
				`INSERT INTO financial_revision_events
            (revision_uid, month, close_uid, close_version, target_kind,
             target_uid, source_table, source_id, command, prior_version,
             new_version, prior_snapshot, new_snapshot, reason,
             evidence_reference, actor_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					revisionUid,
					period,
					snapshot.close_uid,
					snapshot.financial_version,
					kind === 'settlement' ? 'settlement' : 'cost',
					preTarget.uid,
					preTarget.sourceTable,
					preTarget.sourceId,
					journalCommand,
					preTarget.version,
					newVersion,
					JSON.stringify(preTarget.figures),
					JSON.stringify(postTarget.figures),
					reason,
					evidenceReference,
					actor.id,
				]
			)) as [{ insertId?: number }, unknown];
			headerId = Number(inserted?.insertId ?? 0);
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				// A competing revision won the unique key between the repeat
				// check and the insert: one coherent version exists.
				const winner = await loadEntryByUid(db, revisionUid);
				if (winner) return resultOfEntry(winner, true);
				throw new CostError(
					'version_conflict',
					'A competing revision was applied first (version conflict)',
					409
				);
			}
			throw error;
		}

		return {
			id: headerId,
			revision_uid: revisionUid,
			month: period,
			close_uid: snapshot.close_uid,
			close_version: snapshot.financial_version,
			target_kind: kind,
			target_uid: preTarget.uid,
			target_label: preTarget.label,
			command: journalCommand,
			prior_version: preTarget.version,
			new_version: newVersion,
			prior_figures: preTarget.figures,
			new_figures: postTarget.figures,
			repeated: false,
			consumptions,
		};
	});
}

/* ── history + candidates ──────────────────────────────────────────── */

/** Every accepted revision of one closed month, oldest first. */
export async function loadRevisionHistory(
	db: SqlConnection,
	month: string
): Promise<RevisionHistoryEntry[]> {
	const [rows] = (await db.execute(
		`SELECT id, revision_uid, month, close_uid, close_version, target_kind,
           target_uid, source_table, source_id, command, prior_version,
           new_version, prior_snapshot, new_snapshot, reason,
           evidence_reference, actor_user_id, created_at
      FROM financial_revision_events
     WHERE month = ? AND isDelete = 0
     ORDER BY id ASC`,
		[month]
	)) as [DbRow[], unknown];
	const entries = rows as DbRow[];
	const actorNames = await resolveActorNames(
		db,
		entries.map((row) => num(row, 'actor_user_id'))
	);
	const labels = new Map<string, string | null>();
	const costUids = [
		...new Set(
			entries
				.filter((row) => str(row, 'target_kind') === 'cost')
				.map((row) => str(row, 'target_uid') ?? '')
				.filter((uid) => uid.length > 0)
		),
	];
	if (costUids.length > 0) {
		const placeholders = costUids.map(() => '?').join(', ');
		for (const table of ['expenses', 'purchase_invoices', 'cost_accruals']) {
			const numberColumn =
				table === 'expenses'
					? 'expense_number'
					: table === 'purchase_invoices'
						? 'invoice_number'
						: 'accrual_number';
			const [labelRows] = (await db.execute(
				`SELECT cost_uid, ${numberColumn} AS number FROM ${table}
          WHERE cost_uid IN (${placeholders})`,
				[...costUids]
			)) as [DbRow[], unknown];
			for (const labelRow of labelRows as DbRow[]) {
				const uid = str(labelRow, 'cost_uid') ?? '';
				if (!labels.has(uid)) labels.set(uid, str(labelRow, 'number'));
			}
		}
		const [settlementRows] = (await db.execute(
			`SELECT settlement_uid, reference FROM financial_settlements
       WHERE settlement_uid IN (${placeholders})`,
			[...costUids]
		)) as [DbRow[], unknown];
		for (const labelRow of settlementRows as DbRow[]) {
			const uid = str(labelRow, 'settlement_uid') ?? '';
			if (!labels.has(uid)) labels.set(uid, str(labelRow, 'reference'));
		}
	}
	return entries.map((row) => {
		const actorId = num(row, 'actor_user_id');
		return {
			id: Number(num(row, 'id') ?? 0),
			revision_uid: str(row, 'revision_uid') ?? '',
			month: str(row, 'month') ?? '',
			close_uid: str(row, 'close_uid') ?? '',
			close_version: Number(num(row, 'close_version') ?? 0),
			target_kind: (str(row, 'target_kind') ??
				'cost') as RevisionHistoryEntry['target_kind'],
			target_uid: str(row, 'target_uid') ?? '',
			target_label: labels.get(str(row, 'target_uid') ?? '') ?? null,
			source_table: str(row, 'source_table') ?? '',
			command: (str(row, 'command') ??
				'updated') as RevisionHistoryEntry['command'],
			prior_version: Number(num(row, 'prior_version') ?? 0),
			new_version: Number(num(row, 'new_version') ?? 0),
			prior_figures: parseFigures(row['prior_snapshot']),
			new_figures: parseFigures(row['new_snapshot']),
			reason: str(row, 'reason'),
			evidence_reference: str(row, 'evidence_reference'),
			actor_user_id: actorId,
			actor_name: actorId === null ? null : (actorNames.get(actorId) ?? null),
			created_at: str(row, 'created_at') ?? '',
		};
	});
}

/**
 * The costs and settlements a revision control can offer for one month:
 * recognized costs (any revisable state flows through the version check)
 * and recorded settlements, with the versions a revision must present.
 * Project labels are the frozen display, not an operational filter: a
 * soft-deleted Project's costs stay revisable and stay labelled.
 */
export async function loadRevisionCandidates(
	db: SqlConnection,
	month: string
): Promise<RevisionCandidate[]> {
	const candidates: RevisionCandidate[] = [];
	const costQueries: Array<{
		kind: RevisionTargetKind;
		sql: string;
		params: Array<string | number | boolean | null>;
	}> = [
		{
			kind: 'direct',
			sql: `SELECT e.id, e.cost_uid AS uid, e.expense_number AS number,
                e.total_amount AS amount, e.currency, e.cost_classification AS classification,
                e.recognition_period AS period, e.recognition_state AS state,
                e.financial_version AS version, e.project_id,
                p.project_code, COALESCE(p.project_title, p.name) AS project_name
           FROM expenses e
           LEFT JOIN projects p ON p.project_id = e.project_id
          WHERE LEFT(e.recognition_period, 7) = ? AND e.isDelete = 0
            AND e.recognition_state = 'recognized'`,
			params: [month],
		},
		{
			kind: 'supplier',
			sql: `SELECT i.id, i.cost_uid AS uid, i.invoice_number AS number,
                i.total AS amount, i.currency, i.cost_classification AS classification,
                i.recognition_period AS period, i.recognition_state AS state,
                i.financial_version AS version, i.project_id,
                p.project_code, COALESCE(p.project_title, p.name) AS project_name
           FROM purchase_invoices i
           LEFT JOIN projects p ON p.project_id = i.project_id
          WHERE LEFT(i.recognition_period, 7) = ? AND i.isDelete = 0
            AND i.recognition_state = 'recognized'`,
			params: [month],
		},
		{
			kind: 'accrual',
			sql: `SELECT a.id, a.cost_uid AS uid, a.accrual_number AS number,
                a.gross_amount AS amount, a.currency, a.cost_classification AS classification,
                a.recognition_period AS period, a.recognition_state AS state,
                a.financial_version AS version, a.project_id,
                p.project_code, COALESCE(p.project_title, p.name) AS project_name
           FROM cost_accruals a
           LEFT JOIN projects p ON p.project_id = a.project_id
          WHERE LEFT(a.recognition_period, 7) = ? AND a.isDelete = 0
            AND a.recognition_state = 'recognized'`,
			params: [month],
		},
	];
	for (const query of costQueries) {
		const [rows] = (await db.execute(query.sql, query.params)) as [
			DbRow[],
			unknown,
		];
		for (const row of rows) {
			candidates.push({
				kind: query.kind,
				id: Number(num(row, 'id') ?? 0),
				uid: str(row, 'uid') ?? '',
				number: str(row, 'number') ?? '',
				amount: num(row, 'amount'),
				currency: str(row, 'currency'),
				classification: str(row, 'classification'),
				period: str(row, 'period'),
				state: str(row, 'state') ?? '',
				version: Number(num(row, 'version') ?? 1),
				project_code: str(row, 'project_code'),
				project_name: str(row, 'project_name'),
				has_consumption: false,
			});
		}
	}
	const [settlementRows] = (await db.execute(
		`SELECT id, settlement_uid AS uid, reference AS number, amount, currency,
           settled_on AS period, status AS state, financial_version AS version
      FROM financial_settlements
     WHERE LEFT(settled_on, 7) = ? AND isDelete = 0 AND status = 'recorded'`,
		[month]
	)) as [DbRow[], unknown];
	for (const row of settlementRows as DbRow[]) {
		candidates.push({
			kind: 'settlement',
			id: Number(num(row, 'id') ?? 0),
			uid: str(row, 'uid') ?? '',
			number: str(row, 'number') ?? '',
			amount: num(row, 'amount'),
			currency: str(row, 'currency'),
			classification: null,
			period: str(row, 'period'),
			state: str(row, 'state') ?? '',
			version: Number(num(row, 'version') ?? 1),
			project_code: null,
			project_name: null,
			has_consumption: false,
		});
	}
	const uids = candidates
		.filter((candidate) => candidate.kind !== 'settlement')
		.map((candidate) => candidate.uid);
	if (uids.length > 0) {
		const placeholders = uids.map(() => '?').join(', ');
		const [consumed] = (await db.execute(
			`SELECT DISTINCT cost_uid FROM order_consumptions
       WHERE state = 'active' AND cost_uid IN (${placeholders})`,
			[...uids]
		)) as [DbRow[], unknown];
		const consumedSet = new Set(
			(consumed as DbRow[]).map((row) => str(row, 'cost_uid') ?? '')
		);
		for (const candidate of candidates) {
			if (consumedSet.has(candidate.uid)) candidate.has_consumption = true;
		}
	}
	return candidates.sort((a, b) =>
		a.number < b.number ? -1 : a.number > b.number ? 1 : 0
	);
}

/**
 * The revision state as the report and the revision route publish it: the
 * month's open/closed status, the frozen close it targets, the frozen prior
 * totals beside the live updated totals, the revisable candidates, and every
 * accepted revision. One builder serves both publishers so the two responses
 * cannot drift.
 */
export interface RevisionPayload {
	month: string;
	status: 'open' | 'closed';
	close_uid: string | null;
	close_version: number;
	prior: {
		incurred_cost: number | null;
		currency: string | null;
	} | null;
	current: {
		incurred_cost: number | null;
		currency: string | null;
	};
	candidates: RevisionCandidate[];
	revisions: RevisionHistoryEntry[];
}

export function buildRevisionPayload(input: {
	month: string;
	snapshot: CloseSnapshot | null;
	reconciliation: CompanyReconciliation;
	candidates: RevisionCandidate[];
	revisions: RevisionHistoryEntry[];
}): RevisionPayload {
	const { month, snapshot, reconciliation, candidates, revisions } = input;
	return {
		month,
		status: snapshot ? 'closed' : 'open',
		close_uid: snapshot?.close_uid ?? null,
		close_version: snapshot?.financial_version ?? 0,
		prior: snapshot
			? {
					incurred_cost: snapshot.snapshot?.company.incurred_cost ?? null,
					currency: snapshot.snapshot?.company.currency ?? null,
				}
			: null,
		current: {
			incurred_cost: reconciliation.company.incurred_cost,
			currency: reconciliation.company.currency,
		},
		candidates,
		revisions,
	};
}
