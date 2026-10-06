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
 *     capturePeriodCharge({ sourceId, period, basis, amount, evidenceReference }, actor)
 *       Approve period consumption, depreciation, or amortization against a
 *       non-operating item's supported balance (#317).
 *     cancelPeriodCharge({ chargeUid, command: 'cancel', expectedVersion, reason }, actor)
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
 *  - an advance, deposit, prepayment, or capital item is never expensed by its
 *    payment: only approved, evidenced period charges become cost, in the
 *    charge's own month, and they never exceed the source's confirmed balance;
 *  - an approved cost budget is compared with Incurred Project Cost only when
 *    Project, currency, scope, and a period exactly equal to the month all
 *    match, the month's cost is supported by a confirmed source, and no
 *    proportional allocation is applied — `budgets` is its own section of the
 *    reconciliation and never enters a cost total.
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
import {
	loadMonthAllocatedProjectCost,
	loadPayrollAllocationMonths,
	loadPayrollDrilldown,
	loadPayrollMonth,
} from './payroll';
import { buildReconciliation, projectIdsIn } from './reconciliation';
import type {
	CompanyReconciliation,
	CostBudgetJournalEntry,
	CostBudgetRecord,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
	PayrollDrilldown,
} from './types';

export { recordCost, executeCommand, loadCost, CostError } from './commands';
export type { CostActor, CommandOptions } from './commands';
export { capturePeriodCharge, cancelPeriodCharge } from './charges';
export type {
	CapturePeriodChargeInput,
	PeriodChargeCommandInput,
} from './charges';

export {
	createOrder,
	fetchOrder,
	fetchOrders,
	fetchOrderReviewQueue,
	linkClientInvoice,
	resolveLegacyOrder,
	statedOrderValue,
	updateOrder,
	OrderError,
} from './orders';
export type {
	ClientInvoiceLinkInput,
	ClientInvoiceLinkResult,
	CreateOrderInput,
	LegacyOrderDecision,
	LegacyOrderMapping,
	LegacyOrderResolution,
	LegacyOrderResolutionInput,
	LegacyOrderStore,
	LegacyReviewState,
	OrderActor,
	OrderAmountBasis,
	OrderDirection,
	OrderEventRecord,
	OrderFirmness,
	OrderList,
	OrderOptions,
	OrderPatch,
	OrderQuery,
	OrderRecord,
	OrderReviewQueue,
	OrderStatus,
	OrderValueTotal,
	UpdateOrderInput,
} from './orders';
export { recordCostBudget, executeBudgetCommand } from './budget-commands';
export { SOURCE_COVERAGE } from './coverage';
export type { SourceCoverageDeclaration } from './coverage';
export {
	REPORTING_CURRENCY,
	convertToReporting,
	conversionException,
	conversionStatusOf,
	isCurrencyCode,
	reportingCurrencyOf,
} from './currency';
export { monthLabel } from './reconciliation';
export { COST_BUDGET_SCOPES, isCostBudgetScope } from './types';
export {
	allocateEmployerCost,
	freezeMonthAllocations,
	loadMonthAllocatedProjectCost,
	loadPayrollMonth,
	PAYROLL_CURRENCY,
	summarizePayroll,
} from './payroll';
export type {
	AllocationLine,
	AllocationOutcome,
	FreezeSummary,
	PayrollMonthInterpretation,
} from './payroll';
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
	CostNature,
	CostPatch,
	CostRecord,
	CostRecordJson,
	CoverageNotice,
	CurrencyReporting,
	CurrencyTotal,
	EvidenceSummary,
	NonOperatingItemJson,
	NonOperatingSection,
	PayrollCostStatus,
	PayrollDrilldown,
	PayrollEmployeeCost,
	PayrollExpenditure,
	PayrollHourLine,
	PayrollPayStream,
	PayrollProjectShare,
	PayrollShareBasis,
	PeriodBasis,
	PeriodChargeJson,
	PeriodChargeBasis,
	PeriodChargeState,
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

/** Today's calendar month, from the server clock. */
export function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

/** Months with direct cost or recorded employee cost, newest first. */
export async function fetchExpenditureMonths(): Promise<string[]> {
	const [direct, payroll] = await Promise.all([
		loadExpenditureMonths(pool, currentMonth()),
		loadPayrollAllocationMonths(pool),
	]);
	const months = new Set([...direct, ...payroll]);
	months.add(currentMonth());
	return [...months].sort().reverse();
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
		charges,
		monthNonOperating,
		previousProjectCost,
		projectOptions,
		availableMonths,
		payroll,
		previousPayrollCost,
	] = await Promise.all([
		loadMonthRecords(db, month),
		loadMonthCharges(db, { month }),
		loadNonOperatingSources(db, month),
		previousMonth
			? loadMonthProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		loadProjectOptions(db),
		loadExpenditureMonths(db, currentMonth()),
		loadPayrollMonth(db, month),
		previousMonth
			? loadMonthAllocatedProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
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
	for (const record of await loadCostRecordsByIds(db, chargeSourceIds)) {
		sourcesById.set(record.id, record);
	}
	const nonOperatingSources = [...sourcesById.values()];
	const chargeTotals = await loadChargeTotals(
		db,
		nonOperatingSources
			.map((record) => record.costUid)
			.filter((uid): uid is string => !!uid)
	);

	// The prior-month comparison is like-for-like: recorded employee cost is
	// part of the month it was frozen in.
	for (const [projectId, perCurrency] of previousPayrollCost) {
		const target =
			previousProjectCost.get(projectId) ??
			new Map<string, number | null>();
		for (const [currency, amount] of perCurrency) {
			const existing = target.get(currency);
			if (existing === undefined) {
				target.set(currency, amount);
			} else if (existing !== null && amount !== null) {
				target.set(currency, existing + amount);
			} else {
				target.set(currency, null);
			}
		}
		previousProjectCost.set(projectId, target);
	}
	// A budget is read when it covers the month or belongs to a Project the
	// month has a row for, so an approved budget for another period is stated
	// as such instead of the Project reading as unbudgeted.
	const budgets = mergeBudgets(
		await loadBudgetsCoveringMonth(db, month),
		await loadBudgetsForProjects(db, projectIdsIn(records, charges))
	);

	return buildReconciliation({
		month,
		records,
		charges,
		nonOperatingSources,
		chargeTotals,
		previousMonthProjectCost: previousProjectCost,
		budgets,
		projectFilter: request.projectId ?? null,
		projectOptions,
		availableMonths,
		coverageDeclarations: SOURCE_COVERAGE,
		payroll,
		reportingCurrency: request.reportingCurrency ?? null,
	});
}

/** Read the employee-cost drilldown behind one month's reconciliation. */
export async function fetchPayrollDrilldown(
	month: string,
	employeeId: number | null = null,
	options?: CommandOptions
): Promise<PayrollDrilldown> {
	const { interpretation, employees, totals } = await loadPayrollDrilldown(
		options?.connection ?? pool,
		month,
		employeeId
	);
	return {
		month,
		month_label: interpretation.monthLabel,
		currency: interpretation.currency,
		totals,
		employees,
		coverage: interpretation.coverage,
	};
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
	return loadDrilldown(options?.connection ?? pool, queryInput);
}

/** Read the versioned command history of one cost. */
export async function fetchCostJournal(
	costUid: string,
	options?: CommandOptions
): Promise<CostJournalEntry[]> {
	return loadCostEvents(options?.connection ?? pool, costUid);
}
