/**
 * Payroll Calculator Utility
 * ---------------------------
 * Uses frozen PAYROLL_CONFIG to calculate all salary components
 * Integrates with core payroll tables:
 *  - payroll_schedules (Component Rates, incl. DA)
 *  - employee_salary_profile
 *  - payroll_slips
 *  - employee_attendance (for monthly calculations)
 *  - holiday_master (for official holidays)
 */

import PAYROLL_CONFIG from './payroll-config';
import { dbConnect } from './database';
import {
	calculatePayroll,
	normalizeSalaryProfile,
} from './payroll-calculation';
import { sumLoggedHoursForMonth } from '@/lib/logged-hours';
import { resolveLoggedHoursEmployeeId } from '@/lib/logged-hours-source';
import { loadPayrollRunRoster } from '@/lib/payroll-run-roster';
import {
	lockSalaryEmployees,
	recordSalaryAgreementUse,
} from '@/lib/salary-profile-store';
import {
	withPayrollRunWriteLock,
	salaryIssueOf,
	salaryIssueLabel,
	SALARY_ISSUE,
} from '@/app/api/payroll/_lib/payroll-run';

export { calculatePayroll, normalizeSalaryProfile };

const scheduleDate = (value) =>
	typeof value === 'string'
		? value.substring(0, 10)
		: value.toISOString().split('T')[0];

/**
 * @typedef {object} EffectivePayrollSchedule
 * @property {string} date
 * @property {Record<string, unknown>} components
 */

/**
 * Load the effective Component Rates (payroll_schedules) once per run.
 * All component rates — including DA — resolve from `payroll_schedules`
 * (Component Rates); there is no legacy DA-table fallback.
 * @param {Date|string} forDate - The month to price: a `YYYY-MM`/`YYYY-MM-DD`
 *   string or a Date, as `scheduleDate` accepts.
 * @param {object|null} existingDb - Caller's connection, passed through so a
 *   caller inside a transaction reads one snapshot.
 * @returns {Promise<EffectivePayrollSchedule>}
 */
export async function getEffectivePayrollSchedule(
	forDate = new Date(),
	existingDb = null
) {
	const date = scheduleDate(forDate);
	const db = existingDb || (await dbConnect());
	const ownsConnection = !existingDb;
	const components = {};

	try {
		try {
			const [rows] = await db.execute(
				`SELECT component_type, value_type, value, min_salary, max_salary, id
         FROM payroll_schedules
         WHERE is_active = 1
           AND effective_from <= ?
           AND (effective_to IS NULL OR effective_to >= ?)
         ORDER BY component_type, effective_from DESC, id DESC`,
				[date, date]
			);

			for (const row of rows) {
				if (row.component_type === 'pt') {
					if (!components.pt) components.pt = [];
					components.pt.push(row);
				} else if (!components[row.component_type]) {
					components[row.component_type] = row;
				}
			}
		} catch (error) {
			// Keep existing deployments working while the canonical table is absent.
			console.warn('Payroll schedule lookup skipped:', error.message);
		}

		if (!components.da) {
			components.da = {
				value_type: 'fixed',
				value: PAYROLL_CONFIG.DA_FIXED_AMOUNT,
			};
		}

		return { date, components };
	} finally {
		if (ownsConnection) {
			try {
				db.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

/**
 * Get holidays from holiday_master for a given month
 * @param {string} month - Month in YYYY-MM format
 * @param {boolean} includeOptional - Whether to include optional holidays (default: false)
 * @param {object|null} existingDb - Caller's connection; when given, this call
 *   joins the caller's transaction instead of opening (and releasing) its own.
 * @returns {Promise<Array>} Array of holiday objects with date, name, type
 */
export async function getHolidaysForMonth(
	month,
	includeOptional = false,
	existingDb = null
) {
	const db = existingDb || (await dbConnect());
	const ownsConnection = !existingDb;

	try {
		const monthStr = month.substring(0, 7); // Extract YYYY-MM
		const [year, monthNum] = monthStr.split('-');

		// Get first and last day of month
		const firstDay = `${year}-${monthNum}-01`;
		const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
		const lastDayStr = `${year}-${monthNum}-${String(lastDay).padStart(2, '0')}`;

		let query = `
      SELECT id, name, date, type, is_optional
      FROM holiday_master 
      WHERE is_active = 1 
        AND date BETWEEN ? AND ?
    `;

		if (!includeOptional) {
			query += ` AND is_optional = 0`;
		}

		query += ` ORDER BY date ASC`;

		const [rows] = await db.execute(query, [firstDay, lastDayStr]);

		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			date: row.date,
			type: row.type,
			is_optional: row.is_optional,
		}));
	} catch (error) {
		console.error('Error getting holidays for month:', error);
		return [];
	} finally {
		if (ownsConnection) {
			try {
				db.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

/**
 * Calculate actual working days for a month (excluding Sundays and official holidays)
 * @param {string} month - Month in YYYY-MM format
 * @param {object|null} existingDb - Caller's connection, passed through to the
 *   holiday lookup so a caller inside a transaction reads one snapshot.
 * @returns {Promise<object>} Working days info
 */
export async function getWorkingDaysForMonth(month, existingDb = null) {
	const monthStr = month.substring(0, 7);
	const [year, monthNum] = monthStr.split('-');
	const totalDaysInMonth = new Date(
		parseInt(year),
		parseInt(monthNum),
		0
	).getDate();

	// Get official holidays from holiday_master
	const holidays = await getHolidaysForMonth(month, false, existingDb);
	const holidayDates = new Set(
		holidays.map((h) => {
			const d = new Date(h.date);
			return d.getDate();
		})
	);

	let sundays = 0;
	let weekdays = 0;
	let holidaysNotOnSunday = 0;

	for (let day = 1; day <= totalDaysInMonth; day++) {
		const date = new Date(parseInt(year), parseInt(monthNum) - 1, day);
		const isSunday = date.getDay() === 0;
		const isHoliday = holidayDates.has(day);

		if (isSunday) {
			sundays++;
		} else if (isHoliday) {
			holidaysNotOnSunday++;
		} else {
			weekdays++;
		}
	}

	const workingDays = totalDaysInMonth - sundays - holidaysNotOnSunday;

	return {
		totalDaysInMonth,
		sundays,
		holidays: holidays.length,
		holidaysNotOnSunday,
		workingDays,
		holidayList: holidays,
	};
}

/**
 * Get employee's total working hours from attendance for a given month
 * @param {number} employeeId - Employee ID
 * @param {string} month - Month in YYYY-MM format
 * @param {string} defaultInTime - Default in time (HH:MM format)
 * @param {string} defaultOutTime - Default out time (HH:MM format)
 * @returns {Promise<number>} Total working hours
 */
export async function getEmployeeMonthlyHours(
	employeeId,
	month,
	defaultInTime = '09:00',
	defaultOutTime = '17:30'
) {
	const db = await dbConnect();

	try {
		// Get attendance records with in/out times
		const [records] = await db.execute(
			`SELECT 
        status,
        in_time,
        out_time
       FROM employee_attendance 
       WHERE employee_id = ? 
         AND DATE_FORMAT(attendance_date, '%Y-%m') = ?
         AND status IN ('P', 'HD', 'OT')`,
			[employeeId, month.substring(0, 7)]
		);

		let totalHours = 0;

		// Helper to parse time string to decimal hours
		const timeToDecimal = (timeStr) => {
			if (!timeStr) return null;
			const timePart = timeStr.toString().substring(0, 5);
			const [hours, minutes] = timePart.split(':').map(Number);
			return hours + minutes / 60;
		};

		// Parse default times
		const defaultIn = timeToDecimal(defaultInTime);
		const defaultOut = timeToDecimal(defaultOutTime);
		const defaultDailyHours = defaultOut - defaultIn;

		records.forEach((record) => {
			const inTime = timeToDecimal(record.in_time) || defaultIn;
			const outTime = timeToDecimal(record.out_time) || defaultOut;

			let hours = outTime > inTime ? outTime - inTime : defaultDailyHours;

			// Half day = half hours
			if (record.status === 'HD') {
				hours = hours / 2;
			}

			totalHours += hours;
		});

		return totalHours;
	} catch (error) {
		console.error('Error getting employee monthly hours:', error);
		// Return default hours (160 for a month)
		return 160;
	} finally {
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

/**
 * Get employee's attendance summary for a given month
 * Integrates with holiday_master for official holidays
 * @param {number} employeeId - Employee ID
 * @param {string} month - Month in YYYY-MM format
 * @param {object|null} existingDb - Caller's connection, passed through so a
 *   caller inside a transaction reads one snapshot.
 * @returns {Promise<object>} Attendance summary
 */
export async function getEmployeeAttendance(
	employeeId,
	month,
	existingDb = null
) {
	const db = existingDb || (await dbConnect());
	const ownsConnection = !existingDb;

	try {
		// Get actual working days from holiday_master (excluding Sundays and official holidays)
		const workingDaysInfo = await getWorkingDaysForMonth(month, db);
		const standardWorkingDays = workingDaysInfo.workingDays;

		// Get attendance records for the month
		const [records] = await db.execute(
			`SELECT 
        status,
        overtime_hours,
        is_weekly_off
       FROM employee_attendance 
       WHERE employee_id = ? 
         AND DATE_FORMAT(attendance_date, '%Y-%m') = ?`,
			[employeeId, month.substring(0, 7)] // Extract YYYY-MM from month
		);

		// Calculate attendance summary
		let daysPresent = 0;
		let daysAbsent = 0;
		let daysLeave = 0;
		let weeklyOff = 0;
		let holidays = workingDaysInfo.holidaysNotOnSunday; // Use holidays from holiday_master
		let halfDays = 0;
		let totalOvertimeHours = 0;

		records.forEach((record) => {
			switch (record.status) {
				case 'P': // Present
					daysPresent++;
					break;
				case 'A': // Absent
					daysAbsent++;
					break;
				case 'PL': // Paid Leave
				case 'CL': // Casual Leave
				case 'SL': // Sick Leave
				case 'EL': // Earned Leave
					daysLeave++;
					daysPresent++; // Paid leaves count as present for salary
					break;
				case 'UL': // Unpaid Leave
				case 'LWP': // Leave Without Pay
					daysAbsent++;
					break;
				case 'HD': // Half Day
					halfDays++;
					daysPresent += 0.5;
					break;
				case 'WO': // Weekly Off
					weeklyOff++;
					break;
				case 'H': // Holiday (from attendance - may be additional company holidays)
					holidays++;
					break;
			}

			if (record.is_weekly_off) weeklyOff++;
			totalOvertimeHours += parseFloat(record.overtime_hours || 0);
		});

		// If no attendance records found, assume full month present
		const hasAttendanceData = records.length > 0;
		const effectivePresentDays = hasAttendanceData
			? daysPresent
			: standardWorkingDays;
		const lossOfPayDays = hasAttendanceData ? daysAbsent : 0;

		// Payable days = standard working days - explicit absences (LWP/UL only) - half day deductions.
		// Days without attendance records are NOT treated as absences — only explicit
		// unpaid leave/absent entries reduce pay. This prevents salary reduction when
		// attendance hasn't been fully entered for the month.
		const payableDays = standardWorkingDays - lossOfPayDays - halfDays * 0.5;

		return {
			standardWorkingDays,
			daysPresent: effectivePresentDays,
			daysAbsent: lossOfPayDays,
			daysLeave,
			weeklyOff: weeklyOff + workingDaysInfo.sundays,
			holidays,
			halfDays,
			totalOvertimeHours,
			hasAttendanceData,
			// Payable days = standard working days minus only explicit absences
			payableDays,
			// Loss of Pay days
			lopDays: lossOfPayDays,
			// Holiday list from holiday_master
			holidayList: workingDaysInfo.holidayList,
			// Working days breakdown
			workingDaysBreakdown: workingDaysInfo,
		};
	} catch (error) {
		console.error('Error getting employee attendance:', error);
		// Return default (full month) if error
		return {
			standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			daysAbsent: 0,
			daysLeave: 0,
			weeklyOff: 0,
			holidays: 0,
			halfDays: 0,
			totalOvertimeHours: 0,
			hasAttendanceData: false,
			payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			lopDays: 0,
			holidayList: [],
			workingDaysBreakdown: null,
		};
	} finally {
		if (ownsConnection) {
			try {
				db.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

/** Human wording for a roster employment-date problem, shared by every refusal. */
const EMPLOYMENT_ISSUE_LABELS = {
	employment_dates_missing: 'employment dates are missing',
	employment_dates_invalid: 'employment dates are invalid',
	work_outside_employment: 'work is recorded outside their employment dates',
};

/** The roster's issue code as a sentence a route can return to an admin. */
export function employmentIssueLabel(issue) {
	return EMPLOYMENT_ISSUE_LABELS[issue] || String(issue || 'unknown issue');
}

/**
 * A refusal Generate can turn into a named client error instead of a generic
 * 500: the caller asked to pay someone the shared monthly roster does not
 * cover, or whose employment dates need review.
 */
export class PayrollGenerationError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'PayrollGenerationError';
		this.status = options.status ?? 400;
		this.code = options.code ?? 'payroll_generation_refused';
		this.reviewReason = options.reviewReason ?? null;
		this.employeeId = options.employeeId ?? null;
	}
}

/** One roster member by employees.id, or null when they are not on it. */
function findRosterMember(roster, employeeId) {
	return (
		(roster?.members || []).find(
			(member) => Number(member.employee_id) === Number(employeeId)
		) || null
	);
}

/**
 * Why this employee cannot be paid from the month's roster, or null when they
 * can. Single, batch and preview generation all use this same check so none of
 * them can write a slip the shared eligibility rules exclude.
 *
 * Salary readiness is distinct from employment dates: no covering agreement,
 * competing covering agreements, a missing CTC and an invalid CTC are four
 * different refusals. An explicit zero CTC is resolved, never treated as
 * missing.
 */
export function payrollGenerationRefusal(member, employeeId, month) {
	const who = member?.name
		? `${member.name} (${member.employee_code})`
		: `Employee ${employeeId}`;

	if (!member) {
		return new PayrollGenerationError(
			`${who} is not on the ${month} payroll roster, so no Payroll Slip can be generated.`,
			{
				status: 422,
				code: 'payroll_member_not_found',
				employeeId,
			}
		);
	}

	if (member.issue) {
		return new PayrollGenerationError(
			`${who} cannot be paid for ${month}: ${employmentIssueLabel(
				member.issue
			)}. Resolve the employment dates before generating or finalizing payroll.`,
			{
				status: 422,
				code: 'payroll_employment_review',
				reviewReason: member.issue,
				employeeId,
			}
		);
	}

	const salaryIssue = salaryIssueOf(member);
	if (salaryIssue === SALARY_ISSUE.MISSING_PROFILE) {
		return new PayrollGenerationError(
			`No active salary profile found for ${who}. Please set up salary structure first.`,
			{
				status: 400,
				code: 'payroll_profile_missing',
				employeeId,
			}
		);
	}

	if (salaryIssue === SALARY_ISSUE.AMBIGUOUS_PROFILE) {
		const ids = (member.salary_conflict_ids || []).join(', ');
		return new PayrollGenerationError(
			`${who} cannot be paid for ${month}: overlapping Salary Profiles need review${
				ids ? ` (agreement ids ${ids})` : ''
			}. Resolve the competing agreements before generating payroll.`,
			{
				status: 422,
				code: 'payroll_salary_ambiguous',
				reviewReason: salaryIssue,
				employeeId,
			}
		);
	}

	if (
		salaryIssue === SALARY_ISSUE.MISSING_CTC ||
		salaryIssue === SALARY_ISSUE.INVALID_CTC
	) {
		const missing = salaryIssue === SALARY_ISSUE.MISSING_CTC;
		return new PayrollGenerationError(
			`${who} cannot be paid for ${month}: ${salaryIssueLabel(salaryIssue)}. ${
				missing
					? 'Enter an explicit monthly CTC (zero is valid).'
					: 'Correct the invalid monthly CTC.'
			}`,
			{
				status: 422,
				code: missing ? 'payroll_ctc_missing' : 'payroll_ctc_invalid',
				reviewReason: salaryIssue,
				employeeId,
			}
		);
	}

	if (!member.salary_profile) {
		return new PayrollGenerationError(
			`No active salary profile found for ${who}. Please set up salary structure first.`,
			{
				status: 400,
				code: 'payroll_profile_missing',
				employeeId,
			}
		);
	}

	// A slip's provenance and durable use need one exact agreement identity.
	// An eligible roster member always carries it; a hand-built roster that
	// does not is a programming error, not a pay gap to price as zero.
	if (!member.profile_id || !member.profile_source) {
		throw new Error(
			`${who} has no recorded Salary Profile provenance, so generation cannot record which agreement was used.`
		);
	}

	return null;
}

/**
 * Calculate complete payroll breakdown for an employee.
 * Links the Salary Profile with the month's attendance calendar and the
 * hours logged in Project Activity Assignments: Gross is the CTC apportioned
 * over the month's payable hours and paid at the hours actually logged.
 *
 * The profile is the one the shared monthly roster selected at
 * max(month start, employment start); callers inside a transaction pass their
 * connection (and may pass the already-loaded roster) so reads see the roster
 * that will be frozen. No profile argument means the roster is loaded here.
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @param {object} options - Optional settings
 * @param {object} options.db - Existing connection (owned by the caller)
 * @param {object} options.roster - Already-loaded PayrollRunRoster
 * @param {object} options.salaryProfile - Roster-selected profile
 * @param {boolean} options.include_bonus - Whether to include bonus (default: false)
 * @param {number} options.loggedHours - Override the month's logged hours (preview/tests)
 * @returns {Promise<object>} Complete payroll breakdown, or null without a profile
 */
export async function calculateEmployeePayroll(
	employeeId,
	month,
	options = {}
) {
	const includeBonus =
		options.include_bonus === true || options.includeBonus === true;
	const ownsConnection = !options.db;
	const db = options.db || (await dbConnect());

	try {
		let profile = options.salaryProfile ?? null;
		if (!profile) {
			const roster = options.roster || (await loadPayrollRunRoster(db, month));
			const member = findRosterMember(roster, employeeId);
			profile = member && !member.issue ? member.salary_profile : null;
		}

		if (!profile) return null;

		const [payrollSchedule, attendance, loggedHours] = await Promise.all([
			options.payrollSchedule ||
				options.schedule ||
				getEffectivePayrollSchedule(month, db),
			options.attendance || getEmployeeAttendance(employeeId, month, db),
			options.loggedHours !== undefined
				? options.loggedHours
				: getEmployeeLoggedHours(employeeId, month, db),
		]);

		return computePayroll(
			employeeId,
			month,
			profile,
			undefined,
			{ ...attendance, loggedHours: Number(loggedHours) || 0 },
			includeBonus,
			payrollSchedule,
			options.overrides || options.manualOverrides || {}
		);
	} finally {
		if (ownsConnection) {
			try {
				db.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

// Helper to convert undefined to null
const n = (val) => (val === undefined ? null : val);

/**
 * The payroll_slips columns a slip is written with, in `payrollToParams`
 * order. Both the single-row and the batch insert build from this one list,
 * so the two can never drift apart (the batch previously carried its own
 * shorter list, which silently failed every generated row back through the
 * one-by-one fallback).
 */
const SLIP_INSERT_COLUMNS = [
	'month',
	'employee_id',
	'gross',
	'ctc_used',
	'basis_hours',
	'hourly_rate',
	'logged_hours',
	'da_used',
	'da',
	'basic',
	'hra',
	'conveyance',
	'call_allowance',
	'other_allowances',
	'bonus',
	'incentive',
	'ot_rate',
	'total_earnings',
	'pf_employee',
	'esic_employee',
	'pt',
	'mlwf',
	'retention',
	'lwf',
	'tds',
	'other_deductions',
	'total_deductions',
	'net_pay',
	'pf_employer',
	'esic_employer',
	'mlwf_employer',
	'insurance',
	'gratuity',
	'pf_admin',
	'edli',
	'total_employer_contributions',
	'employer_cost',
	'standard_working_days',
	'days_present',
	'days_absent',
	'days_leave',
	'payable_days',
	'lop_days',
	'lop_deduction',
	'overtime_hours',
	'full_month_gross',
	'pl_total',
	'pl_used',
	'pl_balance',
	'payment_status',
	'remarks',
	// Exact source-qualified agreement the slip was priced from. Written by the
	// same transaction that records durable use, so a later salary correction
	// can never make a historical slip disagree with the agreement it used.
	'salary_profile_id',
	'salary_profile_source',
	'salary_type',
];

const SLIP_PLACEHOLDER = `(${SLIP_INSERT_COLUMNS.map(() => '?').join(', ')})`;

const INSERT_SLIP_SQL = `INSERT INTO payroll_slips (
  ${SLIP_INSERT_COLUMNS.join(', ')}
) VALUES ${SLIP_PLACEHOLDER}`;

function payrollToParams(payroll, member = null) {
	return [
		payroll.month,
		payroll.employee_id,
		n(payroll.gross) || 0,
		n(payroll.ctc_used) || 0,
		n(payroll.basis_hours) || 0,
		n(payroll.hourly_rate) || 0,
		n(payroll.logged_hours) || 0,
		n(payroll.da_used) || 0,
		n(payroll.da) || 0,
		n(payroll.basic) || 0,
		n(payroll.hra) || 0,
		n(payroll.conveyance) || 0,
		n(payroll.call_allowance) || 0,
		n(payroll.other_allowances) || 0,
		n(payroll.bonus) || 0,
		n(payroll.incentive) || 0,
		n(payroll.ot_rate) || 0,
		n(payroll.total_earnings) || 0,
		n(payroll.pf_employee) || 0,
		n(payroll.esic_employee) || 0,
		n(payroll.pt) || 0,
		n(payroll.mlwf) || 0,
		n(payroll.retention) || 0,
		n(payroll.lwf) || 0,
		n(payroll.tds) || 0,
		n(payroll.other_deductions) || 0,
		n(payroll.total_deductions) || 0,
		n(payroll.net_pay) || 0,
		n(payroll.pf_employer) || 0,
		n(payroll.esic_employer) || 0,
		n(payroll.mlwf_employer) || 0,
		n(payroll.insurance) || 0,
		n(payroll.gratuity) || 0,
		n(payroll.pf_admin) || 0,
		n(payroll.edli) || 0,
		n(payroll.total_employer_contributions) || 0,
		n(payroll.employer_cost) || 0,
		n(payroll.attendance?.standard_working_days) || 26,
		n(payroll.attendance?.days_present) || 0,
		n(payroll.attendance?.days_absent) || 0,
		n(payroll.attendance?.days_leave) || 0,
		n(payroll.attendance?.payable_days) || 26,
		n(payroll.attendance?.lop_days) || 0,
		n(payroll.lop_deduction) || 0,
		n(payroll.attendance?.overtime_hours) || 0,
		n(payroll.full_month?.gross) || 0,
		n(payroll.pl_total) || 21,
		n(payroll.pl_used) || 0,
		n(payroll.pl_balance) || 21,
		payroll.payment_status || 'pending',
		payroll.remarks || null,
		n(member?.profile_id),
		member?.profile_source ?? null,
		member?.salary_type ?? null,
	];
}

/**
 * Take the shared per-Employee mutex for a single/batch write, then re-read
 * the roster's current terms under those same locks.
 *
 * Callers already hold the Payroll Run row lock, so the lock order stays
 * `payroll_runs` -> `employees` ascending -> agreement/use rows. Ids are
 * deduped and sorted by the shared helper; the roster loader's own lock is
 * idempotent and preserves that order. Ids that do not exist at all are absent
 * from the locked scope and therefore from the roster (refused by membership);
 * soft-deleted ids stay in scope and fall out of the loader's `isDelete = 0`
 * membership.
 */
async function loadLockedEmployeeRoster(db, month, employeeIds) {
	const requested = [...new Set(employeeIds)].sort(
		(left, right) => left - right
	);
	const locked = await lockSalaryEmployees(db, requested);
	const scope = locked.locks
		.map((lock) => lock.employee_id)
		.sort((left, right) => left - right);
	return loadPayrollRunRoster(db, month, {
		employeeIds: scope,
		forUpdate: true,
	});
}

/**
 * Record durable, source-qualified payroll use for one exact agreement/month.
 * Runs on the same connection as the slip insert, after the Employee lock, so
 * a failure removes the slip and the use evidence together. A duplicate is a
 * no-op; deletion of the slip never removes this row.
 */
async function recordGenerationUse(db, member, month, options = {}) {
	return recordSalaryAgreementUse(db, {
		employeeId: member.employee_id,
		agreementId: member.profile_id,
		agreementSource: member.profile_source,
		month,
		evidence: 'payroll_generation',
		evidenceContext:
			options.payrollRunId === undefined || options.payrollRunId === null
				? null
				: { payroll_run_id: options.payrollRunId },
		actorId: options.actorId ?? null,
	});
}

/**
 * Generate and save payroll slip for an employee.
 *
 * The employee must be on the shared monthly roster with a profile selected at
 * max(month start, employment start); a not-eligible or review-required
 * employee is refused with a named reason rather than written as a slip.
 * Callers inside a transaction pass `options.db` so the insert and the roster
 * read share the run row lock.
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @param {object} options - Existing connection / bonus options; `payrollRunId`
 *   and `actorId` are recorded on the durable use evidence
 * @returns {Promise<object>} Generated payroll slip
 */
export async function generatePayrollSlip(employeeId, month, options = {}) {
	// Called without the route's transaction: own the month's write lock here so
	// a standalone call cannot write behind a finalized run or race Finalize.
	if (!options.db) {
		return withPayrollRunWriteLock(month, (db) =>
			generatePayrollSlip(employeeId, month, { ...options, db })
		);
	}

	const db = options.db;
	const requestedId = Number(employeeId);
	if (!Number.isInteger(requestedId) || requestedId <= 0) {
		throw new PayrollGenerationError(
			`Employee ${employeeId} is not on the ${month} payroll roster, so no Payroll Slip can be generated.`,
			{
				status: 422,
				code: 'payroll_member_not_found',
				employeeId,
			}
		);
	}

	// The run row lock is held; take the Employee lock before reading terms.
	const roster = await loadLockedEmployeeRoster(db, month, [requestedId]);
	const member = findRosterMember(roster, requestedId);
	const refusal = payrollGenerationRefusal(member, requestedId, month);
	if (refusal) throw refusal;

	// An existing slip is never repriced and never re-used by a later generate.
	// Report the same conflict the insert's unique key would, without reading
	// the agreement terms a second time.
	const [existingSlips] = await db.execute(
		`SELECT id FROM payroll_slips WHERE month = ? AND employee_id = ? LIMIT 1`,
		[roster.month, requestedId]
	);
	if (existingSlips.length > 0) {
		throw new Error(
			`Payroll slip already exists for employee ${requestedId} for month ${month}`
		);
	}

	const payroll = await calculateEmployeePayroll(requestedId, roster.month, {
		...options,
		db,
		roster,
		salaryProfile: member.salary_profile,
	});

	if (!payroll) {
		throw new PayrollGenerationError(
			`No active salary profile found for employee ${requestedId}. Please set up salary structure first.`,
			{
				status: 400,
				code: 'payroll_profile_missing',
				employeeId: requestedId,
			}
		);
	}

	try {
		const [result] = await db.execute(
			INSERT_SLIP_SQL,
			payrollToParams(payroll, member)
		);

		// Same transaction: a failure here rolls the slip back with the use row.
		await recordGenerationUse(db, member, roster.month, options);

		return {
			...payroll,
			id: result.insertId,
			created_at: new Date(),
		};
	} catch (error) {
		if (error.code === 'ER_DUP_ENTRY') {
			throw new Error(
				`Payroll slip already exists for employee ${requestedId} for month ${month}`
			);
		}

		throw error;
	}
}

// ═══════════════════════════════════════════════════════════════════
// BATCH HELPERS — fetch data for many employees in one DB round-trip
// ═══════════════════════════════════════════════════════════════════

/**
 * Fetch attendance records for a list of employee IDs for a given month
 * in a single query. Returns Map<employee_id, attendanceSummary>.
 * Integrates with holiday_master for accurate working days calculation.
 */
async function batchGetAttendance(db, employeeIds, month) {
	// Get actual working days from holiday_master
	const workingDaysInfo = await getWorkingDaysForMonth(month, db);
	const standardWorkingDays = workingDaysInfo.workingDays;

	const defaultSummary = () => ({
		standardWorkingDays,
		daysPresent: standardWorkingDays,
		daysAbsent: 0,
		daysLeave: 0,
		weeklyOff: workingDaysInfo.sundays,
		holidays: workingDaysInfo.holidaysNotOnSunday,
		halfDays: 0,
		totalOvertimeHours: 0,
		hasAttendanceData: false,
		payableDays: standardWorkingDays,
		lopDays: 0,
		holidayList: workingDaysInfo.holidayList,
	});

	if (employeeIds.length === 0) return new Map();

	const placeholders = employeeIds.map(() => '?').join(',');
	const monthPrefix = month.substring(0, 7);

	const [records] = await db.execute(
		`SELECT employee_id, status, overtime_hours, is_weekly_off
     FROM employee_attendance
     WHERE employee_id IN (${placeholders})
       AND DATE_FORMAT(attendance_date, '%Y-%m') = ?`,
		[...employeeIds, monthPrefix]
	);

	// Group by employee
	const grouped = new Map();
	for (const r of records) {
		if (!grouped.has(r.employee_id)) grouped.set(r.employee_id, []);
		grouped.get(r.employee_id).push(r);
	}

	const resultMap = new Map();

	for (const empId of employeeIds) {
		const empRecords = grouped.get(empId);
		if (!empRecords || empRecords.length === 0) {
			resultMap.set(empId, defaultSummary());
			continue;
		}

		let daysPresent = 0,
			daysAbsent = 0,
			daysLeave = 0;
		let weeklyOff = 0,
			holidays = 0,
			halfDays = 0,
			totalOvertimeHours = 0;

		for (const record of empRecords) {
			switch (record.status) {
				case 'P':
					daysPresent++;
					break;
				case 'A':
					daysAbsent++;
					break;
				case 'PL':
				case 'CL':
				case 'SL':
				case 'EL':
					daysLeave++;
					daysPresent++;
					break;
				case 'UL':
				case 'LWP':
					daysAbsent++;
					break;
				case 'HD':
					halfDays++;
					daysPresent += 0.5;
					break;
				case 'WO':
					weeklyOff++;
					break;
				case 'H':
					holidays++;
					break;
			}
			if (record.is_weekly_off) weeklyOff++;
			totalOvertimeHours += parseFloat(record.overtime_hours || 0);
		}

		resultMap.set(empId, {
			standardWorkingDays,
			daysPresent,
			daysAbsent,
			daysLeave,
			weeklyOff: weeklyOff + workingDaysInfo.sundays,
			holidays: holidays + workingDaysInfo.holidaysNotOnSunday,
			halfDays,
			totalOvertimeHours,
			hasAttendanceData: true,
			// Payable days = standard working days - explicit absences - half day deductions
			payableDays: standardWorkingDays - daysAbsent - halfDays * 0.5,
			lopDays: daysAbsent,
			holidayList: workingDaysInfo.holidayList,
		});
	}

	return resultMap;
}

/**
 * Logged project hours per employee for a payroll month. The assignment's
 * recorded employee id wins; otherwise ownership comes from the linked
 * account's `users.employee_id`. Display and login identifiers never establish
 * attribution. A month with no logged rows yields 0 for that employee: hours
 * alone decide pay.
 */
async function batchGetLoggedHours(db, employeeIds, month) {
	const wanted = new Set(
		employeeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
	);
	const totals = new Map();
	if (wanted.size === 0) return totals;

	const monthPrefix = String(month).substring(0, 7);
	const [assignments] = await db.execute(
		`SELECT uaa.employee_id, uaa.daily_entries,
            u.employee_id AS user_employee_id
     FROM user_activity_assignments uaa
     LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
     WHERE uaa.status <> 'Cancelled'
       AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
	);
	if (assignments.length === 0) return totals;

	for (const row of assignments) {
		const employeeId = resolveLoggedHoursEmployeeId(row);
		if (!employeeId || !wanted.has(employeeId)) continue;
		const hours = sumLoggedHoursForMonth([row.daily_entries], monthPrefix);
		if (hours > 0)
			totals.set(employeeId, (totals.get(employeeId) || 0) + hours);
	}

	for (const [employeeId, hours] of totals) {
		totals.set(employeeId, Math.round(hours * 100) / 100);
	}
	return totals;
}

/**
 * One employee's logged hours for a payroll month. Callers inside a
 * transaction pass their connection so the price reads the same snapshot.
 * The preview endpoint and single-slip generation price exactly what a
 * payroll run would.
 */
async function getEmployeeLoggedHours(employeeId, month, existingDb = null) {
	const db = existingDb || (await dbConnect());
	const ownsConnection = !existingDb;
	try {
		const totals = await batchGetLoggedHours(db, [employeeId], month);
		return totals.get(Number(employeeId)) || 0;
	} finally {
		if (ownsConnection) {
			try {
				db.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

/**
 * Compute payroll using the dependency-free calculation boundary. This is the
 * compatibility interface retained by existing server orchestration callers.
 */
export function computePayroll(
	employeeId,
	month,
	profile,
	daAmount,
	attendance,
	includeBonus = false,
	payrollSchedule = null,
	overrides = {}
) {
	let schedule = payrollSchedule || {};

	// Older callers pass DA as a positional argument. Preserve it without
	// replacing a schedule supplied by the new orchestration path.
	if (daAmount !== undefined && daAmount !== null) {
		if (schedule.components) {
			schedule = {
				...schedule,
				components: { ...schedule.components, da: daAmount },
			};
		} else {
			schedule = { ...schedule, da: daAmount };
		}
	}

	return calculatePayroll({
		employeeId,
		month,
		salaryProfile: profile,
		payrollSchedule: schedule,
		attendance,
		overrides,
		includeBonus,
	});
}

/**
 * Generate payroll slips for the shared monthly roster.
 * OPTIMIZED: uses batch DB queries + multi-row inserts.
 *
 * Membership comes only from `loadPayrollRunRoster`: an eligible employee is
 * one whose employment window covers a day of the month and who has a Salary
 * Profile selected at max(month start, employment start) — which is what lets
 * a mid-month joiner in and still prices an established employee from the
 * first-of-month agreement. Candidates needing employment-date review, a
 * missing/ambiguous agreement or an unpriceable CTC are not written here;
 * Finalize names them instead.
 *
 * The caller already holds the Payroll Run row lock. The loader establishes a
 * stable candidate population, locks those Employees ascending, and re-reads
 * their current terms `FOR UPDATE` before anything is priced. Each successful
 * slip insert records exact source-qualified agreement use on the same
 * connection; any failure rolls the whole batch back.
 *
 * @param {string} month - Payroll month (YYYY-MM-01 format)
 * @param {string|null} salaryType - Optional salary type filter
 * @param {boolean} includeBonus - Add the configured bonus
 * @param {number[]|null} bonusEmployeeIds - Limit the bonus to these employees
 * @param {object} options - `db`: caller's transaction connection;
 *   `payrollRunId`/`actorId` are recorded on the durable use evidence
 * @returns {Promise<object>} Summary of generation results
 */
export async function generateMonthlyPayroll(
	month,
	salaryType = null,
	includeBonus = false,
	bonusEmployeeIds = null,
	options = {}
) {
	// Called without the route's transaction: own the month's write lock here so
	// a standalone call cannot write behind a finalized run or race Finalize.
	if (!options.db) {
		return withPayrollRunWriteLock(month, (db) =>
			generateMonthlyPayroll(
				month,
				salaryType,
				includeBonus,
				bonusEmployeeIds,
				{ ...options, db }
			)
		);
	}

	const db = options.db;
	const validSalaryTypes = [
		'monthly',
		'hourly',
		'daily',
		'contract',
		'lumpsum',
		'custom',
		'payroll',
	];
	const filterBySalaryType =
		salaryType && validSalaryTypes.includes(salaryType);
	const isPayrollFilter = salaryType === 'payroll';
	const isContractFilter = salaryType === 'contract';
	// The caller holds the Payroll Run row lock. Establish the candidate
	// population, lock those Employees ascending and re-read their current
	// terms before pricing anything.
	const roster = await loadPayrollRunRoster(db, month, { forUpdate: true });

	// ── 1. Eligible roster members for this stream ──
	// Stream membership lives on the selected Salary Profile, not on
	// employees.employee_type, so both Payroll and Contract agreements are
	// covered unless the caller filters one. A salary readiness issue (no
	// agreement, competing agreements, missing/invalid CTC) is never priced as
	// zero and never silently becomes a generated slip.
	const employees = roster.members
		.filter(
			(member) =>
				!member.issue && member.salary_profile && salaryIssueOf(member) === null
		)
		.filter((member) => {
			if (!filterBySalaryType) return true;
			const memberType = member.salary_type
				? String(member.salary_type).toLowerCase()
				: null;
			if (isContractFilter) return memberType === 'contract';
			if (isPayrollFilter) return memberType !== 'contract';
			return (
				memberType === salaryType ||
				(memberType === null && salaryType === 'monthly')
			);
		})
		.map((member) => ({
			employee_id: member.employee_id,
			name: member.name,
		}));

	if (employees.length === 0) {
		return {
			month: roster.month,
			total: 0,
			success: 0,
			failed: 0,
			skipped: 0,
			errors: [],
		};
	}

	const employeeIds = employees.map((e) => e.employee_id);
	const employeeNameMap = new Map(
		employees.map((e) => [e.employee_id, e.name])
	);
	const memberMap = new Map(
		roster.members.map((member) => [Number(member.employee_id), member])
	);

	// ── 2. Check for existing slips (skip duplicates in bulk) ──
	const phExisting = employeeIds.map(() => '?').join(',');
	const [existingSlips] = await db.execute(
		`SELECT employee_id FROM payroll_slips WHERE month = ? AND employee_id IN (${phExisting})`,
		[roster.month, ...employeeIds]
	);
	const existingSet = new Set(existingSlips.map((r) => r.employee_id));
	const newIds = employeeIds.filter((id) => !existingSet.has(id));

	const results = {
		month: roster.month,
		total: employees.length,
		success: 0,
		failed: 0,
		skipped: existingSet.size,
		errors: [],
	};

	if (newIds.length === 0) {
		return results;
	}

	// ── 3. Batch-fetch effective schedules, attendance and logged hours ──
	const payrollSchedule = await getEffectivePayrollSchedule(roster.month, db);
	const attendanceMap = await batchGetAttendance(db, newIds, roster.month);
	const hoursMap = await batchGetLoggedHours(db, newIds, roster.month);

	// ── 4. Compute all payrolls in memory and batch-insert ──
	const BATCH_SIZE = 50;
	const toInsert = [];

	for (const empId of newIds) {
		const member = memberMap.get(Number(empId));
		const profile = member?.salary_profile;
		if (!profile) {
			results.failed++;
			results.errors.push({
				employee_id: empId,
				name: employeeNameMap.get(empId),
				error: `No active salary profile found for employee ${empId}`,
			});
			continue;
		}

		const defaultAtt = {
			standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			daysAbsent: 0,
			daysLeave: 0,
			weeklyOff: 0,
			holidays: 0,
			halfDays: 0,
			totalOvertimeHours: 0,
			hasAttendanceData: false,
			payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			lopDays: 0,
		};
		const attendance = {
			...(attendanceMap.get(empId) || defaultAtt),
			loggedHours: hoursMap.get(empId) || 0,
		};

		try {
			// If bonusEmployeeIds is provided, only include bonus for those specific employees
			const empIncludeBonus =
				includeBonus &&
				(bonusEmployeeIds === null || bonusEmployeeIds.includes(empId));
			const payroll = computePayroll(
				empId,
				roster.month,
				profile,
				undefined,
				attendance,
				empIncludeBonus,
				payrollSchedule
			);
			toInsert.push({ payroll, member });
		} catch (err) {
			results.failed++;
			results.errors.push({
				employee_id: empId,
				name: employeeNameMap.get(empId),
				error: err.message,
			});
		}
	}

	// Multi-row INSERT in batches of BATCH_SIZE
	const inserted = [];
	for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
		const batch = toInsert.slice(i, i + BATCH_SIZE);
		const singlePlaceholder = SLIP_PLACEHOLDER;
		const allPlaceholders = batch.map(() => singlePlaceholder).join(',');
		const allParams = batch.flatMap(({ payroll, member }) =>
			payrollToParams(payroll, member)
		);

		const batchSQL = `INSERT INTO payroll_slips (
        ${SLIP_INSERT_COLUMNS.join(', ')}
      ) VALUES ${allPlaceholders}`;

		try {
			await db.query(batchSQL, allParams);
			results.success += batch.length;
			inserted.push(...batch);
		} catch (batchErr) {
			// Fallback: insert one-by-one so partial success is recorded
			for (const entry of batch) {
				try {
					await db.execute(
						INSERT_SLIP_SQL,
						payrollToParams(entry.payroll, entry.member)
					);
					results.success++;
					inserted.push(entry);
				} catch (singleErr) {
					if (singleErr.code === 'ER_DUP_ENTRY') {
						results.skipped++;
					} else {
						results.failed++;
						results.errors.push({
							employee_id: entry.payroll.employee_id,
							name: employeeNameMap.get(entry.payroll.employee_id),
							error: singleErr.message,
						});
					}
				}
			}
		}
	}

	// Durable use for exactly the slips this transaction inserted, ascending
	// Employee id (the loader already holds those locks). A failed evidence
	// write throws, so the caller's transaction removes every new slip too.
	inserted.sort(
		(left, right) => left.member.employee_id - right.member.employee_id
	);
	for (const entry of inserted) {
		await recordGenerationUse(db, entry.member, roster.month, options);
	}

	return results;
}

/**
 * Generate payroll slips for a list of specific employee IDs.
 * OPTIMIZED: batch-fetches data and inserts in bulk.
 *
 * Every requested id is checked against the shared monthly roster; an id that
 * is not eligible (or needs employment-date review, has a missing/ambiguous
 * agreement or an unpriceable CTC) is refused by name instead of being
 * written. This closes the single/batch path as a bypass around Generate's
 * roster.
 *
 * The caller holds the Payroll Run row lock; this takes the shared Employee
 * locks for exactly the requested ids, re-reads their current terms
 * `FOR UPDATE`, and writes each slip together with its exact source-qualified
 * agreement provenance and durable generation use. An existing slip is skipped
 * without repricing; any use-evidence failure aborts the batch for rollback.
 *
 * @param {number[]} employeeIds - Array of employee IDs
 * @param {string} month - Payroll month (YYYY-MM-01 format)
 * @param {boolean} includeBonus - Add the configured bonus
 * @param {number[]|null} bonusEmployeeIds - Limit the bonus to these employees
 * @param {object} options - `db`: caller's transaction connection;
 *   `payrollRunId`/`actorId` are recorded on the durable use evidence
 * @returns {Promise<object>} Summary { success, failed, skipped, errors }
 */
export async function generatePayrollSlipsBatch(
	employeeIds,
	month,
	includeBonus = false,
	bonusEmployeeIds = null,
	options = {}
) {
	if (!employeeIds || employeeIds.length === 0) {
		return { success: 0, failed: 0, skipped: 0, errors: [] };
	}

	// Called without the route's transaction: own the month's write lock here so
	// a standalone call cannot write behind a finalized run or race Finalize.
	if (!options.db) {
		return withPayrollRunWriteLock(month, (db) =>
			generatePayrollSlipsBatch(
				employeeIds,
				month,
				includeBonus,
				bonusEmployeeIds,
				{ ...options, db }
			)
		);
	}

	const db = options.db;
	const numericIds = [];
	const seenIds = new Set();
	for (const value of employeeIds) {
		const id = Number(value);
		if (Number.isInteger(id) && id > 0 && !seenIds.has(id)) {
			seenIds.add(id);
			numericIds.push(id);
		}
	}

	// The run row lock is held; take the sorted Employee locks before reading
	// agreement terms. Only the requested ids are read and priced.
	const roster =
		numericIds.length > 0
			? await loadLockedEmployeeRoster(db, month, numericIds)
			: null;
	const memberMap = new Map(
		(roster?.members || []).map((member) => [
			Number(member.employee_id),
			member,
		])
	);
	const rosterMonth = roster?.month ?? month;

	// Check existing. A recorded slip is skipped, never repriced or re-used.
	const existingSet = new Set();
	if (numericIds.length > 0) {
		const ph = numericIds.map(() => '?').join(',');
		const [existingSlips] = await db.execute(
			`SELECT employee_id FROM payroll_slips WHERE month = ? AND employee_id IN (${ph})`,
			[rosterMonth, ...numericIds]
		);
		for (const row of existingSlips) {
			existingSet.add(Number(row.employee_id));
		}
	}

	const results = {
		success: 0,
		failed: 0,
		skipped: existingSet.size,
		errors: [],
	};

	// Validate before reading the month's attendance/hours, so an ineligible
	// request cannot even be priced.
	const pendingIds = [];
	for (const employeeId of employeeIds) {
		const empId = Number(employeeId);
		if (Number.isInteger(empId) && empId > 0 && existingSet.has(empId)) {
			continue;
		}

		const member = memberMap.get(empId) || null;
		const refusal = payrollGenerationRefusal(
			member,
			Number.isInteger(empId) && empId > 0 ? empId : employeeId,
			rosterMonth
		);
		if (refusal) {
			results.failed++;
			results.errors.push({
				employee_id: Number.isInteger(empId) && empId > 0 ? empId : employeeId,
				name: member?.name,
				employee_code: member?.employee_code,
				reason: refusal.code,
				review_reason: refusal.reviewReason,
				error: refusal.message,
			});
			continue;
		}
		pendingIds.push(empId);
	}

	if (pendingIds.length === 0) {
		return results;
	}

	// The loader locked these Employees ascending; keep inserts and use
	// evidence in that same order.
	pendingIds.sort((left, right) => left - right);

	// Batch-fetch effective schedules, attendance, and hours from the same
	// locked transaction snapshot.
	const payrollSchedule = await getEffectivePayrollSchedule(rosterMonth, db);
	const attendanceMap = await batchGetAttendance(db, pendingIds, rosterMonth);
	const hoursMap = await batchGetLoggedHours(db, pendingIds, rosterMonth);

	for (const empId of pendingIds) {
		const member = memberMap.get(empId);
		const profile = member?.salary_profile;
		if (!profile) {
			// Refused above; kept as a guard against a roster changing mid-flight.
			results.failed++;
			results.errors.push({
				employee_id: empId,
				error: `No active salary profile found for employee ${empId}`,
			});
			continue;
		}
		const defaultAtt = {
			standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			daysAbsent: 0,
			daysLeave: 0,
			weeklyOff: 0,
			holidays: 0,
			halfDays: 0,
			totalOvertimeHours: 0,
			hasAttendanceData: false,
			payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
			lopDays: 0,
		};
		const attendance = {
			...(attendanceMap.get(empId) || defaultAtt),
			loggedHours: hoursMap.get(empId) || 0,
		};

		let payroll;
		try {
			// If bonusEmployeeIds is provided, only include bonus for those specific employees
			const empIncludeBonus =
				includeBonus &&
				(bonusEmployeeIds === null || bonusEmployeeIds.includes(empId));
			payroll = computePayroll(
				empId,
				rosterMonth,
				profile,
				undefined,
				attendance,
				empIncludeBonus,
				payrollSchedule
			);
			await db.execute(INSERT_SLIP_SQL, payrollToParams(payroll, member));
		} catch (err) {
			if (err.code === 'ER_DUP_ENTRY') results.skipped++;
			else {
				results.failed++;
				results.errors.push({ employee_id: empId, error: err.message });
			}
			continue;
		}

		results.success++;
		// Same transaction as the insert: a failure here must abort the batch so
		// neither the slip nor a partial protection set is committed.
		await recordGenerationUse(db, member, rosterMonth, options);
	}

	return results;
}

const payrollCalculator = {
	getEffectivePayrollSchedule,
	getEmployeeAttendance,
	calculateEmployeePayroll,
	generatePayrollSlip,
	generatePayrollSlipsBatch,
	generateMonthlyPayroll,
	payrollGenerationRefusal,
};

export default payrollCalculator;
