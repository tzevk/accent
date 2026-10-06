/**
 * Approved cost budget comparison — the isolated budget section of the monthly
 * reconciliation.
 *
 * Rules it enforces, straight from the ticket and the parent specification:
 *  - A variance is published only when an *approved* budget matches the
 *    Project, the currency, the scope (a cost budget for Incurred Project
 *    Cost), and the period of the month being read.
 *  - A missing, unapproved, incompatible, or ambiguous budget is stated
 *    explicitly and never guessed: no Project commercial field, quotation, or
 *    order value is ever read as a budget.
 *  - A budget never enters Company Incurred Cost, the Project breakdown, or
 *    the evidence summary. It is its own section beside them.
 *  - Remaining or overspent budget is the difference between the approved cost
 *    budget and *confirmed* Incurred Project Cost for that month. It is not
 *    profit, recognized revenue, or a forecast of uncommitted future work.
 *
 * Pure: all data arrives as arguments.
 */

import { sub, toNumber } from '@/lib/money';
import { isConfirmed, isOpenState } from './recognition';
import { monthBounds } from './records';
import type {
	BudgetOutcome,
	BudgetSection,
	CostBudgetCandidate,
	CostBudgetRecord,
	CostRecord,
	CoverageNotice,
	ProjectBudgetComparison,
} from './types';
import { toBudgetCandidate } from './budget-records';

/** One Project row of the reconciliation, as the comparison reads it. */
export interface BudgetComparisonRow {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	currency: string;
	incurred_cost: number;
}

export interface BudgetComparisonInput {
	month: string;
	/** The reconciliation's own Project rows; the single aggregation. */
	rows: BudgetComparisonRow[];
	/** The month's direct costs, for the confirmed/pending disclosure. */
	records: CostRecord[];
	/** Covering budgets plus the budgets of the Projects above. */
	budgets: CostBudgetRecord[];
	projectFilter: number | null;
}

const BASIS =
	'An approved cost budget is compared with confirmed Incurred Project Cost ' +
	'for the same Project, currency, and month. The budget amount is stated on ' +
	'the same basis as Incurred Project Cost: non-recoverable tax included, ' +
	'evidence-backed recoverable tax excluded.';

const VARIANCE_NOTE =
	'Remaining or overspent budget is the difference between the approved cost ' +
	'budget and confirmed Incurred Project Cost for that month. It is not ' +
	'profit, recognized revenue, or a forecast of uncommitted future work.';

/** The comparison never crosses currencies, so no conversion is involved. */
function money(value: number, currency: string): string {
	return `${value.toFixed(2)} ${currency}`;
}

interface CandidateFlags {
	covers: boolean;
	scope: boolean;
	currency: boolean;
	approved: boolean;
}

/**
 * How closely one budget matches this month's row. Covering the month counts
 * most: that is what the reader asked about, so a covering draft is the more
 * relevant fact than an approved budget for a different period. Currency and
 * scope come next (never convert, never compare a non-cost budget), and
 * approval last, because an unapproved budget is not yet a budget.
 */
function matchScore(flags: CandidateFlags): number {
	return (
		(flags.covers ? 8 : 0) +
		(flags.scope ? 4 : 0) +
		(flags.currency ? 2 : 0) +
		(flags.approved ? 1 : 0)
	);
}

function flagsOf(
	budget: CostBudgetRecord,
	monthStart: string,
	monthEnd: string,
	currency: string
): CandidateFlags {
	return {
		covers: budget.period_start <= monthEnd && budget.period_end >= monthStart,
		scope: budget.scope === 'project_incurred_cost',
		currency: budget.currency === currency,
		approved: budget.state === 'approved',
	};
}

function describe(candidate: CostBudgetCandidate): string {
	const parts = [
		`${money(candidate.amount, candidate.currency)} approved cost budget ${candidate.budget_uid}`,
		`version ${candidate.financial_version}`,
		`period ${candidate.period_start} to ${candidate.period_end}`,
	];
	if (candidate.approval_evidence_reference) {
		parts.push(`approval evidence ${candidate.approval_evidence_reference}`);
	}
	if (candidate.state !== 'approved') {
		parts.push(`state ${candidate.state}`);
	}
	return parts.join(', ');
}

/** The pending-cost sentence a reader needs before trusting a comparison. */
function pendingNote(pendingRecords: number): string {
	if (pendingRecords === 0) return '';
	return ` ${pendingRecords} record(s) for this Project are not confirmed cost yet and are not part of the comparison.`;
}

function evaluateRow(
	row: BudgetComparisonRow,
	month: string,
	monthStart: string,
	monthEnd: string,
	candidates: CostBudgetRecord[],
	records: CostRecord[]
): ProjectBudgetComparison {
	const key = records.filter(
		(record) =>
			record.classification === 'project' &&
			record.projectId === row.project_id &&
			(record.currency ?? 'INR') === row.currency
	);
	const confirmedRecords = key.filter((record) => isConfirmed(record.state)).length;
	const pendingRecords = key.filter((record) => isOpenState(record.state)).length;

	const flagged = candidates
		.map((budget) => ({
			budget,
			flags: flagsOf(budget, monthStart, monthEnd, row.currency),
		}))
		.sort(
			(a, b) =>
				matchScore(b.flags) - matchScore(a.flags) ||
				a.budget.budget_uid.localeCompare(b.budget.budget_uid)
		);
	const chosen = flagged.length > 0 ? flagged[0] : null;
	const compatible = flagged.filter(
		(item) =>
			item.flags.approved &&
			item.flags.covers &&
			item.flags.scope &&
			item.flags.currency
	);
	const candidateList = candidates.map(toBudgetCandidate);

	const base = {
		project_id: row.project_id,
		project_code: row.project_code,
		project_name: row.project_name,
		client_name: row.client_name,
		currency: row.currency,
		incurred_cost: row.incurred_cost,
		confirmed_records: confirmedRecords,
		pending_records: pendingRecords,
		candidates: candidateList,
	};

	// `budget` is the comparison basis: set only when a single approved budget
	// matches (or would match once the missing confirmed cost exists). Every
	// other outcome names its candidates instead of implying an approved basis.
	const incompatible = (
		outcome: BudgetOutcome,
		detail: string,
		budget: CostBudgetCandidate | null = null
	): ProjectBudgetComparison => ({
		...base,
		outcome,
		budget,
		variance: null,
		over_budget: null,
		detail,
	});

	if (compatible.length > 1 && confirmedRecords === 0) {
		return incompatible(
			'unsupported_incurred_cost',
			`No confirmed Incurred Project Cost is recorded for ${row.project_code} in ${row.currency} for ${month}, and ${compatible.length} approved budgets cover it (${compatible
				.map((item) => item.budget.budget_uid)
				.join(', ')}), so no variance is stated.${pendingNote(pendingRecords)}`
		);
	}

	if (compatible.length > 1) {
		return incompatible(
			'ambiguous',
			`${compatible.length} approved cost budgets (${compatible
				.map((item) => item.budget.budget_uid)
				.join(', ')}) cover ${row.project_code} in ${row.currency} for ${month}, so no single budget is compared. Withdraw or supersede one of them.`
		);
	}

	if (compatible.length === 1) {
		const budget = compatible[0].budget;
		if (confirmedRecords === 0) {
			return incompatible(
				'unsupported_incurred_cost',
				`${describe(toBudgetCandidate(budget))} covers ${row.project_code} in ${row.currency} for ${month}, but no confirmed Incurred Project Cost is recorded, so no variance is stated against a zero that is not confirmed.${pendingNote(pendingRecords)}`,
				toBudgetCandidate(budget)
			);
		}
		const variance = toNumber(
			sub(budget.amount, row.incurred_cost).toDecimalPlaces(2)
		);
		return {
			...base,
			outcome: 'compared',
			budget: toBudgetCandidate(budget),
			variance,
			over_budget: variance < 0,
			detail:
				`${describe(toBudgetCandidate(budget))} compared with confirmed Incurred Project Cost ` +
				`${money(row.incurred_cost, row.currency)} for ${month}: ` +
				`${variance < 0 ? 'over budget by' : 'remaining'} ${money(Math.abs(variance), row.currency)}.` +
				pendingNote(pendingRecords),
		};
	}

	if (!chosen) {
		return incompatible(
			'missing',
			`No approved cost budget is recorded for ${row.project_code} in ${row.currency} covering ${month}. ` +
				`Incurred Project Cost of ${money(row.incurred_cost, row.currency)} is reported without a budget comparison.${pendingNote(pendingRecords)}`
		);
	}

	const candidate = toBudgetCandidate(chosen.budget);
	if (!chosen.flags.covers) {
		return incompatible(
			'incompatible_period',
			`${describe(candidate)} does not cover ${month}, so it is not compared with ${row.project_code}'s incurred cost for ${month}.`
		);
	}
	if (!chosen.flags.scope) {
		return incompatible(
			'incompatible_scope',
			`${describe(candidate)} declares a commercial value, not a cost budget, so it is not compared with Incurred Project Cost. Record an approved cost budget for ${row.project_code}.`
		);
	}
	if (!chosen.flags.currency) {
		return incompatible(
			'incompatible_currency',
			`${describe(candidate)} is stated in ${candidate.currency} and this Project's cost for ${month} is ${row.currency}; currencies are never converted to force a comparison.`
		);
	}
	return incompatible(
		'unapproved',
		`${describe(candidate)} covers ${row.project_code} in ${row.currency} for ${month} but is not approved, so it is not compared.${pendingNote(pendingRecords)}`
	);
}

function notice(
	code: string,
	label: string,
	detail: string,
	severity: 'warning' | 'info'
): CoverageNotice {
	return { code, label, detail, severity };
}

/** The month's budget section: one entry per Project/currency, plus notices. */
export function buildBudgetSection(input: BudgetComparisonInput): BudgetSection {
	const { month, rows, records, budgets, projectFilter } = input;
	const { start, end } = monthBounds(month);
	const visible = budgets.filter(
		(budget) => projectFilter === null || budget.project_id === projectFilter
	);
	const candidatesByProject = new Map<number, CostBudgetRecord[]>();
	for (const budget of visible) {
		const list = candidatesByProject.get(budget.project_id) ?? [];
		list.push(budget);
		candidatesByProject.set(budget.project_id, list);
	}

	const comparisons: ProjectBudgetComparison[] = rows.map((row) =>
		evaluateRow(
			row,
			month,
			start,
			end,
			candidatesByProject.get(row.project_id) ?? [],
			records
		)
	);

	// An approved budget with no Incurred Project Cost beside it is stated too:
	// an empty store is not proof that nothing was spent.
	const rowProjects = new Set(rows.map((row) => row.project_id));
	const budgetOnlyKeys = new Set<string>();
	for (const budget of visible) {
		if (rowProjects.has(budget.project_id)) continue;
		if (budget.period_start > end || budget.period_end < start) continue;
		budgetOnlyKeys.add(`${budget.project_id}:${budget.currency}`);
	}
	for (const key of budgetOnlyKeys) {
		const [projectIdText, currency] = key.split(':');
		const projectId = Number(projectIdText);
		const projectBudgets = visible.filter(
			(budget) =>
				budget.project_id === projectId &&
				budget.currency === currency &&
				budget.period_start <= end &&
				budget.period_end >= start
		);
		const sample = projectBudgets[0];
		const approved = projectBudgets.filter(
			(budget) => budget.state === 'approved'
		);
		comparisons.push({
			project_id: projectId,
			project_code: sample.project_code,
			project_name: sample.project_name,
			client_name: null,
			currency,
			incurred_cost: null,
			confirmed_records: 0,
			pending_records: 0,
			outcome: 'no_incurred_cost',
			budget: approved.length > 0 ? toBudgetCandidate(approved[0]) : null,
			candidates: projectBudgets.map(toBudgetCandidate),
			variance: null,
			over_budget: null,
			detail:
				`No Incurred Project Cost is recorded for ${sample.project_code} in ${currency} for ${month}, so there is nothing to compare with ` +
				`${approved.length > 0 ? `approved budget ${approved[0].budget_uid}` : `budget ${sample.budget_uid}`}.`,
		});
	}

	comparisons.sort(
		(a, b) =>
			a.project_code.localeCompare(b.project_code) ||
			a.currency.localeCompare(b.currency)
	);

	const notices: CoverageNotice[] = [];
	const outcomes: Array<{
		outcome: BudgetOutcome;
		code: string;
		label: string;
		detail: (count: number) => string;
		severity: 'warning' | 'info';
	}> = [
		{
			outcome: 'missing',
			code: 'budget_missing',
			label: 'No approved cost budget',
			detail: (count) =>
				`${count} Project row(s) have no approved cost budget covering this month. Incurred Project Cost is still reported; no variance is invented.`,
			severity: 'info',
		},
		{
			outcome: 'unapproved',
			code: 'budget_unapproved',
			label: 'Cost budget not approved yet',
			detail: (count) =>
				`${count} Project row(s) have a cost budget that is not approved, so it is not compared.`,
			severity: 'warning',
		},
		{
			outcome: 'incompatible_currency',
			code: 'budget_incompatible_currency',
			label: 'Cost budget in another currency',
			detail: (count) =>
				`${count} Project row(s) have an approved cost budget in a different currency. Currencies are never converted for a comparison.`,
			severity: 'warning',
		},
		{
			outcome: 'incompatible_scope',
			code: 'budget_incompatible_scope',
			label: 'Budget does not cover Project cost',
			detail: (count) =>
				`${count} Project row(s) have an approved record whose scope is not a Project cost budget, so it is not compared.`,
			severity: 'warning',
		},
		{
			outcome: 'incompatible_period',
			code: 'budget_incompatible_period',
			label: 'Cost budget covers another period',
			detail: (count) =>
				`${count} Project row(s) have an approved cost budget that does not cover this month.`,
			severity: 'warning',
		},
		{
			outcome: 'ambiguous',
			code: 'budget_ambiguous',
			label: 'More than one approved cost budget matches',
			detail: (count) =>
				`${count} Project row(s) match more than one approved cost budget, so none is compared. Withdraw or supersede a version.`,
			severity: 'warning',
		},
		{
			outcome: 'unsupported_incurred_cost',
			code: 'budget_unsupported_incurred_cost',
			label: 'Cost not confirmed yet',
			detail: (count) =>
				`${count} Project row(s) have an approved cost budget but no confirmed Incurred Project Cost, so no variance is stated.`,
			severity: 'warning',
		},
		{
			outcome: 'no_incurred_cost',
			code: 'budget_no_incurred_cost',
			label: 'Cost budget without incurred cost',
			detail: (count) =>
				`${count} approved or pending budget row(s) cover a Project with no Incurred Project Cost recorded this month.`,
			severity: 'info',
		},
	];
	for (const entry of outcomes) {
		const count = comparisons.filter(
			(comparison) => comparison.outcome === entry.outcome
		).length;
		if (count > 0) {
			notices.push(
				notice(entry.code, entry.label, entry.detail(count), entry.severity)
			);
		}
	}
	if (comparisons.length === 0) {
		notices.push(
			notice(
				'budget_nothing_to_compare',
				'No Project cost to compare with a budget',
				'No Incurred Project Cost and no covering cost budget in this month, so the budget section has nothing to state.',
				'info'
			)
		);
	}
	notices.push(
		notice(
			'budget_variance_not_profit',
			'Remaining budget is not profit or a forecast',
			VARIANCE_NOTE,
			'info'
		)
	);

	return {
		month,
		basis: BASIS,
		variance_note: VARIANCE_NOTE,
		comparisons,
		notices,
	};
}
