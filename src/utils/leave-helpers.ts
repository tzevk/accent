/**
 * Leave system server helpers.
 *
 * Shared by /api/leaves routes. The approval side-effects keep three systems
 * in sync (see migrations/20260825120000_create_leave_system.js):
 *
 *  1. leave_applications            — status + written_attendance audit JSON
 *  2. employee_attendance           — per-date status codes (PL/CL/SL/EL paid,
 *                                     UL/LWP unpaid, HD half-day) consumed by
 *                                     src/utils/payroll-calculator.js
 *  3. employee_leaves               — per-year balance ledger read by
 *                                     src/app/api/users/[id]/attendance/route.js
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Max calendar span for a single application. */
export const MAX_LEAVE_RANGE_DAYS = 365;

/**
 * Validate a YYYY-MM-DD string and return it, or null when invalid.
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseDateInput(value) {
	if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return null;
	// Guard against e.g. 2026-02-31 normalising into March
	return date.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * Inclusive day count between two validated dates. A half-day is only
 * meaningful for a single-date range and yields 0.5.
 *
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD
 * @param {boolean} [halfDay]
 * @returns {number} positive day count (0.5 steps)
 */
export function computeDurationDays(startDate, endDate, halfDay = false) {
	const start = Date.parse(`${startDate}T00:00:00Z`);
	const end = Date.parse(`${endDate}T00:00:00Z`);
	const days = Math.round((end - start) / 86_400_000) + 1;
	if (days <= 0) return 0;
	return halfDay && days === 1 ? 0.5 : days;
}

/**
 * Split an inclusive date range into per-year calendar day counts so
 * multi-year approvals hit the right employee_leaves rows.
 *
 * @param {string} startDate
 * @param {string} endDate
 * @param {boolean} [halfDay]
 * @returns {Array<{ year: number, days: number }>}
 */
export function splitDaysByYear(startDate, endDate, halfDay = false) {
	if (halfDay) return [{ year: Number(startDate.slice(0, 4)), days: 0.5 }];

	const start = new Date(`${startDate}T00:00:00Z`);
	const end = new Date(`${endDate}T00:00:00Z`);
	const segments: Array<{ year: number; days: number }> = [];
	let cursor = new Date(start);

	while (cursor <= end) {
		const year = cursor.getUTCFullYear();
		const yearEnd = Date.UTC(year, 11, 31);
		const segmentEnd = end.getTime() < yearEnd ? end : new Date(yearEnd);
		const days =
			Math.round((segmentEnd.getTime() - cursor.getTime()) / 86_400_000) + 1;
		segments.push({ year, days });
		cursor = new Date(Date.UTC(year + 1, 0, 1));
	}
	return segments;
}

function attendanceMarker(applicationId) {
	return `Leave #${applicationId}`;
}

/**
 * Apply an approved leave:
 *  - writes employee_attendance rows for each working day in range
 *    (existing presence rows P/HD/OT/WO/H are never overwritten)
 *  - increments used_leaves per year for types that draw quota
 *
 * Returns the audit payload stored on leave_applications.written_attendance.
 *
 * @param {import('mysql2/promise').PoolConnection} db transaction connection
 * @param {{ id: number, user_id: number, employee_id: number, leave_type_id: number,
 *           start_date: string, end_date: string, half_day: number,
 *           is_paid: number, code: string }} application joined application row
 * @param {number} reviewerId
 * @returns {Promise<{ attendance: Array<{date: string, prev_status: string|null}>,
 *                     balances: Array<{leave_type_id: number, year: number, days: number}> }>}
 */
export async function applyApprovedLeave(db, application, reviewerId) {
	const { id, employee_id } = application;
	const startDate = application.start_date.slice(0, 10);
	const endDate = application.end_date.slice(0, 10);
	const marker = attendanceMarker(id);

	// Existing rows in range — never clobber real punches / weekly offs / holidays.
	const [existingRows] = await db.execute(
		`SELECT attendance_date, status FROM employee_attendance
     WHERE employee_id = ? AND attendance_date BETWEEN ? AND ?`,
		[employee_id, startDate, endDate]
	);
	const existing = new Map(
		existingRows.map((row) => [
			String(row.attendance_date).slice(0, 10),
			row.status,
		])
	);

	// Official holidays inside the range (best effort — table always exists in prod).
	const holidays = new Set<string>();
	try {
		const [holidayRows] = await db.execute(
			`SELECT holiday_date FROM holiday_master
       WHERE holiday_date BETWEEN ? AND ?`,
			[startDate, endDate]
		);
		for (const row of holidayRows) {
			holidays.add(String(row.holiday_date).slice(0, 10));
		}
	} catch (_) {
		/* holiday_master missing — treat every non-Sunday as a working day */
	}

	// Half-day payroll semantics (payroll-calculator.js):
	//   'HD' costs 0.5 payable days → correct for unpaid half-days.
	//   Paid type codes count as full present days → used for paid half-days
	//   (no salary impact; only the 0.5 balance deduction applies).
	const singleDay = startDate === endDate;
	const status =
		application.half_day && singleDay
			? application.is_paid
				? application.code
				: 'HD'
			: application.code;

	const appliedAttendance: Array<{
		date: string;
		prev_status: string | null;
	}> = [];
	const cursor = new Date(`${startDate}T00:00:00Z`);
	const end = new Date(`${endDate}T00:00:00Z`);

	while (cursor <= end) {
		const date = cursor.toISOString().slice(0, 10);

		if (cursor.getUTCDay() !== 0 && !holidays.has(date)) {
			const prevStatus = existing.get(date) ?? null;
			const normalizedPrev =
				prevStatus === null || prevStatus === undefined
					? null
					: String(prevStatus);
			const protectedStatus =
				prevStatus === 'P' ||
				prevStatus === 'HD' ||
				prevStatus === 'OT' ||
				prevStatus === 'WO' ||
				prevStatus === 'H';

			if (!protectedStatus) {
				await db.execute(
					`INSERT INTO employee_attendance
           (employee_id, attendance_date, status, approved_by, approved_at, remarks)
         VALUES (?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           status = IF(status IN ('WO', 'H'), status, VALUES(status)),
           approved_by = VALUES(approved_by),
           approved_at = NOW(),
           remarks = VALUES(remarks)`,
					[employee_id, date, status, reviewerId, marker]
				);
				appliedAttendance.push({ date, prev_status: normalizedPrev });
			}
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	// Balance ledger — only for types that consume quota.
	const balancesApplied: Array<{
		leave_type_id: number;
		year: number;
		days: number;
	}> = [];
	if (application.requires_balance) {
		for (const segment of splitDaysByYear(
			startDate,
			endDate,
			Boolean(application.half_day)
		)) {
			await db.execute(
				`INSERT INTO employee_leaves (employee_id, leave_type_id, year, total_leaves, used_leaves)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE used_leaves = used_leaves + VALUES(used_leaves)`,
				[
					employee_id,
					application.leave_type_id,
					segment.year,
					application.default_annual_quota ?? 0,
					segment.days,
				]
			);
			balancesApplied.push({
				leave_type_id: application.leave_type_id,
				year: segment.year,
				days: segment.days,
			});
		}
	}

	return { attendance: appliedAttendance, balances: balancesApplied };
}

/**
 * Reverse a previously-applied approval (rejection of an approved request or
 * deletion) using the audit payload persisted in written_attendance.
 * Restores overwritten statuses, deletes rows this feature created, and
 * decrements used_leaves (never below zero).
 *
 * @param {import('mysql2/promise').PoolConnection} db transaction connection
 * @param {{ id: number, employee_id: number,
 *           written_attendance: string|null }} application
 */
export async function revertApprovedLeave(db, application) {
	if (!application.written_attendance) return;

	let audit;
	try {
		audit = JSON.parse(application.written_attendance);
	} catch (_) {
		return; // corrupt/no audit data — nothing safe to undo
	}
	if (!audit || typeof audit !== 'object') return;

	const { id, employee_id } = application;
	const marker = attendanceMarker(id);

	for (const entry of audit.attendance || []) {
		if (!entry?.date) continue;
		if (entry.prev_status === null || entry.prev_status === undefined) {
			// Row was created by us — remove it only if still carrying our marker.
			await db.execute(
				`DELETE FROM employee_attendance
       WHERE employee_id = ? AND attendance_date = ?
         AND remarks = ?
         AND status IN ('PL','CL','SL','EL','UL','LWP','HD')`,
				[employee_id, entry.date, marker]
			);
		} else {
			await db.execute(
				`UPDATE employee_attendance
       SET status = ?, approved_by = NULL, approved_at = NULL, remarks = NULL
       WHERE employee_id = ? AND attendance_date = ? AND remarks = ?`,
				[entry.prev_status, employee_id, entry.date, marker]
			);
		}
	}

	for (const segment of audit.balances || []) {
		if (!segment?.year || !segment.leave_type_id) continue;
		await db.execute(
			`UPDATE employee_leaves
     SET used_leaves = GREATEST(0, used_leaves - ?)
     WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
			[segment.days, employee_id, segment.leave_type_id, segment.year]
		);
	}
}
