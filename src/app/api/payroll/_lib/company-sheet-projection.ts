/**
 * Company-sheet projection for the Payroll Slip listing (issue #428).
 *
 * This is the listing's read adapter, not a second read model. It batches the
 * monthly Attendance Records, the active Holiday Master rows and the returned
 * employees' identity/employment evidence, then hands them to the pure
 * `buildCompanySheet` module. Money still comes from the already-normalized
 * Payroll Slip rows: nothing here re-prices a slip or derives Basic/DA.
 *
 * Source failures are values, not request failures. A failed attendance or
 * holiday read comes back as `{ state: 'error' }` so the model can keep every
 * recorded money cell visible while marking only the dependent attendance
 * cells unavailable. The adapter never returns daily records to the caller;
 * attendance is consumed as monthly aggregates by the model.
 *
 * Query shape:
 * - one employee batch for the returned Payroll Slips, never the directory;
 * - one attendance batch for the selected month;
 * - one holiday batch for the selected month.
 *
 * Soft deletes: `employee_attendance` and `holiday_master` have no soft-delete
 * column. The employees batch deliberately keeps soft-deleted Employees who
 * still own a Payroll Slip — the listing's JOIN does the same, and filtering
 * here would strip identity from exactly the historical rows the grid exists
 * to display.
 */

import {
	buildCompanySheet,
	type CompanySheetAttendanceRecord,
	type CompanySheetAttendanceSource,
	type CompanySheetEmploymentInput,
	type CompanySheetHolidayInput,
	type CompanySheetHolidaySource,
	type CompanySheetResult,
	type CompanySheetRow,
	type CompanySheetSlipInput,
} from '@/lib/payroll-company-sheet';
import { normalizePayrollRunMonth } from '@/lib/payroll-run-roster';

/** Exact `include` value that opts a listing request into the projection. */
export const COMPANY_SHEET_INCLUDE = 'company-sheet';

/** Month-level projection data; the rows carry their own cells and buckets. */
export type CompanySheetProjectionMeta = Omit<CompanySheetResult, 'rows'>;

export interface CompanySheetProjection {
	readonly meta: CompanySheetProjectionMeta;
	readonly rowsBySlipId: ReadonlyMap<number, CompanySheetRow>;
}

export interface CompanySheetProjectionInput {
	/** `YYYY-MM` or `YYYY-MM-01`, already validated by the route. */
	readonly month: string;
	/** The listing's normalized Payroll Slip rows. */
	readonly slips: readonly CompanySheetSlipInput[];
	/** The server's local calendar day. The pure model never reads a clock. */
	readonly currentDate: string;
}

/**
 * The subset of the mysql2 connection this adapter needs. Keeping it explicit
 * makes the adapter usable with the route's pooled connection and test doubles.
 */
export interface CompanySheetProjectionDb {
	execute(
		sql: string,
		values?: readonly unknown[]
	): Promise<[unknown, unknown]>;
}

interface EmployeeEvidenceRow {
	id: number | string;
	employee_id?: string | null;
	position?: string | null;
	uan?: string | null;
	pf_no?: string | null;
	esi_no?: string | null;
	status?: string | null;
	joining_date?: string | Date | null;
	hire_date?: string | Date | null;
	exit_date?: string | Date | null;
}

const ATTENDANCE_UNAVAILABLE =
	'Attendance records could not be read; attendance counts are unavailable.';
const HOLIDAY_UNAVAILABLE =
	'Holiday records could not be read; attendance counts are unavailable.';

/** The server's local calendar day, never the client's and never UTC-shifted. */
export function companySheetCurrentDate(now: Date = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}

/** `YYYY-MM-01` plus the month's inclusive first and last calendar days. */
function monthWindow(month: string): {
	normalized: string;
	start: string;
	end: string;
} {
	const normalized = normalizePayrollRunMonth(month);
	const monthKey = normalized.slice(0, 7);
	const [year, monthNumber] = monthKey.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return {
		normalized,
		start: normalized,
		end: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
	};
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

function reasonFor(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * One batched employees read for the returned Payroll Slips. A failure is
 * logged and degrades to no employment evidence, which the model reports as
 * `employment_unavailable`; the recorded money is still returned.
 */
async function readEmployees(
	db: CompanySheetProjectionDb,
	employeeIds: readonly number[]
): Promise<EmployeeEvidenceRow[]> {
	if (employeeIds.length === 0) return [];

	try {
		const [rows] = await db.execute(
			`SELECT id, employee_id, position, uan, pf_no, esi_no, status,
              joining_date, hire_date, exit_date
         FROM employees
        WHERE id IN (${placeholders(employeeIds.length)})`,
			employeeIds
		);
		return (rows as EmployeeEvidenceRow[] | null) ?? [];
	} catch (error) {
		console.error(
			'company-sheet employee evidence read failed:',
			reasonFor(error)
		);
		return [];
	}
}

async function readAttendance(
	db: CompanySheetProjectionDb,
	employeeIds: readonly number[],
	monthStart: string,
	monthEnd: string
): Promise<CompanySheetAttendanceSource> {
	if (employeeIds.length === 0) {
		return { state: 'loaded', records: [] };
	}

	try {
		const [rows] = await db.execute(
			`SELECT employee_id, attendance_date, status, overtime_hours
         FROM employee_attendance
        WHERE employee_id IN (${placeholders(employeeIds.length)})
          AND attendance_date BETWEEN ? AND ?
        ORDER BY employee_id ASC, attendance_date ASC`,
			[...employeeIds, monthStart, monthEnd]
		);
		return {
			state: 'loaded',
			records: (rows as CompanySheetAttendanceRecord[] | null) ?? [],
		};
	} catch (error) {
		console.error('company-sheet attendance read failed:', reasonFor(error));
		return { state: 'error', message: ATTENDANCE_UNAVAILABLE };
	}
}

async function readHolidays(
	db: CompanySheetProjectionDb,
	monthStart: string,
	monthEnd: string
): Promise<CompanySheetHolidaySource> {
	try {
		const [rows] = await db.execute(
			`SELECT date, is_active, is_optional
         FROM holiday_master
        WHERE is_active = 1
          AND date BETWEEN ? AND ?
        ORDER BY date ASC`,
			[monthStart, monthEnd]
		);
		return {
			state: 'loaded',
			holidays: (rows as CompanySheetHolidayInput[] | null) ?? [],
		};
	} catch (error) {
		console.error('company-sheet holiday read failed:', reasonFor(error));
		return { state: 'error', message: HOLIDAY_UNAVAILABLE };
	}
}

/**
 * The employee's batch row carries the identity fields the listing does not
 * select. `employees.employee_id` is the business Employee Code, never the
 * biometric/device code. `position` is the company-sheet Designation; the
 * listing's grade alias is deliberately not used.
 */
function withEmployeeIdentity(
	slip: CompanySheetSlipInput,
	employee: EmployeeEvidenceRow | undefined
): CompanySheetSlipInput {
	if (!employee) return slip;

	return {
		...slip,
		employee_code: employee.employee_id ?? slip.employee_code,
		position: employee.position ?? slip.position,
		uan: employee.uan ?? null,
		pf_no: employee.pf_no ?? null,
		esi_no: employee.esi_no ?? null,
	};
}

export async function loadCompanySheetProjection(
	db: CompanySheetProjectionDb,
	input: CompanySheetProjectionInput
): Promise<CompanySheetProjection> {
	const { normalized, start, end } = monthWindow(input.month);
	const employeeIds = [
		...new Set(
			input.slips
				.map((slip) => Number(slip.employee_id))
				.filter((id) => Number.isInteger(id))
		),
	];

	let employees: EmployeeEvidenceRow[] = [];
	let attendance: CompanySheetAttendanceSource = {
		state: 'loaded',
		records: [],
	};
	let holidays: CompanySheetHolidaySource = { state: 'loaded', holidays: [] };

	if (employeeIds.length > 0) {
		// Independent sources, so one failed read never cancels the others.
		[employees, attendance, holidays] = await Promise.all([
			readEmployees(db, employeeIds),
			readAttendance(db, employeeIds, start, end),
			readHolidays(db, start, end),
		]);
	}

	const employeeById = new Map<number, EmployeeEvidenceRow>();
	for (const employee of employees) {
		const id = Number(employee.id);
		if (Number.isInteger(id)) employeeById.set(id, employee);
	}

	const employment: CompanySheetEmploymentInput[] = [
		...employeeById.entries(),
	].map(([employeeId, employee]) => ({
		employee_id: employeeId,
		status: employee.status ?? null,
		joining_date: employee.joining_date ?? null,
		hire_date: employee.hire_date ?? null,
		exit_date: employee.exit_date ?? null,
	}));

	const projectionSlips = input.slips.map((slip) =>
		withEmployeeIdentity(slip, employeeById.get(Number(slip.employee_id)))
	);

	const result = buildCompanySheet({
		month: normalized,
		current_date: input.currentDate,
		slips: projectionSlips,
		attendance,
		holidays,
		employment,
	});

	const rowsBySlipId = new Map<number, CompanySheetRow>();
	for (const row of result.rows) rowsBySlipId.set(row.slip_id, row);

	const meta: CompanySheetProjectionMeta = {
		month: result.month,
		month_key: result.month_key,
		current_date: result.current_date,
		total_days: result.total_days,
		sources: result.sources,
		issues: result.issues,
	};
	return { meta, rowsBySlipId };
}
