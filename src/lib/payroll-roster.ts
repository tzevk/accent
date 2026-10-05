/**
 * Roster selection + exclusion disclosure for the workforce reports
 * (GitHub issues #278, #293).
 *
 * The report roster is **Employee Type = Payroll** on a live
 * (`isDelete = 0`) employee record — the Employee Type is the roster switch,
 * never the Salary Type. Two readers share this module:
 *
 * - The **Attendance report** selects the roster as of today: live,
 *   `status = 'active'`, `employee_type = 'Payroll'`. Someone who never punched
 *   still gets a row — the report is the full roster, not the punch log.
 * - The **Employee Utilization report** selects the roster for a viewed month
 *   through the optional `month` option: live, `employee_type = 'Payroll'`,
 *   and the employment window intersects the month. Status no longer
 *   disqualifies — a leaver stays visible in the months they worked, and a
 *   joiner is absent from months before they joined.
 *
 * Why this module never touches `employee_salary_profile` (deliberate
 * divergence from payroll): payroll decides stream membership on
 * `salary_profile.salary_type` — see `generateMonthlyPayroll` in
 * `src/utils/payroll-calculator.js`, where the payroll stream is
 * `salary_type IS NULL OR salary_type != 'contract'` over a JOIN, so a
 * Payroll-typed employee with no profile row silently vanishes from a payroll
 * run. Both reports filter on the **Employee record** alone: an employee with
 * no salary profile is still on the roster. `RosterEmployeeInput` accepts
 * `has_salary_profile` so the call site can say so out loud, and this module
 * ignores it.
 *
 * `employees.employee_type` is `ENUM('Payroll','Contract','Deputation',
 * 'Permanent','Intern')` and `status` is `ENUM('active','inactive','terminated')`
 * — both are matched on their exact stored spelling, never case-folded: the
 * database cannot hold `'payroll'`, so a loose match would only ever admit rows
 * that do not exist.
 *
 * Everything here is pure. The caller hands over the employees it read.
 */

/** The one employee type the payroll roster covers. */
export const PAYROLL_EMPLOYEE_TYPE = 'Payroll' as const;

/** `employees.employee_type` — exact stored spellings. */
export type RosterEmployeeType =
	| 'Payroll'
	| 'Contract'
	| 'Deputation'
	| 'Permanent'
	| 'Intern';

export interface RosterEmployeeInput {
	/** `employees.id` */
	id: number;
	/** Accent's own employee code (`employees.employee_id`) */
	employee_id: string;
	name: string;
	department?: string | null;
	/** Smart Office code the biometric punches arrive under */
	smartoffice_code?: string | null;
	/** NULL for staff whose type was never filled in — excluded, and reported. */
	employee_type: RosterEmployeeType | string | null;
	/** `employees.status` — anything other than 'active' is excluded today. */
	status: string;
	/** `employees.isDelete` — 1 removes the person from the directory. */
	isDelete: number;
	/**
	 * Whether a row exists in `employee_salary_profile`. Accepted and
	 * **ignored** — see the module note on the deliberate payroll divergence.
	 */
	has_salary_profile?: boolean;
	// ── Employment window inputs (month mode only) ────────────────────
	// All optional so the Attendance report's as-of-today call site stays
	// untouched; the Utilization loader fills them from the employee record
	// plus its recorded evidence.

	/** `employees.joining_date` — first choice for the window's start. */
	joining_date?: string | null;
	/** `employees.hire_date` — second choice for the window's start. */
	hire_date?: string | null;
	/** `employees.exit_date` — first choice for the window's end. */
	exit_date?: string | null;
	/** Earliest `employee_attendance.attendance_date`, when recorded. */
	first_attendance_date?: string | null;
	/** Latest `employee_attendance.attendance_date`, when recorded. */
	last_attendance_date?: string | null;
	/** Earliest Logged Hours day (`user_activity_assignments.daily_entries`). */
	first_logged_date?: string | null;
	/** Latest Logged Hours day (`user_activity_assignments.daily_entries`). */
	last_logged_date?: string | null;
}

/** An employee the report covers, in stable report order. */
export interface RosterMember {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	smartoffice_code: string | null;
	/** Month mode only: first day of the resolved employment window, `null` = open. */
	employment_start?: string | null;
	/** Month mode only: last day of the resolved employment window, `null` = open. */
	employment_end?: string | null;
}

/**
 * Why an employee was dropped.
 * `not_payroll_type` — still active staff whose Employee Type is not Payroll.
 * `terminated` — the Status is not Active (terminated, inactive); they are no
 * longer on the active roster at all. Directory mode only.
 */
export type RosterExclusionReason = 'not_payroll_type' | 'terminated';

/** One line of the disclosure: a reason, the value that caused it, a count. */
export interface RosterExclusionBucket {
	reason: RosterExclusionReason;
	/** The stored value: 'Contract', 'Deputation', 'Permanent', 'Intern',
	 *  'terminated', 'inactive' — or null for a NULL employee_type. */
	value: string | null;
	count: number;
}

/** A dropped employee, named so the disclosure can point at a person. */
export interface ExcludedEmployee {
	id: number;
	employee_id: string;
	name: string;
	employee_type: RosterEmployeeType | string | null;
	status: string;
	reason: RosterExclusionReason;
}

/**
 * What the filter removed. `null` (rather than an all-zero object) when
 * nothing was dropped, so the UI can stay silent.
 */
export interface RosterDisclosure {
	/**
	 * Live employees the filter looked at, active or not. In month mode this
	 * is the live employees whose employment window intersects the month —
	 * the month's candidates — not the whole directory.
	 */
	considered_count: number;
	/** How many of them are on the roster. */
	roster_count: number;
	/** Every employee dropped, across both reasons. */
	excluded_count: number;
	/** Dropped for a non-Payroll Employee Type — staff who are still active. */
	excluded_type_count: number;
	/** Dropped for a non-Active Status. Directory mode only: 0 in month mode. */
	excluded_status_count: number;
	/** Breakdown by reason, then by the value that caused the drop. */
	buckets: RosterExclusionBucket[];
	/** Every dropped employee, in roster order. */
	excluded: ExcludedEmployee[];
}

export interface RosterResult {
	/** The report's rows, ordered by employee code then name then id. */
	roster: RosterMember[];
	/** null when nothing was dropped. */
	disclosure: RosterDisclosure | null;
}

export interface SelectPayrollRosterOptions {
	/**
	 * `YYYY-MM`. When present the roster is month-scoped: an employee must be
	 * live, Employee Type = Payroll, and their employment window must
	 * intersect the month. When absent the roster is the as-of-today
	 * directory rule the Attendance report has always used.
	 */
	month?: string;
}

/** The filter, worded for the screen, in one place so it cannot drift. */
export const ROSTER_FILTER_DESCRIPTION =
	'isDelete = 0, Status = Active, and Employee Type = Payroll';

/** The month-scoped filter, worded for the screen. */
export const ROSTER_MONTH_FILTER_DESCRIPTION =
	'isDelete = 0, Employee Type = Payroll, and the employment window covers the viewed month';

/** Why the roster and the payroll run can disagree. */
export const ROSTER_MEMBERSHIP_NOTE =
	'Attendance is reported from the employee record, not from the salary profile: an employee with no salary profile is still on this roster.';

/** The month-scoped version of the note above. */
export const ROSTER_MONTH_MEMBERSHIP_NOTE =
	'This report reads the employee record, not the salary profile: an employee with no salary profile is still on the roster, and each month lists only the employees whose employment window covers it.';

// ─── Employment window ────────────────────────────────────────────────

export interface EmploymentWindowInput {
	/** `employees.status` — 'active' keeps a missing bound open. */
	status: string;
	joining_date?: string | null;
	hire_date?: string | null;
	exit_date?: string | null;
	first_attendance_date?: string | null;
	last_attendance_date?: string | null;
	first_logged_date?: string | null;
	last_logged_date?: string | null;
}

/** Where one bound of the window came from — the fallback order, recorded. */
export type EmploymentWindowSource =
	| 'joining_date'
	| 'hire_date'
	| 'exit_date'
	| 'attendance'
	| 'logged_hours'
	| 'active_status'
	| 'unresolved';

/**
 * The resolved employment window. `start`/`end` are `YYYY-MM-DD` days; `null`
 * means the bound is open (the employee counts from before / until after any
 * month). `unresolved` marks a non-active employee with no date and no
 * recorded evidence: nothing can place them in a month, so month mode leaves
 * them off every roster and the caller can surface the gap.
 */
export interface EmploymentWindow {
	start: string | null;
	end: string | null;
	unresolved: boolean;
	start_source: EmploymentWindowSource;
	end_source: EmploymentWindowSource;
}

/** `YYYY-MM-DD` prefix of a stored date, or null when there is none. */
function dayOf(value: string | null | undefined): string | null {
	if (typeof value !== 'string' || value.length < 10) return null;
	return value.slice(0, 10);
}

/** First/last day of a `YYYY-MM` month; null when the month is not one. */
function monthBounds(month: string): { start: string; end: string } | null {
	const match = /^(\d{4})-(\d{2})$/.exec(month);
	if (!match) return null;
	const monthNumber = Number(match[2]);
	if (monthNumber < 1 || monthNumber > 12) return null;
	const lastDay = new Date(
		Date.UTC(Number(match[1]), monthNumber, 0)
	).getUTCDate();
	return {
		start: `${month}-01`,
		end: `${month}-${String(lastDay).padStart(2, '0')}`,
	};
}

/**
 * Resolve an employee's employment window. The fallback order is the one
 * recorded for the ADR (#301):
 *
 * - start: `joining_date` → `hire_date` → earliest recorded evidence (first
 *   attendance, else first Logged Hours day) → open when the status is
 *   active, unresolved otherwise.
 * - end: `exit_date` → latest recorded evidence (last attendance, else last
 *   Logged Hours day) → open when the status is active, unresolved otherwise.
 *
 * Evidence is preferred in source order (attendance before Logged Hours), not
 * by earliest date: attendance is the attendance/payroll signal, logged hours
 * the project signal.
 */
export function resolveEmploymentWindow(
	input: EmploymentWindowInput
): EmploymentWindow {
	const isActive = input.status === 'active';

	const joining = dayOf(input.joining_date);
	const hire = dayOf(input.hire_date);
	const firstAttendance = dayOf(input.first_attendance_date);
	const firstLogged = dayOf(input.first_logged_date);
	const exit = dayOf(input.exit_date);
	const lastAttendance = dayOf(input.last_attendance_date);
	const lastLogged = dayOf(input.last_logged_date);

	let start: string | null = null;
	let startSource: EmploymentWindowSource = 'unresolved';
	if (joining) {
		start = joining;
		startSource = 'joining_date';
	} else if (hire) {
		start = hire;
		startSource = 'hire_date';
	} else if (firstAttendance) {
		start = firstAttendance;
		startSource = 'attendance';
	} else if (firstLogged) {
		start = firstLogged;
		startSource = 'logged_hours';
	} else if (isActive) {
		start = null;
		startSource = 'active_status';
	}

	let end: string | null = null;
	let endSource: EmploymentWindowSource = 'unresolved';
	if (exit) {
		end = exit;
		endSource = 'exit_date';
	} else if (lastAttendance) {
		end = lastAttendance;
		endSource = 'attendance';
	} else if (lastLogged) {
		end = lastLogged;
		endSource = 'logged_hours';
	} else if (isActive) {
		end = null;
		endSource = 'active_status';
	}

	return {
		start,
		end,
		unresolved: startSource === 'unresolved' || endSource === 'unresolved',
		start_source: startSource,
		end_source: endSource,
	};
}

/**
 * Whether a resolved window covers any day of a `YYYY-MM` month. An
 * unresolved window covers no month — the employee cannot be placed at all.
 */
export function intersectsEmploymentWindow(
	window: EmploymentWindow,
	month: string
): boolean {
	if (window.unresolved) return false;
	const bounds = monthBounds(month);
	if (!bounds) return false;
	if (window.start !== null && window.start > bounds.end) return false;
	if (window.end !== null && window.end < bounds.start) return false;
	return true;
}

// ─── Ordering ─────────────────────────────────────────────────────────

const CHAR_0 = 48;
const CHAR_9 = 57;

const isDigitCode = (code: number) => code >= CHAR_0 && code <= CHAR_9;

/**
 * Deterministic employee-code order: runs of digits compare as numbers, so
 * `EMP-2` precedes `EMP-10` instead of the lexicographic `EMP-10` first, and
 * `EMP-010` ties with `EMP-10`. Pure string work with no locale involved, so
 * the order is byte-identical on every host — which is the point: the matrix
 * rows must not reshuffle between runs.
 */
function compareEmployeeCode(a: string, b: string): number {
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const ca = a.charCodeAt(i);
		const cb = b.charCodeAt(j);
		if (isDigitCode(ca) && isDigitCode(cb)) {
			let endA = i;
			while (endA < a.length && isDigitCode(a.charCodeAt(endA))) endA++;
			let endB = j;
			while (endB < b.length && isDigitCode(b.charCodeAt(endB))) endB++;
			// Leading zeros carry no order, so '007' and '7' compare equal.
			const digitsA = a.slice(i, endA).replace(/^0+/, '');
			const digitsB = b.slice(j, endB).replace(/^0+/, '');
			if (digitsA.length !== digitsB.length)
				return digitsA.length - digitsB.length;
			if (digitsA !== digitsB) return digitsA < digitsB ? -1 : 1;
			i = endA;
			j = endB;
			continue;
		}
		if (ca !== cb) return ca < cb ? -1 : 1;
		i++;
		j++;
	}
	return a.length - i - (b.length - j);
}

/** Report order: employee code, then name, then id as the final tiebreak. */
function byCodeThenName(
	a: { id: number; employee_id: string; name: string },
	b: { id: number; employee_id: string; name: string }
): number {
	const byCode = compareEmployeeCode(a.employee_id, b.employee_id);
	if (byCode !== 0) return byCode;
	if (a.name !== b.name) return a.name < b.name ? -1 : 1;
	return a.id - b.id;
}

/** Reason first (type before status), then the value, NULL employee_type last. */
function byReasonThenValue(
	a: RosterExclusionBucket,
	b: RosterExclusionBucket
): number {
	if (a.reason !== b.reason) return a.reason === 'not_payroll_type' ? -1 : 1;
	if (a.value === b.value) return 0;
	if (a.value === null) return 1;
	if (b.value === null) return -1;
	return a.value < b.value ? -1 : 1;
}

// ─── Selection ────────────────────────────────────────────────────────

function toMember(
	employee: RosterEmployeeInput,
	window?: EmploymentWindow
): RosterMember {
	return {
		id: employee.id,
		employee_id: employee.employee_id,
		name: employee.name,
		department: employee.department ?? null,
		smartoffice_code: employee.smartoffice_code ?? null,
		...(window
			? { employment_start: window.start, employment_end: window.end }
			: {}),
	};
}

function toExcluded(
	employee: RosterEmployeeInput,
	reason: RosterExclusionReason
): ExcludedEmployee {
	return {
		id: employee.id,
		employee_id: employee.employee_id,
		name: employee.name,
		employee_type: employee.employee_type ?? null,
		status: employee.status,
		reason,
	};
}

/**
 * Select the payroll roster and account for everyone it left out. The input is
 * read, never sorted in place.
 *
 * Without `options.month` this is the directory rule the Attendance report has
 * always used (`isDelete = 0`, `status = 'active'`, Employee Type = Payroll).
 * With it, status no longer disqualifies: the month's candidates are the live
 * employees whose employment window intersects the month, and the disclosure
 * counts the non-Payroll ones among those candidates — the misfiled types a
 * month-scoped roster would otherwise hide.
 */
export function selectPayrollRoster(
	employees: readonly RosterEmployeeInput[],
	options: SelectPayrollRosterOptions = {}
): RosterResult {
	const monthMode = options.month !== undefined;
	const bounds = monthMode ? monthBounds(options.month as string) : null;
	// A malformed month covers no day, so it can select nobody.
	if (monthMode && bounds === null) return { roster: [], disclosure: null };

	const roster: RosterMember[] = [];
	const excluded: ExcludedEmployee[] = [];
	let consideredCount = 0;
	let excludedTypeCount = 0;
	let excludedStatusCount = 0;

	for (const employee of employees) {
		// isDelete = 1 means the person is gone from the employee directory
		// itself, not filtered out of it — counting them as an excluded
		// employee would misreport an active roster as short.
		if (employee.isDelete !== 0) continue;

		if (monthMode) {
			const window = resolveEmploymentWindow(employee);
			if (!intersectsEmploymentWindow(window, options.month as string)) {
				// Not employed in the viewed month — out of that month's scope
				// entirely (a joiner before they joined, a leaver after they
				// left, or an employee no evidence can place).
				continue;
			}
			consideredCount++;
			if (employee.employee_type !== PAYROLL_EMPLOYEE_TYPE) {
				excluded.push(toExcluded(employee, 'not_payroll_type'));
				excludedTypeCount++;
				continue;
			}
			roster.push(toMember(employee, window));
			continue;
		}

		consideredCount++;
		if (employee.status !== 'active') {
			excluded.push(toExcluded(employee, 'terminated'));
			excludedStatusCount++;
			continue;
		}
		if (employee.employee_type !== PAYROLL_EMPLOYEE_TYPE) {
			excluded.push(toExcluded(employee, 'not_payroll_type'));
			excludedTypeCount++;
			continue;
		}
		roster.push(toMember(employee));
	}

	roster.sort(byCodeThenName);
	if (excluded.length === 0) return { roster, disclosure: null };
	excluded.sort(byCodeThenName);

	const counts = new Map<string, RosterExclusionBucket>();
	for (const employee of excluded) {
		// A wrong type is explained by the type; a non-active status is
		// explained by the status, whatever the employee's type happens to be.
		const value =
			employee.reason === 'not_payroll_type'
				? employee.employee_type
				: employee.status;
		const key = `${employee.reason} ${value ?? ''}`;
		const bucket = counts.get(key);
		if (bucket) {
			bucket.count++;
		} else {
			counts.set(key, { reason: employee.reason, value, count: 1 });
		}
	}

	return {
		roster,
		disclosure: {
			considered_count: consideredCount,
			roster_count: roster.length,
			excluded_count: excluded.length,
			excluded_type_count: excludedTypeCount,
			excluded_status_count: excludedStatusCount,
			buckets: [...counts.values()].sort(byReasonThenValue),
			excluded,
		},
	};
}
