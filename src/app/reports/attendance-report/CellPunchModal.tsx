'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
	ArrowDownLeftIcon,
	ArrowTopRightOnSquareIcon,
	ArrowUpRightIcon,
	DevicePhoneMobileIcon,
	InformationCircleIcon,
	InboxArrowDownIcon,
} from '@heroicons/react/24/outline';
import Modal from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn.js';
import type { PunchDirection } from '@/lib/punch';

// ─── Props ──────────────────────────────────────────────────────────

/** One raw Punch exactly as the device reported it. */
export interface CellPunch {
	/** 'HH:MM' or 'HH:MM:ss'. Rendered verbatim — seconds, when present, are dimmed. */
	time: string;
	/** Biometric device serial number. */
	serialNumber: string;
	/**
	 * The employee/device code the device reported for this punch. Display
	 * metadata only: the cell itself is keyed by `employees.id`, so a mismatch
	 * here is a fact about the device, never a second attribution.
	 */
	employeeCode: string;
	/** Reported by the device, or inferred by the report when the device sent none. */
	direction: PunchDirection;
	/** Optional stable React key (the Punch row id); falls back to its position. */
	id?: number | string;
}

export interface CellPunchModalProps {
	/** Whether the drill-down is open. The shared Modal renders nothing when false. */
	open: boolean;
	/** Dismissal callback: backdrop click, the header ✕, the footer Close, or Escape. */
	onClose: () => void;
	/**
	 * The Employee whose matrix cell was opened. `id` is `employees.id` — the
	 * key the credited-hours drill-through link needs; `code` and `name` are
	 * display metadata.
	 */
	employee: { id: number; code: string; name: string };
	/** 'YYYY-MM-DD' — the matrix column this cell sits in. */
	date: string;
	/**
	 * Every Punch behind this cell for the month. The modal derives the device
	 * list from them and filters its own table rows — it never fetches, and it
	 * computes nothing the grid shows, so it cannot move a figure.
	 *
	 * Pass `null`/`undefined` (or `[]`) for a cell with no punches: the modal
	 * then renders its explicit empty state instead of an empty table.
	 */
	punches?: CellPunch[] | null;
	/** 'YYYY-MM' the report covers; half of the credited-hours drill-through link. */
	month: string;
}

export interface CellPunchTriggerProps {
	/** The Employee whose cell this trigger opens. */
	employee: { code: string; name: string };
	/** 'YYYY-MM-DD' — the matrix column this cell sits in. */
	date: string;
	/** Punches on this cell; drives the spoken description of the trigger. */
	punchCount: number;
	/** Invoked on click, Enter or Space. Opens the drill-down. */
	onOpen: () => void;
	/** The cell's own visual content (hours, status, …). */
	children?: ReactNode;
	className?: string;
}

// ─── Small helpers ─────────────────────────────────────────────────

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
/** `YYYY-MM`, the only month shape the attendance grid accepts. */
const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_SHAPE = /^(\d{1,2}:\d{2})(?::(\d{2}))?$/;
const TIME_SORT_SHAPE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;

/**
 * The select's "no filter" value. Deliberately not `''`, so a device serial
 * can never collide with it.
 */
const ALL_DEVICES = 'All devices';

/** Grid page the credited-hours drill-through targets. */
const GRID_PATH = '/employees/attendance';

/** Footer link label: the credited figure lives in the grid, not here. */
const GRID_LINK_LABEL = 'View credited hours in the attendance grid';

/**
 * Human label for a matrix column: 'YYYY-MM-DD' → '13 Aug 2026'.
 *
 * The local-midnight round trip is deliberate: `new Date('2026-08-13')` is
 * parsed as UTC midnight, which `formatDate` would then render a day early
 * west of Greenwich — the local form is what the grid column already means.
 */
function dayLabel(iso: string): string {
	const local = ISO_DATE_SHAPE.test(iso) ? new Date(`${iso}T00:00:00`) : null;
	return formatDate(local && !Number.isNaN(local.getTime()) ? local : iso);
}

/**
 * `/employees/attendance?employee_id=<employees.id>&month=<YYYY-MM>` — the
 * credited figure lives in that grid, so the drill-down links there instead of
 * restating it. Returns null when there is nothing to link to (no usable
 * employee id, or a malformed month), so the footer never renders a link the
 * grid cannot honour.
 */
function gridHref(employeeId: number, month: string): string | null {
	if (!Number.isFinite(employeeId) || employeeId <= 0) return null;
	if (!MONTH_SHAPE.test(month)) return null;
	return `${GRID_PATH}?employee_id=${encodeURIComponent(String(employeeId))}&month=${encodeURIComponent(month)}`;
}

// ─── Presentational pieces ─────────────────────────────────────────

/**
 * Mirrors the Attendance Report table's DirectionBadge classes exactly, so a
 * manager reads the same colour language in the grid and in the drill-down.
 */
function DirectionBadge({ direction }: { direction: PunchDirection }) {
	if (direction === 'in') {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
				<ArrowDownLeftIcon className="h-3 w-3" aria-hidden="true" />
				IN
			</span>
		);
	}
	if (direction === 'out') {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
				<ArrowUpRightIcon className="h-3 w-3" aria-hidden="true" />
				OUT
			</span>
		);
	}
	return (
		<span
			className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500"
			title="Device did not report a direction"
		>
			—
		</span>
	);
}

// ─── Cell trigger ──────────────────────────────────────────────────

/**
 * The keyboard-reachable `<button>` that opens the drill-down. Wrap the cell's
 * own content in `children`; the "show N punches for …" sentence is appended as
 * screen-reader text, so the accessible NAME still leads with the visible hours
 * (WCAG 2.5.3 "Label in Name"). An `aria-label` would instead have replaced the
 * visible hours, hiding them from the name.
 */
export function CellPunchTrigger({
	employee,
	date,
	punchCount,
	onOpen,
	children,
	className,
}: CellPunchTriggerProps) {
	const name = employee.name || employee.code;
	const punchNoun = punchCount === 1 ? 'punch' : 'punches';
	// The em dash leads: the accessible-name algorithm strips a node's leading
	// space, which would otherwise weld the hours to the sentence.
	const description = `— Show ${punchCount} ${punchNoun} for ${name} on ${dayLabel(date)}`;

	return (
		<button
			type="button"
			data-testid="cell-punch-trigger"
			aria-haspopup="dialog"
			title={`${punchCount} ${punchNoun} · ${name} · ${dayLabel(date)}`}
			onClick={onOpen}
			className={cn(
				'w-full rounded-md text-left transition-colors hover:bg-purple-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]/40',
				className
			)}
		>
			{children}
			<span className="sr-only">{description}</span>
		</button>
	);
}

// ─── Drill-down modal ──────────────────────────────────────────────

/**
 * The cell drill-down: every raw Punch behind one employee-day of the matrix,
 * accidental middle taps included — those are exactly why a manager opens it.
 *
 * Presentation only. The caller narrows the punches to the cell; the modal
 * derives the device filter from those rows, lists them in time order and
 * computes nothing the grid shows, so it can never move a figure on the grid.
 * Each device serial in the day is listed, and the footer links through to the
 * credited hours in the attendance grid.
 *
 * Wraps the shared `Modal` (portal to `document.body`), which supplies
 * `role="dialog"`, `aria-modal="true"`, the accessible name from `title`, focus
 * into the panel on open, focus back to the trigger on close, an Escape
 * dismissal, a Tab focus trap, backdrop-click dismissal and the labelled ✕.
 *
 * A cell with no punches renders an explicit empty state (never a blank
 * table), so it is safe to open from a leave or weekly-off cell too.
 */
export default function CellPunchModal({
	open,
	onClose,
	employee,
	date,
	punches,
	month,
}: CellPunchModalProps) {
	// Filter state only: it narrows the table below, never a grid figure. A
	// fresh modal mounts per drill-down, so 'All devices' is the honest default.
	const [device, setDevice] = useState<string>(ALL_DEVICES);
	const deviceSelectId = useId();
	const deviceCaptionId = useId();

	// Time ascending, with the incoming order preserved for identical stamps.
	// Unparseable times sort last rather than scrambling the day.
	const rows = useMemo(
		() =>
			(punches ?? [])
				.map((punch, index) => {
					const m = TIME_SORT_SHAPE.exec((punch.time ?? '').trim());
					return {
						punch,
						index,
						key: m
							? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
							: Number.NaN,
					};
				})
				.sort((a, b) => {
					if (a.key === b.key) return a.index - b.index;
					if (Number.isNaN(a.key))
						return Number.isNaN(b.key) ? a.index - b.index : 1;
					if (Number.isNaN(b.key)) return -1;
					return a.key - b.key;
				})
				.map(({ punch }) => punch),
		[punches]
	);

	// Distinct device serials, in the same byte order as the report's own device
	// list. A Punch without a serial is listed under 'All devices' only.
	const devices = useMemo(
		() =>
			[
				...new Set(rows.map((punch) => punch.serialNumber).filter(Boolean)),
			].sort(),
		[rows]
	);
	// A serial no longer present (reused modal, fresh punches) falls back to the
	// unfiltered list rather than stranding the table on a filter that lost its
	// option.
	const activeDevice = devices.includes(device) ? device : ALL_DEVICES;
	const visibleRows =
		activeDevice === ALL_DEVICES
			? rows
			: rows.filter((punch) => punch.serialNumber === activeDevice);

	const name = employee.name || employee.code;
	const total = rows.length;
	const totalNoun = total === 1 ? 'punch' : 'punches';
	// The caption states exactly what the table below shows.
	const caption =
		total === 0
			? 'No punches recorded'
			: activeDevice === ALL_DEVICES
				? `Showing all ${total} ${totalNoun} from all devices`
				: `Showing ${visibleRows.length} of ${total} ${totalNoun} from device ${activeDevice}`;

	const href = gridHref(employee.id, month);
	const title = `${name} — punches on ${dayLabel(date)}`;

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={title}
			size="md"
			footer={
				<>
					{href ? (
						<Link
							data-testid="cell-punch-grid-link"
							href={href}
							title={`Credited hours for ${name} in ${month}`}
							className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]/40"
						>
							{GRID_LINK_LABEL}
							<ArrowTopRightOnSquareIcon
								className="h-4 w-4 shrink-0"
								aria-hidden="true"
							/>
						</Link>
					) : null}
					<Button data-testid="cell-punch-close" onClick={onClose}>
						Close
					</Button>
				</>
			}
		>
			<div
				data-testid="cell-punch-modal"
				data-date={date}
				data-count={total}
				className="space-y-3"
			>
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
					<label
						htmlFor={deviceSelectId}
						className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600"
					>
						Device
						<select
							id={deviceSelectId}
							data-testid="cell-punch-device-filter"
							value={activeDevice}
							onChange={(event) => setDevice(event.target.value)}
							disabled={devices.length === 0}
							aria-describedby={deviceCaptionId}
							className="h-8 w-48 rounded-md border border-gray-300 bg-white px-2 text-xs font-normal normal-case tracking-normal text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
						>
							<option value={ALL_DEVICES}>All devices</option>
							{devices.map((serial) => (
								<option key={serial} value={serial}>
									{serial}
								</option>
							))}
						</select>
					</label>
					<p
						id={deviceCaptionId}
						data-testid="cell-punch-device-caption"
						className="text-[11px] text-gray-600"
					>
						{caption}
					</p>
				</div>

				{visibleRows.length === 0 ? (
					<div
						data-testid="cell-punch-empty"
						className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-8 text-center"
					>
						<span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100">
							<InboxArrowDownIcon
								className="h-5 w-5 text-gray-400"
								aria-hidden="true"
							/>
						</span>
						<p className="text-sm font-medium text-gray-700">
							No punches for this cell
						</p>
						<p className="text-xs text-gray-500">
							{caption} — the devices recorded nothing for {name} on{' '}
							{dayLabel(date)}.
						</p>
					</div>
				) : (
					<div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
						<div className="overflow-x-auto">
							<table className="w-full text-left text-[13px]">
								<caption className="sr-only">
									{visibleRows.length} raw punch
									{visibleRows.length === 1 ? '' : 'es'} for {name} (
									{employee.code}) on {dayLabel(date)}. {caption}.
								</caption>
								<thead>
									<tr className="border-b border-gray-200 bg-gray-50/80 text-[11px] uppercase tracking-wider text-gray-500">
										<th scope="col" className="px-4 py-2.5 font-semibold">
											Time
										</th>
										<th scope="col" className="px-4 py-2.5 font-semibold">
											Device
										</th>
										<th scope="col" className="px-4 py-2.5 font-semibold">
											Device Code
										</th>
										<th scope="col" className="px-4 py-2.5 font-semibold">
											Direction
										</th>
									</tr>
								</thead>
								<tbody data-testid="cell-punch-list">
									{visibleRows.map((punch, index) => {
										const direction: PunchDirection =
											punch.direction === 'in' || punch.direction === 'out'
												? punch.direction
												: 'unknown';
										// 'HH:MM:ss' renders as dimmed seconds; anything
										// unshaped is passed through verbatim.
										const timeMatch = TIME_SHAPE.exec(
											(punch.time ?? '').trim()
										);
										const hhmm = timeMatch
											? timeMatch[1]
											: (punch.time ?? '').trim();
										const seconds = timeMatch?.[2] ? `:${timeMatch[2]}` : '';
										return (
											<tr
												key={
													punch.id ??
													`${punch.employeeCode}-${punch.time}-${index}`
												}
												data-testid="cell-punch-row"
												data-time={punch.time}
												data-serial={punch.serialNumber}
												data-employee-code={punch.employeeCode}
												data-direction={direction}
												className="border-b border-gray-100 transition-colors last:border-0 even:bg-gray-50/50 hover:bg-purple-50/40"
											>
												<td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-800">
													{hhmm || '—'}
													{seconds ? (
														<span className="text-[11px] text-gray-500">
															{seconds}
														</span>
													) : null}
												</td>
												<td
													className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-700"
													title="Biometric device serial number"
												>
													<span className="inline-flex items-center gap-1.5">
														<DevicePhoneMobileIcon
															className="h-3.5 w-3.5 text-gray-400"
															aria-hidden="true"
														/>
														{punch.serialNumber || '—'}
													</span>
												</td>
												<td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-700">
													{punch.employeeCode || '—'}
												</td>
												<td className="px-4 py-2.5">
													<DirectionBadge direction={direction} />
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				)}

				<p
					data-testid="cell-punch-note"
					className="flex items-start gap-1.5 text-[11px] text-gray-500"
				>
					<InformationCircleIcon
						className="mt-px h-3.5 w-3.5 shrink-0"
						aria-hidden="true"
					/>
					Every punch the device reported for this day is listed, in time order.
					Direction is inferred (first punch of the day = in, next = out) when
					the device doesn&apos;t report one.
				</p>
			</div>
		</Modal>
	);
}
