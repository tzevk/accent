'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import {
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	useReactTable,
	type ColumnDef,
	type ExpandedState,
} from '@tanstack/react-table';
import {
	ArrowRightIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ExclamationCircleIcon,
	ExclamationTriangleIcon,
	InformationCircleIcon,
} from '@heroicons/react/24/outline';
import {
	COMPANY_SHEET_COLUMNS,
	type CompanySheetAttendanceBuckets,
	type CompanySheetAttendanceUnavailableReason,
	type CompanySheetCell,
	type CompanySheetColumn,
	type CompanySheetColumnId,
	type CompanySheetDeductionDetail,
	type CompanySheetIssue,
	type CompanySheetRow,
	type CompanySheetUnavailableReason,
} from '@/lib/payroll-company-sheet';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { add, R, toNumber } from '@/lib/money';
import { paymentStatusBadge } from '@/lib/payment-status';
import { cn } from '@/lib/cn';

/**
 * The Payroll stream's company-sheet grid (issue #429).
 *
 * The 51 captions, their order and every cell come from the pure company-sheet
 * read model; this component only lays them out. Money is the Payroll Slip
 * snapshot. Attendance is current evidence and is labelled as such in the
 * expanded row, which also carries payment state, extra deductions and review
 * warnings. Contract keeps its existing table on the page.
 */
export interface PayrollCompanySheetGridRow {
	readonly sheet: CompanySheetRow;
	readonly payment_status?: string | null;
	readonly payment_date?: string | null;
}

interface PayrollCompanySheetGridProps {
	readonly rows: readonly PayrollCompanySheetGridRow[];
}

const COLUMN_BY_ID = Object.fromEntries(
	COMPANY_SHEET_COLUMNS.map((column) => [column.id, column])
) as Record<CompanySheetColumnId, CompanySheetColumn>;

const TOTAL_COLUMNS: Readonly<Partial<Record<CompanySheetColumnId, true>>> = {
	gross: true,
	total_ded: true,
	net_sal: true,
};

const CODE_WIDTH = 'w-[88px] sm:w-[128px]';
const NAME_WIDTH = 'w-[120px] sm:w-[196px]';
const NAME_LEFT = 'left-[88px] sm:left-[128px]';
const SCROLL_PANEL_WIDTH =
	'w-[calc(100vw-2rem)] sm:w-[calc(100vw-3rem)] lg:w-[calc(100vw-4rem)]';

const UNAVAILABLE_REASON: Record<CompanySheetUnavailableReason, string> = {
	not_recorded: 'Not recorded on the Payroll Slip',
	invalid_value: 'The recorded value is invalid',
	unsupported_mapping: 'No confirmed company mapping',
	attendance_source_error: 'Attendance data could not be read',
	holiday_source_error: 'Holiday data could not be read',
	employment_unavailable: 'Employment dates are unavailable',
};

const ATTENDANCE_UNAVAILABLE: Record<
	CompanySheetAttendanceUnavailableReason,
	string
> = {
	attendance_source_error:
		'Attendance data could not be read, so the current attendance counts are unavailable. The Payroll Slip amounts above are unchanged.',
	holiday_source_error:
		'Holiday data could not be read, so the attendance dates cannot be classified. The Payroll Slip amounts above are unchanged.',
	employment_unavailable:
		'Employment dates are missing or inconsistent, so the attendance dates cannot be classified. The Payroll Slip amounts above are unchanged.',
};

const detailsId = (slipId: number) => `payroll-company-sheet-details-${slipId}`;

function employeeName(row: CompanySheetRow): string {
	const cell = row.cells.full_name;
	return cell.state === 'text' && cell.value.trim()
		? cell.value
		: `Payroll Slip ${row.slip_id}`;
}

function totalFor(
	columnId: CompanySheetColumnId,
	rows: readonly PayrollCompanySheetGridRow[]
) {
	let total = R(0);
	for (const row of rows) {
		const cell = row.sheet.cells[columnId];
		if (cell.state !== 'number') return null;
		total = add(total, cell.value);
	}
	return total;
}

function headerCellClass(column: CompanySheetColumn): string {
	return cn(
		'sticky top-0 z-30 whitespace-nowrap border-b border-r border-gray-300 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-700',
		column.kind === 'text' ? 'text-left' : 'text-right',
		column.id === 'employee_code' && `left-0 z-40 ${CODE_WIDTH}`,
		column.id === 'full_name' && `${NAME_LEFT} z-40 ${NAME_WIDTH}`
	);
}

function bodyCellClass(
	column: CompanySheetColumn,
	expanded: boolean
): string {
	const frozenBackground = expanded
		? 'bg-[#faf7fb]'
		: 'bg-white group-hover:bg-gray-50';
	return cn(
		'border-b border-r border-gray-200 px-2 py-1.5 align-middle text-[13px] text-gray-800',
		column.kind === 'text' ? 'text-left' : 'text-right tabular-nums',
		column.id === 'employee_code' &&
			`sticky left-0 z-20 ${CODE_WIDTH} ${frozenBackground}`,
		column.id === 'full_name' &&
			`sticky ${NAME_LEFT} z-20 ${NAME_WIDTH} ${frozenBackground}`
	);
}

function footerCellClass(column: CompanySheetColumn): string {
	return cn(
		'border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-800',
		column.kind === 'text' ? 'text-left' : 'text-right tabular-nums',
		column.id === 'employee_code' &&
			`sticky left-0 z-20 ${CODE_WIDTH} bg-gray-50`,
		column.id === 'full_name' && `sticky ${NAME_LEFT} z-20 ${NAME_WIDTH} bg-gray-50`
	);
}

function CellValue({
	cell,
	column,
}: {
	cell: CompanySheetCell;
	column: CompanySheetColumn;
}) {
	if (cell.state === 'text') {
		return (
			<span
				className="block max-w-[12rem] truncate"
				title={cell.value || undefined}
			>
				{cell.value}
			</span>
		);
	}
	if (cell.state === 'number') {
		return (
			<span className="block whitespace-nowrap">
				{column.kind === 'money'
					? formatCurrency(cell.value)
					: formatNumber(cell.value)}
			</span>
		);
	}
	return (
		<span
			className="block whitespace-nowrap text-gray-500"
			title={UNAVAILABLE_REASON[cell.reason]}
		>
			Not available
			<span className="sr-only"> — {UNAVAILABLE_REASON[cell.reason]}</span>
		</span>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<dt className="text-xs text-gray-600">{label}</dt>
			<dd className="font-semibold tabular-nums text-gray-900">
				{formatNumber(value)}
			</dd>
		</div>
	);
}

function AttendanceCategoryText({
	buckets,
}: {
	buckets: CompanySheetAttendanceBuckets;
}) {
	return (
		<p className="mt-2 text-xs leading-relaxed text-gray-600">
			Absent {formatNumber(buckets.absent)} · Half days{' '}
			{formatNumber(buckets.half_days)} · Paid leave{' '}
			{formatNumber(buckets.paid_leave)} (PL {formatNumber(buckets.paid_leave_by_code.PL)},
			CL {formatNumber(buckets.paid_leave_by_code.CL)}, SL{' '}
			{formatNumber(buckets.paid_leave_by_code.SL)}, EL{' '}
			{formatNumber(buckets.paid_leave_by_code.EL)}) · Unpaid leave{' '}
			{formatNumber(buckets.unpaid_leave)} (LWP{' '}
			{formatNumber(buckets.unpaid_leave_by_code.LWP)}, UL{' '}
			{formatNumber(buckets.unpaid_leave_by_code.UL)}) · Holidays{' '}
			{formatNumber(buckets.holidays)} · Weekly Off{' '}
			{formatNumber(buckets.weekly_off)} · Unrecorded{' '}
			{formatNumber(buckets.unrecorded)}
			{buckets.upcoming_unrecorded > 0
				? ` (includes ${formatNumber(buckets.upcoming_unrecorded)} upcoming)`
				: ''}{' '}
			· Outside Employment {formatNumber(buckets.outside_employment)} · Recorded
			days {formatNumber(buckets.recorded_days)}
			{buckets.invalid_status > 0
				? ` · Invalid status ${formatNumber(buckets.invalid_status)}`
				: ''}
		</p>
	);
}

function AttendanceSection({
	attendance,
	headingId,
}: {
	attendance: CompanySheetRow['attendance'];
	headingId: string;
}) {
	if (attendance.state === 'unavailable') {
		return (
			<section aria-labelledby={headingId} className="mt-3">
				<h4 id={headingId} className="text-xs font-semibold text-gray-900">
					Monthly attendance categories
				</h4>
				<p className="mt-1 text-sm text-amber-800">
					{ATTENDANCE_UNAVAILABLE[attendance.reason]}
				</p>
			</section>
		);
	}

	const buckets = attendance.buckets;
	return (
		<section aria-labelledby={headingId} className="mt-3">
			<h4 id={headingId} className="text-xs font-semibold text-gray-900">
				Monthly attendance categories
			</h4>
			<dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
				<Stat label="Total Days" value={buckets.total_days} />
				<Stat label="Days Present" value={buckets.present} />
				<Stat label="Days Paid" value={buckets.days_paid} />
				<Stat label="LWP Days" value={buckets.lwp_days} />
				<Stat label="Leave" value={buckets.paid_leave} />
				<Stat label="WeekOff" value={buckets.weekly_off} />
				<Stat label="Paid Holiday" value={buckets.holidays} />
				<Stat label="OT Hours" value={buckets.ot_hours} />
			</dl>
			<AttendanceCategoryText buckets={buckets} />
			{buckets.reconciliation.calendar_balanced &&
			buckets.reconciliation.paid_balanced ? (
				<p className="mt-2 flex items-center gap-1 text-xs text-green-700">
					<CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
					Calendar categories reconcile to Total Days.
				</p>
			) : (
				<div role="status" className="mt-2 space-y-1 text-xs text-amber-800">
					{!buckets.reconciliation.calendar_balanced && (
						<p>Calendar categories do not reconcile to Total Days.</p>
					)}
					{!buckets.reconciliation.paid_balanced && (
						<p>
							Days Paid + LWP Days + Unrecorded + Outside Employment do not
							reconcile to Total Days.
						</p>
					)}
				</div>
			)}
			<p className="mt-3 text-xs leading-relaxed text-gray-700">
				Company Days Paid = Days Present + Leave + Paid Holiday + WeekOff ={' '}
				{formatNumber(buckets.days_paid)}. It is an attendance credit; it is not
				the salary Payable Day. Payable Day counts Present-equivalent working
				days: P = 1, HD = 0.5 and paid leave = 1; Holidays, Weekly Off, absence
				and unpaid leave count 0.
			</p>
			<p className="mt-1 text-xs leading-relaxed text-gray-700">
				OT Hours use the existing payable-overtime gate and are not Logged Hours.
				They never add days or change pay.
			</p>
		</section>
	);
}

function DeductionDetailsList({
	details,
	headingId,
}: {
	details: readonly CompanySheetDeductionDetail[];
	headingId: string;
}) {
	const recorded = details.filter((detail) => detail.state === 'recorded');
	return (
		<section aria-labelledby={headingId}>
			<h4 id={headingId} className="text-xs font-semibold text-gray-900">
				Recorded deductions
			</h4>
			<p className="mt-1 text-xs text-gray-600">
				Extra recorded deductions that the company columns do not show appear
				here. They are already part of the stored TOTAL DED.
			</p>
			{recorded.length === 0 ? (
				<p className="mt-2 text-xs text-gray-600">
					No recorded deductions for this Payroll Slip.
				</p>
			) : (
				<dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
					{recorded.map((detail) => (
						<div key={detail.id}>
							<div className="flex items-baseline justify-between gap-3">
								<dt className="text-xs text-gray-700">{detail.label}</dt>
								<dd className="whitespace-nowrap text-xs font-semibold tabular-nums text-gray-900">
									{detail.amount === null
										? 'Not recorded'
										: formatCurrency(detail.amount)}
								</dd>
							</div>
							{!detail.in_company_columns && (
								<p className="text-[11px] text-gray-500">
									Not a company column
								</p>
							)}
							{detail.note && (
								<p className="text-[11px] text-gray-500">{detail.note}</p>
							)}
						</div>
					))}
				</dl>
			)}
		</section>
	);
}

const ISSUE_STYLE = {
	warning: {
		Icon: ExclamationTriangleIcon,
		label: 'Warning',
		className: 'text-amber-700',
	},
	unavailable: {
		Icon: ExclamationCircleIcon,
		label: 'Unavailable',
		className: 'text-red-700',
	},
	info: {
		Icon: InformationCircleIcon,
		label: 'Note',
		className: 'text-gray-600',
	},
} as const;

function IssueList({
	issues,
	headingId,
}: {
	issues: readonly CompanySheetIssue[];
	headingId: string;
}) {
	if (issues.length === 0) return null;
	return (
		<section aria-labelledby={headingId} className="mt-4">
			<h4 id={headingId} className="text-xs font-semibold text-gray-900">
				Source and review warnings
			</h4>
			<ul className="mt-2 space-y-1.5">
				{issues.map((issue, index) => {
					const style = ISSUE_STYLE[issue.severity];
					return (
						<li
							key={`${issue.code}-${index}`}
							className={cn('flex items-start gap-1.5 text-xs', style.className)}
						>
							<style.Icon
								className="mt-0.5 h-4 w-4 shrink-0"
								aria-hidden="true"
							/>
							<span>
								<span className="font-semibold">{style.label}:</span>{' '}
								{issue.message}
							</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function ExpandedDetails({
	row,
	headingId,
	onCollapse,
}: {
	row: PayrollCompanySheetGridRow;
	headingId: string;
	onCollapse: () => void;
}) {
	const { sheet } = row;
	const name = employeeName(sheet);
	const status = paymentStatusBadge(row.payment_status);

	return (
		<div
			id={detailsId(sheet.slip_id)}
			role="region"
			aria-labelledby={headingId}
			className="space-y-3 border-t border-[#64126D]/15 bg-[#faf7fb] px-3 py-4 sm:px-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3
						id={headingId}
						className="flex items-center gap-1.5 text-base font-semibold text-gray-900"
					>
						<InformationCircleIcon
							className="h-5 w-5 shrink-0 text-[#64126D]"
							aria-hidden="true"
						/>
						Current attendance — generated payroll amounts are unchanged
					</h3>
					<p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-600">
						Attendance counts come from the month&apos;s current Attendance
						Records. They can change after the Payroll Slip was generated. The
						amounts in this sheet are the recorded Payroll Slip snapshot and do
						not change with attendance.
					</p>
				</div>
				<button
					type="button"
					onClick={onCollapse}
					className="rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
					aria-label={`Collapse details for ${name}`}
				>
					Collapse details
				</button>
			</div>

			<AttendanceSection
				attendance={sheet.attendance}
				headingId={`${headingId}-attendance`}
			/>

			<div className="grid gap-4 lg:grid-cols-2">
				<DeductionDetailsList
					details={sheet.deduction_details}
					headingId={`${headingId}-deductions`}
				/>
				<section aria-labelledby={`${headingId}-payment`}>
					<h4
						id={`${headingId}-payment`}
						className="text-xs font-semibold text-gray-900"
					>
						Payment state
					</h4>
					<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-700">
						<span
							className={cn(
								'inline-flex rounded-full px-2 py-0.5 font-medium',
								status.badge
							)}
						>
							{status.label}
						</span>
						{row.payment_date ? (
							<span>Payment date: {formatDate(row.payment_date)}</span>
						) : (
							<span>No payment date recorded.</span>
						)}
					</div>
					<p className="mt-2 text-xs text-gray-600">
						Payment state is recorded on the Payroll Slip and does not change the
						amounts in this sheet.
					</p>
				</section>
			</div>

			<IssueList
				issues={sheet.issues}
				headingId={`${headingId}-issues`}
			/>
		</div>
	);
}

export function PayrollCompanySheetGrid({
	rows,
}: PayrollCompanySheetGridProps) {
	const [expanded, setExpanded] = useState<ExpandedState>({});

	const columns = useMemo<ColumnDef<PayrollCompanySheetGridRow, CompanySheetCell>[]>(
		() =>
			COMPANY_SHEET_COLUMNS.map((column) => ({
				id: column.id,
				accessorFn: (row) => row.sheet.cells[column.id],
				header: () => column.label,
				cell: (info) => {
					const cell = info.getValue();
					const sheet = info.row.original.sheet;
					const name = employeeName(sheet);

					if (column.id === 'employee_code') {
						const isExpanded = info.row.getIsExpanded();
						return (
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => info.row.toggleExpanded()}
									aria-expanded={isExpanded}
									aria-controls={detailsId(sheet.slip_id)}
									aria-label={`${isExpanded ? 'Collapse' : 'Expand'} attendance and deduction details for ${name}`}
									className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
								>
									{isExpanded ? (
										<ChevronDownIcon
											className="h-4 w-4"
											aria-hidden="true"
										/>
									) : (
										<ChevronRightIcon
											className="h-4 w-4"
											aria-hidden="true"
										/>
									)}
								</button>
								<span className="min-w-0 flex-1">
									<CellValue cell={cell} column={column} />
								</span>
							</div>
						);
					}

					if (column.id === 'full_name') {
						const status = paymentStatusBadge(
							info.row.original.payment_status
						);
						return (
							<div className="min-w-0">
								<Link
									href={`/admin/payroll/slips/${sheet.slip_id}`}
									title={cell.state === 'text' ? cell.value : undefined}
									className="block truncate font-medium text-gray-900 hover:text-[#64126D] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
								>
									{cell.state === 'text' ? cell.value : 'Not available'}
								</Link>
								<span
									className={cn(
										'mt-0.5 inline-flex rounded-full px-1.5 py-0 text-[11px] font-medium',
										status.badge
									)}
								>
									{status.label}
								</span>
							</div>
						);
					}

					return <CellValue cell={cell} column={column} />;
				},
			})),
		[]
	);

	const table = useReactTable({
		data: rows as PayrollCompanySheetGridRow[],
		columns,
		state: { expanded },
		onExpandedChange: setExpanded,
		getRowCanExpand: () => true,
		getRowId: (row) => String(row.sheet.slip_id),
		getCoreRowModel: getCoreRowModel(),
		getExpandedRowModel: getExpandedRowModel(),
	});

	const firstColumnId = COMPANY_SHEET_COLUMNS[0].id;

	return (
		<div className="relative rounded-b-xl">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
				<p className="flex items-center gap-1.5 text-xs text-gray-600">
					<ArrowRightIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
					Scroll horizontally for all 51 company columns. Employee Code and Full
					Name stay frozen.
				</p>
				<p className="text-xs text-gray-500">
					Attendance is current evidence; amounts are the generated Payroll Slip.
				</p>
			</div>

			<div
				role="region"
				aria-label="Company payroll sheet"
				aria-describedby="payroll-company-sheet-scroll-hint"
				tabIndex={0}
				className="max-h-[72vh] overflow-auto overscroll-x-contain [scroll-padding-top:2.5rem] focus-visible:outline focus-visible:outline-2 focus-visible:[outline-offset:-2px] focus-visible:outline-[#64126D]"
			>
				<p id="payroll-company-sheet-scroll-hint" className="sr-only">
					The company payroll sheet scrolls in both directions. Headers and the
					Employee Code and Full Name columns stay visible. Expand a row with
					its Employee Code button to read current attendance, payment state,
					deductions and review warnings.
				</p>

				<table className="min-w-full border-separate border-spacing-0 text-[13px]">
					<caption className="sr-only">
						Company payroll sheet for the selected Payroll month. Attendance
						cells show current Attendance Records. Money cells show the
						generated Payroll Slip snapshot.
					</caption>
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const column =
										COLUMN_BY_ID[header.column.id as CompanySheetColumnId];
									return (
										<th
											key={header.id}
											scope="col"
											className={headerCellClass(column)}
										>
											{flexRender(
												header.column.columnDef.header,
												header.getContext()
											)}
										</th>
									);
								})}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => {
							const isExpanded = row.getIsExpanded();
							const headingId = `${detailsId(row.original.sheet.slip_id)}-heading`;
							return (
								<Fragment key={row.id}>
									<tr
										className={cn(
											'group',
											isExpanded ? 'bg-[#faf7fb]' : 'bg-white hover:bg-gray-50'
										)}
									>
										{row.getVisibleCells().map((cell) => {
											const column =
												COLUMN_BY_ID[cell.column.id as CompanySheetColumnId];
											return (
												<td
													key={cell.id}
													className={bodyCellClass(column, isExpanded)}
												>
													{flexRender(
														cell.column.columnDef.cell,
														cell.getContext()
													)}
												</td>
											);
										})}
									</tr>
									{isExpanded && (
										<tr className="bg-[#faf7fb]">
											<td
												colSpan={COMPANY_SHEET_COLUMNS.length}
												className="border-b border-gray-200 p-0"
											>
												<div className={cn('sticky left-0', SCROLL_PANEL_WIDTH)}>
													<ExpandedDetails
														row={row.original}
														headingId={headingId}
														onCollapse={() => row.toggleExpanded()}
													/>
												</div>
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
					<tfoot>
						<tr aria-label="TOTALS">
							{COMPANY_SHEET_COLUMNS.map((column) => {
								const total =
									TOTAL_COLUMNS[column.id] === true
										? totalFor(column.id, rows)
										: null;
								return (
									<td key={column.id} className={footerCellClass(column)}>
										{column.id === firstColumnId ? (
											'TOTALS'
										) : TOTAL_COLUMNS[column.id] === true ? (
											total === null ? (
												<span className="text-gray-500">Not available</span>
											) : (
												formatCurrency(toNumber(total))
											)
										) : null}
									</td>
								);
							})}
						</tr>
					</tfoot>
				</table>
			</div>
		</div>
	);
}
