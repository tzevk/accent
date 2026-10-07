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
 *     fetchCompanyReconciliation({ month, projectId?, asOf?, reportingCurrency? })
 *       Company Incurred Cost for a month, split into Incurred Project Cost,
 *       Company Overhead, and Unallocated Cost per currency, plus the Project
 *       breakdown, evidence states, and the coverage notices that say what the
 *       total does and does not include. The figures are stated in the
 *       requested reporting currency (INR by default) using only matching
 *       stored conversion evidence; an unconverted amount stays in its own
 *       currency subtotal with an explicit exception.
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
 *     fetchProjectBudgets(projectId)
 *       Every approved (and draft) Project cost budget with its amount,
 *       currency, scope, period, approval evidence, and version.
 *     fetchCostBudget(id) / fetchBudgetJournal(budgetUid)
 *       One cost budget and its append-only approval journal.
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
import {
	fetchSupplierCommitmentRollforward,
	loadOrderCommitmentMonths,
} from './commitments';
import { SOURCE_COVERAGE } from './coverage';
import { loadCombinedDrilldown } from './drilldown';
import {
	loadChargeTotals,
	loadCostEvents,
	loadCostRecordsByIds,
	loadExpenditureMonths,
	loadMonthCharges,
	loadMonthProjectCost,
	loadMonthRecords,
	loadNonOperatingSources,
	loadProjectCostBefore,
	loadProjectOptions,
	type ProjectOption,
	type SqlConnection,
} from './records';
export type { SqlConnection } from './records';
import { previousMonthOf } from './ranking';
import {
	loadAllocatedProjectCostBefore,
	loadMonthAllocatedProjectCost,
	loadPayrollAllocationMonths,
	loadPayrollDrilldown,
	loadPayrollMonth,
} from './payroll';
import {
	PETTY_CASH_COST_SOURCE,
	loadPettyCashProjectCostBefore,
	loadPettyCashSummary,
} from './petty-cash';
import { buildReconciliation, projectIdsIn } from './reconciliation';
import { registerCostSource } from './sources';
import {
	loadFilteredOtherExpenseRecords,
	loadOtherExpenseMonthProjectCost,
	loadOtherExpenseMonthRecords,
	loadOtherExpenseMonths,
	loadOtherExpenseProjectCostBefore,
	mergeProjectCostMaps,
} from './other-expenses';
import {
	SUPPLIER_INVOICE_ADAPTER,
	loadSupplierInvoiceMonths,
	loadSupplierMonthProjectCost,
	loadSupplierMonthRecords,
	loadSupplierProjectCostBefore,
} from './supplier-invoices';
import type {
	CompanyReconciliation,
	CostBudgetJournalEntry,
	CostBudgetRecord,
	CostDrilldown,
	CostDrilldownQuery,
	CostJournalEntry,
	PayrollDrilldown,
	CostRecordJson,
	PettyCashSummary,
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
export {
	ensureFundingMirror,
	executePettyCashCommand,
	fundingEventUid,
	isPettyCashCommand,
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
export {
	decideSupplierLink,
	executeSupplierCommand,
	initializeSupplierCost,
	loadSupplierInvoiceDetail,
} from './supplier-invoices';
export type {
	InitializeSupplierCostInput,
	RecordedSupplierCost,
	SupplierCommandInput,
	SupplierInvoiceDetail,
	SupplierInvoicePatch,
	SupplierLinkCandidate,
	SupplierLinkRow,
	SupplierSplitInput,
	SupplierSplitRow,
} from './supplier-invoices';
export { isDrilldownSource } from './drilldown';
export { recordCostBudget, executeBudgetCommand } from './budget-commands';
export {
	fetchOrderCommitment,
	fetchSupplierCommitmentRollforward,
	loadOrderCommitmentMonths,
	recordOrderConsumption,
	releaseOrderConsumption,
} from './commitments';
export type {
	CommitmentBasis,
	CommitmentException,
	CommitmentRollforwardMonth,
	CommitmentRollforwardQuery,
	ConsumptionSource,
	ConsumptionState,
	OrderCommitmentDetail,
	OrderConsumptionCandidate,
	OrderConsumptionRecord,
	RecordOrderConsumptionInput,
	RecordOrderConsumptionResult,
	ReleaseOrderConsumptionInput,
	SupplierCommitmentOrderRow,
	SupplierCommitmentSection,
	SupplierCommitmentTotal,
} from './commitments';
export { PETTY_CASH_COST_SOURCE } from './petty-cash';
export type { PettyCashSourceDescriptor } from './petty-cash';
export { SOURCE_COVERAGE } from './coverage';
export { linkCostReference } from './sources';
export type { SourceCoverageDeclaration } from './coverage';
export type { ProjectOption } from './records';
export {
	REPORTING_CURRENCY,
	convertToReporting,
	conversionException,
	conversionStatusOf,
	isCurrencyCode,
	reportingCurrencyOf,
} from './currency';
export { monthLabel } from './reconciliation';
export { dayOfDate } from './ranking';
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
	ChangeState,
	CompanyConversion,
	CompanyReconciliation,
	ComparisonBasis,
	ComparisonCurrency,
	ComparisonDisclosure,
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
	CostSource,
	CostSplitInfo,
	CoverageNotice,
	CurrencyReporting,
	CurrencyTotal,
	EvidenceSummary,
	FilteredProjectSubtotal,
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
	PettyCashCurrencySummary,
	PettyCashSummary,
	PeriodChargeJson,
	PeriodChargeBasis,
	PeriodChargeState,
	PeriodComparison,
	ProjectBudgetComparison,
	ProjectEvidenceState,
	ProjectRanking,
	RankingEntry,
	RecognitionState,
	RecordCostBudgetInput,
	RecordCostInput,
	RecordedCost,
	ReconciliationProjectRow,
	ReconciliationSourceSummary,
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

// The supplier source registers its adapter so a `cost_uid` can resolve to a
// purchase invoice from anywhere in the module.
registerCostSource(SUPPLIER_INVOICE_ADAPTER);


/** Today's calendar month, from the server clock. */
export function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

/** Today's date, from the server clock: the default as-of of a month. */
export function currentDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Months with cost recorded in any wired source, newest first. */
export async function fetchExpenditureMonths(): Promise<string[]> {
	const current = currentMonth();
	const [direct, supplier, payroll, otherExpense, pettyCash, orders] =
		await Promise.all([
			loadExpenditureMonths(pool, current),
			loadSupplierInvoiceMonths(pool, current),
			loadPayrollAllocationMonths(pool),
			loadOtherExpenseMonths(pool, current),
			PETTY_CASH_COST_SOURCE.loadMonths(pool),
			loadOrderCommitmentMonths(pool),
		]);
	const months = new Set([
		...direct,
		...supplier,
		...payroll,
		...otherExpense,
		...pettyCash,
		// An order-only historical month (a commitment recorded with no cost
		// yet) must stay reachable through the month controls.
		...orders,
	]);
	months.add(current);
	return [...months].sort().reverse();
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
	const today = currentDate();
	const previousMonth = previousMonthOf(month);
	const [
		directRecords,
		directPriorRecords,
		directCostBefore,
		supplierRecords,
		supplierPriorRecords,
		otherExpenseRecords,
		otherExpensePriorRecords,
		charges,
		monthNonOperating,
		pettyCashRecords,
		pettyCashPriorRecords,
		pettyCash,
		previousProjectCost,
		previousCharges,
		previousOtherExpenseProjectCost,
		previousPettyCashProjectCost,
		previousSupplierProjectCost,
		supplierCostBefore,
		otherExpenseCostBefore,
		pettyCashCostBefore,
		payrollCostBefore,
		projectOptions,
		directMonths,
		supplierMonths,
		payrollMonths,
		payroll,
		previousPayrollCost,
		otherExpenseMonths,
		pettyCashMonths,
		orderMonths,
	] = await Promise.all([
		loadMonthRecords(db, month),
		loadMonthRecords(db, previousMonth),
		loadProjectCostBefore(db, month),
		loadSupplierMonthRecords(db, month),
		loadSupplierMonthRecords(db, previousMonth),
		loadOtherExpenseMonthRecords(db, month),
		previousMonth
			? loadOtherExpenseMonthRecords(db, previousMonth)
			: Promise.resolve([]),
		loadMonthCharges(db, { month }),
		loadNonOperatingSources(db, month),
		PETTY_CASH_COST_SOURCE.loadMonthRecords(db, month),
		previousMonth
			? PETTY_CASH_COST_SOURCE.loadMonthRecords(db, previousMonth)
			: Promise.resolve([]),
		loadPettyCashSummary(db, month),
		previousMonth
			? loadMonthProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		previousMonth
			? loadMonthCharges(db, { month: previousMonth })
			: Promise.resolve([]),
		previousMonth
			? loadOtherExpenseMonthProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		previousMonth
			? PETTY_CASH_COST_SOURCE.loadProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		previousMonth
			? loadSupplierMonthProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		loadSupplierProjectCostBefore(db, month),
		loadOtherExpenseProjectCostBefore(db, month),
		loadPettyCashProjectCostBefore(db, month),
		loadAllocatedProjectCostBefore(db, month),
		loadProjectOptions(db),
		loadExpenditureMonths(db, currentMonth()),
		loadSupplierInvoiceMonths(db, currentMonth()),
		loadPayrollAllocationMonths(db),
		loadPayrollMonth(db, month),
		previousMonth
			? loadMonthAllocatedProjectCost(db, previousMonth)
			: Promise.resolve(new Map<number, Map<string, number | null>>()),
		loadOtherExpenseMonths(db, currentMonth()),
		PETTY_CASH_COST_SOURCE.loadMonths(db),
		loadOrderCommitmentMonths(db),
	]);
	const records = [
		...directRecords,
		...supplierRecords,
		...otherExpenseRecords,
		...pettyCashRecords,
	];
	// The comparison's prior window reads the same sources the month reads, so
	// its prior side is measured from evidence and not from a single source.
	const priorMonthRecords = [
		...directPriorRecords,
		...supplierPriorRecords,
		...otherExpensePriorRecords,
		...pettyCashPriorRecords,
	];

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

	// The prior-month comparison is like-for-like across every wired source:
	// recorded employee cost is part of the month it was frozen in, supplier
	// cost joins the direct, other-expense, and petty-cash costs, and the
	// direct loader already includes the month's approved period charges.
	const previousMonthProjectCost = [
		previousProjectCost,
		previousSupplierProjectCost,
		previousOtherExpenseProjectCost,
		previousPettyCashProjectCost,
		previousPayrollCost,
	].reduce(
		mergeProjectCostMaps,
		new Map<number, Map<string, number | null>>()
	);
	// Cost to Date is cumulative across the same sources: every month before
	// the reported one, recognized operating Project cost plus approved period
	// charges (the direct loader covers both), each source in its own currency.
	const projectCostBefore = [
		directCostBefore,
		supplierCostBefore,
		otherExpenseCostBefore,
		pettyCashCostBefore,
		payrollCostBefore,
	].reduce(
		mergeProjectCostMaps,
		new Map<number, Map<string, number | null>>()
	);
	// A budget is read when it covers the month or belongs to a Project the
	// month has a row for, so an approved budget for another period is stated
	// as such instead of the Project reading as unbudgeted.
	const budgets = mergeBudgets(
		await loadBudgetsCoveringMonth(db, month),
		await loadBudgetsForProjects(db, projectIdsIn(records, charges))
	);
	// Outstanding Supplier Commitment (#312): reconstructed as of the month
	// from the order journal and the recorded consumption, on the caller's
	// connection so a financial close takes one coherent snapshot.
	const supplierCommitment = await fetchSupplierCommitmentRollforward(
		{ month },
		{ connection: db }
	);

	return buildReconciliation({
		month,
		records,
		priorMonthRecords,
		asOf: request.asOf ?? today,
		projectCostBefore,
		priorCharges: previousCharges,
		priorPayrollCost: previousPayrollCost,
		charges,
		nonOperatingSources,
		chargeTotals,
		previousMonthProjectCost,
		budgets,
		projectFilter: request.projectId ?? null,
		projectOptions,
		supplierCommitment,
		availableMonths: [
			...new Set([
				...directMonths,
				...supplierMonths,
				...payrollMonths,
				...otherExpenseMonths,
				...pettyCashMonths,
				...orderMonths,
			]),
		]
			.sort()
			.reverse(),
		currentMonth: currentMonth(),
		coverageDeclarations: SOURCE_COVERAGE,
		payroll,
		reportingCurrency: request.reportingCurrency ?? null,
		pettyCash,
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

/** Read the records behind a month's reconciliation (every cost source). */
export async function fetchCostDrilldown(
	queryInput: CostDrilldownQuery,
	options?: CommandOptions
): Promise<CostDrilldown> {
	return loadCombinedDrilldown(options?.connection ?? pool, queryInput);
}

/** The active Projects a cost-destination control can choose from. */
export async function fetchProjectOptions(): Promise<ProjectOption[]> {
	return loadProjectOptions(pool);
}

/** Read the versioned command history of one cost. */
export async function fetchCostJournal(
	costUid: string,
	options?: CommandOptions
): Promise<CostJournalEntry[]> {
	return loadCostEvents(options?.connection ?? pool, costUid);
}
