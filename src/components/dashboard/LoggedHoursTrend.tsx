'use client';

import { useMemo } from 'react';
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import type {
	DashboardTrendPoint,
	DashboardWindow,
} from '@/lib/dashboard-summary';
import { formatDate, formatNumber } from '@/lib/format.js';

export interface LoggedHoursTrendProps {
	/** Bucket series from the summary route, oldest first. */
	points: DashboardTrendPoint[];
	/** Which window the buckets cover; drives the panel's caption only. */
	window: DashboardWindow;
	loading?: boolean;
}

/** Chart row: the bucket's formatted date doubles as the axis label. */
interface TrendDatum {
	label: string;
	logged: number;
	capacity: number;
	partial: boolean;
}

/** The caption's wording for each window; `month` is the full calendar month. */
const WINDOW_LABEL: Record<DashboardWindow, string> = {
	month: 'this month',
	week: 'the last 7 days',
};

/**
 * Logged Hours against Capacity over the selected window: one bar of hours per
 * bucket with a dashed capacity reference line. A bucket that has not finished
 * yet is an in-progress slice of the same calendar, so it is labelled and
 * noted rather than clamped or dropped — the month window's later buckets
 * already carry entries dated later in the month.
 *
 * Presentation only: the payload arrives as props, so this never fetches.
 */
export default function LoggedHoursTrend({
	points,
	window: scope,
	loading = false,
}: LoggedHoursTrendProps) {
	const data = useMemo<TrendDatum[]>(
		() =>
			points.map((point) => ({
				// The marker rides on the label, not the tick index: recharts drops
				// crowded ticks, and an index would then mark the wrong bucket.
				label: `${formatDate(point.label)}${point.partial ? ' (in progress)' : ''}`,
				logged: point.logged,
				capacity: point.capacity,
				partial: point.partial,
			})),
		[points]
	);

	const windowLabel = WINDOW_LABEL[scope];
	const bucketsReadout = data
		.map(
			(datum) =>
				`${datum.label}: ${formatNumber(datum.logged)} h logged, ${formatNumber(datum.capacity)} h capacity`
		)
		.join('; ');

	if (loading) {
		return (
			<div
				data-testid="logged-hours-trend-loading"
				className="rounded-xl border border-border bg-card p-6"
			>
				<div className="mb-4 space-y-2">
					<div
						data-motion
						className="h-5 w-52 animate-pulse rounded bg-muted"
					/>
					<div
						data-motion
						className="h-4 w-72 animate-pulse rounded bg-muted"
					/>
				</div>
				<div data-motion className="h-72 animate-pulse rounded-lg bg-muted" />
			</div>
		);
	}

	return (
		<div
			data-testid="logged-hours-trend"
			className="rounded-xl border border-border bg-card p-6"
		>
			<div className="mb-4">
				<h3 className="text-lg font-semibold text-foreground">
					Logged Hours vs Capacity
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Hours logged each bucket against the capacity calendar for{' '}
					{windowLabel}.
				</p>
			</div>

			{data.length === 0 ? (
				<div className="flex h-72 flex-col items-center justify-center text-center">
					<p className="font-medium text-foreground">
						No logged hours in this window
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Buckets appear once team members log hours for {windowLabel}.
					</p>
				</div>
			) : (
				<>
					<p className="sr-only">
						Logged hours and capacity per bucket: {bucketsReadout}.
					</p>
					<div className="h-72 overflow-hidden">
						<ResponsiveContainer width="100%" height="100%">
							<ComposedChart
								data={data}
								margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
							>
								<CartesianGrid
									stroke="var(--border)"
									strokeDasharray="3 3"
									vertical={false}
								/>
								<XAxis
									dataKey="label"
									tick={{
										fontSize: 12,
										fill: 'var(--muted-foreground)',
									}}
									axisLine={{ stroke: 'var(--border)' }}
									tickLine={{ stroke: 'var(--border)' }}
									minTickGap={24}
								/>
								<YAxis
									width={48}
									tick={{
										fontSize: 12,
										fill: 'var(--muted-foreground)',
									}}
									axisLine={{ stroke: 'var(--border)' }}
									tickLine={{ stroke: 'var(--border)' }}
									tickFormatter={(value) => formatNumber(Number(value))}
								/>
								<Tooltip
									cursor={{
										stroke: 'var(--muted-foreground)',
										strokeDasharray: '3 3',
									}}
									contentStyle={{
										backgroundColor: 'var(--popover)',
										border: '1px solid var(--border)',
										color: 'var(--popover-foreground)',
									}}
									itemStyle={{ color: 'var(--popover-foreground)' }}
									labelStyle={{ color: 'var(--muted-foreground)' }}
									formatter={(value, name) => [
										`${formatNumber(Number(value))} h`,
										String(name),
									]}
								/>
								<Legend />
								<Bar
									dataKey="logged"
									name="Logged Hours"
									fill="var(--chart-logged)"
									radius={[4, 4, 0, 0]}
									maxBarSize={36}
									isAnimationActive={false}
								/>
								<Line
									dataKey="capacity"
									name="Capacity"
									type="monotone"
									stroke="var(--chart-capacity)"
									strokeWidth={2}
									strokeDasharray="6 4"
									dot={false}
									isAnimationActive={false}
								/>
							</ComposedChart>
						</ResponsiveContainer>
					</div>
					{data.some((datum) => datum.partial) && (
						<p
							data-testid="logged-hours-trend-partial-note"
							className="mt-2 text-xs text-muted-foreground"
						>
							The final bucket is still in progress and covers fewer days than
							the others.
						</p>
					)}
				</>
			)}
		</div>
	);
}
