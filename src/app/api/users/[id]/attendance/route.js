import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { isWeeklyOff } from '@/utils/weekly-off';
import { hasColumn } from '@/utils/schema-cache';
import { computeDayPunchSpan } from '@/lib/time-present';
import {
	summarizeWorkSessions,
	unavailableWorkSessionSummary,
} from '@/lib/work-session-summary';
import { linkedEmployeeId } from '@/app/api/me/_lib/session-employee';

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' shifted by whole days, in UTC so the padding never shifts. */
function addDays(day, delta) {
	return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

/**
 * GET /api/users/[id]/attendance
 * Fetch attendance data for a user including in/out time, leaves, etc.
 */
export async function GET(request, { params }) {
	let db;
	try {
		const { id } = await params;
		const requestedUserId = parseInt(id);

		const currentUser = await getCurrentUser(request);

		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Users can view their own attendance
		const isOwnData = requestedUserId === currentUser.id;
		if (!isOwnData && !currentUser.is_super_admin) {
			return NextResponse.json(
				{
					success: false,
					error: 'Forbidden',
				},
				{ status: 403 }
			);
		}

		db = await dbConnect();

		const now = new Date();
		const currentMonth = now.getMonth() + 1;
		const currentYear = now.getFullYear();
		const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

		// Try to get attendance data from attendance table if it exists
		let attendanceData = {
			inTime: null,
			outTime: null,
			idleTime: 0,
			sessionStartTime: null,
			sessionEndTime: null,
			sessionEndSource: null,
			sessionElapsedMinutes: null,
			sessionAsOf: null,
			sessionActive: false,
			sessionTimeInvalid: false,
			punchInTime: null,
			punchOutTime: null,
			punchCount: 0,
			punchComputable: false,
			punchEmployeeId: null,
			currentMonth: now.toLocaleString('default', {
				month: 'long',
				year: 'numeric',
			}),
			daysInMonth: daysInMonth,
			daysPresent: 0,
			weeklyOff: 0,
			holidays: 0,
			overtimeHours: 0,
			leaves: {
				total: 21, // Default annual leave
				used: 0,
				balance: 21,
			},
		};

		try {
			// Check if attendance table exists and get today's record
			const [todayAttendance] = await db.execute(
				`
        SELECT in_time, out_time 
        FROM attendance 
        WHERE user_id = ? AND DATE(date) = CURDATE()
        LIMIT 1
      `,
				[requestedUserId]
			);

			if (todayAttendance.length > 0) {
				attendanceData.inTime = todayAttendance[0].in_time;
				attendanceData.outTime = todayAttendance[0].out_time;
			}

			// Get today's idle time from user_screen_time
			try {
				const [screenTime] = await db.execute(
					`SELECT idle_time_minutes FROM user_screen_time WHERE user_id = ? AND date = CURDATE() LIMIT 1`,
					[requestedUserId]
				);
				if (screenTime.length > 0) {
					attendanceData.idleTime = screenTime[0].idle_time_minutes || 0;
				}
			} catch (stErr) {
				console.log('Screen time fetch skipped:', stErr.message);
			}

			// Get monthly attendance summary
			const [monthlyAttendance] = await db.execute(
				`
        SELECT 
          COUNT(DISTINCT DATE(date)) as days_present,
          COUNT(DISTINCT CASE WHEN status = 'weekly_off' THEN DATE(date) END) as weekly_off,
          COUNT(DISTINCT CASE WHEN status = 'holiday' THEN DATE(date) END) as holidays
        FROM attendance 
        WHERE user_id = ? 
        AND MONTH(date) = ? 
        AND YEAR(date) = ?
      `,
				[requestedUserId, currentMonth, currentYear]
			);

			if (monthlyAttendance.length > 0) {
				attendanceData.daysPresent = monthlyAttendance[0].days_present || 0;
				attendanceData.weeklyOff = monthlyAttendance[0].weekly_off || 0;
				attendanceData.holidays = monthlyAttendance[0].holidays || 0;
			}

			// Calculate overtime hours for the month
			// Overtime = total hours worked beyond 8h per day, summed across all days
			try {
				const [overtimeRows] = await db.execute(
					`
          SELECT 
            COALESCE(SUM(
              GREATEST(
                TIMESTAMPDIFF(MINUTE, in_time, out_time) / 60.0 - 8,
                0
              )
            ), 0) as overtime_hours
          FROM attendance 
          WHERE user_id = ? 
          AND MONTH(date) = ? 
          AND YEAR(date) = ?
          AND in_time IS NOT NULL 
          AND out_time IS NOT NULL
        `,
					[requestedUserId, currentMonth, currentYear]
				);

				if (overtimeRows.length > 0) {
					attendanceData.overtimeHours =
						Math.round((parseFloat(overtimeRows[0].overtime_hours) || 0) * 10) /
						10;
				}
			} catch (otErr) {
				console.log('Overtime calculation skipped:', otErr.message);
			}
		} catch {
			// Attendance table might not exist, use activity logs to estimate
			console.log('Attendance table not found, using activity logs');

			try {
				// Check if user_activity_logs table exists
				const [tables] = await db.execute(
					`SHOW TABLES LIKE 'user_activity_logs'`
				);

				if (tables.length > 0) {
					// Count distinct days with activity as proxy for presence
					const [activityDays] = await db.execute(
						`
            SELECT COUNT(DISTINCT DATE(created_at)) as days_active
            FROM user_activity_logs 
            WHERE user_id = ? 
            AND MONTH(created_at) = ? 
            AND YEAR(created_at) = ?
          `,
						[requestedUserId, currentMonth, currentYear]
					);

					if (activityDays.length > 0) {
						attendanceData.daysPresent = activityDays[0].days_active || 0;
					}
				}
			} catch (logError) {
				console.log('Activity logs table also not found:', logError.message);
			}

			// Weekly offs via the shared company rule (Sundays + 2nd/4th Saturdays).
			let weeklyOff = 0;
			for (let d = 1; d <= daysInMonth; d++) {
				const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
				if (isWeeklyOff(dateStr)) weeklyOff++;
			}
			attendanceData.weeklyOff = weeklyOff;
		}

		// The day's Work Sessions: observed browser spans, read as SQL epochs
		// with SQL-formatted HH:MM labels in the database timezone. The host
		// never parses dates here, and the summary never trusts stored
		// `duration_minutes`. `end_source` says how an end was recorded: a
		// real logout, the page-close beacon, or the sweep (ticket #331).
		// NULL is a row written before the column existed: a pre-existing
		// end, never an inferred one.
		try {
			const hasEndSource = await hasColumn(
				db,
				'user_work_sessions',
				'end_source'
			);
			const [sessionRows] = await db.execute(
				`SELECT
           UNIX_TIMESTAMP(session_start) * 1000 AS start_ms,
           UNIX_TIMESTAMP(session_end) * 1000 AS end_ms,
           DATE_FORMAT(session_start, '%H:%i') AS start_label,
           DATE_FORMAT(session_end, '%H:%i') AS end_label,
           ${hasEndSource ? 'end_source' : 'NULL AS end_source'},
           status,
           UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS as_of_ms
         FROM user_work_sessions
         WHERE user_id = ? AND DATE(session_start) = CURDATE()
           AND status IN ('active', 'ended')
         ORDER BY session_start ASC`,
				[requestedUserId]
			);
			// The snapshot clock rides each row; a day with no rows still
			// needs it from the database, never the host.
			let asOfRaw = sessionRows?.[0]?.as_of_ms ?? null;
			if ((sessionRows ?? []).length === 0) {
				try {
					const [clockRows] = await db.execute(
						`SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS as_of_ms`
					);
					asOfRaw = clockRows?.[0]?.as_of_ms ?? null;
				} catch {
					asOfRaw = null;
				}
			}
			const summary = summarizeWorkSessions(
				(sessionRows ?? []).map((row) => ({
					startMs: row.start_ms,
					endMs: row.end_ms,
					startLabel: row.start_label,
					endLabel: row.end_label,
					endSource: row.end_source,
					status: row.status,
				})),
				asOfRaw
			);
			attendanceData.sessionStartTime = summary.sessionStartTime;
			attendanceData.sessionEndTime = summary.sessionEndTime;
			attendanceData.sessionEndSource = summary.sessionEndSource;
			attendanceData.sessionElapsedMinutes = summary.sessionElapsedMinutes;
			attendanceData.sessionAsOf = summary.sessionAsOf;
			attendanceData.sessionActive = summary.sessionActive;
			attendanceData.sessionTimeInvalid = summary.sessionTimeInvalid;
		} catch (sessionErr) {
			console.log('Work session fetch skipped:', sessionErr.message);
			const unavailable = unavailableWorkSessionSummary();
			attendanceData.sessionStartTime = unavailable.sessionStartTime;
			attendanceData.sessionEndTime = unavailable.sessionEndTime;
			attendanceData.sessionEndSource = unavailable.sessionEndSource;
			attendanceData.sessionElapsedMinutes = unavailable.sessionElapsedMinutes;
			attendanceData.sessionAsOf = unavailable.sessionAsOf;
			attendanceData.sessionActive = unavailable.sessionActive;
			attendanceData.sessionTimeInvalid = unavailable.sessionTimeInvalid;
		}

		// The day's Punches, for the Punch In and Punch Out tiles (ticket
		// #334): the device is the value, the session times the sub-line.
		try {
			// The linked Employee is resolved here, server-side, from the
			// account's own `users.employee_id` → `employees.id` link. No
			// client-side employee lookup exists, so the admin
			// live-monitoring view of another user's dashboard keeps working.
			const linkedId = await linkedEmployeeId(db, requestedUserId);
			const employeeId = linkedId != null ? Number(linkedId) : null;
			attendanceData.punchEmployeeId = employeeId;

			// One day of padding either side — the Attendance report's own rule:
			// the day before feeds the walk, and the day after lets a night
			// shift's first punch join within the shared 12-hour window.
			const [todayRow] = await db.execute(
				`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today`
			);
			const today = todayRow[0].today;
			let punchRows = [];
			if (employeeId != null) {
				const [rows] = await db.execute(
					`SELECT employee_code, log_date, employee_id
             FROM attendance_logs
             WHERE employee_id = ?
               AND log_date >= ? AND log_date < ?`,
					[
						employeeId,
						`${addDays(today, -1)} 00:00:00`,
						`${addDays(today, 2)} 00:00:00`,
					]
				);
				punchRows = rows;
			}

			// The shared rule the Attendance report reads by, over that window.
			const span = computeDayPunchSpan(punchRows, {
				date: today,
				employeeId,
			});
			attendanceData.punchCount = span.punchCount;
			attendanceData.punchComputable = span.computable;
			// Punch In is the day's First Punch wherever one exists — a lone
			// punch still proves the User was at the device — while Punch Out
			// needs the computable pair the shared rule measured. A lone punch
			// is never a zero-length span.
			attendanceData.punchInTime = span.firstPunch
				? span.firstPunch.log_date.slice(11, 16)
				: null;
			attendanceData.punchOutTime =
				span.computable && span.lastPunch
					? span.lastPunch.log_date.slice(11, 16)
					: null;
		} catch (punchErr) {
			console.log('Punch fetch skipped:', punchErr.message);
		}

		// Try to get leave data (still using same db connection)
		try {
			// First check if employee_leaves table exists
			const [leaveTable] = await db.execute(
				`SHOW TABLES LIKE 'employee_leaves'`
			);

			if (leaveTable.length > 0) {
				const [leaveData] = await db.execute(
					`
          SELECT 
            COALESCE(SUM(total_leaves), 24) as total_leaves,
            COALESCE(SUM(used_leaves), 0) as used_leaves
          FROM employee_leaves 
          WHERE employee_id = (SELECT employee_id FROM users WHERE id = ?)
          AND year = ?
        `,
					[requestedUserId, currentYear]
				);

				if (leaveData.length > 0 && leaveData[0].total_leaves) {
					attendanceData.leaves.total = leaveData[0].total_leaves;
					attendanceData.leaves.used = leaveData[0].used_leaves;
					attendanceData.leaves.balance =
						leaveData[0].total_leaves - leaveData[0].used_leaves;
				}
			}
		} catch (leaveError) {
			// Leave table might not exist, use defaults
			console.log('Leave table not found, using defaults:', leaveError.message);
		}

		const response = NextResponse.json({
			success: true,
			data: attendanceData,
		});

		// Cache for 30 seconds - attendance data updates infrequently
		response.headers.set(
			'Cache-Control',
			'private, max-age=30, stale-while-revalidate=60'
		);

		return response;
	} catch (error) {
		console.error('Error fetching attendance:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch attendance data',
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
