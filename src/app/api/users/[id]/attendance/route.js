import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { computeAttendanceSummary } from '@/lib/attendance-summary';
import {
	buildAttendancePunchDays,
	overlayAttendanceRecordPunch,
} from '@/lib/attendance-record-punches';

/**
 * GET /api/users/[id]/attendance
 * Fetch the linked Employee's current-month attendance and the user's CRM access.
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

		const attendanceData = {
			idleTime: 0,
			loginTime: null,
			logoutTime: null,
			accessStatus: 'error',
			accessDate: null,
			currentMonth: null,
			daysInMonth: null,
			daysPresent: null,
			overtimeHours: null,
			leaves: null,
		};

		try {
			// The LEFT JOIN preserves the DB calendar metadata for an unlinked
			// user. Employment data needs a linked Employee that was not deleted.
			const [employeeRows] = await db.execute(
				`SELECT
          e.id AS employee_id,
          DATE_FORMAT(CURDATE(), '%Y-%m-01') AS month_start,
          DATE_FORMAT(LAST_DAY(CURDATE()) + INTERVAL 1 DAY, '%Y-%m-%d') AS next_month_start,
          DAY(LAST_DAY(CURDATE())) AS days_in_month,
          DATE_FORMAT(CURDATE(), '%M %Y') AS current_month,
          YEAR(CURDATE()) AS current_year
        FROM users u
        LEFT JOIN employees e
          ON e.id = u.employee_id
          AND e.isDelete = 0
        WHERE u.id = ? AND u.isDelete = 0`,
				[requestedUserId]
			);
			const employeeContext = employeeRows?.[0] ?? null;

			if (employeeContext) {
				attendanceData.currentMonth = employeeContext.current_month ?? null;
				attendanceData.daysInMonth =
					employeeContext.days_in_month == null
						? null
						: Number(employeeContext.days_in_month);

				const employeeId = employeeContext.employee_id;
				if (employeeId != null) {
					const rangeParams = [
						employeeId,
						employeeContext.month_start,
						employeeContext.next_month_start,
					];

					try {
						const [records] = await db.execute(
							`SELECT
                DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
                status,
                in_time,
                out_time,
                overtime_hours
              FROM employee_attendance
              WHERE employee_id = ?
                AND attendance_date >= ?
                AND attendance_date < ?`,
							rangeParams
						);
						const [punchRows] = await db.execute(
							`SELECT employee_id, log_date, direction
              FROM attendance_logs
              WHERE employee_id = ?
                AND log_date >= ?
                AND log_date < ?
              ORDER BY log_date`,
							rangeParams
						);
						const punchDays = buildAttendancePunchDays(punchRows);
						const employeePunchDays = punchDays[String(employeeId)] ?? {};
						const summary = computeAttendanceSummary(
							Object.fromEntries(
								records.map((record) => {
									const date = String(record.attendance_date).slice(0, 10);
									return [
										date,
										overlayAttendanceRecordPunch(
											record,
											employeePunchDays[date]
										),
									];
								})
							)
						);

						attendanceData.daysPresent = summary.P;
						attendanceData.overtimeHours = summary.totalOTHours;
					} catch (attendanceError) {
						// Unavailable employment data must not become activity-based
						// presence or a misleading zero.
						console.error(
							'Employee attendance fetch skipped:',
							attendanceError
						);
					}

					try {
						const [leaveRows] = await db.execute(
							`SELECT
                COALESCE(SUM(total_leaves), 24) AS total_leaves,
                COALESCE(SUM(used_leaves), 0) AS used_leaves
              FROM employee_leaves
              WHERE employee_id = ? AND year = ?`,
							[employeeId, employeeContext.current_year]
						);
						const leaveData = leaveRows?.[0];
						const total = Number(leaveData?.total_leaves ?? 24);
						const used = Number(leaveData?.used_leaves ?? 0);
						attendanceData.leaves = { total, used, balance: total - used };
					} catch (leaveError) {
						console.error('Employee leave fetch skipped:', leaveError);
					}
				}
			}
		} catch (employeeError) {
			console.error('Employee link fetch skipped:', employeeError);
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

		// CRM idle time is independent of employment and attendance availability.
		try {
			const [screenTime] = await db.execute(
				`SELECT idle_time_minutes FROM user_screen_time WHERE user_id = ? AND date = CURDATE() LIMIT 1`,
				[requestedUserId]
			);
			if (screenTime.length > 0) {
				attendanceData.idleTime = screenTime[0].idle_time_minutes || 0;
			}
		} catch (screenTimeError) {
			console.log('Screen time fetch skipped:', screenTimeError.message);
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
