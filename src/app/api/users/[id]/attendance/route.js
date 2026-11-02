import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { isWeeklyOff } from '@/utils/weekly-off';

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
			loginTime: null,
			logoutTime: null,
			accessStatus: 'error',
			accessDate: null,
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

		// Today's app access, read from successful user_activity_logs rows in
		// the database's current calendar day. Log In is the earliest app
		// entry: real logins plus the initial authenticated app-entry
		// status_change — never a logout, heartbeat, or idle transition. Log
		// Out is the latest recorded contact of any kind, heartbeats and
		// explicit logout included. Both clocks are SQL-formatted HH:MM in
		// the database session timezone; the host never parses dates here.
		try {
			const [accessRows] = await db.execute(
				`SELECT
           DATE_FORMAT(MIN(CASE
             WHEN action_type = 'logout' THEN NULL
             WHEN resource_type = 'heartbeat' THEN NULL
             WHEN action_type = 'status_change' AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.status')) = 'idle' THEN NULL
             ELSE created_at
           END), '%H:%i') AS login_time,
           DATE_FORMAT(MAX(created_at), '%H:%i') AS logout_time,
           DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS access_date
         FROM user_activity_logs
         WHERE user_id = ?
           AND status = 'success'
           AND created_at >= CURDATE()
           AND created_at < CURDATE() + INTERVAL 1 DAY`,
				[requestedUserId]
			);
			const accessRow = accessRows?.[0] ?? null;
			attendanceData.loginTime = accessRow?.login_time ?? null;
			attendanceData.logoutTime = accessRow?.logout_time ?? null;
			attendanceData.accessDate = accessRow?.access_date ?? null;
			attendanceData.accessStatus = accessRows?.length ? 'ok' : 'error';
		} catch (accessErr) {
			console.log('App access fetch skipped:', accessErr.message);
			attendanceData.loginTime = null;
			attendanceData.logoutTime = null;
			attendanceData.accessDate = null;
			attendanceData.accessStatus = 'error';
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
