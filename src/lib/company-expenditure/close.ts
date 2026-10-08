/**
 * Financial close (ticket #322) — review a company financial month and save
 * immutable closed figures, then block ordinary writes to closed months.
 *
 * The close reads one coherent snapshot across every source: it calls
 * `fetchCompanyReconciliation` on its own transaction's connection (the
 * seam `index.ts` documents for this slice), so the frozen totals, source
 * and Project identities, allocation and financial versions,
 * classification, currency and tax basis, and evidence states are exactly
 * what the report stated when the month closed. Payroll finalization stays
 * separate: a pending payroll is a disclosed warning, never a blocker, and
 * finalizing payroll never closes supplier cost, accruals, or the month.
 *
 * Closed-period protection hangs off the seams the module built for it:
 * every write path below asks `assertMonthOpen` before it writes, and the
 * allocation revision path consults the guard registered here through
 * `registerAllocationMutationGuard` (no guard is registered while no close
 * module exists). A refusal is `409 month_closed` and points at the
 * financial revision workflow (#323) — ordinary edit, delete,
 * cancellation, or reclassification cannot bypass it.
 */

import { randomUUID } from 'node:crypto';
import { fetchCompanyReconciliation, currentMonth } from './index';
import { registerAllocationMutationGuard } from './allocation-revisions';
import { SOURCE_COVERAGE } from './coverage';
import { CostError } from './errors';
import type { SqlConnection } from './records';
import type { CostActor } from './commands';
import type {
	CloseBlocker,
	CloseCommandInput,
	CloseCommandResult,
	CloseReviewResult,
	CloseSnapshot,
	CompanyReconciliation,
	CoverageNotice,
} from './types';

const CLOSE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The `YYYY-MM` inside a date, day, or month value; null when unknown. */
export function monthOfPeriod(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim().slice(0, 7);
	return CLOSE_MONTH_PATTERN.test(text) ? text : null;
}

function text(value: unknown, max = 500): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	if (trimmed.length === 0) return null;
	return trimmed.slice(0, max);
}

/** True when the error is a MySQL duplicate-key on the close's unique key. */
function isDuplicateKeyError(error: unknown): boolean {
	if (error === null || typeof error !== 'object') return false;
	const record = error as Record<string, unknown>;
	return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
}

/** Whether the month already carries a closed snapshot. */
export async function isMonthClosed(
	db: SqlConnection,
	month: string
): Promise<boolean> {
	const [rows] = (await db.execute(
		`SELECT 1 FROM financial_close_snapshots
      WHERE month = ? AND status = 'closed' AND isDelete = 0
      LIMIT 1`,
		[month]
	)) as [unknown[], unknown];
	return rows.length > 0;
}

/** The frozen snapshot for a month, or null while the month is open. */
export async function loadCloseSnapshot(
	db: SqlConnection,
	month: string
): Promise<CloseSnapshot | null> {
	const [rows] = (await db.execute(
		`SELECT month, close_uid, financial_version, status, snapshot,
            reviewed_by, reviewed_at, review_reason, evidence_reference,
            created_by, created_at
       FROM financial_close_snapshots
      WHERE month = ? AND isDelete = 0
      LIMIT 1`,
		[month]
	)) as [Record<string, unknown>[], unknown];
	const row = rows[0];
	if (!row) return null;
	let snapshot: CompanyReconciliation | null = null;
	if (row.snapshot !== null && row.snapshot !== undefined) {
		// The driver usually returns LONGTEXT as a string, but it has been
		// observed returning the JSON snapshot already parsed (plain object).
		// Accept both shapes rather than assuming one.
		if (typeof row.snapshot === 'string') {
			snapshot = JSON.parse(row.snapshot) as CompanyReconciliation;
		} else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(row.snapshot)) {
			snapshot = JSON.parse(
				row.snapshot.toString('utf8')
			) as CompanyReconciliation;
		} else if (typeof row.snapshot === 'object') {
			snapshot = row.snapshot as CompanyReconciliation;
		}
	}
	return {
		month: String(row.month ?? month),
		close_uid: String(row.close_uid ?? ''),
		financial_version: Number(row.financial_version ?? 1),
		status: 'closed',
		snapshot,
		reviewed_by:
			row.reviewed_by === null || row.reviewed_by === undefined
				? null
				: Number(row.reviewed_by),
		reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
		review_reason:
			row.review_reason === null || row.review_reason === undefined
				? null
				: String(row.review_reason),
		evidence_reference:
			row.evidence_reference === null || row.evidence_reference === undefined
				? null
				: String(row.evidence_reference),
		created_by:
			row.created_by === null || row.created_by === undefined
				? null
				: Number(row.created_by),
		created_at: String(row.created_at ?? ''),
	};
}

/**
 * The closed-period refusal for a month: `409 month_closed` when the month
 * is closed, null while it is open. Every guarded write path throws the
 * refusal as a `CostError` before its state check, row update, and journal
 * append, so a refusal writes nothing.
 */
export async function closeRefusalForMonth(
	db: SqlConnection,
	month: string | null | undefined
): Promise<{
	code: string;
	message: string;
	status: number;
	detail?: Record<string, unknown>;
} | null> {
	const period = monthOfPeriod(month);
	if (!period) return null;
	if (!(await isMonthClosed(db, period))) return null;
	return {
		code: 'month_closed',
		message:
			'This financial month is closed. Ordinary writes are blocked; change closed figures through the financial revision workflow instead.',
		status: 409,
		detail: { month: period },
	};
}

/** Throw `409 month_closed` when the month is closed; pass open months. */
export async function assertMonthOpen(
	db: SqlConnection,
	month: string | null | undefined
): Promise<void> {
	const refusal = await closeRefusalForMonth(db, month);
	if (refusal) {
		throw new CostError(
			refusal.code,
			refusal.message,
			refusal.status,
			refusal.detail ?? {}
		);
	}
}

/** Coverage notices that mean the month's figures are incomplete. */
const BLOCKER_NOTICES = new Set([
	'no_recognized_cost',
	'records_awaiting_recognition',
	'missing_amount',
	'original_currency_missing',
	'currency_conversion_missing',
	'unresolved_classification',
	'unresolved_tax_treatment',
	'tax_evidence_missing',
	'nature_unresolved_treatment',
	'non_operating_item_not_approved',
	'period_charge_source_not_recognized',
	'petty_cash_spending_awaiting_recognition',
	'petty_cash_settlement_unresolved',
	'cash_unresolved_targets',
]);

function asBlocker(notice: CoverageNotice): CloseBlocker {
	return {
		code: notice.code,
		label: notice.label,
		detail: notice.detail,
		severity: 'error',
	};
}

function asWarning(code: string, label: string, detail: string): CloseBlocker {
	return { code, label, detail, severity: 'warning' };
}

/**
 * Map one reconciliation onto the close decision. Unwired sources,
 * unresolved cost exceptions, unsupported commitments, and an empty month
 * block the close; pending payroll, partial cash cover, and legacy cash
 * gaps are disclosed warnings. Notices the close does not judge are
 * passed through as warnings, never dropped.
 */
export function reviewReconciliation(
	reconciliation: CompanyReconciliation
): CloseReviewResult {
	const blockers: CloseBlocker[] = [];
	const warnings: CloseBlocker[] = [];
	for (const declaration of SOURCE_COVERAGE) {
		if (declaration.status !== 'wired') {
			blockers.push({
				code: `source_not_wired:${declaration.code}`,
				label: `Source not wired: ${declaration.label}`,
				detail: declaration.detail,
				severity: 'error',
			});
		}
	}
	for (const notice of reconciliation.coverage) {
		if (BLOCKER_NOTICES.has(notice.code)) {
			blockers.push(asBlocker(notice));
		}
	}
	for (const exception of reconciliation.supplier_commitment.exceptions) {
		if ((exception.orderCount ?? 0) > 0) {
			// Only the closing month's own exceptions block it. An order from
			// another period (or a directionless legacy copy attributable to
			// no month) stays disclosed in the section but cannot hold an
			// unrelated month's close hostage.
			const blocksMonth = (exception.months ?? []).includes(
				reconciliation.month
			);
			if (!blocksMonth) continue;
			blockers.push({
				code: 'supplier_commitment_unresolved',
				label: 'Supplier commitment has unresolved exceptions',
				detail: `${exception.orderCount} order(s): ${exception.code} — ${exception.detail}`,
				severity: 'error',
			});
		}
	}
	const payroll = reconciliation.payroll;
	const pendingPayroll =
		(payroll.estimated_count ?? 0) +
		(payroll.missing_slip_count ?? 0) +
		(payroll.missing_pricing_count ?? 0) +
		(payroll.allocation_missing_count ?? 0);
	if (pendingPayroll > 0) {
		warnings.push(
			asWarning(
				'payroll_finalization_pending',
				'Payroll finalization pending',
				`${pendingPayroll} employee position(s) are estimated or missing a slip, pricing, or frozen allocation. Finalizing payroll freezes attribution; it does not close the month.`
			)
		);
	}
	const cash = reconciliation.cash;
	const partialCash =
		(cash.coverage.partial_targets ?? 0) +
		(cash.coverage.unsettled_targets ?? 0);
	if (partialCash > 0) {
		warnings.push(
			asWarning(
				'cash_partial_coverage',
				'Cash cover is partial',
				`${cash.coverage.partial_targets} target(s) partly settled and ${cash.coverage.unsettled_targets} unsettled. Recognized cost may be paid after the month closes; the payment is that later month's cash evidence.`
			)
		);
	}
	for (const notice of reconciliation.coverage) {
		if (!BLOCKER_NOTICES.has(notice.code)) {
			warnings.push({
				code: notice.code,
				label: notice.label,
				detail: notice.detail,
				severity: 'warning',
			});
		}
	}
	return { can_close: blockers.length === 0, blockers, warnings };
}

/**
 * Review whether a month can close, reading every source on the caller's
 * connection so the review sees the same rows the close would freeze.
 */
export async function reviewClose(
	db: SqlConnection,
	month: string
): Promise<CloseReviewResult> {
	const reconciliation = await fetchCompanyReconciliation(
		{ month },
		{ connection: db }
	);
	return reviewReconciliation(reconciliation);
}

/**
 * Close a month: version-checked, atomic, one coherent snapshot. The
 * expected version is `0` while the month is open and the snapshot's
 * version afterwards; a stale version, a competing close, and a blocked
 * review all write nothing. A repeat with the read-back version reads the
 * same row back instead of writing a second one.
 */
export async function executeCloseCommand(
	db: SqlConnection,
	input: CloseCommandInput,
	actor: CostActor
): Promise<CloseCommandResult> {
	const month = (input.month ?? '').trim();
	if (!CLOSE_MONTH_PATTERN.test(month)) {
		throw new CostError(
			'invalid_month',
			'A financial month (YYYY-MM) is required to close',
			400,
			{ field: 'month' }
		);
	}
	if (month >= currentMonth()) {
		throw new CostError(
			'month_in_progress',
			'Only a fully elapsed month can be closed',
			422,
			{ month }
		);
	}
	const existing = await loadCloseSnapshot(db, month);
	const current = existing?.financial_version ?? 0;
	if (input.expectedVersion !== current) {
		throw new CostError(
			'stale_version',
			`The close moved on since it was read (current version ${current})`,
			409,
			{ current_version: current }
		);
	}
	if (existing) {
		return {
			month: existing.month,
			close_uid: existing.close_uid,
			financial_version: existing.financial_version,
			status: 'closed',
		};
	}
	// The review and the snapshot read inside this same transaction, so a
	// concurrent write cannot slip between the decision and the freeze.
	const reconciliation = await fetchCompanyReconciliation(
		{ month },
		{ connection: db }
	);
	const review = reviewReconciliation(reconciliation);
	if (!review.can_close) {
		throw new CostError(
			'close_blocked',
			'This month cannot close yet: its review has blockers',
			422,
			{ blockers: review.blockers }
		);
	}
	const closeUid = `close-${randomUUID()}`;
	try {
		await db.execute(
			`INSERT INTO financial_close_snapshots
           (month, close_uid, financial_version, status, snapshot,
            reviewed_by, reviewed_at, review_reason, evidence_reference, created_by)
         VALUES (?, ?, 1, 'closed', ?, ?, NOW(), ?, ?, ?)`,
			[
				month,
				closeUid,
				JSON.stringify(reconciliation),
				actor.id,
				text(input.reason),
				text(input.evidenceReference),
				actor.id,
			]
		);
	} catch (error) {
		// A competing close won the unique key between the read and the
		// insert: one coherent version exists, this request loses.
		if (isDuplicateKeyError(error)) {
			const winner = await loadCloseSnapshot(db, month);
			throw new CostError(
				'stale_version',
				'A competing close wrote this month first',
				409,
				{ current_version: winner?.financial_version ?? 1 }
			);
		}
		throw error;
	}
	return {
		month,
		close_uid: closeUid,
		financial_version: 1,
		status: 'closed',
	};
}

// The closed-month check the allocation revision path consults inside its
// own transaction, before any allocation write (#322's half of the seam).
registerAllocationMutationGuard(async (db, monthDay) => {
	return closeRefusalForMonth(db, monthDay);
});
