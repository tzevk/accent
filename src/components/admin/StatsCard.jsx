'use client';

import { cn } from '@/lib/cn';

const toneMap = {
	purple: 'bg-purple-50 text-[#64126D] border-purple-200',
	green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
	amber: 'bg-amber-50 text-amber-700 border-amber-200',
	rose: 'bg-rose-50 text-rose-700 border-rose-200',
	sky: 'bg-sky-50 text-sky-700 border-sky-200',
	slate: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function StatsCard({
	label,
	value,
	tone = 'purple',
	icon: Icon,
	hint,
}) {
	return (
		<div
			className={cn(
				'rounded-xl border bg-white px-4 py-3 shadow-sm flex items-center gap-3',
				toneMap[tone] || toneMap.purple
			)}
		>
			{Icon ? (
				<div className="rounded-lg bg-white/60 p-2">
					<Icon className="h-5 w-5" />
				</div>
			) : null}
			<div className="min-w-0">
				<div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
					{label}
				</div>
				<div className="text-xl font-bold leading-tight truncate">{value}</div>
				{hint ? (
					<div className="text-[11px] opacity-70 mt-0.5">{hint}</div>
				) : null}
			</div>
		</div>
	);
}
