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

import { isWeeklyOff } from './weekly-off';

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
 * Inclusive billable day count between two validated dates. In-range Weekly
 * Off days (shared isWeeklyOff rule) and Holidays in the set are excluded —
 * the ledger bills only working days. A half-day single-date range still
 * yields 0.5 unchanged.
 *
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD
 * @param {boolean} [halfDay]
 * @param {Set<string>} [holidays] active holiday YYYY-MM-DD set in range
 * @returns {number} billable day count (0.5 steps)
 */
export function computeDurationDays(
	startDate,
	endDate,
	halfDay = false,
	holidays: Set<string> = new Set()
) {
	const start = Date.parse(`${startDate}T00:00:00Z`);
	const end = Date.parse(`${endDate}T00:00:00Z`);
	const days = Math.round((end - start) / 86_400_000) + 1;
	if (days <= 0) return 0;
	if (halfDay && days === 1) return 0.5;
	let billable = 0;
	const cursor = new Date(`${startDate}T00:00:00Z`);
	const stop = new Date(`${endDate}T00:00:00Z`);
	while (cursor <= stop) {
		const date = cursor.toISOString().slice(0, 10);
		if (!isWeeklyOff(date) && !holidays.has(date)) billable += 1;
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return billable;
}

/**
 * Split an inclusive date range into per-year billable day counts so
 * multi-year approvals hit the right employee_leaves rows. Weekly Off and
 * Holiday days are excluded; years with zero billable days are omitted.
 *
 * @param {string} startDate
 * @param {string} endDate
 * @param {boolean} [halfDay]
 * @param {Set<string>} [holidays]
 * @returns {Array<{ year: number, days: number }>}
 */
export function splitDaysByYear(
	startDate,
	endDate,
	halfDay = false,
	holidays: Set<string> = new Set()
) {
	if (halfDay) return [{ year: Number(startDate.slice(0, 4)), days: 0.5 }];

	const start = new Date(`${startDate}T00:00:00Z`);
	const end = new Date(`${endDate}T00:00:00Z`);
	const perYear = new Map<number, number>();
	const cursor = new Date(start);

	while (cursor <= end) {
		const date = cursor.toISOString().slice(0, 10);
		if (!isWeeklyOff(date) && !holidays.has(date)) {
			const year = cursor.getUTCFullYear();
			perYear.set(year, (perYear.get(year) ?? 0) + 1);
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return [...perYear.entries()]
		.sort(([a], [b]) => a - b)
		.map(([year, days]) => ({ year, days }));
}

/**
 * Sandwich extras inside a single application range.
 *
 * In-range Weekly Off / Holiday days bracketed by billable working days on
 * both sides within the same application are Sandwich days (see ADR-0005).
 * Canonical: Fri leave + Sat WO + Sun WO + Mon leave in one Fri-to-Mon
 * application means Sat/Sun are extras. Single-sided adjacency (leave ending
 * Friday with a free weekend, or starting Monday) yields no extras; half-day
 * single-date flow is untouched.
 *
 * Pure calendar derivation — the server re-derives this on create and review
 * so the client warning stays bypassable by design. Cross-application
 * bracketing (separate Sat + Mon rows) is enforced at attendance-save time
 * via src/utils/sandwich.ts, not here.
 *
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @param {boolean} [halfDay]
 * @param {Set<string>} [holidays] active holiday YYYY-MM-DD set in range
 * @returns {string[]} sandwich YYYY-MM-DD dates in ascending order
 */
export function deriveSandwichDatesInRange(
	startDate,
	endDate,
	halfDay = false,
	holidays = new Set()
) {
	if (halfDay) return [];
	const start = new Date(`${startDate}T00:00:00Z`);
	const end = new Date(`${endDate}T00:00:00Z`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
	if (end < start) return [];
	const dates: string[] = [];
	const isOff: boolean[] = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		const date = cursor.toISOString().slice(0, 10);
		dates.push(date);
		isOff.push(isWeeklyOff(date) || holidays.has(date));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	let firstBillable = -1;
	let lastBillable = -1;
	let billableCount = 0;
	for (let i = 0; i < dates.length; i++) {
		if (!isOff[i]) {
			if (firstBillable === -1) firstBillable = i;
			lastBillable = i;
			billableCount += 1;
		}
	}
	if (billableCount < 2) return [];
	const sandwich: string[] = [];
	for (let i = firstBillable + 1; i < lastBillable; i++) {
		if (isOff[i]) sandwich.push(dates[i]);
	}
	return sandwich;
}
/**
 * Coerce the client-acknowledged Sandwich count to a non-negative integer.
 * Missing/blank means 0 (no extras acknowledged). Returns null when the
 * value is present but not a valid count so routes can reject it.
 *
 * Accepts the canonical `sandwich_acknowledged_days` field and the
 * `acknowledged_sandwich_days` alias.
 *
 * @param {unknown} body parsed request body
 * @returns {number|null} acknowledged count, or null when malformed
 */
export function parseSandwichAcknowledgedDays(body) {
	if (!body || typeof body !== 'object') return 0;
	const raw =
		body.sandwich_acknowledged_days ?? body.acknowledged_sandwich_days;
	if (raw === undefined || raw === null || raw === '') return 0;
	const days = Number(raw);
	if (!Number.isInteger(days) || days < 0) return null;
	return days;
}

/**
 * Active holidays in range — same set the timesheet report uses
 * (holiday_master.date where is_active = 1). Missing table → empty set,
 * so every non-weekly-off day counts as working.
 *
 * @param {{ execute: Function }} db pool or transaction connection
 */
export async function getActiveHolidaysInRange(db, startDate, endDate) {
	const holidays = new Set<string>();
	try {
		const [holidayRows] = await db.execute(
			`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date FROM holiday_master
       WHERE is_active = 1 AND date BETWEEN ? AND ?`,
			[startDate, endDate]
		);
		for (const row of holidayRows) {
			holidays.add(String(row.date).slice(0, 10));
		}
	} catch {
		/* holiday_master missing — treat every non-weekly-off day as working */
	}
	return holidays;
}

function attendanceMarker(applicationId) {
	return `Leave #${applicationId}`;
}

/**
 * Apply an approved leave:
 *  - writes employee_attendance rows for each working day in range plus
 *    Sandwich extras (in-range WO/H bracketed by leave on both sides)
 *    in the same leave type, overflowing to unpaid leave when the balance
 *    is short (existing presence rows P/HD/OT are never overwritten;
 *    sandwich extras may overwrite WO/H and restore them on revert)
 *  - increments used_leaves per year for types that draw quota (capped at
 *    the remaining balance; the excess is written as unpaid attendance)
 *
 * Returns the versioned audit payload stored on
 * leave_applications.written_attendance. Version 2 adds the Sandwich
 * extension; version 1 rows (no version/sandwich keys) still revert via
 * the shared attendance/balances arrays.
 *
 * @param {import('mysql2/promise').PoolConnection} db transaction connection
 * @param {{ id: number, user_id: number, employee_id: number, leave_type_id: number,
 *           start_date: string, end_date: string, half_day: number,
 *           is_paid: number, code: string }} application joined application row
 * @param {number} reviewerId
 * @returns {Promise<{ version: number,
 *                     attendance: Array<{date: string, prev_status: string|null}>,
 *                     balances: Array<{leave_type_id: number, year: number, days: number}>,
 *                     sandwich: { dates: string[], overflowDates: string[],
 *                                 overflowLeaveTypeId: number|null,
 *                                 overflowCode: string|null } }>}
 */
export async function applyApprovedLeave(db, application, reviewerId) {
	const { id, employee_id } = application;
	const startDate = application.start_date.slice(0, 10);
	const endDate = application.end_date.slice(0, 10);
	const marker = attendanceMarker(id);

	// Existing rows in range — never clobber real punches.
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

	// Official holidays inside the range — shared helper, same set POST uses.
	const holidays = await getActiveHolidaysInRange(db, startDate, endDate);

	// Half-day payroll semantics (payroll-calculator.js):
	//   'HD' costs 0.5 payable days → correct for unpaid half-days.
	//   Paid type codes count as full present days → used for paid half-days
	//   (no salary impact; only the 0.5 balance deduction applies).
	const singleDay = startDate === endDate;
	const isHalfDaySingle = Boolean(application.half_day) && singleDay;
	const status = isHalfDaySingle
		? application.is_paid
			? application.code
			: 'HD'
		: application.code;

	// Billable working dates plus Sandwich extras re-derived server-side.
	const billableDates: string[] = [];
	{
		const cursor = new Date(`${startDate}T00:00:00Z`);
		const end = new Date(`${endDate}T00:00:00Z`);
		if (isHalfDaySingle) {
			billableDates.push(startDate);
		} else {
			while (cursor <= end) {
				const date = cursor.toISOString().slice(0, 10);
				if (!isWeeklyOff(date) && !holidays.has(date)) billableDates.push(date);
				cursor.setUTCDate(cursor.getUTCDate() + 1);
			}
		}
	}
	const sandwichDates: string[] = deriveSandwichDatesInRange(
		startDate,
		endDate,
		Boolean(application.half_day),
		holidays
	);

	// Per-year totals (billable + sandwich) drive the capped ledger.
	const billableByYear = new Map<number, number>();
	if (isHalfDaySingle) {
		billableByYear.set(Number(startDate.slice(0, 4)), 0.5);
	} else {
		for (const segment of splitDaysByYear(
			startDate,
			endDate,
			Boolean(application.half_day),
			holidays
		)) {
			billableByYear.set(segment.year, segment.days);
		}
	}
	const sandwichByYear = new Map<number, number>();
	for (const date of sandwichDates) {
		const year = Number(date.slice(0, 4));
		sandwichByYear.set(year, (sandwichByYear.get(year) ?? 0) + 1);
	}
	const years = [
		...new Set([...billableByYear.keys(), ...sandwichByYear.keys()]),
	].sort((a, b) => a - b);

	// Remaining balance per year for the applied type (quota fallback mirrors
	// the balances reader when no employee_leaves row exists yet).
	const quota = Number(application.default_annual_quota ?? 0);
	const paidByYear = new Map<number, number>();
	const overflowByYear = new Map<number, number>();
	if (application.requires_balance) {
		for (const year of years) {
			const total =
				(billableByYear.get(year) ?? 0) + (sandwichByYear.get(year) ?? 0);
			let remaining = quota;
			try {
				const [rows] = await db.execute(
					`SELECT total_leaves, used_leaves FROM employee_leaves
           WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
					[employee_id, application.leave_type_id, year]
				);
				const row = rows?.[0];
				if (
					row &&
					row.total_leaves !== undefined &&
					row.used_leaves !== undefined
				) {
					remaining = Number(row.total_leaves) - Number(row.used_leaves);
				}
			} catch {
				remaining = quota;
			}
			if (!Number.isFinite(remaining)) remaining = quota;
			const paid = Math.min(total, Math.max(0, remaining));
			// Half-day steps stay exact in binary; full days are integers.
			const roundedPaid = Math.round(paid * 2) / 2;
			paidByYear.set(year, roundedPaid);
			overflowByYear.set(year, Math.round((total - roundedPaid) * 2) / 2);
		}
	} else {
		for (const year of years) {
			paidByYear.set(
				year,
				(billableByYear.get(year) ?? 0) + (sandwichByYear.get(year) ?? 0)
			);
			overflowByYear.set(year, 0);
		}
	}

	// Unpaid overflow target (UL preferred, LWP fallback) only when needed.
	let overflowLeaveTypeId: number | null = null;
	let overflowCode: string | null = null;
	const needsOverflow = [...overflowByYear.values()].some((days) => days > 0);
	if (needsOverflow && application.requires_balance && !isHalfDaySingle) {
		try {
			const [rows] = await db.execute(
				`SELECT id, code FROM leave_types
         WHERE code IN ('UL', 'LWP') AND isDelete = 0
         ORDER BY CASE WHEN code = 'UL' THEN 0 ELSE 1 END LIMIT 1`
			);
			const row = rows?.[0];
			if (row?.id && row?.code) {
				overflowLeaveTypeId = Number(row.id);
				overflowCode = String(row.code);
			}
		} catch {
			overflowLeaveTypeId = null;
			overflowCode = null;
		}
		// No unpaid type configured — keep the applied code so the ledger
		// stays explainable rather than writing an unknown status.
		if (!overflowCode) {
			for (const year of years) {
				const total =
					(billableByYear.get(year) ?? 0) + (sandwichByYear.get(year) ?? 0);
				paidByYear.set(year, total);
				overflowByYear.set(year, 0);
			}
		}
	}

	// Chronological paid-first assignment per year: the earliest deduction
	// dates consume the remaining balance; the tail overflows to unpaid.
	// Half-day overflow uses HD (the unpaid half-day marker).
	const paidStatusByDate = new Map<string, boolean>();
	if (!application.requires_balance || !needsOverflow) {
		for (const date of [...billableDates, ...sandwichDates])
			paidStatusByDate.set(date, true);
	} else if (isHalfDaySingle) {
		const year = Number(startDate.slice(0, 4));
		paidStatusByDate.set(startDate, (paidByYear.get(year) ?? 0) >= 0.5);
	} else {
		for (const year of years) {
			const yearDates = [...billableDates, ...sandwichDates]
				.filter((date) => Number(date.slice(0, 4)) === year)
				.sort();
			let paidLeft = paidByYear.get(year) ?? 0;
			for (const date of yearDates) {
				if (paidLeft >= 1) {
					paidStatusByDate.set(date, true);
					paidLeft -= 1;
				} else {
					paidStatusByDate.set(date, false);
				}
			}
		}
	}

	const appliedAttendance: Array<{ date: string; prev_status: string | null }> =
		[];
	const writeDate = async (date: string, isSandwich: boolean) => {
		const prevStatus = existing.get(date) ?? null;
		const normalizedPrev =
			prevStatus === null || prevStatus === undefined
				? null
				: String(prevStatus);
		// Billable days never overwrite P/HD/OT/WO/H (legacy guard).
		// Sandwich extras may overwrite WO/H (the converted record) but
		// still never clobber real punches P/HD/OT.
		const protectedStatus = isSandwich
			? prevStatus === 'P' || prevStatus === 'HD' || prevStatus === 'OT'
			: prevStatus === 'P' ||
				prevStatus === 'HD' ||
				prevStatus === 'OT' ||
				prevStatus === 'WO' ||
				prevStatus === 'H';
		if (protectedStatus) return;
		const isPaid = paidStatusByDate.get(date) !== false;
		let writeStatus = status;
		if (!isPaid) {
			if (isHalfDaySingle) writeStatus = 'HD';
			else if (overflowCode) writeStatus = overflowCode;
		}
		const upsert = isSandwich
			? `INSERT INTO employee_attendance
           (employee_id, attendance_date, status, approved_by, approved_at, remarks)
         VALUES (?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           status = IF(status IN ('P', 'HD', 'OT'), status, VALUES(status)),
           approved_by = VALUES(approved_by),
           approved_at = NOW(),
           remarks = VALUES(remarks)`
			: `INSERT INTO employee_attendance
           (employee_id, attendance_date, status, approved_by, approved_at, remarks)
         VALUES (?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           status = IF(status IN ('WO', 'H'), status, VALUES(status)),
           approved_by = VALUES(approved_by),
           approved_at = NOW(),
           remarks = VALUES(remarks)`;
		await db.execute(upsert, [
			employee_id,
			date,
			writeStatus,
			reviewerId,
			marker,
		]);
		appliedAttendance.push({ date, prev_status: normalizedPrev });
	};
	for (const date of [...billableDates].sort()) await writeDate(date, false);
	for (const date of [...sandwichDates].sort()) await writeDate(date, true);
	appliedAttendance.sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : 0
	);

	// Balance ledger — capped paid portion only for types that draw quota.
	const balancesApplied: Array<{
		leave_type_id: number;
		year: number;
		days: number;
	}> = [];
	if (application.requires_balance) {
		for (const year of years) {
			const paid = paidByYear.get(year) ?? 0;
			if (paid <= 0) continue;
			await db.execute(
				`INSERT INTO employee_leaves (employee_id, leave_type_id, year, total_leaves, used_leaves)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE used_leaves = used_leaves + VALUES(used_leaves)`,
				[
					employee_id,
					application.leave_type_id,
					year,
					application.default_annual_quota ?? 0,
					paid,
				]
			);
			balancesApplied.push({
				leave_type_id: application.leave_type_id,
				year,
				days: paid,
			});
		}
	}

	const overflowDates = [...billableDates, ...sandwichDates]
		.filter((date) => paidStatusByDate.get(date) === false)
		.sort();
	return {
		version: 2,
		attendance: appliedAttendance,
		balances: balancesApplied,
		sandwich: {
			dates: [...sandwichDates].sort(),
			overflowDates,
			overflowLeaveTypeId,
			overflowCode,
		},
	};
}

/**
 * Reverse a previously-applied approval (rejection of an approved request,
 * withdrawal of an approved request, or deletion) using the versioned audit
 * payload persisted in written_attendance. Restores overwritten statuses
 * (including Sandwich-converted WO/H cells to their exact prev_status),
 * deletes rows this feature created, and decrements used_leaves (never
 * below zero). Version 1 audits (no version/sandwich keys) and version 2
 * Sandwich audits share the same attendance/balances arrays, so one path
 * restores both exactly.
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
