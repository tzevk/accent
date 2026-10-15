import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn.js';
import {
	ROSTER_FILTER_DESCRIPTION,
	ROSTER_MEMBERSHIP_NOTE,
	ROSTER_MONTH_FILTER_DESCRIPTION,
	ROSTER_MONTH_MEMBERSHIP_NOTE,
	rosterWorkplaceClause,
	type RosterDisclosure as RosterDisclosureData,
} from '@/lib/payroll-roster';

export interface RosterDisclosureProps {
	/** `selectPayrollRoster(...).disclosure` — null renders nothing at all. */
	disclosure: RosterDisclosureData | null;
	className?: string;
	/**
	 * The workplace the report is scoped to, so the filter sentence names it.
	 * Blank omits the clause entirely.
	 */
	workplace?: string;
	/**
	 * Which roster rule the strip describes:
	 * - `directory` (default) — the Attendance report's as-of-today filter and
	 *   wording, unchanged;
	 * - `month` — the Utilization report's month-scoped filter: the Status
	 *   clause goes away, the counted population is the month's candidates,
	 *   and each chip names the Employee Type value alone ("2 Contract",
	 *   "1 unset") because that is what the month's exclusion is about.
	 */
	scope?: 'directory' | 'month';
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
	workplace,
	scope = 'directory',
}: RosterDisclosureProps) {
	if (!disclosure || disclosure.excluded_count === 0) return null;

	const monthScope = scope === 'month';
	const employeeNoun =
		disclosure.excluded_count === 1 ? 'employee' : 'employees';
	const consideredPhrase = monthScope
		? 'considered for the month'
		: 'on the employee list';

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
					This report covers every employee where{' '}
					{monthScope
						? ROSTER_MONTH_FILTER_DESCRIPTION
						: `${ROSTER_FILTER_DESCRIPTION}${rosterWorkplaceClause(workplace)}`}
					.
				</span>
			</p>

			<p data-testid="roster-disclosure-summary" className="mt-1">
				<span className="font-semibold">
					{groupedCount(disclosure.excluded_count)} {employeeNoun} excluded
				</span>{' '}
				of {groupedCount(disclosure.considered_count)} {consideredPhrase},
				leaving{' '}
				<span className="font-semibold">
					{groupedCount(disclosure.roster_count)} on the roster.
				</span>
			</p>

			<ul
				data-testid="roster-disclosure-breakdown"
				className="mt-1.5 flex flex-wrap gap-1.5"
			>
				{disclosure.buckets.map((bucket) => {
					// One label per reason, written once. The month-scoped
					// reader has only ever had one reason, so it keeps the
					// short form that already reads well.
					if (monthScope || bucket.reason === 'not_payroll_type') {
						return (
							<li
								key={`${bucket.reason}-${bucket.value ?? 'none'}`}
								data-testid="roster-disclosure-bucket"
								data-reason={bucket.reason}
								data-value={bucket.value ?? ''}
								className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-blue-800"
							>
								{groupedCount(bucket.count)}{' '}
								{bucket.value === null
									? monthScope
										? 'unset'
										: 'with no Employee Type set'
									: monthScope
										? bucket.value
										: `with Employee Type ${bucket.value}`}
							</li>
						);
					}
					if (bucket.reason === 'exited') {
						return (
							<li
								key={`${bucket.reason}-${bucket.value ?? 'none'}`}
								data-testid="roster-disclosure-bucket"
								data-reason={bucket.reason}
								data-value={bucket.value ?? ''}
								className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-blue-800"
							>
								{groupedCount(bucket.count)} who have already left
							</li>
						);
					}
					if (bucket.reason === 'not_workplace') {
						return (
							<li
								key={`${bucket.reason}-${bucket.value ?? 'none'}`}
								data-testid="roster-disclosure-bucket"
								data-reason={bucket.reason}
								data-value={bucket.value ?? ''}
								className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-blue-800"
							>
								{groupedCount(bucket.count)} at another Workplace
								{bucket.value === null ? '' : ` (${bucket.value})`}
							</li>
						);
					}
					return (
						<li
							key="terminated"
							data-testid="roster-disclosure-bucket"
							data-reason="terminated"
							data-value={bucket.value ?? ''}
							className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-blue-800"
						>
							{groupedCount(bucket.count)} not Active (Status {bucket.value})
						</li>
					);
				})}
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
									: employee.reason === 'exited'
										? `left on ${employee.value}`
										: employee.reason === 'not_workplace'
											? employee.value === null
												? 'no Workplace set'
												: `at ${employee.value}`
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
				{monthScope ? ROSTER_MONTH_MEMBERSHIP_NOTE : ROSTER_MEMBERSHIP_NOTE}
			</p>
		</div>
	);
}
