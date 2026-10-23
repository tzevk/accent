'use client';

/**
 * The comparable-period summary and supporting detail of the company
 * expenditure report.
 *
 * The summary states the month against its prior period: the comparable
 * window amount, prior amount, change, and states with the basis that
 * qualifies them. The supporting detail keeps the comparable window by
 * currency and direct-cost category with the disclosures that qualify it.
 * Both read the same payload; neither recomputes it.
 */

import {
	ExclamationTriangleIcon,
	InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { formatCurrencyIn, formatDate } from '@/lib/format';
import { percentLabel } from './shared';
import type { ClientOrderRow, ReconciliationPayload } from './types';

export interface ComparisonPanelProps {
	/** The reconciled month this panel reports on. */
	data: ReconciliationPayload;
	/** Client orders, giving the filtered Project its commercial context. */
	clientOrders: ClientOrderRow[];
}

export function ComparisonSummary({
	data,
}: Pick<ComparisonPanelProps, 'data'>) {
	// A month whose cost spans currencies has no single comparison figure; the
	// per-currency table in the supporting detail states each one, so the
	// headline says so instead of calling a known, currency-split amount
	// unknown.
	const currencySplitScope =
		data.comparison.currency === null &&
		data.comparison.currency_totals.length > 1;

	return (
		<section
			aria-label={`Comparable period — ${data.month_label} against ${data.comparison.prior_month_label}`}
			data-testid="comparison-panel"
			data-basis={data.comparison.basis}
			data-as-of={data.comparison.as_of}
			data-current-days={data.comparison.current_days}
			data-prior-days={data.comparison.prior_days}
			className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<p className="text-xs font-semibold text-gray-700">
					Comparable period — {data.month_label} against{' '}
					{data.comparison.prior_month_label}
				</p>
				<p className="text-[11px] text-gray-500">
					{data.comparison.unfinished
						? `Measured to ${data.comparison.as_of}: both periods cover their first ${data.comparison.current_days} day(s).`
						: `Full month compared with the full prior month (measured to ${data.comparison.as_of}).`}
				</p>
			</div>
			{data.comparison.unfinished &&
				data.company.incurred_cost !== null &&
				data.company.currency !== null &&
				data.comparison.currency !== null &&
				data.comparison.current_cost !== null &&
				data.comparison.current_cost !== data.company.incurred_cost && (
					<p
						data-testid="comparison-scope-bases"
						className="mt-2 text-[11px] text-gray-600"
					>
						Full-month Company Incurred Cost:{' '}
						{formatCurrencyIn(
							data.company.incurred_cost,
							data.company.currency
						)}{' '}
						· First {data.comparison.current_days} day(s) of this period:{' '}
						{formatCurrencyIn(
							data.comparison.current_cost,
							data.comparison.currency
						)}
					</p>
				)}
			<div className="mt-2 grid gap-3 sm:grid-cols-4">
				<div>
					<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
						{data.comparison.unfinished
							? `First ${data.comparison.current_days} day(s)`
							: 'This period'}
					</p>
					<p
						data-testid="comparison-current"
						data-value={data.comparison.current_cost ?? ''}
						data-currency={data.comparison.currency ?? ''}
						className="text-base font-bold text-gray-900"
					>
						{data.comparison.currency !== null
							? formatCurrencyIn(
									data.comparison.current_cost ?? 0,
									data.comparison.currency
								)
							: data.comparison.currency_totals.length === 0
								? 'No cost recorded'
								: 'See currencies'}
					</p>
				</div>
				<div>
					<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
						Prior period
					</p>
					<p
						data-testid="comparison-prior"
						data-value={data.comparison.prior_cost ?? ''}
						className="text-base font-bold text-gray-900"
					>
						{data.comparison.prior_cost === null
							? currencySplitScope
								? 'See currencies'
								: 'Unknown'
							: formatCurrencyIn(
									data.comparison.prior_cost,
									data.comparison.currency
								)}
					</p>
				</div>
				<div>
					<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
						Absolute change
					</p>
					<p
						data-testid="comparison-change"
						data-value={data.comparison.change_amount ?? ''}
						className="text-base font-bold text-gray-900"
					>
						{data.comparison.change_amount === null
							? currencySplitScope
								? 'See currencies'
								: 'Unknown'
							: formatCurrencyIn(
									data.comparison.change_amount,
									data.comparison.currency
								)}
					</p>
				</div>
				<div>
					<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
						Percentage change
					</p>
					<p
						data-testid="comparison-percent"
						data-value={data.comparison.change_percent ?? ''}
						data-state={data.comparison.change_state}
						className="text-base font-bold text-gray-900"
					>
						{currencySplitScope
							? 'See currencies'
							: percentLabel(
									data.comparison.change_percent,
									data.comparison.change_state
								)}
					</p>
				</div>
			</div>
		</section>
	);
}

export function ComparisonDetail({ data }: Pick<ComparisonPanelProps, 'data'>) {
	if (
		data.comparison.currency_totals.length === 0 &&
		data.comparison.disclosures.length === 0
	) {
		return null;
	}
	return (
		<section
			aria-label={`Comparable window detail — ${data.month_label}`}
			data-testid="comparison-detail"
			data-basis={data.comparison.basis}
			className="mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
		>
			<p className="text-xs font-semibold text-gray-700">
				Comparable window detail — {data.month_label} against{' '}
				{data.comparison.prior_month_label}
			</p>
			{data.comparison.currency_totals.length > 0 && (
				<div className="overflow-x-auto">
					<table className="mt-2 w-full min-w-[440px] text-xs">
						<caption className="sr-only">
							Comparable window by currency and direct-cost category
						</caption>
						<thead className="text-left text-[10px] uppercase tracking-wide text-gray-500">
							<tr>
								<th scope="col">Currency</th>
								<th scope="col" className="text-right">
									This period
								</th>
								<th scope="col" className="text-right">
									Prior period
								</th>
								<th scope="col" className="text-right">
									Change
								</th>
								<th scope="col" className="text-right">
									Incurred Project Cost
								</th>
								<th scope="col" className="text-right">
									Company Overhead
								</th>
								<th scope="col" className="text-right">
									Unallocated Cost
								</th>
							</tr>
						</thead>
						<tbody>
							{data.comparison.currency_totals.map((row) => (
								<tr
									key={row.currency}
									data-testid="comparison-currency-row"
									data-currency={row.currency}
									data-current={row.current_cost}
									data-prior={row.prior_cost ?? ''}
									data-dayless={row.dayless_cost}
									data-dayless-count={row.dayless_records}
								>
									<td>{row.currency}</td>
									<td className="text-right">
										{formatCurrencyIn(row.current_cost, row.currency)}
									</td>
									<td className="text-right">
										{row.prior_cost === null
											? 'Unknown'
											: formatCurrencyIn(row.prior_cost, row.currency)}
									</td>
									<td className="text-right">
										{percentLabel(row.change_percent, row.change_state)}
									</td>
									{row.groups.map((group) => (
										<td
											key={group.key}
											data-testid="comparison-category"
											data-category={group.key}
											data-amount={group.amount}
											className="text-right"
										>
											{formatCurrencyIn(group.amount, row.currency)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<ul className="mt-2 space-y-1">
				{data.comparison.disclosures.map((entry, index) => (
					<li
						key={`${entry.code}-${entry.period ?? 'both'}-${index}`}
						data-testid="comparison-disclosure"
						data-code={entry.code}
						data-period={entry.period ?? ''}
						data-count={entry.count}
						data-amount={entry.amount ?? ''}
						data-severity={entry.severity}
						className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
							entry.severity === 'warning' ? 'text-amber-800' : 'text-gray-500'
						}`}
					>
						{entry.severity === 'warning' ? (
							<ExclamationTriangleIcon className="mt-0.5 h-3 w-3 shrink-0" />
						) : (
							<InformationCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
						)}
						<span>
							<span className="font-semibold">{entry.label}.</span>{' '}
							{entry.detail}
						</span>
					</li>
				))}
			</ul>
			<p className="mt-2 text-[11px] text-gray-500">
				Cost to date is cumulative recognized cost through{' '}
				{formatDate(data.comparison.cost_to_date_through)}, the window&apos;s
				last day.
			</p>
		</section>
	);
}

export function FilteredProjectSubtotal({
	data,
	clientOrders,
}: ComparisonPanelProps) {
	const filtered = data.filtered_subtotal;
	if (filtered === null) return null;
	return (
		<>
			{/* The filtered Project subtotal is never the company reconciliation */}
			{filtered && (
				<div
					data-testid="filtered-subtotal"
					data-project-id={filtered.project_id}
					className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3"
				>
					<p className="text-xs font-semibold text-indigo-900">
						Filtered Project subtotal —{' '}
						{filtered.currency_totals.map((row) => (
							<span key={row.currency} className="mr-2">
								<span
									data-testid="filtered-subtotal-currency"
									data-currency={row.currency}
									data-incurred={row.incurred_cost}
									data-comparison={row.comparison_cost}
									data-cost-to-date={row.cost_to_date ?? ''}
								>
									Incurred {formatCurrencyIn(row.incurred_cost, row.currency)} ·{' '}
									this period{' '}
									{formatCurrencyIn(row.comparison_cost, row.currency)} · to
									date{' '}
									{row.cost_to_date === null
										? 'unknown'
										: formatCurrencyIn(row.cost_to_date, row.currency)}
								</span>
							</span>
						))}
					</p>
					<p className="mt-1 text-[11px] text-indigo-800">
						The company reconciliation above is not narrowed by the Project
						filter; it stays the unfiltered company position.
					</p>
					{(() => {
						const filteredOrders = clientOrders.filter(
							(o) => o.projectId === filtered.project_id
						);
						if (filteredOrders.length === 0) return null;
						return (
							<div
								data-testid="filtered-subtotal-client-orders"
								className="mt-2 border-t border-indigo-200/60 pt-1 text-[11px] text-indigo-900"
							>
								<span className="font-semibold">
									Client order commercial context (not cost, revenue, or
									profit):
								</span>{' '}
								{filteredOrders.map((o) => {
									const val =
										o.amountBasis === 'gross' ? o.grossAmount : o.netAmount;
									return (
										<span key={o.orderUid} className="mr-2">
											{o.orderNumber}:{' '}
											{val !== null ? formatCurrencyIn(val, o.currency) : '—'} (
											{o.amountBasis})
										</span>
									);
								})}
							</div>
						);
					})()}
				</div>
			)}
		</>
	);
}

export function CompanyCurrencySubtotals({
	data,
}: Pick<ComparisonPanelProps, 'data'>) {
	// A month is stated in the requested reporting currency only when every
	// confirmed record is supported; otherwise its own currency subtotals are
	// the whole answer and the warning in the company summary says so.
	const conversion = data.company.conversion;
	const companyStated = conversion.status !== 'unsupported';
	const reportingCurrencyCode = data.company.reporting_currency;
	return (
		<>
			{/* Currency subtotals: never combined without a supported conversion */}
			{data.company.currency_totals.some(
				(row) => row.reporting.status !== 'reporting'
			) && (
				<div
					className={`mt-3 overflow-x-auto rounded-xl border p-3 ${
						companyStated
							? 'border-gray-200 bg-white'
							: 'border-amber-200 bg-amber-50'
					}`}
				>
					<p
						className={`text-xs font-semibold ${companyStated ? 'text-gray-700' : 'text-amber-900'}`}
					>
						{companyStated
							? `Each currency is converted into ${reportingCurrencyCode} at the rate recorded with its cost.`
							: `Some currencies have no supported conversion to ${reportingCurrencyCode} yet. Their amounts stay in their own currency and no combined total is shown.`}
					</p>
					<table className="mt-2 w-full text-xs">
						<thead>
							<tr className="text-left text-gray-600">
								<th className="py-1 pr-3 font-medium">Currency</th>
								<th className="py-1 pr-3 font-medium">Incurred Project Cost</th>
								<th className="py-1 pr-3 font-medium">Company Overhead</th>
								<th className="py-1 pr-3 font-medium">Unallocated Cost</th>
								<th className="py-1 pr-3 font-medium">Total</th>
								<th className="py-1 pr-3 font-medium">
									Reporting ({reportingCurrencyCode})
								</th>
							</tr>
						</thead>
						<tbody>
							{data.company.currency_totals.map((row) => (
								<tr
									key={row.currency}
									data-testid="currency-total-row"
									data-conversion-status={row.reporting.status}
								>
									<td className="py-1 pr-3 font-semibold">{row.currency}</td>
									<td className="py-1 pr-3">
										{formatCurrencyIn(row.incurred_project_cost, row.currency)}
									</td>
									<td className="py-1 pr-3">
										{formatCurrencyIn(row.company_overhead, row.currency)}
									</td>
									<td className="py-1 pr-3">
										{formatCurrencyIn(row.unallocated_cost, row.currency)}
									</td>
									<td className="py-1 pr-3 font-semibold">
										{formatCurrencyIn(row.incurred_cost, row.currency)}
									</td>
									<td
										data-testid="currency-reporting-row"
										data-currency={row.currency}
										data-status={row.reporting.status}
										className="py-1 pr-3 font-semibold"
									>
										{row.reporting.incurred_cost === null
											? `No rate to ${reportingCurrencyCode}`
											: formatCurrencyIn(
													row.reporting.incurred_cost,
													reportingCurrencyCode
												)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}
