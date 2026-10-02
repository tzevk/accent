import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { formatNumber } from '@/lib/format';
import {
	ROSTER_FILTER_DESCRIPTION,
	ROSTER_MEMBERSHIP_NOTE,
	type RosterDisclosure as RosterDisclosureData,
} from './roster';

/** How many excluded employees are named before collapsing into a count. */
const MAX_VISIBLE_EMPLOYEES = 12;

export interface RosterDisclosureProps {
	/** `selectPayrollRoster(...).disclosure` — null renders nothing at all. */
	disclosure: RosterDisclosureData | null;
	/** Override the visible cap (dense layouts, narrower reports). */
	maxVisible?: number;
	className?: string;
}

/**
 * The blue information card that keeps the roster's shortfall visible: the
 * filter it applies, how many employees it left out and why, and who they are.
 *
 * Presentation only — the disclosure arrives as a prop, so this never fetches
 * and never re-derives the selection. It renders `null` when nothing was
 * dropped, so a month that matches the filter exactly shows no card at all.
 *
 * Counts go through `formatNumber` for en-IN grouping, with the `.00` it forces
 * on whole numbers trimmed — the same treatment the other reports give
 * integer quantities.
 */
export default function RosterDisclosure({
	disclosure,
	maxVisible = MAX_VISIBLE_EMPLOYEES,
	className,
}: RosterDisclosureProps) {
	if (!disclosure || disclosure.excluded_count === 0) return null;

	const employeeNoun =
		disclosure.excluded_count === 1 ? 'employee' : 'employees';
	const visible = disclosure.excluded.slice(0, Math.max(0, maxVisible));
	const hiddenCount = disclosure.excluded_count - visible.length;

	return (
		<div
			data-testid="roster-disclosure"
			className={`rounded-2xl bg-blue-50 p-5 shadow-sm ring-1 ring-blue-200${
				className ? ` ${className}` : ''
			}`}
		>
			<h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-blue-900">
				<InformationCircleIcon
					className="h-4 w-4 shrink-0 text-blue-600"
					aria-hidden="true"
				/>
				Payroll roster filter
			</h3>

			<div className="text-sm text-blue-800">
				<p data-testid="roster-disclosure-filter">
					This report covers every employee where {ROSTER_FILTER_DESCRIPTION}.
				</p>
				<p data-testid="roster-disclosure-summary" className="mt-1">
					<span className="font-semibold">
						{formatNumber(disclosure.excluded_count).replace(/\.00$/, '')}{' '}
						{employeeNoun} excluded
					</span>{' '}
					of {formatNumber(disclosure.considered_count).replace(/\.00$/, '')} on
					the employee list, leaving{' '}
					<span className="font-semibold">
						{formatNumber(disclosure.roster_count).replace(/\.00$/, '')} on the
						roster.
					</span>
				</p>

				<ul
					data-testid="roster-disclosure-breakdown"
					className="mt-2 flex flex-wrap gap-1.5"
				>
					{disclosure.buckets.map((bucket) => (
						<li
							key={`${bucket.reason}-${bucket.value ?? 'none'}`}
							data-testid="roster-disclosure-bucket"
							data-reason={bucket.reason}
							data-value={bucket.value ?? ''}
							className="rounded-full border border-blue-200 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-blue-800"
						>
							{formatNumber(bucket.count).replace(/\.00$/, '')}{' '}
							{bucket.reason === 'not_payroll_type'
								? bucket.value === null
									? 'with no Employee Type set'
									: `with Employee Type ${bucket.value}`
								: `not Active (Status ${bucket.value})`}
						</li>
					))}
				</ul>

				<ul
					data-testid="roster-disclosure-list"
					className="mt-2 flex flex-wrap gap-1.5"
				>
					{visible.map((employee) => (
						<li
							key={employee.id}
							data-testid="roster-disclosure-item"
							data-code={employee.employee_id}
							className="rounded-full border border-blue-200 bg-white/70 px-2 py-0.5 text-[11px] text-blue-800"
						>
							<span
								data-testid="roster-disclosure-item-name"
								className="font-medium"
							>
								{employee.name}
							</span>{' '}
							<code
								data-testid="roster-disclosure-item-code"
								className="font-mono"
							>
								{employee.employee_id}
							</code>{' '}
							<span
								data-testid="roster-disclosure-item-reason"
								className="text-blue-700"
							>
								{employee.reason === 'not_payroll_type'
									? employee.employee_type === null
										? 'no Employee Type set'
										: `Employee Type ${employee.employee_type}`
									: `Status ${employee.status}`}
							</span>
						</li>
					))}
					{hiddenCount > 0 ? (
						<li
							data-testid="roster-disclosure-overflow"
							className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800"
						>
							+{hiddenCount} more
						</li>
					) : null}
				</ul>

				<p data-testid="roster-disclosure-note" className="mt-2 text-xs">
					{ROSTER_MEMBERSHIP_NOTE}
				</p>
			</div>
		</div>
	);
}
