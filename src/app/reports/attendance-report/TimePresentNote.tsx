'use client';

import { cn } from '@/lib/cn.js';
import { MAX_MERGED_SPAN_HOURS } from '@/lib/time-present';

/**
 * The one short line under the matrix that keeps the Time Present column's two
 * surprising facts where the reader meets them:
 *
 * - the cross-midnight merge rule (issue #281): the threshold is interpolated
 *   from MAX_MERGED_SPAN_HOURS, so the sentence cannot drift from the
 *   calculator, and it states that a merged punch is consumed;
 * - the half-day disagreement (ADR-0007): the measured span is deliberately not
 *   capped against the half day's credited hours.
 *
 * Plain text: no hover, no expand, no link. The credited-hours drill-through
 * lives in the cell drill-down modal.
 */
export default function TimePresentNote({ className }: { className?: string }) {
	return (
		<p
			data-testid="time-present-notes"
			className={cn('text-pretty text-[11px] text-gray-600', className)}
		>
			<span data-testid="time-present-merge-rule">
				A single punch is not a span: such a day shows an em dash, never 0. When
				a day ends late, the next day&apos;s first punch joins it only when it
				lands within {MAX_MERGED_SPAN_HOURS} hours of that day&apos;s first
				punch, and a merged punch is consumed — counted once, never towards two
				days.
			</span>{' '}
			<span data-testid="time-present-half-day">
				The measured span is deliberately not capped against a half day&apos;s
				credited hours (ADR-0007).
			</span>
		</p>
	);
}
