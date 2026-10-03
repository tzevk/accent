'use client';

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn.js';
import type { UnmappedCodeCount } from './unmapped-codes';

export interface UnmappedCodesStripProps {
	/** Per-code counts, already sorted; from `aggregateUnmappedCodes`. */
	codes: readonly UnmappedCodeCount[];
	/** Total unmapped Punches; defaults to the sum of the counts. */
	totalPunches?: number;
	className?: string;
}

/**
 * The compact amber strip that keeps an unmapped-device-code shortfall visible:
 * every code the devices reported, how many Punches each carries, and the fact
 * that those Punches are excluded from the grid because no Employee is
 * enrolled under them.
 *
 * Every code is named — a cap would hide exactly the rows this strip exists to
 * explain — so the strip is a short, finite list, not a truncated one.
 *
 * Presentation only — the counts arrive as props, so this never fetches and
 * never does aggregate math. Renders `null` when every code resolves, so a
 * clean month shows no strip at all.
 *
 * Counts render plain: Punches are whole numbers, and `formatNumber` is the
 * two-decimal quantity formatter ("12.00"), which would misread as hours.
 */
export default function UnmappedCodesStrip({
	codes,
	totalPunches,
	className,
}: UnmappedCodesStripProps) {
	if (codes.length === 0) return null;

	const total =
		totalPunches ?? codes.reduce((acc, code) => acc + code.punch_count, 0);
	const codeNoun = codes.length === 1 ? 'code' : 'codes';
	const punchNoun = total === 1 ? 'Punch' : 'Punches';

	return (
		<div
			data-testid="unmapped-codes-strip"
			className={cn(
				'flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900',
				className
			)}
		>
			<ExclamationTriangleIcon
				className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
				aria-hidden="true"
			/>
			<div className="min-w-0">
				<div data-testid="unmapped-codes-summary">
					<span className="font-semibold">
						{total} {punchNoun} from {codes.length} {codeNoun} not linked to an
						employee:
					</span>
					<ul
						data-testid="unmapped-codes-list"
						className="mt-1.5 flex flex-wrap gap-1.5"
					>
						{codes.map((code) => (
							<li
								key={code.employee_code}
								data-testid="unmapped-codes-item"
								data-code={code.employee_code}
								className="rounded-full border border-amber-300 bg-white/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-800"
							>
								<code className="font-semibold">{code.employee_code}</code>
								<span className="ml-1 text-amber-700">
									{code.punch_count}{' '}
									{code.punch_count === 1 ? 'Punch' : 'Punches'}
								</span>
							</li>
						))}
					</ul>
				</div>
				<p data-testid="unmapped-codes-note" className="mt-1 text-[11px]">
					These Punches are excluded from the grid, so any shortfall against
					expected attendance comes from these unlinked device codes rather than
					missing time.
				</p>
			</div>
		</div>
	);
}
