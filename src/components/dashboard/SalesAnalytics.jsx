'use client';

import { useMemo, useState } from 'react';
import InteractiveDonut from '@/components/InteractiveDonut';
import { formatCurrency, formatNumber } from '@/lib/format.js';

/** One chart token per canonical status bucket (ADR-0028): a restyle is one edit. */
const BUCKET_COLOURS = {
	Pending: 'var(--chart-pending)',
	Approved: 'var(--chart-approved)',
	Draft: 'var(--chart-draft)',
	Rejected: 'var(--chart-rejected)',
};

/** Counts are whole numbers; `formatNumber` prints their 2dp tail. */
function groupedCount(value) {
	return formatNumber(value).replace(/\.00$/, '');
}

const TOGGLE_BASE =
	'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]';

/**
 * Proposal mix for the window: the four canonical status buckets as a donut,
 * measured by count or by value, with the conversion reading underneath.
 * Presentation only — the payload arrives as props, so this never fetches.
 *
 * `total` counts every proposal in the window, including statuses that match
 * no bucket; the unmapped disclosure names them so the four slices are not
 * mistaken for the whole.
 */
export default function SalesAnalytics({ sales = null, loading = false }) {
	const [metric, setMetric] = useState('count');

	const view = useMemo(() => {
		if (!sales) return null;
		const byValue = metric === 'value';
		const chart = sales.buckets.map((bucket) => ({
			name: bucket.name,
			value: byValue ? bucket.value : bucket.count,
			color: BUCKET_COLOURS[bucket.name],
		}));
		return {
			chart,
			colours: chart.map((slice) => slice.color),
			format: byValue ? formatCurrency : groupedCount,
			centre: byValue
				? formatCurrency(sales.total.value)
				: groupedCount(sales.total.count),
			totalLabel: byValue ? 'Proposal value' : 'Proposals',
			conversion: byValue ? sales.conversion.value : sales.conversion.count,
		};
	}, [sales, metric]);

	if (loading) {
		return (
			<div
				data-testid="sales-analytics-loading"
				className="rounded-xl border border-purple-200 bg-white p-6"
			>
				<div className="mb-4 flex items-center justify-between">
					<div
						data-motion
						className="h-5 w-32 animate-pulse rounded bg-gray-100"
					/>
					<div className="flex gap-2">
						<div
							data-motion
							className="h-7 w-16 animate-pulse rounded-lg bg-gray-100"
						/>
						<div
							data-motion
							className="h-7 w-16 animate-pulse rounded-lg bg-gray-100"
						/>
					</div>
				</div>
				<div
					data-motion
					className="mx-auto h-64 w-64 animate-pulse rounded-full bg-gray-100"
				/>
				<div className="mt-4 space-y-2">
					{[...Array(4)].map((_, index) => (
						<div
							key={index}
							data-motion
							className="mx-auto h-4 w-3/4 animate-pulse rounded bg-gray-100"
						/>
					))}
				</div>
			</div>
		);
	}

	const totalCount = sales ? sales.total.count : 0;
	const unmapped = sales ? sales.unmapped : null;

	// A missing payload and an empty window read the same way, and both keep
	// the donut away: an empty ring says nothing the sentence does not.
	if (totalCount === 0) {
		return (
			<div
				data-testid="sales-analytics"
				className="rounded-xl border border-purple-200 bg-white p-6"
			>
				<h3 className="mb-4 text-lg font-semibold text-gray-900">
					Sales Pipeline
				</h3>
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<p className="font-medium text-gray-700">
						No proposals in this window
					</p>
					<p className="mt-1 text-sm text-gray-500">
						Proposals appear here as they are created.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div
			data-testid="sales-analytics"
			className="rounded-xl border border-purple-200 bg-white p-6"
		>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h3 className="text-lg font-semibold text-gray-900">Sales Pipeline</h3>
				<div
					className="flex gap-2"
					role="group"
					aria-label="Measure proposals by"
				>
					<button
						type="button"
						aria-pressed={metric === 'count'}
						onClick={() => setMetric('count')}
						className={`${TOGGLE_BASE} ${
							metric === 'count'
								? 'bg-[#64126D] text-white'
								: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
						}`}
					>
						Count
					</button>
					<button
						type="button"
						aria-pressed={metric === 'value'}
						onClick={() => setMetric('value')}
						className={`${TOGGLE_BASE} ${
							metric === 'value'
								? 'bg-[#64126D] text-white'
								: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
						}`}
					>
						Value
					</button>
				</div>
			</div>

			<div className="flex flex-col items-center">
				<InteractiveDonut
					data={view.chart}
					colors={view.colours}
					centerValue={view.centre}
					totalLabel={view.totalLabel}
					valueFormatter={view.format}
				/>

				<ul className="mt-3 w-full max-w-[240px] space-y-1">
					{view.chart.map((slice) => (
						<li
							key={slice.name}
							className="flex items-center justify-between gap-3 py-1 text-sm"
						>
							<span className="flex items-center gap-2 text-gray-700">
								<span
									aria-hidden="true"
									className="h-2.5 w-2.5 shrink-0 rounded-full"
									style={{ backgroundColor: slice.color }}
								/>
								{slice.name}
							</span>
							<span className="font-medium tabular-nums text-gray-900">
								{view.format(slice.value)}
							</span>
						</li>
					))}
				</ul>

				<p className="mt-3 text-center text-sm text-gray-600">
					<span className="font-semibold tabular-nums text-gray-900">
						{view.conversion}%
					</span>{' '}
					conversion (approved of{' '}
					<span className="tabular-nums">{groupedCount(totalCount)}</span>{' '}
					proposals)
				</p>

				{unmapped && unmapped.count > 0 && (
					<p
						data-testid="sales-unmapped"
						className="mt-2 text-center text-xs text-gray-500"
					>
						Includes {groupedCount(unmapped.count)}{' '}
						{unmapped.count === 1 ? 'proposal' : 'proposals'} in other statuses
						({unmapped.statuses.join(', ')}).
					</p>
				)}
			</div>
		</div>
	);
}
