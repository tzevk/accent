'use client';

/**
 * The company cost reconciliation headline of the company expenditure view.
 *
 * It states what the company incurred for the month: whether every recognized
 * cost can be stated in the reporting currency, the four direct-cost totals,
 * and the warning that some recognized cost has no supported conversion
 * evidence for that basis.
 */

import { formatCurrencyIn } from '@/lib/format';
import type { ReconciliationPayload } from './types';

export interface CompanyReconciliationPanelProps {
	/** The month's reconciliation, as the company states it. */
	data: ReconciliationPayload;
}

export function CompanyReconciliationPanel({
	data,
}: CompanyReconciliationPanelProps) {
	const groupAmount = (key: string) =>
		data.company.groups.find((group) => group.key === key)?.amount ?? null;
	// A month is stated in the requested reporting currency only when every
	// confirmed record is supported; otherwise its own currency subtotals are
	// the whole answer and the warning below says so.
	const conversion = data.company.conversion;
	const companyStated = conversion.status !== 'unsupported';
	const reportingCurrencyCode = data.company.reporting_currency;

	return (
		<>
			<p className="mb-1 text-xs text-gray-500">
				Company Incurred Cost for {data.month_label}
				{data.company.currency !== null
					? `, stated in ${data.company.currency}`
					: ', shown per currency'}
				. Each recognized direct cost is counted once; Project filters narrow
				the detail only.
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

			{/* Company reconciliation */}
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
				<div className="rounded-xl border border-purple-200 bg-[#64126D]/5 p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-[#64126D]">
						Company Incurred Cost
					</p>
					<p
						data-testid="kpi-incurred-cost"
						data-amount={
							data.company.incurred_cost === null
								? ''
								: String(data.company.incurred_cost)
						}
						className="mt-0.5 text-lg font-bold text-[#64126D]"
					>
						{data.company.incurred_cost === null
							? 'Not combinable'
							: formatCurrencyIn(
									data.company.incurred_cost,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-500">
						{data.company.record_count} recognized record(s)
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Incurred Project Cost
					</p>
					<p
						data-testid="kpi-project-cost"
						data-amount={groupAmount('incurred_project_cost') ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{groupAmount('incurred_project_cost') === null && !companyStated
							? 'See currencies'
							: formatCurrencyIn(
									groupAmount('incurred_project_cost') ?? 0,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-400">
						{data.projects.length} project(s) with cost
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Company Overhead
					</p>
					<p
						data-testid="kpi-overhead"
						data-amount={groupAmount('company_overhead') ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{groupAmount('company_overhead') === null && !companyStated
							? 'See currencies'
							: formatCurrencyIn(
									groupAmount('company_overhead') ?? 0,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-400">
						Deliberately not attributable to one Project
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Unallocated Cost
					</p>
					<p
						data-testid="kpi-unallocated"
						data-amount={groupAmount('unallocated_cost') ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{groupAmount('unallocated_cost') === null && !companyStated
							? 'See currencies'
							: formatCurrencyIn(
									groupAmount('unallocated_cost') ?? 0,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-400">
						Awaiting a Project or Overhead destination
					</p>
				</div>
			</div>
		</>
	);
}
