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
 *     fetchCompanyReconciliation({ month, projectId?, asOf? })
 *       Company Incurred Cost for a month, split into Incurred Project Cost,
 *       Company Overhead, and Unallocated Cost per currency, plus the Project
 *       breakdown, evidence states, and the coverage notices that say what the
 *       total does and does not include.
 *       The response also carries the month's `comparison` (the same month
 *       measured against its Comparable Period, over equivalent elapsed
 *       service periods while the month is unfinished), the `ranking` of the
 *       Project rows by cost and by increase inside one currency, the
 *       `filtered_subtotal` of a filtered Project detail, per-Project
 *       `evidence`, and `cost_to_date`. `asOf` names the date inside the month
 *       the comparison is measured to; it defaults to today.
 *     fetchCostDrilldown(query)
 *       The source records behind the figures, with identity, evidence,
 *       entry date, and the expense state they were counted from.
 *     fetchCostJournal(costUid)
 *       The append-only command history of one cost.
 *     SOURCE_COVERAGE
 *       Which cost sources feed this module and which are still outstanding.
 *
 *   financial calendar (shared with the report's month/FY navigation)
 *     monthLabel(month), previousMonthOf(month), financialYearOf(month),
 *     financialYearLabel(startYear), dayOfDate(value)
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
	loadCostEvents,
	loadDrilldown,
	loadExpenditureMonths,
	loadMonthRecords,
	loadProjectCostBefore,
	loadProjectOptions,
	type SqlConnection,
} from './records';
import { previousMonthOf } from './ranking';
import { buildReconciliation } from './reconciliation';
import type {
	CompanyReconciliation,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
} from './types';

export { recordCost, executeCommand, loadCost, CostError } from './commands';
export type { CostActor, CommandOptions } from './commands';
export { SOURCE_COVERAGE } from './coverage';
export type { SourceCoverageDeclaration } from './coverage';
export { monthLabel } from './reconciliation';
export { dayOfDate } from './ranking';
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
	ChangeState,
	CompanyReconciliation,
	ComparisonBasis,
	ComparisonCurrency,
	ComparisonDisclosure,
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
	CoverageNotice,
	CurrencyTotal,
	EvidenceSummary,
	FilteredProjectSubtotal,
	PeriodBasis,
	PeriodComparison,
	ProjectEvidenceState,
	ProjectRanking,
	RankingEntry,
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

/** Today's calendar month, from the server clock. */
export function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

/** Today's date, from the server clock: the default as-of of a month. */
export function currentDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Months with direct cost recorded, newest first, including the current one. */
export async function fetchExpenditureMonths(): Promise<string[]> {
	return loadExpenditureMonths(pool, currentMonth());
}

export interface ReconciliationRequest {
	/** `YYYY-MM` of the Recognition Period being viewed. */
	month: string;
	/** Narrow the Project detail; never the company reconciliation. */
	projectId?: number | null;
	/**
	 * The date the month is measured to, inside the reported month; it
	 * identifies the comparable period. Defaults to today, so a past month is
	 * compared in full and the current month over its elapsed days.
	 */
	asOf?: string | null;
}

/** Read one month's company reconciliation. */
export async function fetchCompanyReconciliation(
	request: ReconciliationRequest
): Promise<CompanyReconciliation> {
	const month = request.month;
	const today = currentDate();
	const [records, priorMonthRecords, projectCostBefore, projectOptions, availableMonths] =
		await Promise.all([
			loadMonthRecords(pool, month),
			loadMonthRecords(pool, previousMonthOf(month)),
			loadProjectCostBefore(pool, month),
			loadProjectOptions(pool),
			loadExpenditureMonths(pool, currentMonth()),
		]);

	return buildReconciliation({
		month,
		records,
		priorMonthRecords,
		asOf: request.asOf ?? today,
		projectCostBefore,
		projectFilter: request.projectId ?? null,
		projectOptions,
		availableMonths,
		currentMonth: currentMonth(),
		coverageDeclarations: SOURCE_COVERAGE,
	});
}

/** Read the records behind a month's reconciliation. */
export async function fetchCostDrilldown(
	queryInput: CostDrilldownQuery
): Promise<CostDrilldown> {
	return loadDrilldown(pool, queryInput);
}

/** Read the versioned command history of one cost. */
export async function fetchCostJournal(
	costUid: string
): Promise<CostJournalEntry[]> {
	return loadCostEvents(pool, costUid);
}
