/**
 * Payroll Calculator Utility
 * ---------------------------
 * Uses frozen PAYROLL_CONFIG to calculate all salary components
 * Integrates with core payroll tables:
 *  - da_schedule
 *  - employee_salary_profile
 *  - payroll_slips
 *  - employee_attendance (for monthly calculations)
 *  - holiday_master (for official holidays)
 */

import PAYROLL_CONFIG from './payroll-config';
import { dbConnect } from './database';
import {
	calculatePayroll,
	calculatePayrollBreakdown,
	calculatePayrollBoundary,
	normalizeSalaryProfile,
} from './payroll-calculation';

export {
	calculatePayroll,
	calculatePayrollBreakdown,
	calculatePayrollBoundary,
	normalizeSalaryProfile,
};

/**
 * Get current active DA amount from da_schedule
 * @param {Date} forDate - Date to check (defaults to today)
 * @returns {Promise<number>} Current DA amount
 */
export async function getCurrentDA(forDate = new Date()) {
	const db = await dbConnect();

	try {
		const [rows] = await db.execute(
			`SELECT da_amount 
       FROM da_schedule 
       WHERE is_active = 1 
         AND ? BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31')
       LIMIT 1`,
			[forDate]
		);

		return rows.length > 0
			? parseFloat(rows[0].da_amount)
			: PAYROLL_CONFIG.DA_FIXED_AMOUNT;
	} catch (error) {
		console.error('Error getting current DA:', error);
		return PAYROLL_CONFIG.DA_FIXED_AMOUNT; // Fallback to config default
	} finally {
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

const scheduleDate = (value) =>
	typeof value === 'string'
		? value.substring(0, 10)
		: value.toISOString().split('T')[0];

/**
 * Load the effective Payroll Schedule once for a calculation run. The
 * canonical payroll_schedules table is preferred; the legacy DA table remains
 * a compatibility fallback until DA storage is unified.
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
			try {
				const [rows] = await db.execute(
					`SELECT da_amount, effective_from, effective_to
           FROM da_schedule
           WHERE is_active = 1
             AND ? BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31')
           ORDER BY effective_from DESC, id DESC
           LIMIT 1`,
					[date]
				);
				if (rows.length > 0) {
					components.da = {
						value_type: 'fixed',
						value: rows[0].da_amount,
					};
				}
			} catch (error) {
				console.warn('Legacy DA lookup skipped:', error.message);
			}
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
 * @returns {Promise<Array>} Array of holiday objects with date, name, type
 */
export async function getHolidaysForMonth(month, includeOptional = false) {
	const db = await dbConnect();

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
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

/**
 * Calculate actual working days for a month (excluding Sundays and official holidays)
 * @param {string} month - Month in YYYY-MM format
 * @returns {Promise<object>} Working days info
 */
export async function getWorkingDaysForMonth(month) {
	const monthStr = month.substring(0, 7);
	const [year, monthNum] = monthStr.split('-');
	const totalDaysInMonth = new Date(
		parseInt(year),
		parseInt(monthNum),
		0
	).getDate();

	// Get official holidays from holiday_master
	const holidays = await getHolidaysForMonth(month, false);
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
 * @returns {Promise<object>} Attendance summary
 */
export async function getEmployeeAttendance(employeeId, month) {
	const db = await dbConnect();

	try {
		// Get actual working days from holiday_master (excluding Sundays and official holidays)
		const workingDaysInfo = await getWorkingDaysForMonth(month);
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
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

/**
 * Get the effective Salary Profile. The canonical employee_salary_profile is
 * selected first; salary_structures is read-only compatibility fallback data.
 */
export async function getEmployeeSalaryProfile(
	employeeId,
	forDate = new Date()
) {
	const db = await dbConnect();
	const dateStr = scheduleDate(forDate);

	try {
		const [canonicalRows] = await db.execute(
			`SELECT *
       FROM employee_salary_profile
       WHERE employee_id = ?
         AND is_active = 1
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC, id DESC
       LIMIT 1`,
			[employeeId, dateStr, dateStr]
		);
		const [legacyRows] = await db.execute(
			`SELECT *
       FROM salary_structures
       WHERE employee_id = ?
         AND is_active = 1
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC, id DESC
       LIMIT 1`,
			[employeeId, dateStr, dateStr]
		);

		const canonical = canonicalRows.length > 0 ? canonicalRows[0] : null;
		const legacy = legacyRows.length > 0 ? legacyRows[0] : null;
		return canonical || legacy
			? normalizeSalaryProfile(canonical, legacy)
			: null;
	} catch (error) {
		console.error('Error getting employee salary profile:', error);
		return null;
	} finally {
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

/**
 * Calculate complete payroll breakdown for an employee
 * Links salary structure with attendance for monthly calculations
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @param {object} options - Optional settings
 * @param {boolean} options.include_bonus - Whether to include bonus (default: false)
 * @returns {Promise<object>} Complete payroll breakdown
 */
export async function calculateEmployeePayroll(
	employeeId,
	month,
	options = {}
) {
	const includeBonus =
		options.include_bonus === true || options.includeBonus === true;
	const profile = await getEmployeeSalaryProfile(employeeId, month);

	if (!profile) return null;

	const [payrollSchedule, attendance] = await Promise.all([
		options.payrollSchedule ||
			options.schedule ||
			getEffectivePayrollSchedule(month),
		options.attendance || getEmployeeAttendance(employeeId, month),
	]);

	return computePayroll(
		employeeId,
		month,
		profile,
		undefined,
		attendance,
		includeBonus,
		payrollSchedule,
		options.overrides || options.manualOverrides || {}
	);
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA MIGRATION - run once per process lifetime
// ═══════════════════════════════════════════════════════════════════
let _columnsEnsured = false;

const PAYROLL_COLUMNS_TO_ADD = [
	{ name: 'da', definition: 'DECIMAL(12, 2)' },
	{ name: 'bonus', definition: 'DECIMAL(12, 2)' },
	{ name: 'incentive', definition: 'DECIMAL(12, 2)' },
	{ name: 'mlwf', definition: 'DECIMAL(12, 2)' },
	{ name: 'retention', definition: 'DECIMAL(12, 2)' },
	{ name: 'mlwf_employer', definition: 'DECIMAL(12, 2)' },
	{ name: 'insurance', definition: 'DECIMAL(12, 2)' },
	{ name: 'standard_working_days', definition: 'INT DEFAULT 26' },
	{ name: 'days_present', definition: 'DECIMAL(5,1)' },
	{ name: 'days_absent', definition: 'DECIMAL(5,1)' },
	{ name: 'days_leave', definition: 'DECIMAL(5,1)' },
	{ name: 'payable_days', definition: 'DECIMAL(5,1)' },
	{ name: 'lop_days', definition: 'DECIMAL(5,1)' },
	{ name: 'lop_deduction', definition: 'DECIMAL(12, 2)' },
	{ name: 'overtime_hours', definition: 'DECIMAL(5,2)' },
	{ name: 'ot_rate', definition: 'DECIMAL(12, 2) DEFAULT 0' },
	{ name: 'full_month_gross', definition: 'DECIMAL(12, 2)' },
	{ name: 'pl_total', definition: 'INT DEFAULT 21' },
	{ name: 'pl_used', definition: 'INT DEFAULT 0' },
	{ name: 'pl_balance', definition: 'INT DEFAULT 21' },
];

async function ensurePayrollColumns(db) {
	if (_columnsEnsured) return;
	for (const col of PAYROLL_COLUMNS_TO_ADD) {
		try {
			await db.query(
				`ALTER TABLE payroll_slips ADD COLUMN ${col.name} ${col.definition}`
			);
		} catch (_) {
			/* column already exists */
		}
	}
	_columnsEnsured = true;
}

// Helper to convert undefined to null
const n = (val) => (val === undefined ? null : val);

const INSERT_SLIP_SQL = `INSERT INTO payroll_slips (
  month, employee_id, gross, da_used, da, basic, hra, conveyance, call_allowance,
  other_allowances, bonus, incentive, ot_rate, total_earnings,
  pf_employee, esic_employee, pt, mlwf, retention, lwf, tds,
  other_deductions, total_deductions, net_pay,
  pf_employer, esic_employer, mlwf_employer, insurance,
  gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
  standard_working_days, days_present, days_absent, days_leave, payable_days, lop_days,
  lop_deduction, overtime_hours, full_month_gross,
  pl_total, pl_used, pl_balance,
  payment_status, remarks
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function payrollToParams(payroll) {
	return [
		payroll.month,
		payroll.employee_id,
		n(payroll.gross) || 0,
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
	];
}

/**
 * Generate and save payroll slip for an employee
 * Links salary structure with attendance for monthly calculations
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Generated payroll slip
 */
export async function generatePayrollSlip(employeeId, month, options = {}) {
	const payroll = await calculateEmployeePayroll(employeeId, month, options);

	if (!payroll) {
		throw new Error(
			`No active salary profile found for employee ${employeeId}. Please set up salary structure first.`
		);
	}

	const db = await dbConnect();

	try {
		await ensurePayrollColumns(db);

		const [result] = await db.execute(
			INSERT_SLIP_SQL,
			payrollToParams(payroll)
		);

		return {
			...payroll,
			id: result.insertId,
			created_at: new Date(),
		};
	} catch (error) {
		if (error.code === 'ER_DUP_ENTRY') {
			throw new Error(
				`Payroll slip already exists for employee ${employeeId} for month ${month}`
			);
		}

		throw error;
	} finally {
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

// ═══════════════════════════════════════════════════════════════════
// BATCH HELPERS — fetch data for many employees in one DB round-trip
// ═══════════════════════════════════════════════════════════════════

/**
 * Fetch effective Salary Profiles for a list of employees in two queries.
 * Canonical profiles are merged over legacy fallback rows field by field.
 */
async function batchGetSalaryProfiles(db, employeeIds, forDate) {
	if (employeeIds.length === 0) return new Map();

	const placeholders = employeeIds.map(() => '?').join(',');
	const date = scheduleDate(forDate);
	const [canonicalRows] = await db.execute(
		`SELECT *
     FROM employee_salary_profile
     WHERE is_active = 1
       AND employee_id IN (${placeholders})
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY employee_id, effective_from DESC, id DESC`,
		[...employeeIds, date, date]
	);
	const [legacyRows] = await db.execute(
		`SELECT *
     FROM salary_structures
     WHERE is_active = 1
       AND employee_id IN (${placeholders})
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY employee_id, effective_from DESC, id DESC`,
		[...employeeIds, date, date]
	);

	const canonicalMap = new Map();
	for (const row of canonicalRows) {
		if (!canonicalMap.has(row.employee_id)) {
			canonicalMap.set(row.employee_id, row);
		}
	}
	const legacyMap = new Map();
	for (const row of legacyRows) {
		if (!legacyMap.has(row.employee_id)) legacyMap.set(row.employee_id, row);
	}

	const profileMap = new Map();
	for (const employeeId of employeeIds) {
		const canonical = canonicalMap.get(employeeId);
		const legacy = legacyMap.get(employeeId);
		if (canonical || legacy) {
			profileMap.set(employeeId, normalizeSalaryProfile(canonical, legacy));
		}
	}

	return profileMap;
}

/**
 * Fetch attendance records for a list of employee IDs for a given month
 * in a single query. Returns Map<employee_id, attendanceSummary>.
 * Integrates with holiday_master for accurate working days calculation.
 */
async function batchGetAttendance(db, employeeIds, month) {
	// Get actual working days from holiday_master
	const workingDaysInfo = await getWorkingDaysForMonth(month);
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
 * Generate payroll slips for all active employees for a given month.
 * OPTIMIZED: uses batch DB queries + multi-row inserts.
 * @param {string} month - Payroll month (YYYY-MM-01 format)
 * @param {string|null} salaryType - Optional salary type filter
 * @returns {Promise<object>} Summary of generation results
 */
export async function generateMonthlyPayroll(
	month,
	salaryType = null,
	includeBonus = false,
	bonusEmployeeIds = null
) {
	const db = await dbConnect();

	try {
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

		// ── 1. Fetch employee list (canonical profiles first) ──
		const date = scheduleDate(month);
		let espQuery = `SELECT DISTINCT esp.employee_id, CONCAT(e.first_name, ' ', e.last_name) as name
       FROM employee_salary_profile esp
       JOIN employees e ON e.id = esp.employee_id
       WHERE (e.status = 'active' OR e.status IS NULL)
         AND esp.is_active = 1
         AND esp.effective_from <= ?
         AND (esp.effective_to IS NULL OR esp.effective_to >= ?)`;
		const espParams = [date, date];
		if (isPayrollFilter)
			espQuery += ` AND (esp.salary_type IS NULL OR esp.salary_type != 'contract')`;
		else if (isContractFilter) espQuery += ` AND esp.salary_type = 'contract'`;
		else if (filterBySalaryType) {
			espQuery += ` AND (esp.salary_type = ? OR (esp.salary_type IS NULL AND ? = 'monthly'))`;
			espParams.push(salaryType, salaryType);
		}
		const [espEmployees] = await db.execute(espQuery, espParams);

		let ssQuery = `SELECT DISTINCT ss.employee_id, CONCAT(e.first_name, ' ', e.last_name) as name
       FROM salary_structures ss
       JOIN employees e ON e.id = ss.employee_id
       WHERE (e.status = 'active' OR e.status IS NULL)
         AND ss.is_active = 1
         AND ss.effective_from <= ?
         AND (ss.effective_to IS NULL OR ss.effective_to >= ?)
         AND NOT EXISTS (
           SELECT 1 FROM employee_salary_profile esp
           WHERE esp.employee_id = ss.employee_id
             AND esp.is_active = 1
             AND esp.effective_from <= ?
             AND (esp.effective_to IS NULL OR esp.effective_to >= ?)
         )`;
		const ssParams = [date, date, date, date];
		if (isPayrollFilter)
			ssQuery += ` AND (ss.pay_type IS NULL OR ss.pay_type != 'contract')`;
		else if (isContractFilter) ssQuery += ` AND ss.pay_type = 'contract'`;
		else if (filterBySalaryType) {
			ssQuery += ` AND (ss.pay_type = ? OR (ss.pay_type IS NULL AND ? = 'monthly'))`;
			ssParams.push(salaryType, salaryType);
		}
		const [ssEmployees] = await db.execute(ssQuery, ssParams);

		const employees = [...espEmployees, ...ssEmployees];
		if (employees.length === 0) {
			return { month, total: 0, success: 0, failed: 0, skipped: 0, errors: [] };
		}

		const employeeIds = employees.map((e) => e.employee_id);
		const employeeNameMap = new Map(
			employees.map((e) => [e.employee_id, e.name])
		);

		// ── 2. Check for existing slips (skip duplicates in bulk) ──
		const phExisting = employeeIds.map(() => '?').join(',');
		const [existingSlips] = await db.execute(
			`SELECT employee_id FROM payroll_slips WHERE month = ? AND employee_id IN (${phExisting})`,
			[month, ...employeeIds]
		);
		const existingSet = new Set(existingSlips.map((r) => r.employee_id));
		const newIds = employeeIds.filter((id) => !existingSet.has(id));

		const results = {
			month,
			total: employees.length,
			success: 0,
			failed: 0,
			skipped: existingSet.size,
			errors: [],
		};

		if (newIds.length === 0) {
			return results;
		}

		// ── 3. Batch-fetch effective schedules, profiles, and attendance ──
		const payrollSchedule = await getEffectivePayrollSchedule(month, db);
		const profileMap = await batchGetSalaryProfiles(db, newIds, month);
		const attendanceMap = await batchGetAttendance(db, newIds, month);

		// ── 4. Ensure schema once ──
		await ensurePayrollColumns(db);

		// ── 5. Compute all payrolls in memory and batch-insert ──
		const BATCH_SIZE = 50;
		const toInsert = [];

		for (const empId of newIds) {
			const profile = profileMap.get(empId);
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
			const attendance = attendanceMap.get(empId) || defaultAtt;

			try {
				// If bonusEmployeeIds is provided, only include bonus for those specific employees
				const empIncludeBonus =
					includeBonus &&
					(bonusEmployeeIds === null || bonusEmployeeIds.includes(empId));
				const payroll = computePayroll(
					empId,
					month,
					profile,
					undefined,
					attendance,
					empIncludeBonus,
					payrollSchedule
				);
				toInsert.push(payroll);
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
		for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
			const batch = toInsert.slice(i, i + BATCH_SIZE);
			const singlePlaceholder = '(' + new Array(43).fill('?').join(',') + ')';
			const allPlaceholders = batch.map(() => singlePlaceholder).join(',');
			const allParams = batch.flatMap(payrollToParams);

			const batchSQL = `INSERT INTO payroll_slips (
        month, employee_id, gross, da_used, da, basic, hra, conveyance, call_allowance,
        other_allowances, bonus, incentive, total_earnings,
        pf_employee, esic_employee, pt, mlwf, retention, lwf, tds,
        other_deductions, total_deductions, net_pay,
        pf_employer, esic_employer, mlwf_employer, insurance,
        gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
        standard_working_days, days_present, days_absent, days_leave, payable_days, lop_days,
        lop_deduction, overtime_hours, full_month_gross,
        payment_status, remarks
      ) VALUES ${allPlaceholders}`;

			try {
				await db.query(batchSQL, allParams);
				results.success += batch.length;
			} catch (batchErr) {
				// Fallback: insert one-by-one so partial success is recorded
				for (const payroll of batch) {
					try {
						await db.execute(INSERT_SLIP_SQL, payrollToParams(payroll));
						results.success++;
					} catch (singleErr) {
						if (singleErr.code === 'ER_DUP_ENTRY') {
							results.skipped++;
						} else {
							results.failed++;
							results.errors.push({
								employee_id: payroll.employee_id,
								name: employeeNameMap.get(payroll.employee_id),
								error: singleErr.message,
							});
						}
					}
				}
			}
		}

		db.release();
		return results;
	} catch (error) {
		throw error;
	} finally {
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

/**
 * Generate payroll slips for a list of specific employee IDs.
 * OPTIMIZED: batch-fetches data and inserts in bulk.
 * @param {number[]} employeeIds - Array of employee IDs
 * @param {string} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Summary { success, failed, skipped, errors }
 */
export async function generatePayrollSlipsBatch(
	employeeIds,
	month,
	includeBonus = false,
	bonusEmployeeIds = null
) {
	if (!employeeIds || employeeIds.length === 0) {
		return { success: 0, failed: 0, skipped: 0, errors: [] };
	}

	const db = await dbConnect();
	try {
		// Check existing
		const ph = employeeIds.map(() => '?').join(',');
		const [existingSlips] = await db.execute(
			`SELECT employee_id FROM payroll_slips WHERE month = ? AND employee_id IN (${ph})`,
			[month, ...employeeIds]
		);
		const existingSet = new Set(existingSlips.map((r) => r.employee_id));
		const newIds = employeeIds.filter((id) => !existingSet.has(id));

		const results = {
			success: 0,
			failed: 0,
			skipped: existingSet.size,
			errors: [],
		};
		if (newIds.length === 0) {
			return results;
		}

		// Batch-fetch effective schedules, profiles, and attendance.
		const payrollSchedule = await getEffectivePayrollSchedule(month, db);
		const profileMap = await batchGetSalaryProfiles(db, newIds, month);
		const attendanceMap = await batchGetAttendance(db, newIds, month);
		await ensurePayrollColumns(db);

		for (const empId of newIds) {
			const profile = profileMap.get(empId);
			if (!profile) {
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
			const attendance = attendanceMap.get(empId) || defaultAtt;
			try {
				// If bonusEmployeeIds is provided, only include bonus for those specific employees
				const empIncludeBonus =
					includeBonus &&
					(bonusEmployeeIds === null || bonusEmployeeIds.includes(empId));
				const payroll = computePayroll(
					empId,
					month,
					profile,
					undefined,
					attendance,
					empIncludeBonus,
					payrollSchedule
				);
				await db.execute(INSERT_SLIP_SQL, payrollToParams(payroll));
				results.success++;
			} catch (err) {
				if (err.code === 'ER_DUP_ENTRY') results.skipped++;
				else {
					results.failed++;
					results.errors.push({ employee_id: empId, error: err.message });
				}
			}
		}

		db.release();
		return results;
	} catch (error) {
		throw error;
	} finally {
		try {
			db.release();
		} catch (_) {
			/* ignore */
		}
	}
}

const payrollCalculator = {
	getCurrentDA,
	getEffectivePayrollSchedule,
	getEmployeeAttendance,
	getEmployeeSalaryProfile,
	calculateEmployeePayroll,
	generatePayrollSlip,
	generatePayrollSlipsBatch,
	generateMonthlyPayroll,
};

export default payrollCalculator;
