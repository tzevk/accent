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
 *     capturePeriodCharge({ sourceId, period, basis, amount, evidenceReference }, actor)
 *       Approve period consumption, depreciation, or amortization against a
 *       non-operating item's supported balance (#317).
 *     cancelPeriodCharge({ chargeUid, command: 'cancel', expectedVersion, reason }, actor)
 *
 * Invariants the module guarantees to every caller:
 *  - confirmed cost is `recognition_state = 'recognized'` and nothing else;
 *  - a missing amount is NULL, never zero, and never silently recognized;
 *  - the Recognition Period comes from the received-work period, or the bill
 *    date as a disclosed fallback;
 *  - currencies are not added together without a supported conversion;
 *  - every accepted command increments `financial_version` and appends one
 *    journal row, so a repeated or stale command changes nothing;
 *  - an advance, deposit, prepayment, or capital item is never expensed by its
 *    payment: only approved, evidenced period charges become cost, in the
 *    charge's own month, and they never exceed the source's confirmed balance.
 *
 * Later slices extend this module: a source adapter per cost source feeds the
 * same `buildReconciliation`, `command`/`revision` controls hang off the same
 * version + journal pair, and the Excel export consumes
 * `fetchCompanyReconciliation` so the download cannot disagree with the screen.
 */

import { query } from '@/utils/database';
import { SOURCE_COVERAGE } from './coverage';
import {
	loadChargeTotals,
	loadCostEvents,
	loadCostRecordsByIds,
	loadDrilldown,
	loadExpenditureMonths,
	loadMonthCharges,
	loadMonthProjectCost,
	loadMonthRecords,
	loadNonOperatingSources,
	loadProjectOptions,
	type SqlConnection,
} from './records';
import { buildReconciliation } from './reconciliation';
import type {
	CompanyReconciliation,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
} from './types';

export { recordCost, executeCommand, loadCost, CostError } from './commands';
export type { CostActor, CommandOptions } from './commands';
export {
	capturePeriodCharge,
	cancelPeriodCharge,
} from './charges';
export type {
	CapturePeriodChargeInput,
	PeriodChargeCommandInput,
} from './charges';
export { SOURCE_COVERAGE } from './coverage';
export type { SourceCoverageDeclaration } from './coverage';
export { monthLabel } from './reconciliation';
export {
	CHARGE_BASIS_LABELS,
	COST_NATURES,
	NATURE_LABELS,
	NON_OPERATING_NATURES,
	PERIOD_CHARGE_BASES,
	chargePeriodDate,
	consumedToDate,
	isChargePeriod,
	isNonOperatingNature,
	periodChargeBlockers,
	remainingBalance,
} from './non-operating';
export type {
	PeriodChargeBlocker,
	PeriodChargeBlockerInput,
	PeriodChargeCandidate,
} from './non-operating';
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
	CostNature,
	CostPatch,
	CostRecord,
	CoverageNotice,
	CurrencyTotal,
	EvidenceSummary,
	NonOperatingItemJson,
	NonOperatingSection,
	PeriodBasis,
	PeriodChargeJson,
	PeriodChargeBasis,
	PeriodChargeState,
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
	return loadExpenditureMonths(pool, currentMonth());
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
	const [
		records,
		charges,
		monthNonOperating,
		previousProjectCost,
		projectOptions,
		availableMonths,
	] = await Promise.all([
		loadMonthRecords(pool, month),
		loadMonthCharges(pool, { month }),
		loadNonOperatingSources(pool, month),
		previousMonth
			? loadMonthProjectCost(pool, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		loadProjectOptions(pool),
		loadExpenditureMonths(pool, currentMonth()),
	]);

	// A charge can draw down a balance recognized in an earlier month, so the
	// section needs those sources too; every other source of the month is
	// already loaded, and duplicates collapse by expense id.
	const sourcesById = new Map(
		monthNonOperating.map((record) => [record.id, record])
	);
	const chargeSourceIds = [
		...new Set(
			charges
				.map((charge) => charge.sourceId)
				.filter((id) => !sourcesById.has(id))
		),
	];
	for (const record of await loadCostRecordsByIds(pool, chargeSourceIds)) {
		sourcesById.set(record.id, record);
	}
	const nonOperatingSources = [...sourcesById.values()];
	const chargeTotals = await loadChargeTotals(
		pool,
		nonOperatingSources
			.map((record) => record.costUid)
			.filter((uid): uid is string => !!uid)
	);

	return buildReconciliation({
		month,
		records,
		charges,
		nonOperatingSources,
		chargeTotals,
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
	return loadDrilldown(pool, queryInput);
}

/** Read the versioned command history of one cost. */
export async function fetchCostJournal(
	costUid: string
): Promise<CostJournalEntry[]> {
	return loadCostEvents(pool, costUid);
}
