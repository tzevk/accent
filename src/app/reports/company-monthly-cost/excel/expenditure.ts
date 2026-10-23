/**
 * Server-side Excel workbook builder for the Company Monthly Cost report.
 *
 * Company expenditure export.
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type {
	BudgetOutcome,
	ChangeState,
	CompanyReconciliation,
	ClosePayload,
	ProjectBudgetComparison,
	RevisionPayload,
} from '@/lib/company-expenditure';
import { div, gt, mul, toNumber } from '@/lib/money';
import {
	TINT_PURPLE_HDR,
	TINT_PURPLE_SUB,
	TINT_GRAY_LIGHT,
	TINT_WARN_LIGHT,
	TINT_ERROR_LIGHT,
	TINT_GREEN_LIGHT,
	setFill,
	setFont,
	box,
	sanitizeName,
} from './theme';

// ─── Company Expenditure Export (Ticket #324) ───────────────────────

export interface ExpenditureClientOrder {
	orderNumber: string;
	counterpartyName: string;
	projectCode: string | null;
	projectName: string | null;
	orderDate: string | null;
	currency: string;
	grossAmount: number | null;
	netAmount: number | null;
	clientInvoicedValue: number | null;
	clientRemainingValue: number | null;
	status: string;
}

export interface ExpenditureExportInput {
	reconciliation: CompanyReconciliation;
	close: ClosePayload | null;
	revisions: RevisionPayload | null;
	asOf?: string | null;
	clientOrders?: ExpenditureClientOrder[];
}

export function fileBaseForExpenditureExcel(
	data: CompanyReconciliation,
	projectId?: number | null
): string {
	const m = sanitizeName(data.month);
	const p = projectId ? `_Project_${projectId}` : '';
	return `Company_Expenditure_${m}${p}.xlsx`;
}

function renderValue(
	cell: ExcelJS.Cell,
	val: number | string | null | undefined,
	numFmt?: string
): void {
	if (val === null || val === undefined) {
		cell.value = '—';
	} else if (typeof val === 'number') {
		cell.value = val;
		if (numFmt) cell.numFmt = numFmt;
	} else {
		cell.value = val;
	}
}

const CHANGE_LABELS: Record<ChangeState, string> = {
	no_prior: 'No prior month',
	new: 'New cost',
	increase: 'Increase',
	decrease: 'Decrease',
	unchanged: 'No change',
	unproven: 'Window membership unproven',
};

const BUDGET_OUTCOME_LABELS: Record<BudgetOutcome, string> = {
	compared: 'Compared',
	missing: 'No approved budget',
	unapproved: 'Not approved',
	incompatible_currency: 'Different currency',
	incompatible_scope: 'Not a cost budget',
	incompatible_period: 'Different period',
	ambiguous: 'More than one match',
	unsupported_incurred_cost: 'Cost not confirmed yet',
	no_incurred_cost: 'No incurred cost recorded',
};

function comparisonPercentCell(
	cell: ExcelJS.Cell,
	percent: number | null,
	state: ChangeState,
	currencySplit: boolean
): void {
	if (currencySplit) {
		cell.value = 'See currencies';
		return;
	}
	if (percent !== null) {
		cell.value = percent / 100;
		cell.numFmt = '0.00%';
		return;
	}
	cell.value =
		state === 'new'
			? 'New cost, no percentage'
			: state === 'no_prior'
				? 'Prior amount unknown'
				: (CHANGE_LABELS[state] ?? state);
}

function comparisonAmountLabel(
	amount: number | null,
	currency: string | null,
	currencySplit: boolean
): string {
	if (currencySplit && currency === null) return 'See currencies';
	if (amount === null) return 'Unknown';
	return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
}

/**
 * Map key for one Project/currency row's budget comparison. A Project can
 * hold more than one currency in a month, and a comparison never crosses
 * currencies, so both parts are required to reach the matching comparison.
 */
function budgetRowKey(
	row: Pick<ProjectBudgetComparison, 'project_id' | 'currency'>
): string {
	return `${row.project_id}:${row.currency}`;
}

/**
 * Presentation-only budget variance percentage: approved budget minus
 * confirmed cost, stated as a share of a positive approved budget. Any other
 * shape (uncompared, missing variance, zero or negative budget) stays
 * unavailable. Shared Decimal operations only; no financial recalculation.
 */
function budgetVariancePercent(
	comparison: ProjectBudgetComparison
): number | null {
	if (comparison.outcome !== 'compared') return null;
	if (comparison.variance === null) return null;
	const amount = comparison.budget?.amount ?? null;
	if (amount === null || !gt(amount, 0)) return null;
	return toNumber(mul(div(comparison.variance, amount), 100).toDecimalPlaces(2));
}

function renderVariancePercentCell(
	cell: ExcelJS.Cell,
	comparison: ProjectBudgetComparison
): void {
	const percent = budgetVariancePercent(comparison);
	if (percent === null) {
		cell.value =
			comparison.outcome === 'compared'
				? 'Unavailable: budget is not positive'
				: `Unavailable: ${BUDGET_OUTCOME_LABELS[comparison.outcome] ?? comparison.outcome}`;
		return;
	}
	cell.value = percent / 100;
	cell.numFmt = '0.00%';
}

function closeStatusLabel(close: ClosePayload | null): string {
	if (!close) return 'Unavailable';
	return close.status === 'closed' ? 'Closed' : 'Open';
}

function closeVersionLabel(close: ClosePayload | null): string {
	if (!close) return 'Unavailable';
	return String(close.financial_version);
}

function buildExpenditureReconciliationSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation, close, asOf } = input;
	const ws = wb.addWorksheet('Company Reconciliation', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 32 },
		{ width: 22 },
		{ width: 18 },
		{ width: 24 },
		{ width: 16 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = 'Accent CRM — Company Expenditure Reconciliation';
	setFont(t, { bold: true, size: 14, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	ws.mergeCells(2, 1, 2, 6);
	const s = ws.getCell(2, 1);
	s.value =
		'Company Incurred Cost reconciled to Incurred Project Cost, Company Overhead, and Unallocated Cost';
	setFont(s, { size: 9.5, color: 'FF4B5563' });
	ws.getRow(2).height = 18;

	// Metadata Box
	const cutoff = asOf || reconciliation.month;
	const metaRows = [
		['Reporting Month', reconciliation.month_label || reconciliation.month],
		['Reporting Cutoff / As Of', cutoff],
		['Reporting Currency Basis', reconciliation.company.reporting_currency],
		['Financial Close Status', closeStatusLabel(close)],
		['Financial Version', closeVersionLabel(close)],
		['Close Snapshot UID', close?.close_uid || '—'],
		[
			'Filter Scope',
			reconciliation.project_id
				? `Project ID: ${reconciliation.project_id}`
				: 'All Projects (Unfiltered)',
		],
		[
			'Conversion Evidence Status',
			reconciliation.company.conversion.status === 'reporting'
				? `All confirmed records natively in ${reconciliation.company.reporting_currency}`
				: reconciliation.company.conversion.status === 'converted'
					? `${reconciliation.company.conversion.converted_records} records converted into ${reconciliation.company.reporting_currency}`
					: `${reconciliation.company.conversion.unsupported_records} records unconverted into ${reconciliation.company.reporting_currency}`,
		],
	];

	let rNum = 4;
	for (const [k, v] of metaRows) {
		const row = ws.getRow(rNum);
		row.height = 18;
		const c1 = row.getCell(1);
		c1.value = k;
		setFont(c1, { bold: true, size: 9.5 });
		setFill(c1, TINT_GRAY_LIGHT);
		box(c1);

		const c2 = row.getCell(2);
		c2.value = v;
		setFont(c2, { size: 9.5 });
		setFill(c2, TINT_GRAY_LIGHT);
		box(c2);
		rNum++;
	}

	// Filter warning if applicable
	if (reconciliation.project_id) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 6);
		const warnCell = ws.getCell(rNum, 1);
		warnCell.value =
			'Note: Project filter narrows Project Detail only. Company Incurred Cost and summary figures below represent company-wide totals.';
		setFont(warnCell, { bold: true, size: 9.5, color: 'FF92400E' });
		setFill(warnCell, TINT_WARN_LIGHT);
		box(warnCell);
		ws.getRow(rNum).height = 20;
	}

	// Section: Company Incurred Cost
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 5);
	const sec1 = ws.getCell(rNum, 1);
	sec1.value = 'Company Incurred Cost Reconciliation';
	setFont(sec1, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(sec1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 22;

	rNum++;
	const th1 = ws.getRow(rNum);
	th1.height = 20;
	const thCols1 = [
		{ col: 1, label: 'Reconciliation Metric' },
		{ col: 2, label: `Amount (${reconciliation.company.reporting_currency})` },
		{ col: 3, label: 'Original Currency' },
		{ col: 4, label: 'Conversion / Treatment' },
		{ col: 5, label: 'Confirmed Records' },
	];
	for (const h of thCols1) {
		const c = th1.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: h.col === 2 || h.col === 5 ? 'right' : 'left',
		};
	}

	// `company.groups` is the reconciliation's own category breakdown: it is
	// stated only when the whole month can be stated in one currency, and it
	// stays absent otherwise. Never a partial reporting-currency sum.
	const groupAmount = (key: string): number | null =>
		reconciliation.company.groups.find((group) => group.key === key)?.amount ??
		null;
	const groupRecords = (key: string): number | null =>
		reconciliation.company.groups.find((group) => group.key === key)
			?.record_count ?? null;
	const companyMetrics: Array<{
		label: string;
		amount: number | null;
		currency: string | null;
		treatment: string;
		records: number | string;
		bold?: boolean;
	}> = [
		{
			label: 'Company Incurred Cost',
			amount: reconciliation.company.incurred_cost,
			currency:
				reconciliation.company.currency ||
				reconciliation.company.reporting_currency,
			treatment: reconciliation.company.conversion.status,
			records: reconciliation.company.record_count,
			bold: true,
		},
		{
			label: '— Incurred Project Cost',
			amount: groupAmount('incurred_project_cost'),
			currency: reconciliation.company.currency,
			treatment: 'Attributed to Projects',
			records: groupRecords('incurred_project_cost') ?? '—',
		},
		{
			label: '— Company Overhead',
			amount: groupAmount('company_overhead'),
			currency: reconciliation.company.currency,
			treatment: 'Unattributed General Overhead',
			records: groupRecords('company_overhead') ?? '—',
		},
		{
			label: '— Unallocated Cost',
			amount: groupAmount('unallocated_cost'),
			currency: reconciliation.company.currency,
			treatment: 'Unallocated Direct / Payroll Cost',
			records: groupRecords('unallocated_cost') ?? '—',
		},
		{
			label: 'Gross Supplier & Expense Liability',
			amount: reconciliation.company.gross_liability,
			currency: reconciliation.company.reporting_currency,
			treatment: 'Gross Liability Before Tax Deduction',
			records: reconciliation.company.record_count,
		},
		{
			label: 'Recoverable Tax',
			amount: reconciliation.company.recoverable_tax,
			currency: reconciliation.company.reporting_currency,
			treatment: 'Confirmed Recoverable Input Tax',
			records: '—',
		},
		{
			label: 'Unresolved Tax Gross',
			amount: reconciliation.company.unresolved_tax.gross_amount,
			currency:
				reconciliation.company.unresolved_tax.currency ||
				reconciliation.company.reporting_currency,
			treatment: 'Excluded Pending Confirmation',
			records: reconciliation.company.unresolved_tax.count,
		},
		{
			label: 'Known Zero Records',
			amount: 0,
			currency: reconciliation.company.reporting_currency,
			treatment: 'Confirmed Zero-Cost Records',
			records: reconciliation.company.known_zero_count,
		},
	];

	for (const m of companyMetrics) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;

		const c1 = row.getCell(1);
		c1.value = m.label;
		setFont(c1, { bold: m.bold ?? false, size: 9.5 });
		box(c1);

		const c2 = row.getCell(2);
		renderValue(c2, m.amount, '#,##0.00');
		setFont(c2, { bold: m.bold ?? false, size: 9.5 });
		c2.alignment = { vertical: 'middle', horizontal: 'right' };
		box(c2);

		const c3 = row.getCell(3);
		c3.value = m.currency || '—';
		setFont(c3, { size: 9.5 });
		c3.alignment = { vertical: 'middle', horizontal: 'center' };
		box(c3);

		const c4 = row.getCell(4);
		c4.value = m.treatment;
		setFont(c4, { size: 9.5 });
		box(c4);

		const c5 = row.getCell(5);
		renderValue(c5, m.records);
		setFont(c5, { size: 9.5 });
		c5.alignment = { vertical: 'middle', horizontal: 'right' };
		box(c5);
	}
	// Section: Estimated Payroll (separate from confirmed cost)
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 5);
	const secPay = ws.getCell(rNum, 1);
	secPay.value = 'Estimated Payroll — Separate From Confirmed Cost';
	setFont(secPay, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secPay, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 5);
	const paySub = ws.getCell(rNum, 1);
	paySub.value =
		'Payroll-based estimate for employees with no finalized allocation yet. Never part of Company Incurred Cost; no combined headline is stated.';
	setFont(paySub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	const payrollNotices = reconciliation.coverage.filter(
		(notice) =>
			notice.code === 'payroll_not_generated' ||
			notice.code === 'payroll_not_finalized' ||
			notice.code === 'payroll_pricing_missing' ||
			notice.code === 'payroll_allocation_missing'
	);
	const payrollRows: Array<[string, string]> = [
		[
			'Estimated payroll',
			`${reconciliation.payroll.estimated_total.toFixed(2)} ${reconciliation.payroll.currency} (${reconciliation.payroll.estimated_count} employee(s))`,
		],
		[
			'Recorded payroll (already in confirmed cost)',
			`${reconciliation.payroll.recorded_total.toFixed(2)} ${reconciliation.payroll.currency} (${reconciliation.payroll.recorded_count} recorded, ${reconciliation.payroll.known_zero_count} known zero)`,
		],
		[
			'Missing pricing (unknown, not zero)',
			`${reconciliation.payroll.missing_pricing_count} employee(s) with no covering Salary Profile`,
		],
		[
			'Missing slips / allocations',
			`${reconciliation.payroll.missing_slip_count} missing slip(s), ${reconciliation.payroll.allocation_missing_count} finalized slip(s) without a frozen allocation`,
		],
	];
	for (const [k, v] of payrollRows) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		const c1 = row.getCell(1);
		c1.value = k;
		setFont(c1, { bold: true, size: 9.5 });
		setFill(c1, TINT_GRAY_LIGHT);
		box(c1);
		ws.mergeCells(rNum, 2, rNum, 5);
		const c2 = row.getCell(2);
		c2.value = v;
		setFont(c2, { size: 9.5 });
		setFill(c2, TINT_GRAY_LIGHT);
		box(c2);
	}
	for (const notice of payrollNotices) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 5);
		const row = ws.getRow(rNum);
		row.height = 18;
		const c = row.getCell(1);
		c.value = `${notice.label}. ${notice.detail}`;
		setFont(c, { size: 9, color: 'FF92400E' });
		setFill(c, TINT_WARN_LIGHT);
		box(c);
	}


	// Filtered Project Subtotal Table (if filter applied)
	if (reconciliation.filtered_subtotal) {
		const fs = reconciliation.filtered_subtotal;
		const proj = reconciliation.projects.find(
			(p) => p.project_id === fs.project_id
		);
		const projName = proj
			? `${proj.project_code} — ${proj.project_name}`
			: `Project ${fs.project_id}`;

		rNum += 2;
		ws.mergeCells(rNum, 1, rNum, 5);
		const secFilter = ws.getCell(rNum, 1);
		secFilter.value = 'Filtered Project Subtotal (Selected Scope)';
		setFont(secFilter, { bold: true, size: 10.5, color: 'FFFFFFFF' });
		setFill(secFilter, TINT_PURPLE_HDR);
		ws.getRow(rNum).height = 20;

		rNum++;
		const thF = ws.getRow(rNum);
		thF.height = 20;
		const fCols = [
			{ col: 1, label: 'Project' },
			{ col: 2, label: 'Currency' },
			{ col: 3, label: 'Incurred Cost' },
			{ col: 4, label: 'Comparison Cost' },
			{ col: 5, label: 'Cost to Date' },
		];
		for (const h of fCols) {
			const c = thF.getCell(h.col);
			c.value = h.label;
			setFont(c, { bold: true, size: 9 });
			setFill(c, TINT_PURPLE_SUB);
			box(c);
			c.alignment = {
				vertical: 'middle',
				horizontal: [3, 4, 5].includes(h.col) ? 'right' : 'left',
			};
		}

		for (const ct of fs.currency_totals) {
			rNum++;
			const fRow = ws.getRow(rNum);
			fRow.height = 18;
			fRow.getCell(1).value = projName;
			fRow.getCell(2).value = ct.currency;
			renderValue(fRow.getCell(3), ct.incurred_cost, '#,##0.00');
			renderValue(fRow.getCell(4), ct.comparison_cost, '#,##0.00');
			renderValue(fRow.getCell(5), ct.cost_to_date, '#,##0.00');

			for (let i = 1; i <= 5; i++) {
				const c = fRow.getCell(i);
				setFont(c, { bold: true, size: 9.5 });
				box(c);
				if ([3, 4, 5].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	// Section: Currency Subtotals
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 10);
	const secCur = ws.getCell(rNum, 1);
	secCur.value = 'Currency Subtotals';
	setFont(secCur, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secCur, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCur = ws.getRow(rNum);
	thCur.height = 20;
	const curHeaders = [
		'Currency',
		'Project Cost',
		'Overhead',
		'Unallocated',
		'Incurred Cost',
		'Gross Liability',
		'Recoverable Tax',
		'Unresolved Tax',
		'Period Charges',
		'Status',
	];
	curHeaders.forEach((label, idx) => {
		const c = thCur.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 1 && idx <= 8 ? 'right' : 'left',
		};
	});

	for (const ct of reconciliation.company.currency_totals) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;

		row.getCell(1).value = ct.currency;
		renderValue(row.getCell(2), ct.incurred_project_cost, '#,##0.00');
		renderValue(row.getCell(3), ct.company_overhead, '#,##0.00');
		renderValue(row.getCell(4), ct.unallocated_cost, '#,##0.00');
		renderValue(row.getCell(5), ct.incurred_cost, '#,##0.00');
		renderValue(row.getCell(6), ct.gross_liability, '#,##0.00');
		renderValue(row.getCell(7), ct.recoverable_tax, '#,##0.00');
		renderValue(row.getCell(8), ct.unresolved_tax_gross, '#,##0.00');
		renderValue(row.getCell(9), ct.period_charge_amount, '#,##0.00');
		row.getCell(10).value = ct.reporting.status;

		for (let i = 1; i <= 10; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 2 && i <= 9) {
				c.alignment = { vertical: 'middle', horizontal: 'right' };
			}
		}
	}

	// Section: Categorized Costs by Source Register
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 4);
	const secCat = ws.getCell(rNum, 1);
	secCat.value = 'Categorized Costs by Source Register';
	setFont(secCat, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secCat, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCat = ws.getRow(rNum);
	thCat.height = 20;
	const catHeaders = [
		'Source Category',
		'Register Key',
		'Incurred Cost Amount',
		'Records',
	];
	catHeaders.forEach((label, idx) => {
		const c = thCat.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 2 ? 'right' : 'left',
		};
	});

	for (const g of reconciliation.company.groups) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = g.label;
		row.getCell(2).value = g.key;
		renderValue(row.getCell(3), g.amount, '#,##0.00');
		renderValue(row.getCell(4), g.record_count);

		for (let i = 1; i <= 4; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 3) c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Section: Comparison against Prior Comparable Period. The confirmed
	// full-month total above is the headline; this section states the existing
	// comparable-window measurement beside it with both bases explicit.
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 10);
	const secComp = ws.getCell(rNum, 1);
	secComp.value = 'Comparison Against Prior Comparable Period';
	setFont(secComp, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secComp, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	const cmp = reconciliation.comparison;
	const currencySplit =
		cmp.currency === null && cmp.currency_totals.length > 1;
	const windowBasisLabel =
		cmp.basis === 'equal_period'
			? `Elapsed window to ${cmp.as_of}: current ${cmp.current_days} day(s), prior ${cmp.prior_days} day(s)`
			: `Full month compared with the full prior month (measured to ${cmp.as_of})`;
	const fullMonthLabel =
		reconciliation.company.incurred_cost === null
			? 'See currencies'
			: `${reconciliation.company.incurred_cost.toFixed(2)} ${reconciliation.company.currency ?? ''}`.trim();

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 10);
	const compSub = ws.getCell(rNum, 1);
	compSub.value =
		`Full-month Company Incurred Cost ${fullMonthLabel}; comparable window ${comparisonAmountLabel(cmp.current_cost, cmp.currency, currencySplit)}. ` +
		`${windowBasisLabel}. Cost to date is cumulative through ${cmp.cost_to_date_through}.`;
	setFont(compSub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 28;

	rNum++;
	const thComp = ws.getRow(rNum);
	thComp.height = 20;
	const compHeaders = [
		'Prior Month',
		'Basis',
		'Current Days',
		'Prior Days',
		'Window Current Cost',
		'Window Prior Cost',
		'Cost Change Amount',
		'Cost Change %',
		'State',
		'Window',
	];
	compHeaders.forEach((label, idx) => {
		const c = thComp.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [3, 4, 5, 6, 7, 8].includes(idx + 1) ? 'right' : 'left',
		};
	});

	rNum++;
	const compRow = ws.getRow(rNum);
	compRow.height = 18;
	compRow.getCell(1).value = cmp.prior_month_label || cmp.prior_month || '—';
	compRow.getCell(2).value =
		cmp.basis === 'equal_period' ? 'Elapsed window' : 'Full month';
	renderValue(compRow.getCell(3), cmp.current_days);
	renderValue(compRow.getCell(4), cmp.prior_days);
	compRow.getCell(5).value = comparisonAmountLabel(
		cmp.current_cost,
		cmp.currency,
		currencySplit
	);
	compRow.getCell(6).value = comparisonAmountLabel(
		cmp.prior_cost,
		cmp.currency,
		currencySplit
	);
	compRow.getCell(7).value = comparisonAmountLabel(
		cmp.change_amount,
		cmp.currency,
		currencySplit
	);
	comparisonPercentCell(compRow.getCell(8), cmp.change_percent, cmp.change_state, currencySplit);
	compRow.getCell(9).value = CHANGE_LABELS[cmp.change_state] ?? cmp.change_state;
	compRow.getCell(10).value = cmp.window_mismatch
		? 'Unequal windows: prior month shorter'
		: 'Equal windows';

	for (let i = 1; i <= 10; i++) {
		const c = compRow.getCell(i);
		setFont(c, { size: 9.5 });
		box(c);
		if ([3, 4, 5, 6, 7, 8].includes(i)) {
			c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	if (cmp.currency_totals.length > 0) {
		rNum += 2;
		ws.mergeCells(rNum, 1, rNum, 10);
		const secCmpCur = ws.getCell(rNum, 1);
		secCmpCur.value = 'Comparable Window by Currency';
		setFont(secCmpCur, { bold: true, size: 10, color: TINT_PURPLE_HDR });
		ws.getRow(rNum).height = 18;

		rNum++;
		const thCmpCur = ws.getRow(rNum);
		thCmpCur.height = 20;
		const cmpCurHeaders = [
			'Currency',
			'Window Current Cost',
			'Window Prior Cost',
			'Change Amount',
			'Change %',
			'State',
			'Dayless Cost Excluded',
			'Unproven Cost',
			'Late Cost',
			'Disclosure Basis',
		];
		cmpCurHeaders.forEach((label, idx) => {
			const c = thCmpCur.getCell(idx + 1);
			c.value = label;
			setFont(c, { bold: true, size: 9 });
			setFill(c, TINT_PURPLE_SUB);
			box(c);
			c.alignment = {
				vertical: 'middle',
				horizontal: [2, 3, 4, 5, 7, 8, 9].includes(idx + 1) ? 'right' : 'left',
			};
		});

		for (const row of cmp.currency_totals) {
			rNum++;
			const curRow = ws.getRow(rNum);
			curRow.height = 18;
			curRow.getCell(1).value = row.currency;
			renderValue(curRow.getCell(2), row.current_cost, '#,##0.00');
			if (row.prior_cost === null) {
				curRow.getCell(3).value = 'Unknown';
			} else {
				renderValue(curRow.getCell(3), row.prior_cost, '#,##0.00');
			}
			if (row.change_amount === null) {
				curRow.getCell(4).value = 'Unknown';
			} else {
				renderValue(curRow.getCell(4), row.change_amount, '#,##0.00');
			}
			comparisonPercentCell(curRow.getCell(5), row.change_percent, row.change_state, false);
			curRow.getCell(6).value =
				CHANGE_LABELS[row.change_state] ?? row.change_state;
			renderValue(curRow.getCell(7), row.dayless_cost, '#,##0.00');
			if (row.unproven_cost === null) {
				curRow.getCell(8).value = '—';
			} else {
				renderValue(curRow.getCell(8), row.unproven_cost, '#,##0.00');
			}
			renderValue(curRow.getCell(9), row.late_cost, '#,##0.00');
			curRow.getCell(10).value =
				`${row.unproven_records} unproven record(s), ${row.undated_records} undated, ` +
				`${row.late_records} late current, ${row.prior_late_records} late prior, ` +
				`${row.dayless_records} dayless excluded`;

			for (let i = 1; i <= 10; i++) {
				const c = curRow.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([2, 3, 4, 5, 7, 8, 9].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	if (cmp.disclosures.length > 0) {
		rNum += 2;
		ws.mergeCells(rNum, 1, rNum, 10);
		const secCmpDis = ws.getCell(rNum, 1);
		secCmpDis.value = 'Comparison Disclosures';
		setFont(secCmpDis, { bold: true, size: 10, color: TINT_PURPLE_HDR });
		ws.getRow(rNum).height = 18;

		rNum++;
		const thCmpDis = ws.getRow(rNum);
		thCmpDis.height = 20;
		const cmpDisHeaders = ['Code', 'Period', 'Severity', 'Amount', 'Detail'];
		cmpDisHeaders.forEach((label, idx) => {
			const c = thCmpDis.getCell(idx + 1);
			c.value = label;
			setFont(c, { bold: true, size: 9 });
			setFill(c, TINT_PURPLE_SUB);
			box(c);
			c.alignment = {
				vertical: 'middle',
				horizontal: idx === 3 ? 'right' : 'left',
			};
		});

		for (const entry of cmp.disclosures) {
			rNum++;
			ws.mergeCells(rNum, 5, rNum, 10);
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = entry.code;
			row.getCell(2).value = entry.period ?? 'Both periods';
			row.getCell(3).value = entry.severity;
			if (entry.amount === null) {
				row.getCell(4).value = '—';
			} else {
				renderValue(row.getCell(4), entry.amount, '#,##0.00');
			}
			row.getCell(5).value =
				`${entry.label}. ${entry.detail} (${entry.count} record(s)` +
				(entry.currency ? `, ${entry.currency}` : '') +
				')';

			for (let i = 1; i <= 10; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9 });
				box(c);
				if (i === 4) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
				if (i === 3) {
					if (entry.severity === 'info') setFill(c, TINT_GREEN_LIGHT);
					else if (entry.severity === 'warning') setFill(c, TINT_WARN_LIGHT);
				}
			}
		}
	}

	// Section: Source Coverage Notices
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 5);
	const secCov = ws.getCell(rNum, 1);
	secCov.value = 'Source Coverage & Audit Disclosures';
	setFont(secCov, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secCov, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCov = ws.getRow(rNum);
	thCov.height = 20;
	const covHeaders = ['Code', 'Source', 'Severity', 'Audit Finding'];
	covHeaders.forEach((label, idx) => {
		const c = thCov.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
	});

	for (const n of reconciliation.coverage) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = n.code;
		row.getCell(2).value = n.label;
		row.getCell(3).value = n.severity;
		row.getCell(4).value = n.detail;

		for (let i = 1; i <= 4; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i === 3) {
				if (n.severity === 'info') setFill(c, TINT_GREEN_LIGHT);
				else if (n.severity === 'warning') setFill(c, TINT_WARN_LIGHT);
				else if (n.severity === 'error') setFill(c, TINT_ERROR_LIGHT);
			}
		}
	}
}

function buildExpenditureProjectDetailSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation } = input;
	const ws = wb.addWorksheet('Project Detail', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 8 }, // Sr.
		{ width: 18 }, // Code
		{ width: 30 }, // Project Name
		{ width: 22 }, // Client Name
		{ width: 10 }, // Currency
		{ width: 16 }, // Logged Hours
		{ width: 20 }, // Incurred Cost (Orig)
		{ width: 18 }, // Conversion Status
		{ width: 22 }, // Converted Cost
		{ width: 18 }, // Cost to Date
		{ width: 16 }, // Evidence State
		{ width: 10 }, // Records
		{ width: 20 }, // Approved Monthly Budget
		{ width: 20 }, // Remaining / Overspent
		{ width: 14 }, // Variance %
		{ width: 22 }, // Budget State
		{ width: 40 }, // Budget Reason
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Project Expenditure & Logged Hours — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	ws.mergeCells(2, 1, 2, 12);
	const s = ws.getCell(2, 1);
	s.value =
		'Individual Project Incurred Cost, Logged Hours, Cost to Date, Historical Evidence States, and the approved monthly budget comparison beside each cost row';
	setFont(s, { size: 9.5, color: 'FF4B5563' });
	ws.getRow(2).height = 18;

	// Table Headers
	const th = ws.getRow(4);
	th.height = 22;
	const cols: Array<{
		col: number;
		label: string;
		align: 'left' | 'center' | 'right';
	}> = [
		{ col: 1, label: 'Sr.', align: 'center' },
		{ col: 2, label: 'Project Code', align: 'left' },
		{ col: 3, label: 'Project Name', align: 'left' },
		{ col: 4, label: 'Client Name', align: 'left' },
		{ col: 5, label: 'Currency', align: 'center' },
		{ col: 6, label: 'Logged Hours', align: 'right' },
		{ col: 7, label: 'Incurred Cost (Orig)', align: 'right' },
		{ col: 8, label: 'Conversion Status', align: 'center' },
		{
			col: 9,
			label: `Converted (${reconciliation.company.reporting_currency})`,
			align: 'right',
		},
		{ col: 10, label: 'Cost to Date', align: 'right' },
		{ col: 11, label: 'Evidence State', align: 'center' },
		{ col: 12, label: 'Records', align: 'right' },
		{ col: 13, label: 'Approved Monthly Budget', align: 'right' },
		{ col: 14, label: 'Remaining (+) / Overspent (−)', align: 'right' },
		{ col: 15, label: 'Variance %', align: 'right' },
		{ col: 16, label: 'Budget State', align: 'left' },
		{ col: 17, label: 'Budget Reason', align: 'left' },
	];

	for (const h of cols) {
		const c = th.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = { vertical: 'middle', horizontal: h.align };
	}

	let rNum = 5;
	let totalHours = 0;
	let totalConverted = 0;
	let allConverted = true;
	// Exact Project/currency/month/scope matches from the existing budget
	// results only; no manufactured comparison or zero-cost row.
	const budgetByRow = new Map<string, ProjectBudgetComparison>();
	for (const comparison of reconciliation.budgets.comparisons) {
		budgetByRow.set(budgetRowKey(comparison), comparison);
	}

	for (let idx = 0; idx < reconciliation.projects.length; idx++) {
		const p = reconciliation.projects[idx];
		const row = ws.getRow(rNum);
		row.height = 18;

		row.getCell(1).value = idx + 1;
		row.getCell(2).value = p.project_code;
		row.getCell(3).value = p.project_name;
		row.getCell(4).value = p.client_name || '—';
		row.getCell(5).value = p.currency;
		renderValue(row.getCell(6), p.logged_hours, '#,##0.00');
		renderValue(row.getCell(7), p.incurred_cost, '#,##0.00');
		row.getCell(8).value = p.conversion_status;
		renderValue(row.getCell(9), p.converted_incurred_cost, '#,##0.00');
		renderValue(row.getCell(10), p.cost_to_date, '#,##0.00');
		row.getCell(11).value = p.evidence.state;
		renderValue(row.getCell(12), p.record_count);
		const budget = budgetByRow.get(budgetRowKey(p)) ?? null;
		renderValue(row.getCell(13), budget?.budget?.amount ?? null, '#,##0.00');
		renderValue(row.getCell(14), budget?.variance ?? null, '#,##0.00');
		if (budget) {
			renderVariancePercentCell(row.getCell(15), budget);
			row.getCell(16).value =
				`${BUDGET_OUTCOME_LABELS[budget.outcome] ?? budget.outcome}` +
				(budget.budget ? ` · ${budget.budget.state}` : '');
			row.getCell(17).value = budget.detail;
		} else {
			row.getCell(15).value = 'Unavailable: no budget comparison';
			row.getCell(16).value = 'No budget comparison';
			row.getCell(17).value = `No budget comparison covers ${p.project_code} in ${p.currency} for ${reconciliation.month}; the standalone budget section stays the unmatched-comparison surface.`;
		}

		totalHours += p.logged_hours || 0;
		if (p.converted_incurred_cost !== null) {
			totalConverted += p.converted_incurred_cost;
		} else {
			allConverted = false;
		}

		for (const h of cols) {
			const c = row.getCell(h.col);
			setFont(c, { size: 9.5 });
			box(c);
			c.alignment = { vertical: 'middle', horizontal: h.align };
		}
		rNum++;
	}

	// Totals / Subtotal Row
	const totRow = ws.getRow(rNum);
	totRow.height = 20;
	ws.mergeCells(rNum, 1, rNum, 5);
	const lbl = totRow.getCell(1);
	lbl.value = reconciliation.filtered_subtotal
		? 'Filtered Project Subtotal'
		: 'Total Projects Detail';
	setFont(lbl, { bold: true, size: 9.5 });
	lbl.alignment = { vertical: 'middle', horizontal: 'right' };

	renderValue(totRow.getCell(6), totalHours, '#,##0.00');
	renderValue(
		totRow.getCell(9),
		allConverted ? totalConverted : null,
		'#,##0.00'
	);

	for (let i = 1; i <= 17; i++) {
		const c = totRow.getCell(i);
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		if ([6, 7, 9, 10, 12].includes(i)) {
			c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}
}

function buildExpenditureBudgetsCommitmentsSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation, clientOrders } = input;
	const ws = wb.addWorksheet('Budgets & Commitments', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 18 },
		{ width: 28 },
		{ width: 14 },
		{ width: 14 },
		{ width: 10 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 14 },
		{ width: 22 },
		{ width: 14 },
		{ width: 24 },
		{ width: 40 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Approved Budgets, Supplier Commitments & Orders — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	// Section 1: Approved Cost Budgets Comparison
	let rNum = 3;
	ws.mergeCells(rNum, 1, rNum, 10);
	const s1 = ws.getCell(rNum, 1);
	s1.value = 'Approved Cost Budgets Comparison';
	setFont(s1, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 10);
	const s1sub = ws.getCell(rNum, 1);
	s1sub.value =
		'Budgets compared with Incurred Project Cost where scope, currency, and period match exactly. Variance is approved budget minus confirmed cost: positive means remaining, negative means overspent. Budgets never enter company expenditure totals.';
	setFont(s1sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 28;

	rNum++;
	const thB = ws.getRow(rNum);
	thB.height = 20;
	const bCols = [
		'Project Code',
		'Project Name',
		'Scope',
		'Period',
		'Currency',
		'Approved Budget',
		'Incurred Cost',
		'Variance',
		'Variance %',
		'Status',
		'Version',
		'Reference',
		'Reason',
	];
	bCols.forEach((label, idx) => {
		const c = thB.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [6, 7, 8, 9].includes(idx + 1) ? 'right' : 'left',
		};
	});

	if (reconciliation.budgets.comparisons.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 13);
		const emptyB = ws.getCell(rNum, 1);
		emptyB.value = 'No approved cost budgets matching this period.';
		setFont(emptyB, { size: 9.5 });
		box(emptyB);
		ws.getRow(rNum).height = 18;
	} else {
		for (const bc of reconciliation.budgets.comparisons) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = bc.project_code;
			row.getCell(2).value = bc.project_name;
			row.getCell(3).value = bc.budget?.scope || 'project';
			row.getCell(4).value = reconciliation.month;
			row.getCell(5).value = bc.currency;
			renderValue(row.getCell(6), bc.budget?.amount ?? null, '#,##0.00');
			renderValue(row.getCell(7), bc.incurred_cost, '#,##0.00');
			renderValue(row.getCell(8), bc.variance, '#,##0.00');
			renderVariancePercentCell(row.getCell(9), bc);
			row.getCell(10).value =
				`${BUDGET_OUTCOME_LABELS[bc.outcome] ?? bc.outcome}` +
				(bc.budget ? ` · ${bc.budget.state}` : '');
			row.getCell(11).value = String(bc.budget?.financial_version ?? '—');
			row.getCell(12).value = bc.budget?.approval_evidence_reference || '—';
			row.getCell(13).value = bc.detail;

			for (let i = 1; i <= 13; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([6, 7, 8, 9].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	// Section 2: Supplier Commitments
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 7);
	const s2 = ws.getCell(rNum, 1);
	s2.value = 'Outstanding Supplier Commitments (Rollforward)';
	setFont(s2, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s2, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 7);
	const s2sub = ws.getCell(rNum, 1);
	s2sub.value =
		'Supplier order value not yet consumed by recognized cost. Not incurred cost.';
	setFont(s2sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	rNum++;
	const thSC = ws.getRow(rNum);
	thSC.height = 20;
	const scCols = [
		'Currency',
		'Basis',
		'Closing Commitment',
		'Month Consumption',
		'Unconsumed Orders',
	];
	scCols.forEach((label, idx) => {
		const c = thSC.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [3, 4, 5].includes(idx + 1) ? 'right' : 'left',
		};
	});

	for (const t of reconciliation.supplier_commitment.totals) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = t.currency;
		row.getCell(2).value = t.basis;
		renderValue(row.getCell(3), t.closingCommitment, '#,##0.00');
		renderValue(row.getCell(4), t.consumptionInMonth, '#,##0.00');
		renderValue(row.getCell(5), t.unconsumedOrderCount);

		for (let i = 1; i <= 5; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if ([3, 4, 5].includes(i)) {
				c.alignment = { vertical: 'middle', horizontal: 'right' };
			}
		}
	}

	// Supplier Orders Detail
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 9);
	const s2det = ws.getCell(rNum, 1);
	s2det.value = 'Supplier Orders Detail';
	setFont(s2det, { bold: true, size: 10, color: TINT_PURPLE_HDR });
	ws.getRow(rNum).height = 18;

	rNum++;
	const thOrd = ws.getRow(rNum);
	thOrd.height = 20;
	const ordCols = [
		'Order No.',
		'Supplier',
		'Project Code',
		'Project Name',
		'Currency',
		'Basis',
		'Order Value',
		'Consumed Amount',
		'Outstanding Balance',
		'Status',
	];
	ordCols.forEach((label, idx) => {
		const c = thOrd.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [7, 8, 9].includes(idx + 1) ? 'right' : 'left',
		};
	});

	if (reconciliation.supplier_commitment.orders.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 10);
		const emptyO = ws.getCell(rNum, 1);
		emptyO.value = 'No supplier commitments recorded for this period.';
		setFont(emptyO, { size: 9.5 });
		box(emptyO);
		ws.getRow(rNum).height = 18;
	} else {
		for (const o of reconciliation.supplier_commitment.orders) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = o.orderNumber;
			row.getCell(2).value = o.counterpartyName;
			row.getCell(3).value = o.projectCode || '—';
			row.getCell(4).value = o.projectName || '—';
			row.getCell(5).value = o.currency;
			row.getCell(6).value = o.basis;
			renderValue(row.getCell(7), o.value, '#,##0.00');
			renderValue(row.getCell(8), o.consumption, '#,##0.00');
			renderValue(row.getCell(9), o.remaining, '#,##0.00');
			row.getCell(10).value = o.status;

			for (let i = 1; i <= 10; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([7, 8, 9].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	// Section 3: Client Order Context (Commercial Context Only)
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 10);
	const s3 = ws.getCell(rNum, 1);
	s3.value = 'Client Order Context (Commercial Context Only)';
	setFont(s3, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s3, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 10);
	const s3warn = ws.getCell(rNum, 1);
	s3warn.value =
		'CAUTION: Client order values represent commercial context only. They are NOT recognized revenue or profit, and NOT company expenditure. Do NOT subtract costs from client orders to calculate profit.';
	setFont(s3warn, { bold: true, size: 9, color: 'FF991B1B' });
	setFill(s3warn, TINT_ERROR_LIGHT);
	box(s3warn);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCl = ws.getRow(rNum);
	thCl.height = 20;
	const clCols = [
		'Client Name',
		'Project Code',
		'Project Name',
		'Order Reference',
		'Order Date',
		'Currency',
		'Order Value',
		'Invoiced Value',
		'Remaining Value',
		'Status',
	];
	clCols.forEach((label, idx) => {
		const c = thCl.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [7, 8, 9].includes(idx + 1) ? 'right' : 'left',
		};
	});

	if (!clientOrders || clientOrders.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 10);
		const emptyCl = ws.getCell(rNum, 1);
		emptyCl.value = 'No client orders recorded for this scope.';
		setFont(emptyCl, { size: 9.5 });
		box(emptyCl);
		ws.getRow(rNum).height = 18;
	} else {
		for (const co of clientOrders) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = co.counterpartyName;
			row.getCell(2).value = co.projectCode || '—';
			row.getCell(3).value = co.projectName || '—';
			row.getCell(4).value = co.orderNumber;
			row.getCell(5).value = co.orderDate || '—';
			row.getCell(6).value = co.currency;
			renderValue(row.getCell(7), co.grossAmount ?? co.netAmount, '#,##0.00');
			renderValue(row.getCell(8), co.clientInvoicedValue, '#,##0.00');
			renderValue(row.getCell(9), co.clientRemainingValue, '#,##0.00');
			row.getCell(10).value = co.status;

			for (let i = 1; i <= 10; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([7, 8, 9].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}
}

function buildExpenditureCashPaidSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation } = input;
	const ws = wb.addWorksheet('Cash Paid', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 18 },
		{ width: 28 },
		{ width: 16 },
		{ width: 10 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 16 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Outward Cash Paid & Float Funding — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	ws.mergeCells(2, 1, 2, 8);
	const s = ws.getCell(2, 1);
	s.value =
		'Dated outward cash movements (settlements, native payroll payouts, petty cash spending). Funding is internal transfer and displayed apart.';
	setFont(s, { size: 9.5, color: 'FF4B5563' });
	ws.getRow(2).height = 18;

	// Table 1: Outward Paid by Currency
	let rNum = 4;
	ws.mergeCells(rNum, 1, rNum, 6);
	const s1 = ws.getCell(rNum, 1);
	s1.value = 'Outward Cash Paid by Currency';
	setFont(s1, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(s1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const th1 = ws.getRow(rNum);
	th1.height = 20;
	const c1Headers = [
		'Currency',
		'Total Paid',
		'Settlements',
		'Payroll Payouts',
		'Petty Cash Spending',
		'Movements',
	];
	c1Headers.forEach((label, idx) => {
		const c = th1.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 1 ? 'right' : 'left',
		};
	});

	for (const cur of reconciliation.cash.by_currency) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = cur.currency;
		renderValue(row.getCell(2), cur.paid, '#,##0.00');
		renderValue(row.getCell(3), cur.settlement, '#,##0.00');
		renderValue(row.getCell(4), cur.payroll, '#,##0.00');
		renderValue(row.getCell(5), cur.petty_spend, '#,##0.00');
		renderValue(row.getCell(6), cur.movement_count);

		for (let i = 1; i <= 6; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 2) c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Table 2: Float Funding Summary
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 4);
	const s2 = ws.getCell(rNum, 1);
	s2.value = 'Petty Float Funding Summary (Internal Transfers)';
	setFont(s2, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(s2, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 6);
	const s2sub = ws.getCell(rNum, 1);
	s2sub.value =
		'Voucher funding moves bank balance into petty float; it is not outward operating cash paid.';
	setFont(s2sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	rNum++;
	const th2 = ws.getRow(rNum);
	th2.height = 20;
	const c2Headers = ['Currency', 'Funding Amount', 'Movement Count'];
	c2Headers.forEach((label, idx) => {
		const c = th2.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 1 ? 'right' : 'left',
		};
	});

	for (const f of reconciliation.cash.funding.by_currency) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = f.currency || 'INR';
		renderValue(row.getCell(2), f.amount, '#,##0.00');
		renderValue(row.getCell(3), f.movement_count);

		for (let i = 1; i <= 3; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 2) c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Table 3: Movement Targets & Settlement Status
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 9);
	const s3 = ws.getCell(rNum, 1);
	s3.value = 'Cash Targets & Settlement Balances';
	setFont(s3, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(s3, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const th3 = ws.getRow(rNum);
	th3.height = 20;
	const c3Headers = [
		'Target Type',
		'Target Label / Key',
		'Nature',
		'Currency',
		'Liability / Cost',
		'Settled in Month',
		'All-Time Settled',
		'Remaining Balance',
		'State',
	];
	c3Headers.forEach((label, idx) => {
		const c = th3.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [5, 6, 7, 8].includes(idx + 1) ? 'right' : 'left',
		};
	});

	for (const tg of reconciliation.cash.targets) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = tg.target_kind;
		row.getCell(2).value = tg.label || tg.target_key;
		row.getCell(3).value = tg.nature || '—';
		row.getCell(4).value = tg.currency || '—';
		renderValue(row.getCell(5), tg.liability, '#,##0.00');
		renderValue(row.getCell(6), tg.settled_this_month, '#,##0.00');
		renderValue(row.getCell(7), tg.settled, '#,##0.00');
		renderValue(row.getCell(8), tg.remaining, '#,##0.00');
		row.getCell(9).value = tg.state;

		for (let i = 1; i <= 9; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if ([5, 6, 7, 8].includes(i)) {
				c.alignment = { vertical: 'middle', horizontal: 'right' };
			}
		}
	}
}

function buildExpenditureRevisionsCloseSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation, close, revisions } = input;
	const ws = wb.addWorksheet('Revisions & Close', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 24 },
		{ width: 16 },
		{ width: 22 },
		{ width: 14 },
		{ width: 14 },
		{ width: 14 },
		{ width: 34 },
		{ width: 34 },
		{ width: 28 },
		{ width: 24 },
		{ width: 20 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Financial Close & Revision History — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	// Section 1: Financial Close Metadata
	let rNum = 3;
	ws.mergeCells(rNum, 1, rNum, 4);
	const s1 = ws.getCell(rNum, 1);
	s1.value = 'Financial Close Status & Frozen Snapshot';
	setFont(s1, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	const closeRows = [
		['Close Status', closeStatusLabel(close)],
		['Financial Version', closeVersionLabel(close)],
		['Close Snapshot UID', close?.close_uid || '—'],
		['Closed / Reviewed At', close?.reviewed_at || close?.created_at || '—'],
		[
			'Reviewed By (User ID)',
			close?.reviewed_by ? String(close.reviewed_by) : '—',
		],
		['Review Reason', close?.review_reason || '—'],
		['Evidence Reference', close?.evidence_reference || '—'],
		[
			'Frozen Incurred Cost (Snapshot)',
			close?.snapshot?.company.incurred_cost !== null &&
			close?.snapshot?.company.incurred_cost !== undefined
				? String(close.snapshot.company.incurred_cost)
				: '—',
		],
		[
			'Frozen Snapshot Currency',
			close?.snapshot?.company.currency ||
				close?.snapshot?.company.reporting_currency ||
				'—',
		],
	];

	for (const [k, v] of closeRows) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		const c1 = row.getCell(1);
		c1.value = k;
		setFont(c1, { bold: true, size: 9.5 });
		setFill(c1, TINT_GRAY_LIGHT);
		box(c1);

		const c2 = row.getCell(2);
		c2.value = v;
		setFont(c2, { size: 9.5 });
		setFill(c2, TINT_GRAY_LIGHT);
		box(c2);
	}

	// Close Review Findings (Blockers & Warnings)
	if (close?.review) {
		const findings = [
			...close.review.blockers.map((b) => ({ type: 'Blocker (Error)', ...b })),
			...close.review.warnings.map((w) => ({ type: 'Warning', ...w })),
		];
		if (findings.length > 0) {
			rNum += 2;
			ws.mergeCells(rNum, 1, rNum, 4);
			const sf = ws.getCell(rNum, 1);
			sf.value = 'Close Review Findings';
			setFont(sf, { bold: true, size: 10, color: TINT_PURPLE_HDR });
			ws.getRow(rNum).height = 18;

			rNum++;
			const thF = ws.getRow(rNum);
			thF.height = 20;
			['Severity', 'Code', 'Label', 'Detail'].forEach((l, idx) => {
				const c = thF.getCell(idx + 1);
				c.value = l;
				setFont(c, { bold: true, size: 9 });
				setFill(c, TINT_PURPLE_SUB);
				box(c);
			});

			for (const f of findings) {
				rNum++;
				const row = ws.getRow(rNum);
				row.height = 18;
				row.getCell(1).value = f.type;
				row.getCell(2).value = f.code;
				row.getCell(3).value = f.label;
				row.getCell(4).value = f.detail;

				for (let i = 1; i <= 4; i++) {
					const c = row.getCell(i);
					setFont(c, { size: 9.5 });
					box(c);
					if (i === 1) {
						setFill(
							c,
							f.type.startsWith('Blocker') ? TINT_ERROR_LIGHT : TINT_WARN_LIGHT
						);
					}
				}
			}
		}
	}

	// Section 2: Financial Revisions
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 11);
	const s2 = ws.getCell(rNum, 1);
	s2.value = 'Explicit Financial Revisions Log';
	setFont(s2, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s2, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 11);
	const s2sub = ws.getCell(rNum, 1);
	s2sub.value = !revisions
		? 'Revision context is unavailable for this export.'
		: revisions.status === 'closed'
			? 'Explicit versioned corrections recorded against the frozen closed financial month.'
			: 'Month is open. Corrections travel through standard operational command paths.';
	setFont(s2sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	const revisionContextRows: Array<[string, string]> = [
		['Revision Status', revisions ? (revisions.status === 'closed' ? 'Closed' : 'Open') : 'Unavailable'],
		['Close Version', revisions ? String(revisions.close_version) : 'Unavailable'],
		[
			'Frozen Prior Total',
			revisions?.prior?.incurred_cost === null ||
			revisions?.prior?.incurred_cost === undefined
				? '—'
				: `${revisions.prior.incurred_cost.toFixed(2)} ${revisions.prior.currency ?? ''}`.trim(),
		],
		[
			'Live Current Total',
			revisions?.current.incurred_cost === null ||
			revisions?.current.incurred_cost === undefined
				? '—'
				: `${revisions.current.incurred_cost.toFixed(2)} ${revisions.current.currency ?? ''}`.trim(),
		],
	];
	for (const [k, v] of revisionContextRows) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		const c1 = row.getCell(1);
		c1.value = k;
		setFont(c1, { bold: true, size: 9.5 });
		setFill(c1, TINT_GRAY_LIGHT);
		box(c1);
		ws.mergeCells(rNum, 2, rNum, 4);
		const c2 = row.getCell(2);
		c2.value = v;
		setFont(c2, { size: 9.5 });
		setFill(c2, TINT_GRAY_LIGHT);
		box(c2);
	}
	rNum++;

	rNum++;
	const thRev = ws.getRow(rNum);
	thRev.height = 20;
	const revHeaders = [
		'Revision UID',
		'Target Kind',
		'Target Reference',
		'Command',
		'Prior Version',
		'New Version',
		'Prior Figures',
		'New Figures',
		'Reason',
		'Evidence Reference',
		'Recorded At',
	];
	revHeaders.forEach((label, idx) => {
		const c = thRev.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [5, 6].includes(idx + 1) ? 'right' : 'left',
		};
	});

	const revList = revisions?.revisions ?? [];
	if (revList.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 11);
		const emptyR = ws.getCell(rNum, 1);
		emptyR.value = 'No financial revisions recorded for this month.';
		setFont(emptyR, { size: 9.5 });
		box(emptyR);
		ws.getRow(rNum).height = 18;
	} else {
		for (const r of revList) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 20;

			const pf = r.prior_figures;
			const nf = r.new_figures;
			const priorText =
				`${pf.amount ?? '—'} ${pf.currency ?? ''} (${pf.classification || pf.state || '—'}, ${pf.period || '—'})`.trim();
			const newText =
				`${nf.amount ?? '—'} ${nf.currency ?? ''} (${nf.classification || nf.state || '—'}, ${nf.period || '—'})`.trim();

			row.getCell(1).value = r.revision_uid;
			row.getCell(2).value = r.target_kind;
			row.getCell(3).value = r.target_label || r.target_uid;
			row.getCell(4).value = r.command;
			row.getCell(5).value = r.prior_version;
			row.getCell(6).value = r.new_version;
			row.getCell(7).value = priorText;
			row.getCell(8).value = newText;
			row.getCell(9).value = r.reason || '—';
			row.getCell(10).value = r.evidence_reference || '—';
			row.getCell(11).value = r.created_at;

			for (let i = 1; i <= 11; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9 });
				box(c);
				if ([5, 6].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}
}

export function buildExpenditureWorkbook(
	input: ExpenditureExportInput
): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	buildExpenditureReconciliationSheet(wb, input);
	buildExpenditureProjectDetailSheet(wb, input);
	buildExpenditureBudgetsCommitmentsSheet(wb, input);
	buildExpenditureCashPaidSheet(wb, input);
	buildExpenditureRevisionsCloseSheet(wb, input);

	return wb;
}

export async function buildExpenditureWorkbookBuffer(
	input: ExpenditureExportInput
): Promise<Buffer> {
	const wb = buildExpenditureWorkbook(input);
	const ab = await wb.xlsx.writeBuffer();
	return Buffer.from(ab);
}
