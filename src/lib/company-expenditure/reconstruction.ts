/**
 * Reviewed historical allocation reconstruction — ticket #308, ADR-0016.
 *
 * A finalized legacy Payroll Slip without saved allocation shares is rebuilt
 * **once** from its recorded employer cost and the available monthly Logged
 * Hours, and the rebuild is a proposal until an authorized reviewer approves
 * it:
 *
 *  - the proposal stores the reviewed figures, the evidence snapshot, the
 *    missing-evidence limitations, the actor, and its `financial_version`;
 *    nothing here reprices from the current Salary Profile;
 *  - approval copies the reviewed proposal into the allocation tables
 *    (`kind = 'reconstruction'`) and appends a `reconstructed` journal row —
 *    what the reviewer saw is exactly what freezes, so a later timesheet edit
 *    cannot move it;
 *  - repeated or concurrent commands are refused: one pending proposal per
 *    slip, one allocation per slip, `expected_version` on every review, and
 *    the slip row is locked before a version is minted.
 *
 * The commands never write `payroll_slips` or `payroll_runs`: a reconstruction
 * changes no slip, payment status, or payroll-run state. Everything joins the
 * caller's connection/transaction (`CommandOptions.connection`).
 */

import { add, R, toNumber } from '@/lib/money';
import type { CommandOptions, CostActor } from './commands';
import { inTransaction } from './commands';
import { CostError } from './errors';
import { text } from './fields';
import {
	PAYROLL_CURRENCY,
	allocateEmployerCost,
	isLockedStatus,
	loadAllocationBasis,
	loadRunStatus,
} from './payroll';
import type { SqlConnection } from './records';
import type {
	PayrollProjectShare,
	PayrollReconstructionEvidence,
	PayrollReconstructionLimitation,
	PayrollReconstructionSummary,
	ReconstructionLimitationCode,
} from './types';

type DbRow = Record<string, unknown>;

/** The parameter shapes the module's SqlConnection seam accepts. */
type SqlParams = Array<string | number | boolean | null>;

/**
 * The driver's execute() result is not typed by this module's SqlConnection
 * seam, so both shapes it returns are narrowed once, here: rows for reads, a
 * result header for writes. Every call site then reads typed values.
 */
async function readRows(
	db: SqlConnection,
	sql: string,
	params: SqlParams = []
): Promise<DbRow[]> {
	const [rows] = await db.execute(sql, params);
	return Array.isArray(rows) ? (rows as DbRow[]) : [];
}

interface WriteResult {
	insertId: number;
	affectedRows: number;
}

async function executeWrite(
	db: SqlConnection,
	sql: string,
	params: SqlParams = []
): Promise<WriteResult> {
	const [result] = await db.execute(sql, params);
	const header = (result ?? {}) as { insertId?: number; affectedRows?: number };
	return {
		insertId: Number(header.insertId ?? 0),
		affectedRows: Number(header.affectedRows ?? 0),
	};
}

function num(row: DbRow | undefined, key: string): number | null {
	if (!row) return null;
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function str(row: DbRow | undefined, key: string): string | null {
	if (!row) return null;
	const value = row[key];
	if (value === null || value === undefined) return null;
	return typeof value === 'string' ? value : String(value);
}

function round2(value: number): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/** One `YYYY-MM-DD HH:mm:ss` stamp, used for the decision and its snapshot. */
function sqlNow(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return (
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
		`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
	);
}

function safeJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function asObject(value: unknown): DbRow {
	return value && typeof value === 'object' ? (value as DbRow) : {};
}

/** The stored limitation codes this ticket writes, filtered from JSON. */
function parseLimitations(raw: unknown): PayrollReconstructionLimitation[] {
	const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
	if (!Array.isArray(parsed)) return [];
	const limitations: PayrollReconstructionLimitation[] = [];
	for (const entry of parsed) {
		const code = str(asObject(entry), 'code');
		if (code !== 'timesheet_missing' && code !== 'hours_without_project') {
			continue;
		}
		limitations.push({
			code: code as ReconstructionLimitationCode,
			detail: str(asObject(entry), 'detail') ?? '',
		});
	}
	return limitations;
}

function parseEvidence(raw: unknown): PayrollReconstructionEvidence {
	const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
	const object = asObject(parsed);
	return {
		source_table: str(object, 'source_table') ?? 'user_activity_assignments',
		source_field: str(object, 'source_field') ?? 'daily_entries',
		month: str(object, 'month') ?? '',
		employee_id: num(object, 'employee_id') ?? 0,
		payroll_slip_id: num(object, 'payroll_slip_id') ?? 0,
		recorded_employer_cost: num(object, 'recorded_employer_cost') ?? 0,
		currency: str(object, 'currency') ?? PAYROLL_CURRENCY,
		total_logged_hours: num(object, 'total_logged_hours') ?? 0,
		project_hours: num(object, 'project_hours') ?? 0,
		no_project_hours: num(object, 'no_project_hours') ?? 0,
		destinations: num(object, 'destinations') ?? 0,
		pay_stream_source:
			str(object, 'pay_stream_source') ?? 'salary_profile_observed_at_proposal',
	};
}

/* ── public command shapes ─────────────────────────────────────────── */

export interface ProposeReconstructionInput {
	/** `YYYY-MM` the Payroll Slip belongs to. */
	month: string;
	/** `payroll_slips.id` of the finalized slip to reconstruct. */
	payrollSlipId: number;
	/** Optional reference the reviewer can cite. */
	evidenceReference?: string | null;
}

export interface ReconstructionReviewInput {
	proposalUid: string;
	command: 'approve' | 'reject';
	expectedVersion: number;
	reason?: string | null;
}

/** The allocation an approval froze. */
export interface ReconstructionAllocationRef {
	allocation_id: number;
	allocation_uid: string;
	version: number;
	kind: 'reconstruction';
	frozen_at: string;
}

/** One command's outcome: the proposal state plus what it froze, if anything. */
export interface ReconstructionCommandResult extends PayrollReconstructionSummary {
	allocation: ReconstructionAllocationRef | null;
}

/* ── reads ─────────────────────────────────────────────────────────── */

const PROPOSAL_COLUMNS = `p.id, p.proposal_uid, p.payroll_slip_id, p.month, p.employee_id,
       p.financial_version, p.status, p.recorded_employer_cost, p.currency,
       p.total_logged_hours, p.project_hours, p.no_project_hours,
       p.rounding_adjustment, p.evidence, p.missing_evidence, p.evidence_reference,
       p.proposed_by, p.proposed_at, p.reviewed_by, p.reviewed_at, p.review_reason,
       p.frozen_allocation_id, u.full_name AS proposed_by_name,
       r.full_name AS reviewed_by_name`;

const PROPOSAL_JOINS = `LEFT JOIN users u ON u.id = p.proposed_by
       LEFT JOIN users r ON r.id = p.reviewed_by`;

async function loadProposalShares(
	db: SqlConnection,
	proposalId: number
): Promise<PayrollProjectShare[]> {
	const rows = await readRows(
		db,
		`SELECT s.project_id, s.project_code, s.project_name, s.client_name,
            s.hours, s.amount, s.rounding_adjustment, s.basis
       FROM payroll_allocation_reconstruction_shares s
      WHERE s.proposal_id = ?
      ORDER BY s.id`,
		[proposalId]
	);
	return rows.map((row) => ({
		project_id: num(row, 'project_id'),
		project_code: str(row, 'project_code'),
		project_name: str(row, 'project_name'),
		client_name: str(row, 'client_name'),
		hours: Number(num(row, 'hours') ?? 0),
		amount: Number(num(row, 'amount') ?? 0),
		rounding_adjustment: Number(num(row, 'rounding_adjustment') ?? 0),
		basis: (str(row, 'basis') ?? 'project') as PayrollProjectShare['basis'],
	}));
}

function proposalSummary(
	row: DbRow,
	shares: readonly PayrollProjectShare[]
): PayrollReconstructionSummary {
	return {
		proposal_uid: str(row, 'proposal_uid') ?? '',
		financial_version: Number(num(row, 'financial_version') ?? 0),
		status: (str(row, 'status') ??
			'pending') as PayrollReconstructionSummary['status'],
		recorded_employer_cost: Number(num(row, 'recorded_employer_cost') ?? 0),
		currency: str(row, 'currency') ?? PAYROLL_CURRENCY,
		total_logged_hours: Number(num(row, 'total_logged_hours') ?? 0),
		project_hours: Number(num(row, 'project_hours') ?? 0),
		no_project_hours: Number(num(row, 'no_project_hours') ?? 0),
		rounding_adjustment: Number(num(row, 'rounding_adjustment') ?? 0),
		evidence: parseEvidence(row.evidence),
		missing_evidence: parseLimitations(row.missing_evidence),
		proposed_by: num(row, 'proposed_by'),
		proposed_by_name: str(row, 'proposed_by_name'),
		proposed_at: str(row, 'proposed_at'),
		reviewed_by: num(row, 'reviewed_by'),
		reviewed_by_name: str(row, 'reviewed_by_name'),
		reviewed_at: str(row, 'reviewed_at'),
		review_reason: str(row, 'review_reason'),
		evidence_reference: str(row, 'evidence_reference'),
		shares: [...shares],
	};
}

/** One proposal with its shares, by stable identity. */
async function loadProposal(
	db: SqlConnection,
	proposalUid: string
): Promise<PayrollReconstructionSummary | null> {
	const rows = await readRows(
		db,
		`SELECT ${PROPOSAL_COLUMNS}
       FROM payroll_allocation_reconstruction_proposals p
       ${PROPOSAL_JOINS}
      WHERE p.proposal_uid = ?`,
		[proposalUid]
	);
	const row = rows[0];
	if (!row) return null;
	const shares = await loadProposalShares(db, Number(num(row, 'id') ?? 0));
	return proposalSummary(row, shares);
}

/**
 * The latest reconstruction proposal per Payroll Slip for one month, keyed by
 * `payroll_slips.id`. Pending and rejected proposals stay visible beside the
 * row; an approved one is attached only when the row's recorded allocation is
 * the freeze it produced (a later revision or re-finalization supersedes it as
 * history, and the row must not keep claiming a reconstructed state).
 */
export async function loadReconstructionSummaries(
	db: SqlConnection,
	monthDay: string
): Promise<Map<number, PayrollReconstructionSummary>> {
	const latest = `p.financial_version = (
        SELECT MAX(p2.financial_version)
          FROM payroll_allocation_reconstruction_proposals p2
         WHERE p2.payroll_slip_id = p.payroll_slip_id
      )`;
	const rows = await readRows(
		db,
		`SELECT ${PROPOSAL_COLUMNS}
       FROM payroll_allocation_reconstruction_proposals p
       ${PROPOSAL_JOINS}
      WHERE p.month = ? AND ${latest}`,
		[monthDay]
	);
	const summaries = new Map<number, PayrollReconstructionSummary>();
	const bySlip = new Map<number, DbRow>();
	for (const row of rows) {
		const slipId = Number(num(row, 'payroll_slip_id') ?? 0);
		bySlip.set(slipId, row);
		summaries.set(slipId, proposalSummary(row, []));
	}
	if (bySlip.size === 0) return summaries;

	const shareRows = await readRows(
		db,
		`SELECT s.proposal_id, s.project_id, s.project_code, s.project_name,
            s.client_name, s.hours, s.amount, s.rounding_adjustment, s.basis
       FROM payroll_allocation_reconstruction_shares s
       JOIN payroll_allocation_reconstruction_proposals p ON p.id = s.proposal_id
      WHERE p.month = ? AND ${latest}
      ORDER BY s.id`,
		[monthDay]
	);
	const proposalToSlip = new Map<number, number>();
	for (const [slipId, row] of bySlip) {
		proposalToSlip.set(Number(num(row, 'id') ?? 0), slipId);
	}
	for (const row of shareRows) {
		const slipId = proposalToSlip.get(Number(num(row, 'proposal_id') ?? 0));
		if (slipId === undefined) continue;
		summaries.get(slipId)?.shares.push({
			project_id: num(row, 'project_id'),
			project_code: str(row, 'project_code'),
			project_name: str(row, 'project_name'),
			client_name: str(row, 'client_name'),
			hours: Number(num(row, 'hours') ?? 0),
			amount: Number(num(row, 'amount') ?? 0),
			rounding_adjustment: Number(num(row, 'rounding_adjustment') ?? 0),
			basis: (str(row, 'basis') ?? 'project') as PayrollProjectShare['basis'],
		});
	}
	return summaries;
}

/* ── the propose command ───────────────────────────────────────────── */

export async function proposeAllocationReconstruction(
	input: ProposeReconstructionInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<ReconstructionCommandResult> {
	const evidenceReference = text(input.evidenceReference, 500);
	return inTransaction(options, async (db) => {
		// Lock ordering (shared with the review command and #309's revision
		// writer): the slip's latest proposal row first, then the slip row —
		// every allocation writer takes the slip row, so a fixed order here
		// means concurrent propose/approve/revision commands queue instead of
		// deadlocking.
		const latestRows = await readRows(
			db,
			`SELECT financial_version, status
         FROM payroll_allocation_reconstruction_proposals
        WHERE payroll_slip_id = ?
        ORDER BY financial_version DESC
        LIMIT 1 FOR UPDATE`,
			[input.payrollSlipId]
		);
		const slipRows = await readRows(
			db,
			`SELECT id FROM payroll_slips WHERE id = ? FOR UPDATE`,
			[input.payrollSlipId]
		);
		if (slipRows.length === 0) {
			throw new CostError(
				'slip_not_found',
				`Payroll Slip ${input.payrollSlipId} does not exist`,
				404
			);
		}
		const basis = await loadAllocationBasis(db, input.payrollSlipId);
		if (!basis) {
			throw new CostError(
				'slip_not_found',
				`Payroll Slip ${input.payrollSlipId} does not exist`,
				404
			);
		}
		const month = basis.slip.monthDay.slice(0, 7);
		if (month !== input.month) {
			throw new CostError(
				'month_mismatch',
				`Payroll Slip ${input.payrollSlipId} belongs to ${month}, not ${input.month}`,
				409
			);
		}
		if (!isLockedStatus(basis.runStatus)) {
			throw new CostError(
				'run_not_locked',
				'The month must be finalized or paid before its slips can be reconstructed',
				409
			);
		}
		const allocationRows = await readRows(
			db,
			`SELECT COALESCE(MAX(version), 0) AS version
         FROM payroll_employee_allocations
        WHERE payroll_slip_id = ?`,
			[input.payrollSlipId]
		);
		if (Number(num(allocationRows[0], 'version') ?? 0) > 0) {
			throw new CostError(
				'allocation_exists',
				'This Payroll Slip already has a saved allocation; a reconstruction never replaces it',
				409
			);
		}
		const latest = latestRows[0];
		if (str(latest, 'status') === 'pending') {
			throw new CostError(
				'reconstruction_pending',
				'A reconstruction proposal for this Payroll Slip already awaits review',
				409
			);
		}
		const financialVersion = Number(num(latest, 'financial_version') ?? 0) + 1;
		const proposalUid = `payroll-recon-${input.payrollSlipId}-v${financialVersion}`;

		const money = round2(basis.slip.employerCost);
		const outcome = allocateEmployerCost(money, basis.hours);
		const totalHours = round2(
			outcome.shares.reduce((sum, share) => add(sum, share.hours), R(0))
		);
		const projectHours = round2(
			outcome.shares
				.filter((share) => share.basis === 'project')
				.reduce((sum, share) => add(sum, share.hours), R(0))
		);
		const noProjectHours = round2(
			outcome.shares
				.filter((share) => share.basis === 'no_project')
				.reduce((sum, share) => add(sum, share.hours), R(0))
		);
		const limitations: PayrollReconstructionLimitation[] = [];
		if (totalHours === 0) {
			limitations.push({
				code: 'timesheet_missing',
				detail: `No eligible Logged Hours are recorded for ${month}; the whole recorded cost stays unallocated.`,
			});
		} else if (noProjectHours > 0) {
			limitations.push({
				code: 'hours_without_project',
				detail: `${noProjectHours} of ${totalHours} Logged Hours have no reliable Project; those hours stay in the denominator and their share stays unallocated.`,
			});
		}
		const evidenceSnapshot: PayrollReconstructionEvidence = {
			source_table: 'user_activity_assignments',
			source_field: 'daily_entries',
			month,
			employee_id: basis.slip.employeeId,
			payroll_slip_id: basis.slip.id,
			recorded_employer_cost: money,
			currency: PAYROLL_CURRENCY,
			total_logged_hours: totalHours,
			project_hours: projectHours,
			no_project_hours: noProjectHours,
			destinations: outcome.shares.length,
			pay_stream_source: 'salary_profile_observed_at_proposal',
		};

		const inserted = await executeWrite(
			db,
			`INSERT INTO payroll_allocation_reconstruction_proposals
         (proposal_uid, payroll_slip_id, month, employee_id, employee_code,
          employee_name, pay_stream, financial_version, status,
          recorded_employer_cost, currency, total_logged_hours, project_hours,
          no_project_hours, rounding_adjustment, evidence, missing_evidence,
          evidence_reference, proposed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				proposalUid,
				basis.slip.id,
				basis.slip.monthDay,
				basis.slip.employeeId,
				basis.employeeCode,
				basis.employeeName,
				basis.payStream,
				financialVersion,
				money,
				PAYROLL_CURRENCY,
				totalHours,
				projectHours,
				noProjectHours,
				outcome.roundingAdjustment,
				JSON.stringify(evidenceSnapshot),
				JSON.stringify(limitations),
				evidenceReference,
				actor.id,
			]
		);
		for (const share of outcome.shares) {
			await executeWrite(
				db,
				`INSERT INTO payroll_allocation_reconstruction_shares
           (proposal_id, project_id, project_code, project_name, client_name,
            hours, amount, rounding_adjustment, basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					inserted.insertId,
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

		const summary = await loadProposal(db, proposalUid);
		if (!summary) {
			throw new CostError(
				'proposal_not_written',
				'The reconstruction proposal could not be read back',
				500
			);
		}
		return { ...summary, allocation: null };
	});
}

/* ── the review command ────────────────────────────────────────────── */

export async function reviewAllocationReconstruction(
	input: ReconstructionReviewInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<ReconstructionCommandResult> {
	const reviewedAt = sqlNow();
	const reason = text(input.reason, 500);
	return inTransaction(options, async (db) => {
		const rows = await readRows(
			db,
			`SELECT ${PROPOSAL_COLUMNS}
         FROM payroll_allocation_reconstruction_proposals p
         ${PROPOSAL_JOINS}
        WHERE p.proposal_uid = ?
        FOR UPDATE`,
			[input.proposalUid]
		);
		const row = rows[0];
		if (!row) {
			throw new CostError(
				'reconstruction_not_found',
				`Reconstruction proposal ${input.proposalUid} does not exist`,
				404
			);
		}
		if (str(row, 'status') !== 'pending') {
			throw new CostError(
				'already_reviewed',
				'This reconstruction proposal has already been reviewed',
				409
			);
		}
		const financialVersion = Number(num(row, 'financial_version') ?? 0);
		if (financialVersion !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				'This reconstruction proposal changed while the command was applied',
				409,
				{ current_version: financialVersion }
			);
		}
		const proposalId = Number(num(row, 'id') ?? 0);
		const proposalUid = str(row, 'proposal_uid') ?? input.proposalUid;

		if (input.command === 'reject') {
			const rejected = await executeWrite(
				db,
				`UPDATE payroll_allocation_reconstruction_proposals
            SET status = 'rejected', reviewed_by = ?, reviewed_at = ?,
                review_reason = ?
          WHERE id = ? AND status = 'pending'`,
				[actor.id, reviewedAt, reason, proposalId]
			);
			if (rejected.affectedRows === 0) {
				throw new CostError(
					'already_reviewed',
					'This reconstruction proposal has already been reviewed',
					409
				);
			}
			const summary = await loadProposal(db, proposalUid);
			if (!summary) {
				throw new CostError(
					'reconstruction_not_found',
					`Reconstruction proposal ${proposalUid} does not exist`,
					404
				);
			}
			return { ...summary, allocation: null };
		}

		const slipId = Number(num(row, 'payroll_slip_id') ?? 0);
		const monthDay = (str(row, 'month') ?? '').slice(0, 10);
		// Same serialization point every allocation writer uses.
		const slipRows = await readRows(
			db,
			`SELECT id FROM payroll_slips WHERE id = ? FOR UPDATE`,
			[slipId]
		);
		if (slipRows.length === 0) {
			throw new CostError(
				'slip_not_found',
				`Payroll Slip ${slipId} does not exist`,
				404
			);
		}
		const runStatus = await loadRunStatus(db, monthDay);
		if (!isLockedStatus(runStatus)) {
			throw new CostError(
				'run_not_locked',
				'The month must be finalized or paid before a reconstruction can freeze',
				409
			);
		}
		const versionRows = await readRows(
			db,
			`SELECT COALESCE(MAX(version), 0) AS version
         FROM payroll_employee_allocations
        WHERE payroll_slip_id = ?`,
			[slipId]
		);
		const maxVersion = Number(num(versionRows[0], 'version') ?? 0);
		if (maxVersion > 0) {
			throw new CostError(
				'allocation_exists',
				'This Payroll Slip already has a saved allocation; a reconstruction never replaces it',
				409
			);
		}
		const version = maxVersion + 1;
		const allocationUid = `payroll-alloc-${slipId}-v${version}`;
		const shares = await loadProposalShares(db, proposalId);

		const inserted = await executeWrite(
			db,
			`INSERT INTO payroll_employee_allocations
         (allocation_uid, payroll_slip_id, month, employee_id, employee_code,
          employee_name, pay_stream, version, kind, recorded_employer_cost,
          currency, total_logged_hours, project_hours, no_project_hours,
          rounding_adjustment, frozen_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reconstruction', ?, ?, ?, ?, ?, ?, ?)`,
			[
				allocationUid,
				slipId,
				monthDay,
				Number(num(row, 'employee_id') ?? 0),
				str(row, 'employee_code') ?? '',
				str(row, 'employee_name') ?? '',
				str(row, 'pay_stream') ?? 'payroll',
				version,
				Number(num(row, 'recorded_employer_cost') ?? 0),
				str(row, 'currency') ?? PAYROLL_CURRENCY,
				Number(num(row, 'total_logged_hours') ?? 0),
				Number(num(row, 'project_hours') ?? 0),
				Number(num(row, 'no_project_hours') ?? 0),
				Number(num(row, 'rounding_adjustment') ?? 0),
				actor.id,
			]
		);
		for (const share of shares) {
			await executeWrite(
				db,
				`INSERT INTO payroll_employee_allocation_shares
           (allocation_id, project_id, project_code, project_name, client_name,
            hours, amount, rounding_adjustment, basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					inserted.insertId,
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

		await executeWrite(
			db,
			`INSERT INTO payroll_allocation_events
         (allocation_uid, source_table, source_id, version, command,
          actor_user_id, reason, evidence_reference, snapshot)
       VALUES (?, 'payroll_slips', ?, ?, 'reconstructed', ?, ?, ?, ?)`,
			[
				allocationUid,
				slipId,
				version,
				actor.id,
				reason,
				proposalUid,
				JSON.stringify({
					payroll_slip_id: slipId,
					month: monthDay,
					employee_id: Number(num(row, 'employee_id') ?? 0),
					recorded_employer_cost: Number(
						num(row, 'recorded_employer_cost') ?? 0
					),
					currency: str(row, 'currency') ?? PAYROLL_CURRENCY,
					rounding_adjustment: Number(num(row, 'rounding_adjustment') ?? 0),
					shares,
					reconstruction: {
						proposal_uid: proposalUid,
						financial_version: financialVersion,
						proposed_by: num(row, 'proposed_by'),
						proposed_at: str(row, 'proposed_at'),
						evidence: parseEvidence(row.evidence),
						missing_evidence: parseLimitations(row.missing_evidence),
						evidence_reference: str(row, 'evidence_reference'),
						reviewed_by: actor.id,
						reviewed_at: reviewedAt,
						review_reason: reason,
					},
				}),
			]
		);

		const approved = await executeWrite(
			db,
			`UPDATE payroll_allocation_reconstruction_proposals
          SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
              review_reason = ?, frozen_allocation_id = ?
        WHERE id = ? AND status = 'pending'`,
			[actor.id, reviewedAt, reason, inserted.insertId, proposalId]
		);
		if (approved.affectedRows === 0) {
			throw new CostError(
				'already_reviewed',
				'This reconstruction proposal has already been reviewed',
				409
			);
		}

		const frozenRows = await readRows(
			db,
			`SELECT frozen_at FROM payroll_employee_allocations WHERE id = ?`,
			[inserted.insertId]
		);
		const summary = await loadProposal(db, proposalUid);
		if (!summary) {
			throw new CostError(
				'reconstruction_not_found',
				`Reconstruction proposal ${proposalUid} does not exist`,
				404
			);
		}
		return {
			...summary,
			allocation: {
				allocation_id: inserted.insertId,
				allocation_uid: allocationUid,
				version,
				kind: 'reconstruction',
				frozen_at: str(frozenRows[0], 'frozen_at') ?? reviewedAt,
			},
		};
	});
}
