/**
 * Company expenditure — the shared financial module behind the monthly
 * reconciliation, the direct-cost entry and recognition controls, and the
 * source drilldown.
 *
 * This is the module's public interface. Callers (report routes, the entry and
 * command routes, and later the export and allocation slices) use these
 * exports and nothing else:
 *
 *   reads
 *     fetchCompanyReconciliation({ month, projectId? })
 *       Company Incurred Cost for a month, split into Incurred Project Cost,
 *       Company Overhead, and Unallocated Cost per currency, plus the Project
 *       breakdown, evidence states, and the coverage notices that say what the
 *       total does and does not include.
 *     fetchCostDrilldown(query)
 *       The source records behind the figures, with identity, evidence, and
 *       the expense state they were counted from.
 *     fetchCostJournal(costUid)
 *       The append-only command history of one cost.
 *     SOURCE_COVERAGE
 *       Which cost sources feed this module and which are still outstanding.
 *
 *   writes (one path, versioned)
 *     recordCost(input, actor, { connection? })
 *     executeCommand({ id, command, expectedVersion, reason?, patch? }, actor)
 *
 * Invariants the module guarantees to every caller:
 *  - confirmed cost is `recognition_state = 'recognized'` and nothing else;
 *  - a missing amount is NULL, never zero, and never silently recognized;
 *  - the Recognition Period comes from the received-work period, or the bill
 *    date as a disclosed fallback;
 *  - currencies are not added together without a supported conversion;
 *  - every accepted command increments `financial_version` and appends one
 *    journal row, so a repeated or stale command changes nothing.
 *
 * Later slices extend this module: a source adapter per cost source feeds the
 * same `buildReconciliation`, `command`/`revision` controls hang off the same
 * version + journal pair, and the Excel export consumes
 * `fetchCompanyReconciliation` so the download cannot disagree with the screen.
 */

import { query } from '@/utils/database';
import { SOURCE_COVERAGE } from './coverage';
import {
	costSourceUnion,
	DIRECT_EXPENSE_COST_SOURCE,
	loadCostEvents,
	loadDrilldown,
	loadExpenditureMonths,
	loadMonthProjectCost,
	loadMonthRecords,
	loadProjectOptions,
	type SqlConnection,
} from './records';
import { buildReconciliation } from './reconciliation';
import { OTHER_EXPENSE_COST_SOURCE } from './other-expenses';
import type {
	CompanyReconciliation,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
} from './types';

export { recordCost, executeCommand, loadCost, CostError } from './commands';
export type { CostActor, CommandOptions } from './commands';
export {
	captureOtherExpense,
	executeOtherExpenseCommand,
	loadOtherExpenseReview,
	resolveOtherExpenseCopy,
} from './other-expenses';
export type {
	CopyReviewAction,
	CopyReviewInput,
	CopyReviewResult,
	DuplicateCandidate,
	LinkedCopyReview,
	OtherExpenseCaptureInput,
	OtherExpenseCommandInput,
	OtherExpenseCommandResult,
	OtherExpensePatch,
	OtherExpenseReviewQueue,
	OtherExpenseRow,
	PendingCopyReview,
	RecordedOtherExpense,
	UnresolvedOtherExpense,
} from './other-expenses';

/**
 * Every wired cost source, read through one projection. A later source ticket
 * appends its own `XX_COST_SOURCE` here; no ticket adds a second aggregation.
 */
export const COMPANY_COST_SOURCES = costSourceUnion([
	DIRECT_EXPENSE_COST_SOURCE,
	OTHER_EXPENSE_COST_SOURCE,
]);
export {
	linkCostReference,
	registerCostIdentity,
	registerCostSource,
	resolveCostReference,
} from './sources';
export type {
	CostLinkBasis,
	CostLinkReviewState,
	CostLinkRole,
	CostReference,
	CostSourceAdapter,
} from './sources';
export { SOURCE_COVERAGE } from './coverage';
export type { SourceCoverageDeclaration } from './coverage';
export type { SqlConnection } from './records';
export { monthLabel } from './reconciliation';
export {
	effectiveTaxTreatment,
	evaluateCost,
	isConfirmed,
	isOpenState,
	nextState,
	recognitionBlockers,
	resolveRecognitionPeriod,
} from './recognition';
export type {
	CompanyReconciliation,
	CostClassification,
	CostCommandInput,
	CostCommandName,
	CostCommandResult,
	CostDrilldown,
	CostDrilldownQuery,
	CostEvaluation,
	CostExceptionCode,
	CostJournalEntry,
	CostPatch,
	CostRecord,
	CostSource,
	CostSplitInfo,
	CoverageNotice,
	CurrencyTotal,
	EvidenceSummary,
	PeriodBasis,
	RecognitionState,
	RecordCostInput,
	RecordedCost,
	ReconciliationProjectRow,
	TaxTreatment,
} from './types';

/** The pooled connection this module reads through. */
const pool: SqlConnection = {
	execute: (sql, params) => query(sql, params),
};

/** The month before `YYYY-MM`, or null at the calendar's start. */
function previousMonthOf(month: string): string | null {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber) return null;
	if (monthNumber === 1) {
		return year - 1 < 1970 ? null : `${year - 1}-12`;
	}
	return `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
}

/** Today's calendar month, from the server clock. */
export function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

/** Months with direct cost recorded, newest first, including the current one. */
export async function fetchExpenditureMonths(): Promise<string[]> {
	return loadExpenditureMonths(pool, currentMonth(), COMPANY_COST_SOURCES);
}

export interface ReconciliationRequest {
	/** `YYYY-MM` of the Recognition Period being viewed. */
	month: string;
	/** Narrow the Project detail; never the company reconciliation. */
	projectId?: number | null;
}

/** Read one month's company reconciliation. */
export async function fetchCompanyReconciliation(
	request: ReconciliationRequest
): Promise<CompanyReconciliation> {
	const month = request.month;
	const previousMonth = previousMonthOf(month);
	const [records, previousProjectCost, projectOptions, availableMonths] =
		await Promise.all([
			loadMonthRecords(pool, month, COMPANY_COST_SOURCES),
			previousMonth
				? loadMonthProjectCost(pool, previousMonth, COMPANY_COST_SOURCES)
				: Promise.resolve(new Map<number, Map<string, number | null>>()),
			loadProjectOptions(pool),
			loadExpenditureMonths(pool, currentMonth(), COMPANY_COST_SOURCES),
		]);

	return buildReconciliation({
		month,
		records,
		previousMonthProjectCost: previousProjectCost,
		projectFilter: request.projectId ?? null,
		projectOptions,
		availableMonths,
		coverageDeclarations: SOURCE_COVERAGE,
	});
}

/** Read the records behind a month's reconciliation. */
export async function fetchCostDrilldown(
	queryInput: CostDrilldownQuery
): Promise<CostDrilldown> {
	return loadDrilldown(pool, queryInput, COMPANY_COST_SOURCES);
}

/** Read the versioned command history of one cost. */
export async function fetchCostJournal(
	costUid: string
): Promise<CostJournalEntry[]> {
	return loadCostEvents(pool, costUid);
}
