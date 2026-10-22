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
import SearchableSelect from '@/components/ui/searchable-select';
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
		<>
			{/* Controls */}
			<div className="mb-3 flex flex-wrap items-end gap-2">
				<div className="w-full max-w-[240px]">
					<SearchableSelect
						options={monthOptions}
						value={month}
						onChange={(value) => onMonthChange(String(value))}
						placeholder="Select month…"
						aria-label="Month"
					/>
				</div>
				<div className="flex items-end gap-1">
					<button
						type="button"
						data-testid="fy-prev"
						onClick={() => onFinancialYearStep(-1)}
						className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						aria-label="Previous financial year"
					>
						‹
					</button>
					<span
						data-testid="fy-label"
						data-fy={financialYear ?? ''}
						className="px-1 py-2 text-xs font-semibold text-gray-700"
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
						className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="Next financial year"
					>
						›
					</button>
				</div>
				<div className="w-full max-w-[280px]">
					<SearchableSelect
						options={projectOptions}
						value={projectFilter}
						onChange={(value) => {
							onProjectFilterChange(String(value));
							onProjectExpand(null);
						}}
						placeholder="All projects"
						aria-label="Project filter"
					/>
				</div>
				<label className="block text-sm">
					<span className="sr-only">Ranking</span>
					<select
						data-testid="ranking-select"
						aria-label="Ranking"
						value={rankingMode}
						onChange={(event) =>
							onRankingModeChange(
								event.target.value === 'increase' ? 'increase' : 'cost'
							)
						}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
					>
						<option value="cost">Largest cost first</option>
						<option value="increase">Largest increase first</option>
					</select>
				</label>
				<label className="text-xs font-medium text-gray-600">
					<span className="mb-1 block">Reporting currency</span>
					<select
						aria-label="Reporting currency"
						value={reportingCurrency}
						onChange={(event) => onReportingCurrencyChange(event.target.value)}
						className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
					>
						{CURRENCIES.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</select>
				</label>
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						onClick={onRefresh}
						aria-busy={refreshing}
						className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						<ArrowPathIcon
							className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''} motion-reduce:animate-none`}
						/>
						{refreshing ? 'Refreshing…' : 'Refresh'}
					</button>
					<button
						type="button"
						data-testid="expenditure-export-button"
						onClick={onExport}
						disabled={exporting}
						className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<DocumentArrowDownIcon
							className={`h-4 w-4 ${exporting ? 'animate-bounce' : ''} motion-reduce:animate-none`}
						/>
						{exporting ? 'Exporting…' : 'Export Excel'}
					</button>
					{canRecord && (
						<button
							type="button"
							onClick={onRecordCost}
							className="inline-flex items-center gap-1.5 rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a]"
						>
							<PlusIcon className="h-4 w-4" />
							Record cost
						</button>
					)}
				</div>
			</div>
		</>
	);
}
