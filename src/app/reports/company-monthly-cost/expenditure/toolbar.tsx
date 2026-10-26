'use client';

/**
 * The controls row of the company expenditure report.
 *
 * It picks the month and the financial year, narrows the detail to one
 * Project, chooses how the figures are ranked and in which currency they are
 * reported, and refreshes or exports the reconciliation. Nothing here
 * computes a figure: every value arrives from the container as a plain value
 * and every action leaves as a callback.
 */

import {
	ArrowPathIcon,
	DocumentArrowDownIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';
// The financial-year vocabulary is pure calendar arithmetic, so the row takes
// it from the same module the report uses instead of a second copy here; the
// barrel is avoided because it also opens the database pool (server only).
import { financialYearLabel } from '@/lib/company-expenditure/ranking';
import { CURRENCIES } from './shared';

export interface ToolbarProps {
	/** The month the report reads. */
	month: string;
	/** The months the picker offers. */
	monthOptions: Array<{ value: string; label: string }>;
	onMonthChange: (month: string) => void;
	/** `other_expenses:create` — may record a cost. */
	canRecord: boolean;
	/** The Projects the filter offers. */
	projectOptions: Array<{ value: string; label: string }>;
	projectFilter: string;
	onProjectFilterChange: (value: string) => void;
	/** Collapses the expanded Project when the filter changes. */
	onProjectExpand: (projectId: number | null) => void;
	rankingMode: 'cost' | 'increase';
	onRankingModeChange: (value: 'cost' | 'increase') => void;
	reportingCurrency: string;
	onReportingCurrencyChange: (value: string) => void;
	/** The financial year of the reported month and of the current month. */
	financialYear: number | null;
	currentFinancialYear: number | null;
	onFinancialYearStep: (step: number) => void;
	/** The export is in flight. */
	exporting: boolean;
	onExport: () => void;
	/** The reconciliation is being refetched. */
	refreshing: boolean;
	/** Refetches the reconciliation and the review queue together. */
	onRefresh: () => void;
	onRecordCost: () => void;
}

export function Toolbar({
	month,
	monthOptions,
	onMonthChange,
	canRecord,
	projectOptions,
	projectFilter,
	onProjectFilterChange,
	onProjectExpand,
	rankingMode,
	onRankingModeChange,
	reportingCurrency,
	onReportingCurrencyChange,
	financialYear,
	currentFinancialYear,
	onFinancialYearStep,
	exporting,
	onExport,
	refreshing,
	onRefresh,
	onRecordCost,
}: ToolbarProps) {
	return (
		<section
			aria-label="Expenditure filters and actions"
			className="mb-5 rounded-xl border border-gray-200 bg-white p-4"
		>
			<div className="flex flex-wrap items-end gap-4">
				<label className="min-w-0 flex-1 text-sm font-medium text-gray-700 sm:min-w-48 sm:max-w-64">
					<span className="mb-1.5 block">Month</span>
					<select
						aria-label="Month"
						value={month}
						onChange={(event) => onMonthChange(event.target.value)}
						className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] sm:min-h-10 sm:text-sm"
					>
						{monthOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<div>
					<p className="mb-1.5 text-sm font-medium text-gray-700">
						Financial year
					</p>
					<div className="flex min-h-11 items-center gap-1 rounded-lg border border-gray-300 bg-white sm:min-h-10">
						<button
							type="button"
							data-testid="fy-prev"
							onClick={() => onFinancialYearStep(-1)}
							className="min-h-10 min-w-10 rounded-md text-lg text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
							aria-label="Previous financial year"
						>
							‹
						</button>
						<span
							data-testid="fy-label"
							data-fy={financialYear ?? ''}
							className="text-sm font-medium tabular-nums text-gray-700"
						>
							{financialYear === null ? '—' : financialYearLabel(financialYear)}
						</span>
						<button
							type="button"
							data-testid="fy-next"
							onClick={() => onFinancialYearStep(1)}
							disabled={
								financialYear === null ||
								currentFinancialYear === null ||
								financialYear >= currentFinancialYear
							}
							className="min-h-10 min-w-10 rounded-md text-lg text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] disabled:cursor-not-allowed disabled:opacity-40"
							aria-label="Next financial year"
						>
							›
						</button>
					</div>
				</div>
				<label className="text-sm font-medium text-gray-700">
					<span className="mb-1.5 block">Reporting currency</span>
					<select
						aria-label="Reporting currency"
						value={reportingCurrency}
						onChange={(event) => onReportingCurrencyChange(event.target.value)}
						className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] sm:min-h-10 sm:text-sm"
					>
						{CURRENCIES.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap items-center gap-2 sm:ms-auto">
					<button
						type="button"
						onClick={onRefresh}
						aria-busy={refreshing}
						className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] sm:min-h-10"
					>
						<ArrowPathIcon
							aria-hidden="true"
							className={`h-4 w-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
						/>
						{refreshing ? 'Refreshing…' : 'Refresh'}
					</button>
					<button
						type="button"
						data-testid="expenditure-export-button"
						onClick={onExport}
						disabled={exporting}
						className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10"
					>
						<DocumentArrowDownIcon aria-hidden="true" className="h-4 w-4" />
						{exporting ? 'Exporting…' : 'Export Excel'}
					</button>
					{canRecord && (
						<button
							type="button"
							onClick={onRecordCost}
							className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] sm:min-h-10"
						>
							<PlusIcon aria-hidden="true" className="h-4 w-4" />
							Record cost
						</button>
					)}
				</div>
			</div>
			<div className="mt-4 grid min-w-0 gap-4 border-t border-gray-200 pt-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
				<label className="min-w-0 text-sm font-medium text-gray-700">
					<span className="mb-1.5 block">Project filter</span>
					<select
						value={projectFilter}
						onChange={(event) => {
							onProjectFilterChange(event.target.value);
							onProjectExpand(null);
						}}
						className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] sm:min-h-10 sm:text-sm"
					>
						{projectOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<label className="min-w-0 text-sm font-medium text-gray-700">
					<span className="mb-1.5 block">Project order</span>
					<select
						data-testid="ranking-select"
						value={rankingMode}
						onChange={(event) =>
							onRankingModeChange(
								event.target.value === 'increase' ? 'increase' : 'cost'
							)
						}
						className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] sm:min-h-10 sm:text-sm"
					>
						<option value="cost">Largest monthly cost first</option>
						<option value="increase">Largest confirmed increase first</option>
					</select>
				</label>
				<p className="self-end text-xs leading-relaxed text-gray-600 lg:pb-2">
					Project filters change the detail only. Company totals stay
					unfiltered.
				</p>
			</div>
		</section>
	);
}
