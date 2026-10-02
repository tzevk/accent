'use client';

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { UnmappedCodeCount } from './unmapped-codes';

/** How many codes the strip names before collapsing into "… (N more)". */
const MAX_VISIBLE_CODES = 10;

export interface UnmappedCodesStripProps {
	/** Per-code counts, already sorted; from `aggregateUnmappedCodes`. */
	codes: readonly UnmappedCodeCount[];
	/** Total unmapped Punches; defaults to the sum of the counts. */
	totalPunches?: number;
	/** Override the visible cap (dense layouts, narrower reports). */
	maxVisible?: number;
	className?: string;
}

/**
 * The amber strip that keeps an unmapped-device-code shortfall visible: which
 * biometric codes the devices reported, how many Punches each carries, and the
 * fact that those Punches are excluded from the grid because no Employee is
 * enrolled under them.
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
	maxVisible = MAX_VISIBLE_CODES,
	className,
}: UnmappedCodesStripProps) {
	if (codes.length === 0) return null;

	const total =
		totalPunches ?? codes.reduce((acc, code) => acc + code.punch_count, 0);
	const visible = codes.slice(0, Math.max(0, maxVisible));
	const hiddenCount = codes.length - visible.length;
	const codeNoun = codes.length === 1 ? 'code' : 'codes';
	const punchNoun = total === 1 ? 'Punch' : 'Punches';

	return (
		<div
			data-testid="unmapped-codes-strip"
			className={`flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3${
				className ? ` ${className}` : ''
			}`}
		>
			<ExclamationTriangleIcon
				className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
				aria-hidden="true"
			/>
			<div className="text-sm text-amber-800">
				<p data-testid="unmapped-codes-summary">
					<span className="font-semibold">
						{total} {punchNoun} from {codes.length} {codeNoun} not linked to an
						employee:{' '}
					</span>
					<span className="font-medium">
						{visible.map((code) => code.employee_code).join(', ')}
						{hiddenCount > 0 ? `, … (${hiddenCount} more)` : ''}
					</span>
				</p>
				<ul
					data-testid="unmapped-codes-list"
					className="mt-2 flex flex-wrap gap-1.5"
				>
					{visible.map((code) => (
						<li
							key={code.employee_code}
							data-testid="unmapped-codes-item"
							data-code={code.employee_code}
							className="rounded-full border border-amber-200 bg-white/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-800"
						>
							<code className="font-semibold">{code.employee_code}</code>
							<span className="ml-1 text-amber-700">
								{code.punch_count}{' '}
								{code.punch_count === 1 ? 'Punch' : 'Punches'}
							</span>
						</li>
					))}
					{hiddenCount > 0 ? (
						<li
							data-testid="unmapped-codes-overflow"
							className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
						>
							+{hiddenCount} more
						</li>
					) : null}
				</ul>
				<p data-testid="unmapped-codes-note" className="mt-2 text-xs">
					These Punches are excluded from the grid, so any shortfall against
					expected attendance comes from these unlinked device codes rather than
					missing time.
				</p>
			</div>
		</div>
	);
}
