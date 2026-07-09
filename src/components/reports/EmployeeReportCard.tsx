'use client';

import React, { useMemo, useState } from 'react';
import {
	useReactTable,
	getCoreRowModel,
	getSortedRowModel,
	createColumnHelper,
	flexRender,
	type SortingState,
	type Column,
} from '@tanstack/react-table';
import {
	ChevronDownIcon,
	ChevronUpIcon,
	ArrowsUpDownIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn';

export interface EmployeeRow {
	date: string | null;
	project_id: number | string;
	project_code: string;
	project_name: string;
	activity_name: string;
	sub_activity_name: string;
	assignment_id: string;
	planned_hours: number;
	hours: number;
	qty_done: number;
}

export interface EmployeeReportItem {
	user_id: string;
	user_name: string;
	email: string;
	rows: EmployeeRow[];
}

const fmtDate = (d: string | null) => {
	if (!d) return '–';
	const date = new Date(d + 'T00:00:00');
	if (isNaN(date.getTime())) return '–';
	return date.toLocaleDateString('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
};

type RowData = EmployeeRow & { sr_no: number };

const columnHelper = createColumnHelper<RowData>();

function DefaultSortHeader({
	column,
	title,
}: {
	column: Column<RowData, unknown> | null;
	title: string;
}) {
	if (!column) {
		return (
			<span className="font-semibold text-gray-600 uppercase tracking-wider text-xs">
				{title}
			</span>
		);
	}
	const sorted = column.getIsSorted();
	return (
		<button
			type="button"
			onClick={column.getToggleSortingHandler()}
			className="inline-flex items-center gap-1 font-semibold text-gray-600 uppercase tracking-wider text-xs hover:text-gray-800"
			title={`Sort by ${title}`}
		>
			<span>{title}</span>
			{sorted === 'asc' ? (
				<ChevronUpIcon className="w-3 h-3" />
			) : sorted === 'desc' ? (
				<ChevronDownIcon className="w-3 h-3" />
			) : (
				<ArrowsUpDownIcon className="w-3 h-3 opacity-50" />
			)}
		</button>
	);
}

export default function EmployeeReportCard({
	employee,
}: {
	employee: EmployeeReportItem;
}) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: 'date', desc: true },
	]);

	// Attach Sr. No based on the sorted/filtered view.
	const rows = useMemo(() => {
		return employee.rows.map((r, i) => ({ ...r, sr_no: i + 1 }));
	}, [employee.rows]);

	const totals = useMemo(() => {
		const distinctAssign = new Set<string>();
		let assign = 0;
		let actual = 0;
		let qty = 0;
		for (const r of employee.rows) {
			if (!distinctAssign.has(r.assignment_id)) {
				distinctAssign.add(r.assignment_id);
				assign += r.planned_hours || 0;
			}
			actual += r.hours || 0;
			qty += r.qty_done || 0;
		}
		return { assign, actual, qty };
	}, [employee.rows]);

	// First-row-of-assignment detection drives the "Assign Manhours" display,
	// so distinct assignments don't get their planned hours summed per-day.
	const isFirstRowOfAssignment = (
		row: RowData,
		displayedRows: RowData[]
	): boolean => {
		// First occurrence of this assignment_id in the current (sorted) order.
		const idx = displayedRows.findIndex(
			(r) => r.assignment_id === row.assignment_id
		);
		const first = displayedRows[idx];
		return first.sr_no === row.sr_no && first.date === row.date;
	};

	// Columns reference depends on the current row order, so build them
	// dynamically from `rows` (which is sorted by the table state). Since
	// TanStack Table sorts internally, we instead compute "first row" using
	// the table's pre-sort rows and re-check against the sorted output readability.
	// Implementation: derive from displayed rows in the render.
	const columns = useMemo(
		() => [
			columnHelper.accessor('sr_no', {
				header: () => <DefaultSortHeader column={null} title="Sr. No" />,
				cell: (info) => info.getValue(),
				size: 60,
			}),
			columnHelper.accessor((row) => row.date, {
				id: 'date',
				header: (info) => (
					<DefaultSortHeader column={info.column} title="Date" />
				),
				cell: (info) => fmtDate(info.getValue()),
				size: 110,
			}),
			columnHelper.accessor('project_code', {
				id: 'project_code',
				header: (info) => (
					<DefaultSortHeader column={info.column} title="Project No." />
				),
				cell: (info) =>
					info.getValue() ? (
						<span className="font-mono text-[11px] text-purple-700">
							{info.getValue()}
						</span>
					) : (
						'–'
					),
			}),
			columnHelper.accessor('project_name', {
				id: 'project_name',
				header: (info) => (
					<DefaultSortHeader column={info.column} title="Project Name" />
				),
				cell: (info) =>
					info.getValue() ? (
						<span className="text-sm text-gray-700 truncate max-w-[220px] block">
							{info.getValue()}
						</span>
					) : (
						'–'
					),
			}),
			columnHelper.accessor(
				(row) => row.sub_activity_name || row.activity_name || 'Unnamed',
				{
					id: 'sub_activity',
					header: (info) => (
						<DefaultSortHeader column={info.column} title="Sub-Activity" />
					),
					cell: (info) => (
						<div className="min-w-0">
							<div className="font-medium text-gray-800 text-sm truncate">
								{info.getValue()}
							</div>
							{info.row.original.sub_activity_name &&
								info.row.original.activity_name &&
								info.row.original.sub_activity_name !==
									info.row.original.activity_name && (
									<div className="text-[10px] text-gray-400 truncate">
										{info.row.original.activity_name}
									</div>
								)}
						</div>
					),
				}
			),
			columnHelper.accessor('planned_hours', {
				id: 'planned_hours',
				header: (info) => (
					<DefaultSortHeader column={info.column} title="Assign Manhours" />
				),
				cell: (info) => {
					const displayed = info.table
						.getSortedRowModel()
						.rows.map((r) => r.original);
					const row = info.row.original;
					return isFirstRowOfAssignment(row, displayed) ? (
						<span className="tabular-nums">{row.planned_hours || 0}</span>
					) : (
						<span className="text-gray-300">–</span>
					);
				},
				size: 90,
			}),
			columnHelper.accessor('hours', {
				id: 'hours',
				header: (info) => (
					<DefaultSortHeader column={info.column} title="Actual Manhours" />
				),
				cell: (info) => (
					<span className="tabular-nums font-medium text-blue-600">
						{info.getValue() || 0}
					</span>
				),
				size: 90,
			}),
			columnHelper.accessor('qty_done', {
				id: 'qty_done',
				header: (info) => (
					<DefaultSortHeader column={info.column} title="Unit/Qty" />
				),
				cell: (info) => (
					<span className="tabular-nums font-medium text-purple-600">
						{info.getValue() || 0}
					</span>
				),
				size: 80,
			}),
		],
		[]
	);

	const table = useReactTable({
		data: rows,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	// Reset Sr. No to reflect the displayed order.
	const displayedRows = useMemo(
		() => table.getSortedRowModel().rows.map((r) => r.original),
		[table]
	);
	const srByRowKey = useMemo(() => {
		const map = new Map<string, number>();
		displayedRows.forEach((r, i) =>
			map.set(`${r.assignment_id}#${r.date ?? ''}#${i}`, i + 1)
		);
		return map;
	}, [displayedRows]);

	const isEmpty = employee.rows.length === 0;
	const summary = [
		{
			label: 'Rows',
			value: employee.rows.length,
			color: 'text-gray-700',
		},
		{
			label: 'Assign Manhours',
			value: totals.assign,
			color: 'text-gray-700',
		},
		{
			label: 'Actual Manhours',
			value: totals.actual,
			color: 'text-blue-600',
		},
		{
			label: 'Total Qty',
			value: totals.qty,
			color: 'text-purple-600',
		},
	];

	return (
		<div className="bg-white rounded-xl border border-gray-200 shadow-sm">
			{/* Header */}
			<div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-50/70 to-white flex items-center justify-between gap-3">
				<div className="flex items-center gap-3 min-w-0">
					<div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center font-bold text-purple-700 text-sm flex-shrink-0 shadow-sm">
						{employee.user_name?.[0]?.toUpperCase() || '?'}
					</div>
					<div className="min-w-0">
						<h3 className="text-sm font-semibold text-gray-900 truncate">
							{employee.user_name}
						</h3>
						{employee.email && (
							<p className="text-[11px] text-gray-400 truncate">
								{employee.email}
							</p>
						)}
					</div>
				</div>
				<div className="flex items-center gap-3 flex-shrink-0">
					{summary.map((s) => (
						<div
							key={s.label}
							className="hidden sm:flex flex-col items-end"
							title={s.label}
						>
							<span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">
								{s.label}
							</span>
							<span
								className={cn('text-sm font-semibold tabular-nums', s.color)}
							>
								{s.value}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* Table */}
			{isEmpty ? (
				<div className="py-10 text-center text-sm text-gray-400 italic">
					No activities recorded
				</div>
			) : (
				<div className="overflow-x-clip">
					<table className="w-full caption-bottom text-sm border-t border-gray-100">
						<thead className="sticky top-[64px] z-20 bg-gray-50 border-b border-gray-200 shadow-sm">
							<tr>
								{table.getFlatHeaders().map((header) => (
									<th
										key={header.id}
										style={{ width: header.getSize() }}
										className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap"
									>
										{flexRender(
											header.column.columnDef.header,
											header.getContext()
										)}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200">
							{table.getRowModel().rows.map((row, idx) => {
								const data = row.original;
								const srNo =
									srByRowKey.get(
										`${data.assignment_id}#${data.date ?? ''}#${idx}`
									) || idx + 1;
								const cells = row.getVisibleCells();
								return (
									<tr
										key={row.id}
										className="hover:bg-purple-50/30 transition-colors"
									>
										{cells.map((cell) => (
											<td
												key={cell.id}
												className="px-4 py-3 text-center text-sm text-gray-900 align-middle"
											>
												{cell.column.id === 'sr_no'
													? srNo
													: flexRender(
															cell.column.columnDef.cell,
															cell.getContext()
														)}
											</td>
										))}
									</tr>
								);
							})}
						</tbody>
						<tfoot className="border-t border-gray-200 bg-gray-50 font-medium">
							<tr>
								<td
									className="px-4 py-3 text-center text-xs uppercase tracking-wider text-gray-600"
									colSpan={5}
								>
									Total
								</td>
								<td className="px-4 py-3 text-center tabular-nums text-gray-800">
									{totals.assign}
								</td>
								<td className="px-4 py-3 text-center tabular-nums text-blue-600">
									{totals.actual}
								</td>
								<td className="px-4 py-3 text-center tabular-nums text-purple-600">
									{totals.qty}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			)}
		</div>
	);
}
