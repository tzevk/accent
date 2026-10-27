'use client';

/**
 * Available monthly expenditure includes confirmed cost and unfinalized payroll
 * estimates once. Confirmed cost stays explicit for financial review and close.
 */

import { formatCurrencyIn } from '@/lib/format';
import { availableMonthlyCost } from '@/lib/company-expenditure/available-cost';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CostHelp, CostLabel } from './cost-help';
import { COST_DEFINITIONS, costStatusLabels } from './shared';
import type { ReconciliationPayload } from './types';

export interface CompanyReconciliationPanelProps {
	/** The month's reconciliation, as the company states it. */
	data: ReconciliationPayload;
}

export function CompanyReconciliationPanel({
	data,
}: CompanyReconciliationPanelProps) {
	const available = availableMonthlyCost(data.company, data.payroll);
	const statuses = costStatusLabels(
		available,
		data.payroll.unpriced_count,
		data.company.incurred_cost
	);
	// A month is stated in the requested reporting currency only when every
	// confirmed record is supported; otherwise its own currency subtotals are
	// the whole answer and the warning below says so.
	const conversion = data.company.conversion;
	const companyStated = conversion.status !== 'unsupported';
	const reportingCurrencyCode = data.company.reporting_currency;
	const statedCurrency = data.company.currency ?? reportingCurrencyCode;

	return (
		<TooltipProvider delayDuration={300}>
			<div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p className="text-base font-semibold text-gray-900">
							{data.month_label}
						</p>
						<p className="mt-1 text-sm text-gray-600">
							Company-wide · Reporting in {available.currency}
						</p>
					</div>
					<CostHelp />
				</div>

				<div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
					<div className="min-w-0">
						<h3 className="text-sm font-medium text-gray-700">
							<CostLabel term="monthly" />
						</h3>
						<p
							data-testid="kpi-available-cost"
							data-amount={available.amount ?? ''}
							className="mt-2 break-words text-3xl font-semibold tracking-tight tabular-nums text-[#64126D] sm:text-4xl"
						>
							{available.amount === null
								? 'Not combinable'
								: formatCurrencyIn(available.amount, available.currency)}
						</p>
						<div
							role="status"
							aria-atomic="true"
							className="mt-3 flex flex-wrap gap-2 text-xs"
						>
							{statuses.map((status) => (
								<span
									key={status}
									className={`rounded-md border px-2 py-1 font-medium ${
										available.estimated || available.partial
											? 'border-amber-200 bg-amber-50 text-amber-900'
											: 'border-green-200 bg-green-50 text-green-900'
									}`}
								>
									{status}
								</span>
							))}
						</div>
					</div>

					<div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:border-s lg:border-gray-200 lg:ps-6">
						<div>
							<h3 className="text-sm font-medium text-gray-700">
								{COST_DEFINITIONS.confirmed.label}
							</h3>
							<p className="mt-2 text-xl font-semibold tabular-nums text-gray-900">
								<span data-testid="kpi-confirmed-cost">
									{data.company.incurred_cost === null && !companyStated
										? 'Not combinable'
										: formatCurrencyIn(
												data.company.incurred_cost ?? 0,
												statedCurrency
											)}
								</span>
							</p>
							<p className="mt-2 text-xs leading-relaxed text-gray-600">
								{data.company.record_count} recognized record(s)
							</p>
							{data.company.incurred_cost === null && companyStated && (
								<p className="mt-1 text-xs leading-relaxed text-gray-600">
									No confirmed cost recorded yet.
								</p>
							)}
						</div>
						<section
							aria-label={COST_DEFINITIONS.salaryEstimate.label}
							data-testid="decision-separate-payroll"
							data-estimated-total={data.payroll.estimated_total}
							data-currency={data.payroll.currency}
							data-missing-pricing={data.payroll.missing_pricing_count}
							data-recorded-total={data.payroll.recorded_total}
							className="min-w-0"
						>
							<h3 className="text-sm font-medium text-gray-700">
								<CostLabel term="salaryEstimate" />
							</h3>
							<p className="mt-2 text-xl font-semibold tabular-nums text-gray-900">
								{formatCurrencyIn(
									data.payroll.estimated_total,
									data.payroll.currency
								)}
							</p>
							<p className="mt-2 text-xs leading-relaxed text-gray-600">
								{available.estimate_currency_supported
									? 'Included in the total, not added again.'
									: 'Shown separately; currencies cannot be combined.'}
							</p>
							<p className="mt-1 text-xs leading-relaxed text-gray-600">
								Recorded{' '}
								{formatCurrencyIn(
									data.payroll.recorded_total,
									data.payroll.currency
								)}{' '}
								· {data.payroll.known_zero_count} known-zero employee(s)
							</p>
						</section>
					</div>
				</div>

				{available.partial && (
					<p className="mt-5 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
						<span className="font-semibold">This total is partial.</span> Salary
						costs for {data.payroll.unpriced_count} employee(s) cannot be
						calculated.{' '}
						{data.payroll.missing_pricing_count > 0 &&
							`${data.payroll.missing_pricing_count} have no Salary Profile covering this month. `}
						Known costs and logged hours remain included. An unpriced zero does
						not mean zero actual salary.
					</p>
				)}

				<dl className="mt-5 grid gap-5 border-t border-gray-200 pt-5 sm:grid-cols-3">
					<div className="min-w-0">
						<dt className="text-sm font-medium text-gray-700">
							<CostLabel term="project" />
						</dt>
						<dd
							data-testid="kpi-project-cost"
							data-amount={available.project ?? ''}
							className="mt-1 text-xl font-semibold tabular-nums text-gray-900"
						>
							{available.project === null
								? 'See currencies'
								: formatCurrencyIn(available.project, available.currency)}
						</dd>
						<dd
							data-testid="kpi-project-count"
							data-scoped={
								data.project_id === null ? '' : String(data.project_id)
							}
							className="mt-1 text-xs leading-relaxed text-gray-600"
						>
							{data.project_id !== null
								? 'Project detail filtered; company cost stays unfiltered'
								: data.projects.length === 1
									? '1 project row in detail'
									: `${data.projects.length} project rows in detail`}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-sm font-medium text-gray-700">
							<CostLabel term="overhead" />
						</dt>
						<dd
							data-testid="kpi-overhead"
							data-amount={available.overhead ?? ''}
							className="mt-1 text-xl font-semibold tabular-nums text-gray-900"
						>
							{available.overhead === null
								? 'See currencies'
								: formatCurrencyIn(available.overhead, available.currency)}
						</dd>
						<dd className="mt-1 text-xs leading-relaxed text-gray-600">
							Shared costs, not charged to a Project
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-sm font-medium text-gray-700">
							<CostLabel term="unallocated" />
						</dt>
						<dd
							data-testid="kpi-unallocated"
							data-amount={available.unallocated ?? ''}
							className="mt-1 text-xl font-semibold tabular-nums text-gray-900"
						>
							{available.unallocated === null
								? 'See currencies'
								: formatCurrencyIn(available.unallocated, available.currency)}
						</dd>
						<dd className="mt-1 text-xs leading-relaxed text-gray-600">
							No Project or overhead destination
						</dd>
					</div>
				</dl>

				<p
					data-testid="conversion-status"
					data-status={conversion.status}
					data-reporting-currency={reportingCurrencyCode}
					className="mt-4 text-xs leading-relaxed text-gray-600"
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
						className="mt-3 max-w-3xl rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900"
					>
						No complete company total in {reportingCurrencyCode}: some
						recognized cost has no supported conversion evidence for that basis.
						The currency subtotals below retain the native amounts.
					</p>
				)}
				{!available.estimate_currency_supported && (
					<p
						role="status"
						className="mt-3 max-w-3xl text-sm leading-relaxed text-amber-900"
					>
						Payroll estimates remain in {data.payroll.currency}. No supported
						conversion to {available.currency} exists, so totals that need both
						currencies cannot be combined.
					</p>
				)}
			</div>
		</TooltipProvider>
	);
}
