'use client';

import { Fragment, useMemo } from 'react';
import { cn } from '@/lib/cn';

// ── Types (mirror data-source) ────────────────────────────────────

export interface ActivityStatusCell {
	hours: number;
	qty_done: number;
}

export interface ActivityStatusRow {
	user_id: string;
	user_name: string;
	days: Record<string, ActivityStatusCell>;
	total_hours: number;
	total_qty: number;
	hours_per_qty: number;
}

export interface ActivityStatusProject {
	project_id: number;
	project_name: string;
	project_code: string;
	client_name: string;
	start_date: string | null;
	end_date: string | null;
}

export interface ActivityStatusReport {
	project: ActivityStatusProject;
	activity: string; // 'All Activities' — the matrix aggregates every activity
	from: string;
	to: string;
	dates: string[];
	rows: ActivityStatusRow[];
}

interface ActivityStatusMatrixProps {
	report: ActivityStatusReport;
	className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

/** `2026-07-22` → `22-Jul` */
function shortDate(iso: string): string {
	const [, m, d] = iso.split('-');
	const month = MONTHS[parseInt(m, 10) - 1] || m;
	return `${parseInt(d, 10)}-${month}`;
}

/** `2026-07-22` → `22-07-2026` (matches the source document's date label) */
function ddmmyyyy(iso: string): string {
	const [y, m, d] = iso.split('-');
	return `${d}-${m}-${y}`;
}

/** Integer-ish display: drop `.00` from whole numbers, otherwise 2dp. */
function cellNum(n: number): string {
	if (!n) return '0';
	if (Number.isInteger(n)) return String(n);
	return n.toFixed(2);
}

function ratioDisplay(n: number, totalQty: number): string {
	if (totalQty <= 0) return '';
	return n.toFixed(1);
}

// ── Component ─────────────────────────────────────────────────────

export default function ActivityStatusMatrix({
	report,
	className,
}: ActivityStatusMatrixProps) {
	const { project, activity, from, to, dates, rows } = report;

	const totalDays = dates.length;

	const totals = useMemo(
		() =>
			rows.reduce(
				(acc, r) => ({
					hours: acc.hours + r.total_hours,
					qty: acc.qty + r.total_qty,
				}),
				{ hours: 0, qty: 0 }
			),
		[rows]
	);

	const overallRatio =
		totals.qty > 0 ? Math.round((totals.hours / totals.qty) * 10) / 10 : 0;

	return (
		<div className={cn('activity-status-matrix', className)}>
			<style>{matrixStyles}</style>

			<article
				className="mx-auto bg-white text-black shadow-sm border border-gray-200 print:shadow-none print:border-0"
				aria-label={`Activity status report for ${project.project_name}`}
			>
				{/* ── Document header ────────────────────────────── */}
				<header className="grid grid-cols-12 border-b border-gray-300 text-[11px]">
					<div className="col-span-2 flex items-center justify-center border-r border-gray-300 p-3 print:p-2">
						<div className="flex flex-col items-center leading-none">
							<span className="font-bold text-base tracking-tight text-gray-900">
								ACCENT
							</span>
							<span className="text-[8px] uppercase tracking-widest text-gray-500">
								Techno Solutions
							</span>
						</div>
					</div>

					<h1 className="col-span-8 self-center text-center text-xl font-bold tracking-wide uppercase">
						Activity Status Report
					</h1>

					<div className="col-span-2 border-l border-gray-300 text-[10px]">
						<div className="px-2 py-1 border-b border-gray-300 flex justify-between gap-2">
							<span className="text-gray-500">Doc. No.</span>
							<span className="font-mono">ATS-PIP-CTR-001</span>
						</div>
						<div className="px-2 py-1 border-b border-gray-300 flex justify-between gap-2">
							<span className="text-gray-500">Sht.</span>
							<span>2 of 2</span>
						</div>
						<div className="px-2 py-1 flex justify-between gap-2">
							<span className="text-gray-500">Rev.</span>
							<span>00</span>
						</div>
					</div>
				</header>

				{/* ── Project / activity / date meta ─────────────── */}
				<div className="grid grid-cols-12 text-[11px] border-b border-gray-300">
					<div className="col-span-1 px-2 py-1.5 font-semibold border-r border-gray-300">
						PROJECT:
					</div>
					<div className="col-span-11 px-2 py-1.5 font-mono">
						{project.project_name}
					</div>
				</div>
				<div className="grid grid-cols-12 text-[11px] border-b border-gray-300">
					<div className="col-span-1 px-2 py-1.5 font-semibold border-r border-gray-300">
						ACTIVITY:
					</div>
					<div className="col-span-9 px-2 py-1.5 font-mono">{activity}</div>
					<div className="col-span-1 px-2 py-1.5 font-semibold border-l border-r border-gray-300 text-right">
						Date:
					</div>
					<div className="col-span-1 px-2 py-1.5 font-mono text-center">
						{totalDays > 0 ? `${ddmmyyyy(from)} to ${ddmmyyyy(to)}` : '—'}
					</div>
				</div>

				{/* ── Section subheader ──────────────────────────── */}
				<div className="text-center text-[11px] font-semibold py-1.5 border-b border-gray-300 uppercase tracking-wide">
					Activity completed and issued.
				</div>

				{/* ── Matrix table ──────────────────────────────── */}
				<div className="overflow-x-auto print:overflow-visible">
					<table className="w-full border-collapse text-[11px] tabular-nums">
						<caption className="sr-only">
							Activity status report for {project.project_name} — {activity} —{' '}
							{ddmmyyyy(from)} to {ddmmyyyy(to)}.
						</caption>

						<thead>
							{/* Row 1 — group labels */}
							<tr className="border-b border-gray-400">
								<th
									scope="row"
									rowSpan={3}
									className="border-r border-gray-400 px-2 py-2 align-bottom text-center font-semibold w-10"
								>
									Sr No.
								</th>
								<th
									scope="row"
									rowSpan={3}
									className="border-r border-gray-400 px-2 py-2 align-bottom text-left font-semibold whitespace-nowrap"
								>
									Name of Person
								</th>
								<th
									scope="colgroup"
									colSpan={totalDays * 2}
									className="border-r border-gray-400 px-2 py-1.5 text-center font-semibold"
								>
									Date
								</th>
								<th
									scope="colgroup"
									colSpan={3}
									className="px-2 py-1.5 text-center font-semibold"
								>
									Total
								</th>
							</tr>

							{/* Row 2 — per-date + per-total headers */}
							<tr className="border-b border-gray-400">
								{dates.map((iso) => (
									<th
										key={iso}
										scope="colgroup"
										colSpan={2}
										className="border-r border-gray-300 px-1 py-1 text-center font-semibold"
									>
										{shortDate(iso)}
									</th>
								))}
								<th
									scope="col"
									className="vertical-header border-r border-gray-300 px-1 py-2 text-center font-semibold"
								>
									<span>Hours</span>
								</th>
								<th
									scope="col"
									className="vertical-header border-r border-gray-300 px-1 py-2 text-center font-semibold bg-blue-50/60"
								>
									<span>Activity Qty</span>
								</th>
								<th
									scope="col"
									className="vertical-header px-1 py-2 text-center font-semibold"
								>
									<span>Hrs for Activity</span>
								</th>
							</tr>

							{/* Row 3 — Hrs / ActQty labels under each date */}
							<tr className="border-b border-gray-400">
								{dates.map((iso) => (
									<Fragment key={iso}>
										<th
											scope="col"
											className="vertical-header border-r border-gray-200 px-0.5 py-2 text-center font-normal text-[9px]"
										>
											<span>Hrs</span>
										</th>
										<th
											scope="col"
											className="vertical-header border-r border-gray-300 px-0.5 py-2 text-center font-normal text-[9px] bg-blue-50/60"
										>
											<span>ActQty.</span>
										</th>
									</Fragment>
								))}
							</tr>
						</thead>

						<tbody>
							{rows.length === 0 ? (
								<tr>
									<td
										colSpan={2 + totalDays * 2 + 3}
										className="px-3 py-8 text-center text-gray-500"
									>
										No work logged in this date range.
									</td>
								</tr>
							) : (
								rows.map((row, idx) => (
									<tr
										key={row.user_id}
										className={cn(
											'border-b border-gray-200',
											idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
										)}
									>
										<td className="border-r border-gray-300 px-2 py-1.5 text-center text-gray-500 w-8">
											{idx + 1}
										</td>
										<td className="border-r border-gray-300 px-2 py-1.5 font-medium text-gray-900 uppercase tracking-wide whitespace-nowrap">
											{row.user_name}
										</td>
										{dates.map((iso) => {
											const cell = row.days[iso];
											return (
												<Fragment key={`${row.user_id}-${iso}`}>
													<td className="border-r border-gray-200 px-1 py-1.5 text-right text-gray-700 w-9">
														{cell ? cellNum(cell.hours) : ''}
													</td>
													<td className="border-r border-gray-300 px-1 py-1.5 text-right text-gray-700 bg-blue-50/40 w-10">
														{cell ? cellNum(cell.qty_done) : ''}
													</td>
												</Fragment>
											);
										})}
										<td className="border-r border-gray-300 px-2 py-1.5 text-right font-semibold text-gray-900">
											{cellNum(row.total_hours)}
										</td>
										<td className="border-r border-gray-300 px-2 py-1.5 text-right font-semibold text-gray-900 bg-blue-50/40">
											{cellNum(row.total_qty)}
										</td>
										<td className="px-2 py-1.5 text-right font-semibold text-gray-900">
											{ratioDisplay(row.hours_per_qty, row.total_qty)}
										</td>
									</tr>
								))
							)}
						</tbody>

						{rows.length > 0 && (
							<tfoot>
								<tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
									<td className="border-r border-gray-300 px-2 py-1.5 text-center text-gray-500">
										—
									</td>
									<td className="border-r border-gray-300 px-2 py-1.5 uppercase tracking-wide text-gray-700">
										Total
									</td>
									{dates.map((iso) => {
										let dayHours = 0;
										let dayQty = 0;
										rows.forEach((r) => {
											const c = r.days[iso];
											if (c) {
												dayHours += c.hours;
												dayQty += c.qty_done;
											}
										});
										return (
											<Fragment key={`f-${iso}`}>
												<td className="border-r border-gray-200 px-1 py-1.5 text-right text-gray-700">
													{dayHours ? cellNum(dayHours) : ''}
												</td>
												<td className="border-r border-gray-300 px-1 py-1.5 text-right text-gray-700 bg-blue-50/40">
													{dayQty ? cellNum(dayQty) : ''}
												</td>
											</Fragment>
										);
									})}
									<td className="border-r border-gray-300 px-2 py-1.5 text-right text-gray-900">
										{cellNum(totals.hours)}
									</td>
									<td className="border-r border-gray-300 px-2 py-1.5 text-right text-gray-900 bg-blue-50/40">
										{cellNum(totals.qty)}
									</td>
									<td className="px-2 py-1.5 text-right text-gray-900">
										{ratioDisplay(overallRatio, totals.qty)}
									</td>
								</tr>
							</tfoot>
						)}
					</table>
				</div>
			</article>
		</div>
	);
}

// ── Print + visual styles ─────────────────────────────────────────

const matrixStyles = `
.activity-status-matrix .vertical-header {
	writing-mode: vertical-rl;
	transform: rotate(180deg);
	white-space: nowrap;
	vertical-align: middle;
}
.activity-status-matrix .vertical-header > span {
	display: inline-block;
}
@media print {
	@page {
		size: A4 landscape;
		margin: 8mm;
	}
	.activity-status-matrix {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.activity-status-matrix table {
		font-size: 9px;
	}
	.activity-status-matrix th,
	.activity-status-matrix td {
		padding: 1px 2px !important;
	}
}
`;
