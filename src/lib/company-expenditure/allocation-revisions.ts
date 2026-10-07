/**
 * Project Cost Allocation Revision — ADR-0016, ticket #309.
 *
 * A revision corrects *how* a finalized Payroll Slip's recorded employer cost
 * is attributed to Projects. It never changes the amount: the corrected
 * destinations are given as monthly Logged Hours, re-run through the single
 * frozen rule `allocateEmployerCost` (#307), and the new immutable version
 * sums exactly to the same `payroll_slips.employer_cost` the previous version
 * summed to. The Payroll Slip, the Payroll Run, and every payment/reopen rule
 * are untouched — corrections of a `paid` month stay possible while the paid
 * month itself stays permanent.
 *
 * Every version is appended, never updated: `payroll_employee_allocations`
 * gains the next `version` with `kind = 'revision'`, the shares are ordinary
 * `payroll_employee_allocation_shares` rows, and `payroll_allocation_events`
 * gains one `revised` row carrying the actor, reason, evidence reference, and
 * a snapshot with the previous and revised figures. The selected version stays
 * the highest `version`, exactly the read #307 already performs.
 *
 * The financial-period seam for the later close slice (#322) is
 * `registerAllocationMutationGuard`: a guard runs inside the revision
 * transaction and refuses (writing nothing) when its period state forbids the
 * correction. No guard is registered while no close module exists.
 */

import {
	allocateEmployerCost,
	PAYROLL_CURRENCY,
	type AllocationLine,
} from './payroll';
import { CostError } from './errors';
import { inTransaction, type CommandOptions } from './commands';
import type { SqlConnection } from './records';
import { add, R, toNumber } from '@/lib/money';
import type { ResultSetHeader } from 'mysql2/promise';
import type { PayrollProjectShare } from './types';

/** One corrected destination. `project_id: null` is No project. */
export interface AllocationRevisionLine {
	project_id: number | null;
	hours: number;
}

export interface ReviseAllocationInput {
	/** `payroll_slips.id` of the allocation being corrected. */
	payrollSlipId: number;
	/** The allocation version the caller saw (MAX(version) for the slip). */
	expectedVersion: number;
	reason: string;
	evidenceReference: string;
	/**
	 * The corrected monthly attribution. Every line states positive hours for a
	 * live Project (`project_id`) or for hours without a Project (`null`); an
	 * empty list states that the month has no eligible Logged Hours, so the
	 * whole recorded cost stays unallocated.
	 */
	lines: readonly AllocationRevisionLine[];
}

export interface AllocationVersionSnapshot {
	version: number;
	allocation_uid: string;
	kind: 'finalization' | 'reconstruction' | 'revision';
	recorded_employer_cost: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	shares: PayrollProjectShare[];
}

export interface AllocationRevisionResult {
	allocation_uid: string;
	version: number;
	kind: 'revision';
	payroll_slip_id: number;
	month: string;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	pay_stream: 'payroll' | 'contract';
	recorded_employer_cost: number;
	currency: string;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	shares: PayrollProjectShare[];
	previous: AllocationVersionSnapshot;
	actor_user_id: number | null;
	revised_at: string;
}

export interface AllocationVersionView extends AllocationVersionSnapshot {
	frozen_at: string;
	frozen_by: number | null;
	actor_name: string | null;
	command: string | null;
	reason: string | null;
	evidence_reference: string | null;
	journal_at: string | null;
	/** The next version for the slip, or null when this is the selected one. */
	superseded_by: number | null;
	/** `SUM(shares.amount) === recorded_employer_cost`. */
	reconciles: boolean;
}

export interface AllocationRevisionHistory {
	payroll_slip_id: number;
	month: string;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	currency: string;
	selected_version: number;
	versions: AllocationVersionView[];
}

/** A registered financial-period refusal; the command writes nothing. */
export interface AllocationMutationRefusal {
	code: string;
	message: string;
	status: number;
	detail?: Record<string, unknown>;
}

/**
 * The financial-period seam: a guard that can refuse an allocation mutation
 * for a month. #322 (financial close) registers its closed-month check here;
 * guards run inside the revision transaction before any write.
 */
export type AllocationMutationGuard = (
	db: SqlConnection,
	monthDay: string
) => Promise<AllocationMutationRefusal | null>;

const mutationGuards: AllocationMutationGuard[] = [];

/** Register a financial-period guard consulted by every allocation mutation. */
export function registerAllocationMutationGuard(
	guard: AllocationMutationGuard
): void {
	mutationGuards.push(guard);
}

/* ── row shapes ────────────────────────────────────────────────────── */

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

function round2(value: number): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

interface SlipRow {
	id: number;
	employeeId: number;
	month: string;
	employerCost: number;
}

interface AllocationRow {
	id: number;
	allocationUid: string;
	version: number;
	kind: AllocationVersionSnapshot['kind'];
	recordedEmployerCost: number;
	currency: string;
	totalLoggedHours: number;
	projectHours: number;
	noProjectHours: number;
	roundingAdjustment: number;
	payStream: 'payroll' | 'contract';
	employeeCode: string;
	employeeName: string;
	frozenAt: string;
	frozenBy: number | null;
}

function mapAllocationRow(row: DbRow): AllocationRow {
	return {
		id: Number(num(row, 'id') ?? 0),
		allocationUid: str(row, 'allocation_uid') ?? '',
		version: Number(num(row, 'version') ?? 1),
		kind: (str(row, 'kind') ?? 'finalization') as AllocationRow['kind'],
		recordedEmployerCost: Number(num(row, 'recorded_employer_cost') ?? 0),
		currency: str(row, 'currency') ?? PAYROLL_CURRENCY,
		totalLoggedHours: Number(num(row, 'total_logged_hours') ?? 0),
		projectHours: Number(num(row, 'project_hours') ?? 0),
		noProjectHours: Number(num(row, 'no_project_hours') ?? 0),
		roundingAdjustment: Number(num(row, 'rounding_adjustment') ?? 0),
		payStream: (str(row, 'pay_stream') ?? 'payroll') as 'payroll' | 'contract',
		employeeCode: str(row, 'employee_code') ?? '',
		employeeName: str(row, 'employee_name') ?? '',
		frozenAt: str(row, 'frozen_at') ?? '',
		frozenBy: num(row, 'frozen_by'),
	};
}

const ALLOCATION_COLUMNS = `id, allocation_uid, version, kind,
  recorded_employer_cost, currency, total_logged_hours, project_hours,
  no_project_hours, rounding_adjustment, pay_stream, employee_code,
  employee_name, frozen_at, frozen_by`;

async function loadSharesForAllocations(
	db: SqlConnection,
	allocationIds: readonly number[]
): Promise<Map<number, PayrollProjectShare[]>> {
	const shares = new Map<number, PayrollProjectShare[]>();
	if (allocationIds.length === 0) return shares;
	const placeholders = allocationIds.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`SELECT allocation_id, project_id, project_code, project_name,
            client_name, hours, amount, rounding_adjustment, basis
       FROM payroll_employee_allocation_shares
      WHERE allocation_id IN (${placeholders})
      ORDER BY id`,
		[...allocationIds]
	);
	for (const row of rows as DbRow[]) {
		const allocationId = num(row, 'allocation_id');
		if (allocationId === null) continue;
		const list = shares.get(allocationId) ?? [];
		list.push({
			project_id: num(row, 'project_id'),
			project_code: str(row, 'project_code'),
			project_name: str(row, 'project_name'),
			client_name: str(row, 'client_name'),
			hours: Number(num(row, 'hours') ?? 0),
			amount: Number(num(row, 'amount') ?? 0),
			rounding_adjustment: Number(num(row, 'rounding_adjustment') ?? 0),
			basis: (str(row, 'basis') ?? 'project') as PayrollProjectShare['basis'],
		});
		shares.set(allocationId, list);
	}
	return shares;
}

function snapshotOf(
	row: AllocationRow,
	shares: PayrollProjectShare[]
): AllocationVersionSnapshot {
	return {
		version: row.version,
		allocation_uid: row.allocationUid,
		kind: row.kind,
		recorded_employer_cost: row.recordedEmployerCost,
		total_logged_hours: row.totalLoggedHours,
		project_hours: row.projectHours,
		no_project_hours: row.noProjectHours,
		rounding_adjustment: row.roundingAdjustment,
		shares,
	};
}

/* ── the revision command ──────────────────────────────────────────── */

interface ValidatedLine extends AllocationLine {
	hours: number;
}

async function loadLiveProjects(
	db: SqlConnection,
	projectIds: readonly number[]
): Promise<
	Map<
		number,
		{ code: string | null; name: string | null; client: string | null }
	>
> {
	const projects = new Map<
		number,
		{ code: string | null; name: string | null; client: string | null }
	>();
	if (projectIds.length === 0) return projects;
	const placeholders = projectIds.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`SELECT project_id, project_code, COALESCE(project_title, name) AS project_name,
            client_name
       FROM projects
      WHERE project_id IN (${placeholders}) AND isDelete = 0`,
		[...projectIds]
	);
	for (const row of rows as DbRow[]) {
		const projectId = num(row, 'project_id');
		if (projectId === null) continue;
		projects.set(projectId, {
			code: str(row, 'project_code'),
			name: str(row, 'project_name'),
			client: str(row, 'client_name'),
		});
	}
	return projects;
}

/** Validate the corrected lines and attach the live Project identity. */
async function validateLines(
	db: SqlConnection,
	lines: unknown
): Promise<ValidatedLine[]> {
	if (!Array.isArray(lines)) {
		throw new CostError(
			'invalid_lines',
			'lines must be an array of { project_id, hours } destinations',
			422
		);
	}
	const normalized: Array<{ projectId: number | null; hours: number }> = [];
	const seen = new Set<string>();
	for (const entry of lines as unknown[]) {
		if (entry === null || typeof entry !== 'object') {
			throw new CostError(
				'invalid_lines',
				'Each line must be an object with project_id and hours',
				422
			);
		}
		const record = entry as Record<string, unknown>;
		const rawProject = record.project_id;
		const projectId =
			rawProject === null || rawProject === undefined
				? null
				: Number(rawProject);
		if (
			projectId !== null &&
			(!Number.isInteger(projectId) || projectId <= 0)
		) {
			throw new CostError(
				'invalid_lines',
				'project_id must be a positive Project id or null for No project',
				422
			);
		}
		const hours = Number(record.hours);
		if (!Number.isFinite(hours) || hours <= 0) {
			throw new CostError(
				'invalid_lines',
				'Every destination states positive hours; omit a destination that has none',
				422
			);
		}
		const rounded = round2(hours);
		if (rounded <= 0) {
			throw new CostError(
				'invalid_lines',
				'Hours round to zero; omit that destination instead',
				422
			);
		}
		const key = projectId === null ? 'no-project' : String(projectId);
		if (seen.has(key)) {
			throw new CostError(
				'duplicate_destination',
				'The same destination is stated more than once',
				422,
				{ project_id: projectId }
			);
		}
		seen.add(key);
		normalized.push({ projectId, hours: rounded });
	}

	const projectIds = normalized
		.map((line) => line.projectId)
		.filter((id): id is number => id !== null);
	const projects = await loadLiveProjects(db, projectIds);
	for (const projectId of projectIds) {
		if (!projects.has(projectId)) {
			throw new CostError(
				'unknown_project',
				`Project ${projectId} is not a live Project`,
				422,
				{ project_id: projectId }
			);
		}
	}
	return normalized
		.map((line) => {
			const identity =
				line.projectId === null ? null : projects.get(line.projectId)!;
			return {
				project_id: line.projectId,
				project_code: identity?.code ?? null,
				project_name: identity?.name ?? null,
				client_name: identity?.client ?? null,
				hours: line.hours,
			};
		})
		.sort((a, b) => {
			if (a.project_id === b.project_id) return 0;
			if (a.project_id === null) return 1;
			if (b.project_id === null) return -1;
			return a.project_id - b.project_id;
		});
}

/**
 * Apply one authorized Project Cost Allocation Revision in one transaction:
 * the slip lock, the run/version checks, every registered period guard, the
 * corrected-cent allocation, and the appended version + journal row commit or
 * roll back together. A stale version, a refused period, or an invalid line
 * writes nothing; a repeated command is stale by definition.
 */
export async function reviseEmployeeAllocation(
	input: ReviseAllocationInput,
	actor: { id: number | null },
	options?: CommandOptions
): Promise<AllocationRevisionResult> {
	return inTransaction(options, async (db) => {
		// Lock the slip first: a concurrent revision (or a re-finalization) on
		// this slip serializes behind it, so version numbers cannot race.
		const [slipRows] = await db.execute(
			`SELECT id, employee_id, month, employer_cost
         FROM payroll_slips WHERE id = ? FOR UPDATE`,
			[input.payrollSlipId]
		);
		const slipRow = (slipRows as DbRow[])[0];
		if (!slipRow) {
			throw new CostError('slip_not_found', 'Payroll Slip not found', 404);
		}
		const slip: SlipRow = {
			id: Number(num(slipRow, 'id') ?? 0),
			employeeId: Number(num(slipRow, 'employee_id') ?? 0),
			month: (str(slipRow, 'month') ?? '').slice(0, 10),
			employerCost: Number(num(slipRow, 'employer_cost') ?? 0),
		};

		const [allocationRows] = await db.execute(
			`SELECT ${ALLOCATION_COLUMNS} FROM payroll_employee_allocations
        WHERE payroll_slip_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
			[slip.id]
		);
		const latestRow = (allocationRows as DbRow[])[0];
		if (!latestRow) {
			throw new CostError(
				'allocation_missing',
				'This Payroll Slip has no frozen Project allocation to revise',
				409
			);
		}
		const latest = mapAllocationRow(latestRow);
		if (latest.version !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				`This allocation changed since it was read (current version ${latest.version})`,
				409,
				{ current_version: latest.version }
			);
		}

		const [year, monthNumber] = slip.month.split('-').map(Number);
		const [runRows] = await db.execute(
			`SELECT status FROM payroll_runs
        WHERE year = ? AND month = ? ORDER BY run_number DESC LIMIT 1`,
			[year, monthNumber]
		);
		const runStatus = str((runRows as DbRow[])[0] ?? {}, 'status');
		if (runStatus !== 'finalized' && runStatus !== 'paid') {
			throw new CostError(
				'run_not_locked',
				'The month’s Payroll Run is not locked; finalize it before revising the allocation',
				409,
				{ run_status: runStatus }
			);
		}

		// Financial-period seam (#322 registers its closed-month check here).
		for (const guard of mutationGuards) {
			const refusal = await guard(db, slip.month);
			if (refusal) {
				throw new CostError(
					refusal.code,
					refusal.message,
					refusal.status,
					refusal.detail
				);
			}
		}

		const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
		if (!reason || reason.length > 500) {
			throw new CostError(
				'reason_required',
				'A reason is required for an allocation revision',
				422
			);
		}
		const evidence =
			typeof input.evidenceReference === 'string'
				? input.evidenceReference.trim()
				: '';
		if (!evidence || evidence.length > 500) {
			throw new CostError(
				'evidence_required',
				'An evidence reference is required for an allocation revision',
				422
			);
		}
		const lines = await validateLines(db, input.lines);

		const outcome = allocateEmployerCost(slip.employerCost, lines);
		// The rule sums exactly to the slip; a mismatch would be a rule bug, not
		// a user error, and must never be persisted.
		const newTotal = toNumber(
			outcome.shares
				.reduce((sum, share) => add(sum, share.amount), R(0))
				.toDecimalPlaces(2)
		);
		if (R(newTotal).comparedTo(R(round2(slip.employerCost))) !== 0) {
			throw new CostError(
				'reconciliation_failed',
				'The revised shares do not reconcile to the recorded employer cost',
				500,
				{ expected: round2(slip.employerCost), actual: newTotal }
			);
		}

		const version = latest.version + 1;
		const allocationUid = `payroll-alloc-${slip.id}-v${version}`;
		const projectHours = outcome.shares
			.filter((share) => share.basis === 'project')
			.reduce((sum, share) => add(sum, share.hours), R(0));
		const noProjectHours = outcome.shares
			.filter((share) => share.basis === 'no_project')
			.reduce((sum, share) => add(sum, share.hours), R(0));

		let allocationId = 0;
		try {
			const [inserted] = await db.execute(
				`INSERT INTO payroll_employee_allocations
           (allocation_uid, payroll_slip_id, month, employee_id, employee_code,
            employee_name, pay_stream, version, kind, recorded_employer_cost,
            currency, total_logged_hours, project_hours, no_project_hours,
            rounding_adjustment, frozen_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'revision', ?, ?, ?, ?, ?, ?, ?)`,
				[
					allocationUid,
					slip.id,
					slip.month,
					slip.employeeId,
					latest.employeeCode,
					latest.employeeName,
					latest.payStream,
					version,
					round2(slip.employerCost),
					PAYROLL_CURRENCY,
					toNumber(
						outcome.shares
							.reduce((sum, share) => add(sum, share.hours), R(0))
							.toDecimalPlaces(2)
					),
					toNumber(projectHours.toDecimalPlaces(2)),
					toNumber(noProjectHours.toDecimalPlaces(2)),
					outcome.roundingAdjustment,
					actor.id,
				]
			);
			// `SqlConnection.execute` types its result as unknown; a successful
			// INSERT is a mysql2 ResultSetHeader carrying the new row's id.
			allocationId = Number((inserted as ResultSetHeader).insertId ?? 0);
		} catch (error) {
			// mysql2 reports the unique_slip_allocation_version race as a
			// duplicate key: a concurrent revision won, so this command is stale.
			const duplicateKey =
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				error.code === 'ER_DUP_ENTRY';
			if (duplicateKey) {
				throw new CostError(
					'version_conflict',
					'Another revision was applied first (version conflict)',
					409
				);
			}
			throw error;
		}

		for (const share of outcome.shares) {
			await db.execute(
				`INSERT INTO payroll_employee_allocation_shares
           (allocation_id, project_id, project_code, project_name, client_name,
            hours, amount, rounding_adjustment, basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					allocationId,
					share.project_id,
					share.project_code,
					share.project_name,
					share.client_name,
					share.hours,
					share.amount,
					share.rounding_adjustment,
					share.basis,
				]
			);
		}

		const previousShares = await loadSharesForAllocations(db, [latest.id]);
		const previous = snapshotOf(latest, previousShares.get(latest.id) ?? []);

		await db.execute(
			`INSERT INTO payroll_allocation_events
         (allocation_uid, source_table, source_id, version, command, actor_user_id,
          reason, evidence_reference, snapshot)
       VALUES (?, 'payroll_slips', ?, ?, 'revised', ?, ?, ?, ?)`,
			[
				allocationUid,
				slip.id,
				version,
				actor.id,
				reason,
				evidence,
				JSON.stringify({
					payroll_slip_id: slip.id,
					month: slip.month,
					employee_id: slip.employeeId,
					recorded_employer_cost: round2(slip.employerCost),
					previous_version: latest.version,
					previous_allocation_uid: latest.allocationUid,
					previous,
					corrected_lines: lines.map((line) => ({
						project_id: line.project_id,
						hours: line.hours,
					})),
					revised: {
						shares: outcome.shares,
						rounding_adjustment: outcome.roundingAdjustment,
						total_logged_hours: toNumber(
							outcome.shares
								.reduce((sum, share) => add(sum, share.hours), R(0))
								.toDecimalPlaces(2)
						),
						project_hours: toNumber(projectHours.toDecimalPlaces(2)),
						no_project_hours: toNumber(noProjectHours.toDecimalPlaces(2)),
					},
				}),
			]
		);

		const [eventRows] = (await db.execute(
			`SELECT created_at FROM payroll_allocation_events
        WHERE allocation_uid = ? AND version = ?`,
			[allocationUid, version]
		)) as [DbRow[], unknown];

		return {
			allocation_uid: allocationUid,
			version,
			kind: 'revision',
			payroll_slip_id: slip.id,
			month: slip.month.slice(0, 7),
			employee_id: slip.employeeId,
			employee_code: latest.employeeCode,
			employee_name: latest.employeeName,
			pay_stream: latest.payStream,
			recorded_employer_cost: round2(slip.employerCost),
			currency: PAYROLL_CURRENCY,
			total_logged_hours: toNumber(
				outcome.shares
					.reduce((sum, share) => add(sum, share.hours), R(0))
					.toDecimalPlaces(2)
			),
			project_hours: toNumber(projectHours.toDecimalPlaces(2)),
			no_project_hours: toNumber(noProjectHours.toDecimalPlaces(2)),
			rounding_adjustment: outcome.roundingAdjustment,
			shares: outcome.shares,
			previous,
			actor_user_id: actor.id,
			revised_at: str(eventRows[0] ?? {}, 'created_at') ?? '',
		};
	});
}

/* ── history read ──────────────────────────────────────────────────── */

interface EventRow {
	allocationUid: string;
	version: number;
	command: string | null;
	actorUserId: number | null;
	reason: string | null;
	evidenceReference: string | null;
	createdAt: string | null;
}

/**
 * The slip's full version history: every frozen allocation with its shares,
 * the journal row that produced it, and who produced it. Read-only and safe on
 * any connection; the selected version stays the highest one.
 */
export async function loadAllocationRevisionHistory(
	db: SqlConnection,
	payrollSlipId: number
): Promise<AllocationRevisionHistory | null> {
	const [slipRows] = await db.execute(
		`SELECT id, employee_id, month FROM payroll_slips WHERE id = ?`,
		[payrollSlipId]
	);
	const slipRow = (slipRows as DbRow[])[0];
	if (!slipRow) return null;
	const slipId = Number(num(slipRow, 'id') ?? 0);
	const employeeId = Number(num(slipRow, 'employee_id') ?? 0);
	const month = (str(slipRow, 'month') ?? '').slice(0, 7);

	const [allocationRows] = await db.execute(
		`SELECT ${ALLOCATION_COLUMNS} FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? ORDER BY version`,
		[slipId]
	);
	const allocations = (allocationRows as DbRow[]).map(mapAllocationRow);
	if (allocations.length === 0) {
		throw new CostError(
			'allocation_missing',
			'This Payroll Slip has no frozen Project allocation history',
			409
		);
	}
	const sharesByAllocation = await loadSharesForAllocations(
		db,
		allocations.map((allocation) => allocation.id)
	);

	const uids = allocations.map((allocation) => allocation.allocationUid);
	const placeholders = uids.map(() => '?').join(', ');
	const [eventRows] = await db.execute(
		`SELECT allocation_uid, version, command, actor_user_id, reason,
            evidence_reference, created_at
       FROM payroll_allocation_events
      WHERE allocation_uid IN (${placeholders})
      ORDER BY id`,
		[...uids]
	);
	const events = new Map<string, EventRow>();
	for (const row of eventRows as DbRow[]) {
		const uid = str(row, 'allocation_uid') ?? '';
		events.set(`${uid}:${Number(num(row, 'version') ?? 0)}`, {
			allocationUid: uid,
			version: Number(num(row, 'version') ?? 0),
			command: str(row, 'command'),
			actorUserId: num(row, 'actor_user_id'),
			reason: str(row, 'reason'),
			evidenceReference: str(row, 'evidence_reference'),
			createdAt: str(row, 'created_at'),
		});
	}

	const actorIds = [...events.values()]
		.map((event) => event.actorUserId)
		.filter((id): id is number => id !== null);
	const actorNames = new Map<number, string>();
	if (actorIds.length > 0) {
		const actorPlaceholders = actorIds.map(() => '?').join(', ');
		const [actorRows] = await db.execute(
			`SELECT id, full_name FROM users WHERE id IN (${actorPlaceholders})`,
			[...actorIds]
		);
		for (const row of actorRows as DbRow[]) {
			const id = num(row, 'id');
			if (id === null) continue;
			actorNames.set(id, str(row, 'full_name') ?? '');
		}
	}

	const versions: AllocationVersionView[] = allocations.map(
		(allocation, index) => {
			const shares = sharesByAllocation.get(allocation.id) ?? [];
			const event = events.get(
				`${allocation.allocationUid}:${allocation.version}`
			);
			const snapshot = snapshotOf(allocation, shares);
			return {
				...snapshot,
				frozen_at: allocation.frozenAt,
				frozen_by: allocation.frozenBy,
				actor_name: event?.actorUserId
					? (actorNames.get(event.actorUserId) ?? null)
					: null,
				command: event?.command ?? null,
				reason: event?.reason ?? null,
				evidence_reference: event?.evidenceReference ?? null,
				journal_at: event?.createdAt ?? null,
				superseded_by:
					index + 1 < allocations.length
						? allocations[index + 1].version
						: null,
				reconciles:
					shares
						.reduce((sum, share) => add(sum, share.amount), R(0))
						.comparedTo(R(allocation.recordedEmployerCost)) === 0,
			};
		}
	);

	const selected = allocations[allocations.length - 1];
	return {
		payroll_slip_id: slipId,
		month,
		employee_id: employeeId,
		employee_code: selected.employeeCode,
		employee_name: selected.employeeName,
		currency: selected.currency,
		selected_version: selected.version,
		versions,
	};
}
