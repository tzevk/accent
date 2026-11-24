import { deriveDayTimes, deriveOvertime } from './punch';

export interface AttendancePunchRow {
	employee_id: string | number | null;
	log_date: string | null;
	direction?: string | null;
}

export interface AttendancePunchDay {
	in_time: string | null;
	out_time: string | null;
	overtime_hours: number;
}

export type AttendancePunchDays = Record<
	string,
	Record<string, AttendancePunchDay>
>;

/**
 * Group mapped punches into per-employee, per-day direction-gated times.
 * Directions are inferred by deriveDayTimes; payable OT keeps its 2h gate.
 */
export function buildAttendancePunchDays(
	rows?: readonly AttendancePunchRow[] | null
): AttendancePunchDays {
	const groups = new Map<
		string,
		{
			employee_code: string;
			log_date: string;
			direction?: string | null;
		}[]
	>();
	for (const row of rows || []) {
		if (row.employee_id == null || !row.log_date) continue;
		const date = String(row.log_date).slice(0, 10);
		const key = `${row.employee_id}|${date}`;
		const punch = {
			employee_code: String(row.employee_id),
			log_date: String(row.log_date),
			direction: row.direction,
		};
		const group = groups.get(key);
		if (group) group.push(punch);
		else groups.set(key, [punch]);
	}

	const punchDays: AttendancePunchDays = {};
	for (const [key, dayPunches] of groups) {
		const [empId, date] = key.split('|');
		const times = deriveDayTimes(dayPunches);
		if (times.in_time == null && times.out_time == null) continue;
		if (!punchDays[empId]) punchDays[empId] = {};
		punchDays[empId][date] = {
			...times,
			overtime_hours: deriveOvertime(times.in_time, times.out_time),
		};
	}
	return punchDays;
}

interface AttendanceRecordPunchSource {
	readonly status?: unknown;
	readonly in_time?: string | null;
	readonly out_time?: string | null;
	readonly overtime_hours?: unknown;
}

type AttendanceRecordPunchOverlay<T extends AttendanceRecordPunchSource> = Omit<
	T,
	'in_time' | 'out_time' | 'overtime_hours'
> & {
	in_time: string | null;
	out_time: string | null;
	overtime_hours: number | T['overtime_hours'];
};

/** Device times win, while an authored Half Day keeps its stored overtime. */
export function overlayAttendanceRecordPunch<
	T extends AttendanceRecordPunchSource,
>(
	record: T,
	punch?: AttendancePunchDay | null
): T | AttendanceRecordPunchOverlay<T> {
	if (!punch) return record;
	return {
		...record,
		in_time: punch.in_time,
		out_time: punch.out_time,
		overtime_hours:
			String(record.status || '').toUpperCase() === 'HD'
				? record.overtime_hours
				: punch.overtime_hours,
	};
}
