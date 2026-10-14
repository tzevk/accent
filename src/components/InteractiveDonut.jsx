'use client';

import { useMemo, memo, useSyncExternalStore } from 'react';
import {
	PieChart,
	Pie,
	Cell,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from 'recharts';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const subscribeReducedMotion = (onChange) => {
	const query = window.matchMedia(REDUCED_MOTION_QUERY);
	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
};

const readReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;

// Recharts animates with JavaScript, which no CSS media query reaches, so the
// preference is read and the animation is switched off rather than stilled.
const getServerReducedMotion = () => false;

/**
 * A slice with no colour of its own falls back to the neutral capacity token,
 * never to a hex: the callers map every status onto a `--chart-*` token, so
 * this only guards a caller that forgot its palette.
 */
const FALLBACK_SLICE_COLOUR = 'var(--chart-capacity)';

function InteractiveDonutBase({
	data = [],
	innerRadius = 72,
	outerRadius = 100,
	colors = [],
	totalLabel = 'Total',
	showLegend = false,
	showTotalBelow = false,
	animationBegin = 0,
	animationDuration = 450,
	animationEasing = 'ease-out',
	valueFormatter,
	centerValue,
}) {
	const chartData = useMemo(
		() =>
			(data || []).map((d, i) => ({
				name: d.name || d.label || `Item ${i + 1}`,
				value: Number(d.value) || 0,
				fill: d.color || colors[i % colors.length] || FALLBACK_SLICE_COLOUR,
			})),
		[data, colors]
	);

	const total = useMemo(
		() => chartData.reduce((a, d) => a + (Number(d.value) || 0), 0),
		[chartData]
	);

	const fmt = typeof valueFormatter === 'function' ? valueFormatter : String;

	// The centre can read a total the slice sum cannot show (a proposal total
	// that includes statuses the donut does not chart), so it arrives already
	// formatted and the tooltip formatter is not applied to it.
	const centre = centerValue === undefined ? fmt(total) : centerValue;

	const reducedMotion = useSyncExternalStore(
		subscribeReducedMotion,
		readReducedMotion,
		getServerReducedMotion
	);

	return (
		<div
			className="relative w-full h-64 will-change-transform"
			style={{ transform: 'translateZ(0)' }}
		>
			<ResponsiveContainer width="100%" height="100%">
				<PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
					<Pie
						data={chartData}
						innerRadius={innerRadius}
						outerRadius={outerRadius}
						paddingAngle={2}
						cornerRadius={8}
						dataKey="value"
						isAnimationActive={!reducedMotion}
						animationBegin={animationBegin}
						animationDuration={animationDuration}
						animationEasing={animationEasing}
					>
						{chartData.map((entry, index) => (
							<Cell key={`cell-${index}`} fill={entry.fill} />
						))}
					</Pie>
					<Tooltip
						formatter={(value, name) => [fmt(value), name]}
						contentStyle={{
							borderRadius: 12,
							borderColor: '#E5E7EB',
							boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
						}}
					/>
					{showLegend && <Legend verticalAlign="bottom" height={24} />}
				</PieChart>
			</ResponsiveContainer>
			{/* Premium center label */}
			{!showTotalBelow && (
				<div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center">
					<div className="px-2 text-center">
						{/* text-lg, not text-2xl: a crore-scale rupee total overflows
						    the hole at 24px, and the label must stay readable. */}
						<div className="text-lg font-bold whitespace-nowrap text-gray-900">
							{centre}
						</div>
						<div className="text-xs text-gray-500 -mt-0.5">{totalLabel}</div>
					</div>
				</div>
			)}
			{showTotalBelow && (
				<div className="text-center -mt-6">
					<span className="text-sm text-gray-600">{totalLabel}: </span>
					<span className="text-sm font-semibold text-[#64126D]">{centre}</span>
				</div>
			)}
		</div>
	);
}

function areEqual(prev, next) {
	if (
		prev.innerRadius !== next.innerRadius ||
		prev.outerRadius !== next.outerRadius
	)
		return false;
	if (
		prev.showLegend !== next.showLegend ||
		prev.showTotalBelow !== next.showTotalBelow
	)
		return false;
	if (prev.centerValue !== next.centerValue) return false;
	// The palette feeds the fill of an uncoloured slice, so a colour change
	// without a data change must still re-render. Compare the joined string:
	// callers rebuild the array inline, and identity would defeat the memo.
	const prevColors = prev.colors || [];
	const nextColors = next.colors || [];
	if (prevColors.length !== nextColors.length) return false;
	if (prevColors.join() !== nextColors.join()) return false;
	const a = prev.data || [];
	const b = next.data || [];
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (
			a[i].value !== b[i].value ||
			a[i].name !== b[i].name ||
			a[i].label !== b[i].label ||
			a[i].color !== b[i].color
		)
			return false;
	}
	return true;
}

export default memo(InteractiveDonutBase, areEqual);
