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
 *     fetchCompanyReconciliation({ month, projectId?, reportingCurrency? })
 *       Company Incurred Cost for a month, split into Incurred Project Cost,
 *       Company Overhead, and Unallocated Cost per currency, plus the Project
 *       breakdown, evidence states, and the coverage notices that say what the
 *       total does and does not include. The figures are stated in the
 *       requested reporting currency (INR by default) using only matching
 *       stored conversion evidence; an unconverted amount stays in its own
 *       currency subtotal with an explicit exception.
 *     fetchCostDrilldown(query)
 *       The source records behind the figures, with identity, evidence, and
 *       the expense state they were counted from.
 *     fetchCostJournal(costUid)
 *       The append-only command history of one cost.
 *     fetchProjectBudgets(projectId)
 *       Every approved (and draft) Project cost budget with its amount,
 *       currency, scope, period, approval evidence, and version.
 *     fetchCostBudget(id) / fetchBudgetJournal(budgetUid)
 *       One cost budget and its append-only approval journal.
 *     SOURCE_COVERAGE
 *       Which cost sources feed this module and which are still outstanding.
 *
 *   writes (one path, versioned)
 *     recordCost(input, actor, { connection? })
 *     executeCommand({ id, command, expectedVersion, reason?, patch? }, actor)
 *     recordCostBudget(input, actor, { connection? })
 *     executeBudgetCommand(
 *       { id, command, expectedVersion, reason?, evidenceReference?, patch? },
 *       actor
 *     )
 *
 * Invariants the module guarantees to every caller:
 *  - confirmed cost is `recognition_state = 'recognized'` and nothing else;
 *  - a missing amount is NULL, never zero, and never silently recognized;
 *  - the Recognition Period comes from the received-work period, or the bill
 *    date as a disclosed fallback;
 *  - currencies are not added together without a supported conversion, and a
 *    missing original currency is unknown — never read as INR;
 *  - every accepted command increments `financial_version` and appends one
 *    journal row, so a repeated or stale command changes nothing;
 *  - an approved cost budget is compared with Incurred Project Cost only when
 *    Project, currency, scope, and period match, and a budget never enters a
 *    cost total — `budgets` is its own section of the reconciliation.
 *
 * Later slices extend this module: a source adapter per cost source feeds the
 * same `buildReconciliation`, `command`/`revision` controls hang off the same
 * version + journal pair, and the Excel export consumes
 * `fetchCompanyReconciliation` so the download cannot disagree with the screen.
 * Cost budgets carry their own versioned commands and journal beside the cost
 * ones: a later financial close reads the same approved budget the month was
 * compared with, and a superseded approval stays readable.
 */

import { query } from '@/utils/database';
import {
	loadBudget,
	loadBudgetEvents,
	loadBudgetsCoveringMonth,
	loadBudgetsForProject,
	loadBudgetsForProjects,
} from './budget-records';
import type { CommandOptions } from './commands';
import { SOURCE_COVERAGE } from './coverage';
import {
	loadCostEvents,
	loadDrilldown,
	loadExpenditureMonths,
	loadMonthProjectCost,
	loadMonthRecords,
	loadProjectOptions,
	type SqlConnection,
} from './records';
import {
	PETTY_CASH_COST_SOURCE,
	loadPettyCashSummary,
	type PettyCashDrilldown,
	type PettyCashSourceDescriptor,
} from './petty-cash';
import { buildReconciliation, projectIdsIn } from './reconciliation';
import type {
	CompanyReconciliation,
	CostBudgetJournalEntry,
	CostBudgetRecord,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
	CostRecordJson,
	PettyCashSummary,
} from './types';

export { recordCost, executeCommand, loadCost, CostError } from './commands';
export type { CostActor, CommandOptions } from './commands';
export {
	ensureFundingMirror,
	executePettyCashCommand,
	fundingEventUid,
	isPettyCashCommand,
	loadPettyCashDrilldown,
	loadPettyCashGuardRow,
	loadVoucherGuard,
	pettyCashCommandInputFromJson,
	pettyCashRegisterRefusal,
	pettyCashSpendInputFromJson,
	recordPettyCashSpend,
	voucherRegisterRefusal,
} from './petty-cash';
export type {
	FundingMirrorInput,
	FundingMirrorResult,
	PettyCashCommandInput,
	PettyCashCommandResult,
	PettyCashGuardRow,
	PettyCashSpendInput,
	PettyCashSpendPatch,
	RecordedPettyCashSpend,
	RegisterRefusal,
	VoucherGuard,
} from './petty-cash';
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
export { recordCostBudget, executeBudgetCommand } from './budget-commands';
export { PETTY_CASH_COST_SOURCE } from './petty-cash';
export type {
	PettyCashDrilldown,
	PettyCashSourceDescriptor,
} from './petty-cash';
export { SOURCE_COVERAGE } from './coverage';
export type { SourceCoverageDeclaration } from './coverage';
export {
	REPORTING_CURRENCY,
	convertToReporting,
	conversionException,
	conversionStatusOf,
	currencyCodeOf,
	evidenceOf,
	parseConversionRate,
	reportingCurrencyOf,
} from './currency';
export { monthLabel } from './reconciliation';
export { COST_BUDGET_SCOPES, isCostBudgetScope } from './types';
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
	BudgetOutcome,
	BudgetSection,
	CompanyConversion,
	CompanyReconciliation,
	ConversionEvidence,
	ConversionExceptionCode,
	ConversionOutcome,
	ConversionStatus,
	CostBudgetCandidate,
	CostBudgetCommandInput,
	CostBudgetCommandName,
	CostBudgetCommandResult,
	CostBudgetJournalCommand,
	CostBudgetJournalEntry,
	CostBudgetPatch,
	CostBudgetRecord,
	CostBudgetScope,
	CostBudgetState,
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
	CurrencyReporting,
	CurrencyTotal,
	EvidenceSummary,
	PeriodBasis,
	PettyCashCurrencySummary,
	PettyCashSummary,
	ProjectBudgetComparison,
	RecognitionState,
	RecordCostBudgetInput,
	RecordCostInput,
	RecordedCost,
	ReconciliationProjectRow,
	TaxTreatment,
} from './types';

export interface CostBudgetDetail {
	budget: CostBudgetRecord;
	journal: CostBudgetJournalEntry[];
}

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

/**
 * Confirmed Project cost of the previous month across every wired source. A
 * per-currency amount stays null (unknown) when any contributing source
 * reports unknown, so a comparison is never stated against an invented zero.
 */
function mergeProjectCost(
	direct: Map<number, Map<string, number | null>>,
	pettyCash: Map<number, Map<string, number | null>>
): Map<number, Map<string, number | null>> {
	const merged = new Map<number, Map<string, number | null>>();
	for (const source of [direct, pettyCash]) {
		for (const [projectId, perCurrency] of source) {
			const target = merged.get(projectId) ?? new Map<string, number | null>();
			for (const [currency, amount] of perCurrency) {
				const existing = target.get(currency);
				if (existing === undefined) {
					target.set(currency, amount);
				} else if (existing === null || amount === null) {
					target.set(currency, null);
				} else {
					target.set(currency, existing + amount);
				}
			}
			merged.set(projectId, target);
		}
	}
	return merged;
}

/** Today's calendar month, from the server clock. */
export function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

/** Months with cost recorded in any wired source, newest first. */
export async function fetchExpenditureMonths(): Promise<string[]> {
	const [direct, pettyCash] = await Promise.all([
		loadExpenditureMonths(pool, currentMonth()),
		PETTY_CASH_COST_SOURCE.loadMonths(pool),
	]);
	return [...new Set([currentMonth(), ...direct, ...pettyCash])]
		.sort()
		.reverse();
}

export interface ReconciliationRequest {
	/** `YYYY-MM` of the Recognition Period being viewed. */
	month: string;
	/** Narrow the Project detail; never the company reconciliation. */
	projectId?: number | null;
	/** Requested reporting basis; absent means the company reporting currency. */
	reportingCurrency?: string | null;
}

/** Covering budgets plus the row Projects' budgets, without duplicates. */
function mergeBudgets(...groups: CostBudgetRecord[][]): CostBudgetRecord[] {
	const byUid = new Map<string, CostBudgetRecord>();
	for (const group of groups) {
		for (const budget of group) byUid.set(budget.budget_uid, budget);
	}
	return [...byUid.values()];
}

/**
 * Read one month's company reconciliation.
 *
 * Pass `options.connection` to read inside the caller's transaction (the later
 * financial-close slice takes one coherent snapshot across every source).
 */
export async function fetchCompanyReconciliation(
	request: ReconciliationRequest,
	options?: CommandOptions
): Promise<CompanyReconciliation> {
	const db = options?.connection ?? pool;
	const month = request.month;
	const previousMonth = previousMonthOf(month);
	const [
		records,
		pettyCashRecords,
		pettyCash,
		previousProjectCost,
		previousPettyCashProjectCost,
		projectOptions,
		directMonths,
		pettyCashMonths,
	] = await Promise.all([
		loadMonthRecords(db, month),
		PETTY_CASH_COST_SOURCE.loadMonthRecords(db, month),
		loadPettyCashSummary(db, month),
		previousMonth
			? loadMonthProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		previousMonth
			? PETTY_CASH_COST_SOURCE.loadProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		loadProjectOptions(db),
		loadExpenditureMonths(db, currentMonth()),
		PETTY_CASH_COST_SOURCE.loadMonths(db),
	]);
	const sourceRecords = [...records, ...pettyCashRecords];
	const availableMonths = [
		...new Set([currentMonth(), ...directMonths, ...pettyCashMonths]),
	]
		.sort()
		.reverse();
	// A budget is read when it covers the month or belongs to a Project the
	// month has a row for, so an approved budget for another period is stated
	// as such instead of the Project reading as unbudgeted.
	const budgets = mergeBudgets(
		await loadBudgetsCoveringMonth(db, month),
		await loadBudgetsForProjects(db, projectIdsIn(sourceRecords))
	);

	return buildReconciliation({
		month,
		records: sourceRecords,
		previousMonthProjectCost: mergeProjectCost(
			previousProjectCost,
			previousPettyCashProjectCost
		),
		budgets,
		projectFilter: request.projectId ?? null,
		projectOptions,
		availableMonths,
		coverageDeclarations: SOURCE_COVERAGE,
		reportingCurrency: request.reportingCurrency ?? null,
		pettyCash,
	});
}

/**
 * The petty-cash register's own view: funding, spending, remaining supported
 * funding, and recognized cost — for one month, or all time when `month` is
 * null.
 */
export async function fetchPettyCashSummary(
	month: string | null = null
): Promise<PettyCashSummary> {
	return loadPettyCashSummary(pool, month);
}

/** One Project's cost budgets, every state, newest first. */
export async function fetchProjectBudgets(
	projectId: number,
	options?: CommandOptions
): Promise<CostBudgetRecord[]> {
	return loadBudgetsForProject(options?.connection ?? pool, projectId);
}

/** One cost budget with its append-only journal, or null when unknown. */
export async function fetchCostBudget(
	id: number,
	options?: CommandOptions
): Promise<CostBudgetDetail | null> {
	const db = options?.connection ?? pool;
	const budget = await loadBudget(db, id);
	if (!budget) return null;
	return { budget, journal: await loadBudgetEvents(db, budget.budget_uid) };
}

/** The versioned history of one cost budget, by its stable identity. */
export async function fetchBudgetJournal(
	budgetUid: string,
	options?: CommandOptions
): Promise<CostBudgetJournalEntry[]> {
	return loadBudgetEvents(options?.connection ?? pool, budgetUid);
}

/** Read the records behind a month's reconciliation. */
export async function fetchCostDrilldown(
	queryInput: CostDrilldownQuery,
	options?: CommandOptions
): Promise<CostDrilldown> {
	const db = options?.connection ?? pool;
	const limit = Math.min(Math.max(queryInput.limit ?? 50, 1), 200);
	const offset = Math.max(queryInput.offset ?? 0, 0);
	// Reads every source over the same widened window, then states one ordered,
	// paginated union: a confirmed petty-cash cost appears exactly once. The
	// per-source loaders cap their own window at 200 rows, so the union page is
	// bounded the same way (deeper offsets rely on the ordered window).
	const window: CostDrilldownQuery = {
		...queryInput,
		limit: Math.min(limit + offset, 200),
		offset: 0,
	};
	const [expenses, pettyCash] = await Promise.all([
		loadDrilldown(db, window),
		PETTY_CASH_COST_SOURCE.loadDrilldown(db, window),
	]);
	const records = [...expenses.records, ...pettyCash.records]
		.sort(compareDrilldownRecords)
		.slice(offset, offset + limit);
	const expensesHasRows = expenses.totals.records > 0;
	const pettyCashHasRows = pettyCash.total > 0;
	return {
		month: queryInput.month,
		scope: 'month',
		total: expenses.total + pettyCash.total,
		limit,
		offset,
		records,
		totals: {
			confirmed_amount: mergedDrilldownAmount(
				expenses.totals,
				pettyCash,
				expensesHasRows,
				pettyCashHasRows
			),
			currency: mergedDrilldownCurrency(
				expenses.totals,
				pettyCash,
				expensesHasRows,
				pettyCashHasRows
			),
			records: expenses.totals.records + pettyCash.total,
		},
	};
}

/** Highest-first by Recognition Period, then expense date, then source, id. */
function compareDrilldownRecords(a: CostRecordJson, b: CostRecordJson): number {
	const periodA = a.recognition_period ?? '';
	const periodB = b.recognition_period ?? '';
	if (periodA !== periodB) return periodA < periodB ? 1 : -1;
	const dateA = a.expense_date ?? '';
	const dateB = b.expense_date ?? '';
	if (dateA !== dateB) return dateA < dateB ? 1 : -1;
	if (a.source !== b.source) return a.source === 'direct_expense' ? -1 : 1;
	return b.id - a.id;
}

/**
 * The union totals can be stated as one figure only when every contributing
 * source states a number in the same currency; otherwise the figure is null
 * (unknown, never a wrong sum). A source with no rows states nothing.
 */
function mergedDrilldownAmount(
	expensesTotals: CostDrilldown['totals'],
	pettyCash: PettyCashDrilldown,
	expensesHasRows: boolean,
	pettyCashHasRows: boolean
): number | null {
	if (!pettyCashHasRows) return expensesTotals.confirmed_amount;
	if (!expensesHasRows) return pettyCash.confirmed_amount;
	if (
		expensesTotals.confirmed_amount === null ||
		pettyCash.confirmed_amount === null ||
		expensesTotals.currency === null ||
		pettyCash.currency === null ||
		expensesTotals.currency !== pettyCash.currency
	) {
		return null;
	}
	return expensesTotals.confirmed_amount + pettyCash.confirmed_amount;
}

function mergedDrilldownCurrency(
	expensesTotals: CostDrilldown['totals'],
	pettyCash: PettyCashDrilldown,
	expensesHasRows: boolean,
	pettyCashHasRows: boolean
): string | null {
	if (!pettyCashHasRows) return expensesTotals.currency;
	if (!expensesHasRows) return pettyCash.currency;
	if (
		expensesTotals.confirmed_amount === null ||
		pettyCash.confirmed_amount === null
	) {
		return null;
	}
	return expensesTotals.currency === pettyCash.currency
		? expensesTotals.currency
		: null;
}

/** Read the versioned command history of one cost. */
export async function fetchCostJournal(
	costUid: string,
	options?: CommandOptions
): Promise<CostJournalEntry[]> {
	return loadCostEvents(options?.connection ?? pool, costUid);
}
