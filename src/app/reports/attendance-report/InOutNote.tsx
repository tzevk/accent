'use client';

import { cn } from '@/lib/cn.js';
import { MAX_MERGED_SPAN_HOURS } from '@/lib/time-present';

/**
 * The one short line under the matrix that keeps the In and Out times' three
 * surprising facts where the reader meets them:
 *
 * - a lone Punch is not a span, so such a day shows an em dash, never 0;
 * - the cross-midnight merge rule (issue #281): the threshold is interpolated
 *   from MAX_MERGED_SPAN_HOURS, so the sentence cannot drift from the
 *   calculator, and it states that a merged punch is consumed;
 * - a merged day prints the next day's clock as its Out, on the earlier day.
 *
 * Plain text: no hover, no expand, no link. Every raw Punch of a cell stays in
 * the cell drill-down modal.
 */
export default function InOutNote({ className }: { className?: string }) {
	return (
		<p
			data-testid="in-out-notes"
			className={cn('text-pretty text-[11px] text-gray-600', className)}
		>
			A single punch is not a span: such a day shows an em dash, never 0. When
			a day ends late, the next day&apos;s first punch can join it. The join
			happens only within {MAX_MERGED_SPAN_HOURS} hours of that day&apos;s
			first punch. A merged punch is consumed: it counts once, never towards
			two days. On such a day, the Out shown on the earlier day is the next
			day&apos;s clock.
		</p>
	);
}
