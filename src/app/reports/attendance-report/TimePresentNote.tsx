'use client';

import Link from 'next/link';
import {
	ArrowTopRightOnSquareIcon,
	InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { MAX_MERGED_SPAN_HOURS } from '@/lib/time-present';

// ── Copy ────────────────────────────────────────────────────────────

/**
 * What the Time Present column measures, and why it is allowed to disagree
 * with the credited hours on a half day (ADR-0007).
 *
 * Exported, not inlined, so the page and the E2E flow (#285) assert on one
 * string. Always visible: no hover, no disclosure widget.
 */
export const TIME_PRESENT_NOTE =
	'Time Present is a measured span: the hours from the first punch of the day to the last, ignoring the punches in between and ignoring the direction the device reported. It is deliberately not capped on a half day — on a day authored as HD, someone who punched 09:00 to 19:00 shows ten measured hours here and four credited hours in the employee attendance grid. That disagreement is by design, not a bug: ADR-0007 holds that a half day is HR intent, not a measurement.';

/**
 * The cross-midnight merge rule (issue #281), stated where the column is
 * defined rather than only in a test. The threshold is interpolated from
 * MAX_MERGED_SPAN_HOURS so the sentence cannot drift from the calculator.
 */
export const TIME_PRESENT_MERGE_RULE = `A single punch is not a span: such a day shows an em dash, never 0. When a day ends late, the first punch of the following day joins it only if it lands within ${MAX_MERGED_SPAN_HOURS} hours of the first punch of that day, and a merged punch is consumed — counted once, never towards two days.`;

/** Replaces the stale "Direction is inferred…" footer line. */
export const TIME_PRESENT_FOOTER_NOTE =
	'Time Present ignores punch direction entirely: it measures the span from the first punch of the day to the last. The IN/OUT badges are separate — they carry the device direction, inferred as first punch of the day = in and next = out, only when the device reports none.';

/** Link label for the drill-through to the credited figure. */
export const TIME_PRESENT_LINK_LABEL =
	'View credited hours in the employee attendance grid';

/** Grid page the deep link targets. */
export const TIME_PRESENT_GRID_PATH = '/employees/attendance';

// ── Deep link ───────────────────────────────────────────────────────

/** `YYYY-MM`, the only month shape the grid accepts. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * `/employees/attendance?employee_id=<id>&month=<YYYY-MM>` — the credited
 * figure lives in the grid, so the note links there rather than restating it.
 *
 * `employeeId` is the `employees.id` primary key, matching the `employee_id`
 * query param the other reports already drill through with. Returns null when
 * there is nothing to link to (no employee in scope, or a malformed month),
 * so a caller never renders a link to a page that cannot honour it.
 */
export function timePresentGridHref(
	employeeId: number | string | null | undefined,
	month: string | null | undefined
): string | null {
	if (employeeId === null || employeeId === undefined) return null;
	const id = String(employeeId).trim();
	if (!id) return null;
	if (!month || !MONTH_PATTERN.test(month)) return null;
	return `${TIME_PRESENT_GRID_PATH}?employee_id=${encodeURIComponent(id)}&month=${encodeURIComponent(month)}`;
}

// ── Components ──────────────────────────────────────────────────────

export interface TimePresentNoteProps {
	/** `employees.id` of the Employee the Time Present figures belong to. */
	employeeId: number | string | null | undefined;
	/** `YYYY-MM` the Time Present column covers. */
	month: string | null | undefined;
	/** Display name, used only for the link's hover title. */
	employeeName?: string | null;
	className?: string;
}

/**
 * The definition note that sits beside the Time Present column: what the
 * column measures, the merge rule, and a link to the grid where the credited
 * figure lives.
 *
 * Presentation only — the measured hours arrive from the caller, so this
 * never fetches and never computes. The link is dropped (never rendered
 * broken) when no Employee or month is in scope; the definition itself is
 * always visible.
 */
export default function TimePresentNote({
	employeeId,
	month,
	employeeName,
	className,
}: TimePresentNoteProps) {
	const href = timePresentGridHref(employeeId, month);
	const linkTitle = employeeName
		? `${TIME_PRESENT_LINK_LABEL} for ${employeeName} (${month})`
		: `${TIME_PRESENT_LINK_LABEL} (${month})`;

	return (
		<div
			data-testid="time-present-note"
			className={`flex max-w-prose flex-col gap-1 text-[11px] leading-relaxed text-gray-500${
				className ? ` ${className}` : ''
			}`}
		>
			<p className="flex items-start gap-1.5">
				<InformationCircleIcon
					className="mt-px h-3.5 w-3.5 shrink-0"
					aria-hidden="true"
				/>
				<span data-testid="time-present-note-text">{TIME_PRESENT_NOTE}</span>
			</p>
			<p data-testid="time-present-merge-rule" className="pl-5">
				{TIME_PRESENT_MERGE_RULE}
			</p>
			{href ? (
				<p className="pl-5">
					<Link
						data-testid="time-present-note-link"
						href={href}
						title={linkTitle}
						className="inline-flex items-center gap-1 font-medium text-purple-700 transition-colors hover:text-purple-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-700"
					>
						{TIME_PRESENT_LINK_LABEL}
						<ArrowTopRightOnSquareIcon
							className="h-3 w-3 shrink-0"
							aria-hidden="true"
						/>
					</Link>
				</p>
			) : null}
		</div>
	);
}

export interface TimePresentFooterNoteProps {
	className?: string;
}

/**
 * Footer replacement for the report's stale direction line. Same footnote
 * treatment as the note, so the integrator swaps one element for another and
 * the E2E flow (#285) has one stable hook for it.
 */
export function TimePresentFooterNote({
	className,
}: TimePresentFooterNoteProps) {
	return (
		<p
			data-testid="time-present-footer-note"
			className={`mt-3 flex items-start gap-1.5 text-[11px] text-gray-500${
				className ? ` ${className}` : ''
			}`}
		>
			<InformationCircleIcon
				className="mt-px h-3.5 w-3.5 shrink-0"
				aria-hidden="true"
			/>
			{TIME_PRESENT_FOOTER_NOTE}
		</p>
	);
}
