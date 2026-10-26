'use client';

/**
 * Available monthly expenditure includes confirmed cost and unfinalized payroll
 * estimates once. Confirmed cost stays explicit for financial review and close.
 */

import { formatCurrencyIn } from '@/lib/format';
import { availableMonthlyCost } from '@/lib/company-expenditure/available-cost';
import type { ReconciliationPayload } from './types';

export interface CompanyReconciliationPanelProps {
	/** The month's reconciliation, as the company states it. */
	data: ReconciliationPayload;
}

export function CompanyReconciliationPanel({
	data,
}: CompanyReconciliationPanelProps) {
	const available = availableMonthlyCost(data.company, data.payroll);
	// A month is stated in the requested reporting currency only when every
	// confirmed record is supported; otherwise its own currency subtotals are
	// the whole answer and the warning below says so.
	const conversion = data.company.conversion;
	const companyStated = conversion.status !== 'unsupported';
	const reportingCurrencyCode = data.company.reporting_currency;
	const statedCurrency = data.company.currency ?? reportingCurrencyCode;

	return (
		<>
			<p className="mb-1 text-xs text-gray-500">
				Available expenditure for {data.month_label}, stated in{' '}
				{available.currency}. Includes confirmed cost and available salary
				estimates. Project filters narrow the detail only.
			</p>
			<p
				data-testid="conversion-status"
				data-status={conversion.status}
				data-reporting-currency={reportingCurrencyCode}
				className="mb-3 text-xs text-gray-600"
			>
				{conversion.status === 'reporting'
					? `All recognized cost is already in ${reportingCurrencyCode}.`
					: conversion.status === 'converted'
						? `${conversion.converted_records} recognized record(s) converted into ${reportingCurrencyCode} at their recorded rates.`
						: `${conversion.unsupported_records} recognized record(s) cannot be stated in ${reportingCurrencyCode} yet.`}
			</p>
			{!companyStated && data.company.record_count > 0 && (
				<p
					data-testid="conversion-warning"
					className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
				>
					No complete company total in {reportingCurrencyCode}: some recognized
					cost has no supported conversion evidence for that basis, so only the
					currency subtotals below are stated.
				</p>
			)}
			{!available.estimate_currency_supported && (
				<p role="status" className="mb-3 text-xs font-medium text-amber-800">
					Payroll estimates remain in {data.payroll.currency}. No supported
					conversion to {available.currency} exists, so totals that need both
					currencies cannot be combined.
				</p>
			)}

			{/* Available cost: confirmed expenses and payroll estimates counted once. */}
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
				<div className="rounded-xl border border-purple-200 bg-[#64126D]/5 p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-[#64126D]">
						Available monthly expenditure
					</p>
					<p
						data-testid="kpi-available-cost"
						data-amount={available.amount ?? ''}
						className="mt-0.5 text-lg font-bold text-[#64126D]"
					>
						{available.amount === null
							? 'Not combinable'
							: formatCurrencyIn(available.amount, available.currency)}
					</p>
					<p className="text-[10px] text-gray-600">
						{available.partial
							? 'Partial total'
							: available.estimated
								? 'Includes salary estimates'
								: 'Confirmed cost'}
					</p>
					<p className="text-[10px] text-gray-600">
						Confirmed:{' '}
						<span data-testid="kpi-confirmed-cost">
							{data.company.incurred_cost === null && !companyStated
								? 'Not combinable'
								: formatCurrencyIn(
										data.company.incurred_cost ?? 0,
										statedCurrency
									)}
						</span>
					</p>
					{data.company.incurred_cost === null && companyStated && (
						<p className="text-[10px] text-gray-600">
							No confirmed cost recorded yet.
						</p>
					)}
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Available project cost
					</p>
					<p
						data-testid="kpi-project-cost"
						data-amount={available.project ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{available.project === null
							? 'See currencies'
							: formatCurrencyIn(available.project, available.currency)}
					</p>
					<p
						data-testid="kpi-project-count"
						data-scoped={
							data.project_id === null ? '' : String(data.project_id)
						}
						className="text-[10px] text-gray-600"
					>
						{data.project_id === null
							? `${data.projects.length} project(s) with cost`
							: 'Project detail filtered; company cost stays unfiltered'}
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Company Overhead
					</p>
					<p
						data-testid="kpi-overhead"
						data-amount={available.overhead ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{available.overhead === null
							? 'See currencies'
							: formatCurrencyIn(available.overhead, available.currency)}
					</p>
					<p className="text-[10px] text-gray-600">
						Deliberately not attributable to one Project
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Available unallocated cost
					</p>
					<p
						data-testid="kpi-unallocated"
						data-amount={available.unallocated ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{available.unallocated === null
							? 'See currencies'
							: formatCurrencyIn(available.unallocated, available.currency)}
					</p>
					<p className="text-[10px] text-gray-600">
						Awaiting a Project or Overhead destination
					</p>
				</div>
			</div>
			{/* Payroll basis: estimates are included above, never in confirmed cost. */}
			<section
				aria-label="Estimated payroll"
				data-testid="decision-separate-payroll"
				data-estimated-total={data.payroll.estimated_total}
				data-currency={data.payroll.currency}
				data-missing-pricing={data.payroll.missing_pricing_count}
				data-recorded-total={data.payroll.recorded_total}
				className="mb-3 mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
			>
				<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
					Estimated payroll
				</p>
				<p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
					{formatCurrencyIn(
						data.payroll.estimated_total,
						data.payroll.currency
					)}
				</p>
				<p className="text-[10px] text-gray-600">
					Recorded{' '}
					{formatCurrencyIn(data.payroll.recorded_total, data.payroll.currency)}{' '}
					· {data.payroll.known_zero_count} known-zero employee(s)
				</p>
				<p className="text-[10px] text-gray-600">
					{available.estimate_currency_supported
						? 'Included once in available expenditure above. Not part of confirmed expenditure.'
						: 'Not combined with confirmed expenditure: the currencies have no supported conversion.'}
				</p>
				{available.partial && (
					<p role="status" className="mt-1 text-xs font-medium text-amber-800">
						Partial expenditure: {data.payroll.unpriced_count} employee(s) have
						no available payroll cost.{' '}
						{data.payroll.missing_pricing_count > 0 &&
							`${data.payroll.missing_pricing_count} have no Salary Profile covering this month. `}
						Known costs and logged hours stay visible. Unpriced salaries are
						excluded from the available totals; a displayed zero does not mean
						their actual salary cost is zero.
					</p>
				)}
			</section>
		</>
	);
}
