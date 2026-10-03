import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn.js';
import {
	ROSTER_FILTER_DESCRIPTION,
	ROSTER_MEMBERSHIP_NOTE,
	type RosterDisclosure as RosterDisclosureData,
} from './roster';

export interface RosterDisclosureProps {
	/** `selectPayrollRoster(...).disclosure` — null renders nothing at all. */
	disclosure: RosterDisclosureData | null;
	className?: string;
}

/**
 * en-IN grouping, with the `.00` tail `formatNumber` forces on whole numbers
 * trimmed — the same treatment the other reports give integer quantities.
 */
function groupedCount(value: number): string {
	return formatNumber(value).replace(/\.00$/, '');
}

/**
 * The compact caveat strip that keeps the roster's shortfall visible: the
 * filter it applies, how many employees it left out and why, and — behind a
 * native `<details>` disclosure — exactly who they are.
 *
 * Presentation only — the disclosure arrives as a prop, so this never fetches
 * and never re-derives the selection. It renders `null` when nothing was
 * dropped, so a month that matches the filter exactly shows no strip at all.
 */
export default function RosterDisclosure({
	disclosure,
	className,
}: RosterDisclosureProps) {
	if (!disclosure || disclosure.excluded_count === 0) return null;

	const employeeNoun =
		disclosure.excluded_count === 1 ? 'employee' : 'employees';

	return (
		<div
			data-testid="roster-disclosure"
			className={cn(
				'rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-xs text-blue-900',
				className
			)}
		>
			<p
				data-testid="roster-disclosure-filter"
				className="flex items-start gap-1.5"
			>
				<InformationCircleIcon
					className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600"
					aria-hidden="true"
				/>
				<span>
					This report covers every employee where {ROSTER_FILTER_DESCRIPTION}.
				</span>
			</p>

			<p data-testid="roster-disclosure-summary" className="mt-1">
				<span className="font-semibold">
					{groupedCount(disclosure.excluded_count)} {employeeNoun} excluded
				</span>{' '}
				of {groupedCount(disclosure.considered_count)} on the employee list,
				leaving{' '}
				<span className="font-semibold">
					{groupedCount(disclosure.roster_count)} on the roster.
				</span>
			</p>

			<ul
				data-testid="roster-disclosure-breakdown"
				className="mt-1.5 flex flex-wrap gap-1.5"
			>
				{disclosure.buckets.map((bucket) => (
					<li
						key={`${bucket.reason}-${bucket.value ?? 'none'}`}
						data-testid="roster-disclosure-bucket"
						data-reason={bucket.reason}
						data-value={bucket.value ?? ''}
						className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-blue-800"
					>
						{groupedCount(bucket.count)}{' '}
						{bucket.reason === 'not_payroll_type'
							? bucket.value === null
								? 'with no Employee Type set'
								: `with Employee Type ${bucket.value}`
							: `not Active (Status ${bucket.value})`}
					</li>
				))}
			</ul>

			<details data-testid="roster-disclosure-list" className="mt-1.5">
				<summary className="cursor-pointer text-[11px] font-medium text-blue-700 transition-colors hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
					Show excluded employees ({groupedCount(disclosure.excluded_count)})
				</summary>
				<ul className="mt-1.5 flex flex-wrap gap-1.5">
					{disclosure.excluded.map((employee) => (
						<li
							key={employee.id}
							data-testid="roster-disclosure-item"
							data-code={employee.employee_id}
							className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-[11px] text-blue-800"
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
				</ul>
			</details>

			<p
				data-testid="roster-disclosure-note"
				className="mt-1 text-[11px] text-blue-800"
			>
				{ROSTER_MEMBERSHIP_NOTE}
			</p>
		</div>
	);
}
