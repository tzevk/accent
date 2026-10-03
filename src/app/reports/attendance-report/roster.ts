/**
 * Roster selection + exclusion disclosure for the Attendance report
 * (GitHub issue #278).
 *
 * The report covers the **Payroll** roster, full stop: every employee whose
 * `employees` row is live (`isDelete = 0`), currently `status = 'active'`, and
 * typed `employee_type = 'Payroll'`. Someone who never punched still gets a row —
 * the report is the full roster, not the punch log.
 *
 * Why this module never touches `employee_salary_profile` (deliberate
 * divergence from payroll): payroll decides stream membership on
 * `salary_profile.salary_type` — see `generateMonthlyPayroll` in
 * `src/utils/payroll-calculator.js`, where the payroll stream is
 * `salary_type IS NULL OR salary_type != 'contract'` over a JOIN, so a
 * Payroll-typed employee with no profile row silently vanishes from a payroll
 * run. The attendance report filters on the **Employee record** alone: an
 * employee with no salary profile is still on the roster. `RosterEmployeeInput`
 * accepts `has_salary_profile` so the call site can say so out loud, and this
 * module ignores it.
 *
 * `employees.employee_type` is `ENUM('Payroll','Contract','Deputation',
 * 'Permanent','Intern')` and `status` is `ENUM('active','inactive','terminated')`
 * — both are matched on their exact stored spelling, never case-folded: the
 * database cannot hold `'payroll'`, so a loose match would only ever admit rows
 * that do not exist.
 *
 * Everything here is pure. The caller hands over the month's employees.
 */

/** The one employee type the Attendance report covers. */
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
	/** `employees.status` — anything other than 'active' is excluded. */
	status: string;
	/** `employees.isDelete` — 1 removes the person from the directory. */
	isDelete: number;
	/**
	 * Whether a row exists in `employee_salary_profile`. Accepted and
	 * **ignored** — see the module note on the deliberate payroll divergence.
	 */
	has_salary_profile?: boolean;
}

/** An employee the report covers, in stable report order. */
export interface RosterMember {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	smartoffice_code: string | null;
}

/**
 * Why an employee was dropped.
 * `not_payroll_type` — still active staff whose Employee Type is not Payroll.
 * `terminated` — the Status is not Active (terminated, inactive); they are no
 * longer on the active roster at all.
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
	/** Live employees the filter looked at, active or not. */
	considered_count: number;
	/** How many of them are on the roster. */
	roster_count: number;
	/** Every employee dropped, across both reasons. */
	excluded_count: number;
	/** Dropped for a non-Payroll Employee Type — staff who are still active. */
	excluded_type_count: number;
	/** Dropped for a non-Active Status. */
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

/** The filter, worded for the screen, in one place so it cannot drift. */
export const ROSTER_FILTER_DESCRIPTION =
	'isDelete = 0, Status = Active, and Employee Type = Payroll';

/** Why the roster and the payroll run can disagree. */
export const ROSTER_MEMBERSHIP_NOTE =
	'Attendance is reported from the employee record, not from the salary profile: an employee with no salary profile is still on this roster.';

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

/**
 * Select the Payroll roster for the month and account for everyone it left
 * out. The input is read, never sorted in place.
 */
export function selectPayrollRoster(
	employees: readonly RosterEmployeeInput[]
): RosterResult {
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
		consideredCount++;
		if (employee.status !== 'active') {
			excluded.push({
				id: employee.id,
				employee_id: employee.employee_id,
				name: employee.name,
				employee_type: employee.employee_type ?? null,
				status: employee.status,
				reason: 'terminated',
			});
			excludedStatusCount++;
			continue;
		}
		if (employee.employee_type !== PAYROLL_EMPLOYEE_TYPE) {
			excluded.push({
				id: employee.id,
				employee_id: employee.employee_id,
				name: employee.name,
				employee_type: employee.employee_type ?? null,
				status: employee.status,
				reason: 'not_payroll_type',
			});
			excludedTypeCount++;
			continue;
		}
		roster.push({
			id: employee.id,
			employee_id: employee.employee_id,
			name: employee.name,
			department: employee.department ?? null,
			smartoffice_code: employee.smartoffice_code ?? null,
		});
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
