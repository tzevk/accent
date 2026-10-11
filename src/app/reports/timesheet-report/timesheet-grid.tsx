'use client';

import Image from 'next/image';
import { capProjectDays } from '@/lib/timesheet-cap';

/**
 * The Timesheet grid's own row and cell rendering, shared by both readers of
 * `fetchTimesheetData`:
 *
 *   - the admin report page (`/reports/timesheet-report`), behind its
 *     employee and month pickers and its Excel export;
 *   - the self-service page (`/user/timesheet`), read-only, with the pickers
 *     and the export removed.
 *
 * One rendering keeps the two surfaces in agreement: hours mean the same
 * thing on both, so a number an employee reads privately matches what an
 * admin reads. This module is presentation only — every figure arrives in
 * `data`, derived by the report's own data source.
 */

// ─── Client-safe API types ──────────────────────────────────────────

type DayType = 'working' | 'weekly_off' | 'holiday';

export interface TsDay {
	date: string;
	day: number;
	weekday: string;
	status: string | null;
	overtime_hours: number;
	is_weekly_off: boolean;
	is_holiday: boolean;
	holiday_name: string | null;
	hours: number;
	day_type: DayType;
}

export interface TsEmployee {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	position: string | null;
	designation: string | null;
}

export interface TsProject {
	project_id: number | null;
	project_code: string;
	project_name: string;
	activity_name: string;
	discipline_name: string | null;
	status: string | null;
	estimated_hours: number;
	actual_hours: number;
	qty_assigned: number;
	qty_completed: number;
	start_date: string | null;
	due_date: string | null;
	days: Record<string, number>;
	total_hours: number;
}

export interface TsMonthlyHours {
	daily: Record<string, number>;
	normal: number;
	overtime_daily: Record<string, number>;
	overtime: number;
	total: number;
	source: 'project' | 'attendance';
}

export interface TsSummary {
	present_days: number;
	half_days: number;
	weekly_offs: number;
	holidays: number;
	absent_days: number;
	leave_days: number;
	standard_hours: number;
	overtime_hours: number;
	total_hours: number;
}

export interface TimesheetGridData {
	employee: TsEmployee | null;
	month: string;
	year: number;
	month_label: string;
	days: TsDay[];
	holidays: { name: string; date: string }[];
	projects: TsProject[];
	summary: TsSummary;
	hours: TsMonthlyHours;
	settings: { standard_working_hours: number; half_day_hours: number };
}

export interface TimesheetGridProps {
	data: TimesheetGridData;
	/** The employee the page selected; falls back to `data.employee`. */
	employee?: TsEmployee | null;
}

/** Authored leave statuses, spelled the way the Excel template spells them. */
const LEAVE_CODES: Record<string, true> = {
	PL: true,
	CL: true,
	SL: true,
	ML: true,
	EL: true,
	L: true,
	LWP: true,
};

function isLeaveStatus(status: string | null): boolean {
	return !!status && LEAVE_CODES[status.toUpperCase()] === true;
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

/** `2026-09` becomes `September 2026`; anything else passes through. */
export function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** Day cells: 9.3 hours becomes 09:18. */
function formatClock(hours: number): string {
	const minutes = Math.round(hours * 60);
	const hh = Math.floor(minutes / 60);
	const mm = minutes % 60;
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Total cells: 174.5 hours becomes 174:30:00. */
function formatElapsed(hours: number): string {
	const seconds = Math.round(hours * 3600);
	const hh = Math.floor(seconds / 3600);
	const mm = Math.floor((seconds % 3600) / 60);
	const ss = seconds % 60;
	return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function isBlueDay(day: TsDay): boolean {
	return day.day_type !== 'working';
}

/**
 * The reference template spells non-working day labels down blue columns.
 * Keep the full weekday/holiday wording instead of a short status code.
 */
function fullDayLabel(day: TsDay): string {
	if (isLeaveStatus(day.status)) {
		return 'LEAVE';
	}
	if (day.day_type === 'holiday') {
		return (day.holiday_name || 'HOLIDAY').toUpperCase();
	}
	if (day.weekday === 'Sat') return 'SATURDAY';
	if (day.weekday === 'Sun') return 'SUNDAY';
	return day.weekday.toUpperCase();
}

/**
 * The rows the month actually shows: an assignment with hours logged in the
 * month, or one whose assigned or due date falls in it.
 */
function projectRowsForMonth(
	projects: TsProject[],
	month: string
): TsProject[] {
	return projects.filter((project) => {
		if (project.total_hours > 0) return true;
		if (project.start_date?.startsWith(month)) return true;
		if (project.due_date?.startsWith(month)) return true;
		return false;
	});
}

// ─── Page ───────────────────────────────────────────────────────────

export default function TimesheetGrid({ data, employee }: TimesheetGridProps) {
	const days = data.days;
	const selectedEmployee = employee ?? data.employee;

	const projectRows = projectRowsForMonth(data.projects, data.month);
	// The grid credits at most the standard working day per day in the top
	// section — per-project cells are capped so the section sums to ≤ 8h,
	// and the daily excess is already surfaced in the overtime row
	// (data.hours.overtime_daily). The cap splits an over-8h day across its
	// projects proportionally so every project stays visible.
	const displayedProjectRows = capProjectDays(
		projectRows,
		data.settings.standard_working_hours
	);

	return (
		<section className="min-w-[1950px] bg-white font-[Arial,sans-serif] text-[10px] leading-none text-black">
			{/* Workbook header: logo, title, employee details, month/year. */}
			<div className="grid min-h-[58px] grid-cols-[260px_310px_minmax(0,1fr)_145px] border-x border-t border-black">
				<div className="flex items-center justify-center border-r border-black">
					<Image
						src="/accent-logo.png"
						alt="Accent"
						width={120}
						height={58}
						className="h-[52px] w-[112px] object-contain"
					/>
				</div>
				<div className="flex items-center justify-center border-r border-black text-[15px] font-bold">
					Monthly Time Sheet
				</div>
				<div className="grid grid-cols-[140px_minmax(0,1fr)] grid-rows-4 border-r border-black">
					<div className="border-b border-black px-1 py-1">Employee Code</div>
					<div className="border-b border-black px-1 py-1 font-semibold">
						{selectedEmployee?.employee_id ?? data.employee?.employee_id ?? ''}
					</div>
					<div className="border-b border-black px-1 py-1">Employee Name</div>
					<div className="border-b border-black px-1 py-1 font-semibold">
						{selectedEmployee?.name ?? data.employee?.name ?? ''}
					</div>
					<div className="border-b border-black px-1 py-1">Designation</div>
					<div className="border-b border-black px-1 py-1 font-semibold">
						{selectedEmployee?.position || selectedEmployee?.designation || ''}
					</div>
					<div className="px-1 py-1">Department</div>
					<div className="px-1 py-1 font-semibold">
						{selectedEmployee?.department ?? ''}
					</div>
				</div>
				<div className="grid grid-rows-2">
					<div className="grid grid-cols-[1fr_1fr] border-b border-black">
						<span className="border-r border-black px-1 py-1">Month</span>
						<span className="px-1 py-1 text-right font-semibold">
							{data.month_label.split(' ')[0]}
						</span>
					</div>
					<div className="grid grid-cols-[1fr_1fr]">
						<span className="border-r border-black px-1 py-1">Year</span>
						<span className="px-1 py-1 text-right font-semibold">
							{data.year}
						</span>
					</div>
				</div>
			</div>

			<div className="border-x border-t border-b border-black py-1 text-center text-[11px] font-bold">
				Daily Man Hours
			</div>

			<table className="w-full table-fixed border-collapse border border-black">
				<caption className="sr-only">
					Monthly time sheet for{' '}
					{selectedEmployee?.name ?? data.employee?.name ?? 'employee'} in{' '}
					{data.month_label}
				</caption>
				<colgroup>
					{Array.from({ length: 4 }, (_, index) => (
						<col key={`code-col-${index}`} style={{ width: '65px' }} />
					))}
					{Array.from({ length: 4 }, (_, index) => (
						<col key={`activity-col-${index}`} style={{ width: '20.5px' }} />
					))}
					<col style={{ width: '48px' }} />
					{days.map((day) => (
						<col key={day.date} style={{ width: '48px' }} />
					))}
					<col style={{ width: '72px' }} />
				</colgroup>
				<thead>
					<tr className="h-[25px]">
						<th
							colSpan={4}
							className="border border-black px-1 py-1 text-center font-normal"
						>
							Days
						</th>
						<th
							colSpan={4}
							rowSpan={2}
							className="border border-black bg-gray-100 px-1 py-1 text-center font-normal"
						>
							Activity
						</th>
						<th
							rowSpan={2}
							className="border border-black bg-gray-100 px-1 py-1 text-center font-normal"
						>
							Count
						</th>
						{days.map((day) => (
							<th
								key={day.date}
								className={`border border-black px-0 py-1 text-center font-normal ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white'}`}
							>
								{day.weekday}
							</th>
						))}
						<th
							rowSpan={2}
							className="border border-black px-1 py-1 text-center font-normal"
						>
							Monthly Man
							<br />
							Hours
						</th>
					</tr>
					<tr className="h-[18px]">
						<th
							colSpan={4}
							className="border border-black px-1 py-1 text-center font-normal"
						>
							Project Code
						</th>
						{days.map((day) => (
							<th
								key={day.date}
								className={`border border-black px-0 py-1 text-center font-normal tabular-nums ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white'}`}
							>
								{String(day.day).padStart(2, '0')}
							</th>
						))}
					</tr>
				</thead>

				<tbody>
					{/* Fixed-height normal section: empty rows preserve the Excel layout and hold vertical labels. */}
					{Array.from({ length: 20 }, (_, rowIndex) => {
						const project = displayedProjectRows[rowIndex] ?? null;
						return (
							<tr key={`normal-${rowIndex}`} style={{ height: '15px' }}>
								<td
									colSpan={4}
									className="border border-black px-1 py-0 text-left align-middle"
								>
									{project?.project_code || ''}
								</td>
								<td
									colSpan={4}
									className="border border-black px-1 py-0 text-center align-middle whitespace-nowrap overflow-hidden text-ellipsis"
									title={project?.activity_name || ''}
								>
									{project?.activity_name || ''}
								</td>
								<td
									className="border border-black px-1 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis"
									title={
										project?.qty_completed
											? String(project.qty_completed)
											: undefined
									}
								>
									{project?.qty_completed ? project.qty_completed : ''}
								</td>
								{days.map((day) => {
									const hours = project?.days[day.date] ?? 0;
									const isLeave = isLeaveStatus(day.status);
									const showLabel = isBlueDay(day) || isLeave;
									const label = showLabel ? fullDayLabel(day) : '';
									const letter = label[rowIndex] ?? '';
									return (
										<td
											key={day.date}
											title={
												hours > 0
													? `${project?.activity_name || ''} — ${formatClock(hours)}`
													: undefined
											}
											className={`border border-black px-0 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : isLeave ? 'bg-white text-red-600' : 'bg-white text-black'}`}
										>
											{hours > 0
												? formatClock(hours)
												: letter === ' '
													? ''
													: letter}
										</td>
									);
								})}
								<td className="border border-black px-1 py-0 text-right align-middle tabular-nums">
									{project ? formatElapsed(project.total_hours) : '0:00:00'}
								</td>
							</tr>
						);
					})}
					<tr style={{ height: '18px' }}>
						<td colSpan={9} className="border border-black px-1 py-0" />
						<td
							colSpan={20}
							className="border border-black px-1 py-0 text-center font-semibold text-blue-700"
						>
							Over Time Hours
						</td>
						<td
							colSpan={11}
							className="border border-black px-1 py-0 text-right font-normal"
						>
							Sub-Total Of Normal Hours
						</td>
						<td className="border border-black px-1 py-0 text-right tabular-nums">
							{formatElapsed(data.hours.normal)}
						</td>
					</tr>

					{Array.from({ length: 6 }, (_, rowIndex) => {
						const project = displayedProjectRows[rowIndex] ?? null;
						return (
							<tr key={`overtime-${rowIndex}`} style={{ height: '15px' }}>
								<td
									colSpan={4}
									className="border border-black px-1 py-0 align-middle whitespace-nowrap overflow-hidden text-ellipsis"
									title={
										rowIndex === 0 ? project?.project_code || '' : undefined
									}
								>
									{rowIndex === 0 ? project?.project_code || '' : ''}
								</td>
								<td
									colSpan={4}
									className="border border-black px-1 py-0 text-center align-middle whitespace-nowrap overflow-hidden text-ellipsis"
									title={
										rowIndex === 0 ? project?.activity_name || '' : undefined
									}
								>
									{rowIndex === 0 ? project?.activity_name || '' : ''}
								</td>
								<td className="border border-black px-1 py-0 text-center align-middle" />
								{days.map((day) => {
									const otValue = data.hours.overtime_daily[day.date];
									return (
										<td
											key={day.date}
											title={otValue ? formatClock(otValue) : undefined}
											className={`border border-black px-0 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white text-blue-700'}`}
										>
											{rowIndex === 0 && otValue ? formatClock(otValue) : ''}
										</td>
									);
								})}
								<td className="border border-black px-1 py-0 text-right tabular-nums text-blue-700 font-semibold">
									{rowIndex === 0
										? formatElapsed(data.hours.overtime)
										: '0:00:00'}
								</td>
							</tr>
						);
					})}

					<tr style={{ height: '18px' }}>
						<td
							colSpan={9}
							className="border border-black px-1 py-0 font-normal"
						>
							Daily Man Hours
						</td>
						{days.map((day) => {
							const dailyValue = data.hours.daily[day.date];
							return (
								<td
									key={day.date}
									title={dailyValue ? formatClock(dailyValue) : undefined}
									className={`border border-black px-0 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white'}`}
								>
									{dailyValue ? formatClock(dailyValue) : ''}
								</td>
							);
						})}
						<td className="border border-black px-1 py-0 text-right tabular-nums">
							{formatElapsed(data.hours.normal)}
						</td>
					</tr>

					<tr style={{ height: '18px' }}>
						<td
							colSpan={40}
							className="border border-black px-1 py-0 text-right font-normal"
						>
							Sub-Total Of Over Time Hours
						</td>
						<td className="border border-black px-1 py-0 text-right tabular-nums">
							{formatElapsed(data.hours.overtime)}
						</td>
					</tr>
					<tr style={{ height: '18px' }}>
						<td
							colSpan={40}
							className="border border-black px-1 py-0 text-right font-normal"
						>
							Total Monthly Hours
						</td>
						<td className="border border-black px-1 py-0 text-right font-bold tabular-nums">
							{formatElapsed(data.hours.total)}
						</td>
					</tr>
				</tbody>

				<tfoot>
					<tr style={{ height: '58px' }}>
						<td
							colSpan={14}
							className="border border-black px-2 py-1 text-center align-bottom"
						>
							<span className="block border-b border-black pb-1">
								{selectedEmployee?.name ?? data.employee?.name ?? ''}
							</span>
							Prepared By
						</td>
						<td
							colSpan={13}
							className="border border-black px-2 py-1 text-center align-bottom"
						>
							<span className="block border-b border-black pb-1">&nbsp;</span>
							Checked By
						</td>
						<td
							colSpan={14}
							className="border border-black px-2 py-1 text-center align-bottom"
						>
							<span className="block border-b border-black pb-1">&nbsp;</span>
							Approved By
						</td>
					</tr>
				</tfoot>
			</table>
		</section>
	);
}
