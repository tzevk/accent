/**
 * Recorded employer-cost allocation — ADR-0016, ticket #307.
 *
 * One deep implementation of "what does the month's employee cost mean":
 *
 *  - A Payroll Slip's recorded employer cost is allocated across the
 *    Employee's eligible monthly Logged Hours. Each Project's share is its
 *    hours' share of the month's total; hours without a Project stay in the
 *    denominator and their share is Unallocated Employee Cost ("No project").
 *  - With no Logged Hours the whole recorded cost stays unallocated ("No
 *    logged hours") — it is never spread over known Projects.
 *  - Shares are deterministic cents that sum exactly to the slip: the
 *    largest-remainder step and the cent it applies are persisted.
 *  - Before Payroll Finalize (and for months without a finalized allocation)
 *    the month is an estimate computed by the corrected payroll calculation —
 *    never by client billing rates or a full-CTC redistribution.
 *
 * The freeze is written by `freezeMonthAllocations` inside Payroll Finalize's
 * transaction, so the run lock and the allocation snapshot are one atomic
 * write. Every read function takes the caller's connection: the later
 * financial close (#322) must be able to read one coherent snapshot.
 */

import Decimal from 'decimal.js';
import { add, div, mul, R, toNumber } from '@/lib/money';
import { sumLoggedHoursForMonth } from '@/lib/logged-hours';
import {
	buildLoggedHoursIdentifierMap,
	resolveLoggedHoursEmployeeId,
} from '@/lib/logged-hours-source';
import type { AssignmentResolutionRow } from '@/lib/logged-hours-source';
import {
	calculatePayroll,
	normalizeSalaryProfile,
} from '@/utils/payroll-calculation';
import {
	getEffectivePayrollSchedule,
	getWorkingDaysForMonth,
} from '@/utils/payroll-calculator';
import type { SqlConnection } from './records';
import type {
	CoverageNotice,
	PayrollEmployeeCost,
	PayrollExpenditure,
	PayrollHourLine,
	PayrollProjectShare,
} from './types';

/** The currency Payroll Slips are recorded in — the company's own payroll. */
export const PAYROLL_CURRENCY = 'INR';

/** One Logged-Hours destination considered by the allocation. */
export interface AllocationLine {
	project_id: number | null;
	project_code?: string | null;
	project_name?: string | null;
	client_name?: string | null;
	hours: number;
}

export interface AllocationOutcome {
	shares: PayrollProjectShare[];
	/** Total cent the largest-remainder step applied. */
	roundingAdjustment: number;
}

function round2(value: Decimal.Value): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/**
 * Merge duplicate destinations and drop non-positive hours, ordered by
 * Project id with No project last, so the input to the largest-remainder step
 * (and therefore its tie-break) is canonical.
 */
function mergeAllocationLines(
	lines: readonly AllocationLine[]
): AllocationLine[] {
	const merged = new Map<string, AllocationLine>();
	for (const line of lines) {
		const hours = R(line.hours);
		if (hours.lte(0)) continue;
		const key =
			line.project_id === null ? 'no-project' : String(line.project_id);
		const existing = merged.get(key);
		if (existing) {
			existing.hours = round2(add(existing.hours, hours));
		} else {
			merged.set(key, { ...line, hours: round2(hours) });
		}
	}
	return [...merged.values()].sort((a, b) => {
		if (a.project_id === b.project_id) return 0;
		if (a.project_id === null) return 1;
		if (b.project_id === null) return -1;
		return a.project_id - b.project_id;
	});
}

/**
 * Allocate one recorded employer cost across the month's Logged Hours.
 *
 * Deterministic cents: every exact share is floored to the cent, and the
 * remaining cents (always fewer than the number of destinations) go one each
 * to the largest fractional remainders — ties broken by larger hours, then by
 * the canonical destination order. The result sums exactly to `amount`, and
 * each share carries the cent it was given, so the adjustment is attributable.
 */
export function allocateEmployerCost(
	amount: number,
	lines: readonly AllocationLine[]
): AllocationOutcome {
	const money = R(amount).toDecimalPlaces(2);
	const merged = mergeAllocationLines(lines);
	const total = merged.reduce<Decimal>(
		(sum, line) => add(sum, line.hours),
		R(0)
	);

	// No destination to divide across — or a cost that cannot be attributed
	// (a negative slip figure is bad data, not a Project cost) — stays wholly
	// unallocated.
	if (merged.length === 0 || total.lte(0) || money.lt(0)) {
		return {
			shares: [
				{
					project_id: null,
					project_code: null,
					project_name: null,
					client_name: null,
					hours: 0,
					amount: round2(money),
					rounding_adjustment: 0,
					basis: 'no_logged_hours',
				},
			],
			roundingAdjustment: 0,
		};
	}

	const exact = merged.map((line) => mul(money, div(line.hours, total)));
	const floors = exact.map((share) =>
		share.toDecimalPlaces(2, Decimal.ROUND_DOWN)
	);
	const floorSum = floors.reduce<Decimal>(
		(sum, share) => add(sum, share),
		R(0)
	);
	const leftoverCents = money
		.minus(floorSum)
		.times(100)
		.toDecimalPlaces(0, Decimal.ROUND_DOWN)
		.toNumber();

	const order = merged
		.map((line, index) => ({
			index,
			remainder: exact[index].minus(floors[index]),
			hours: R(line.hours),
		}))
		.sort(
			(a, b) =>
				b.remainder.comparedTo(a.remainder) ||
				b.hours.comparedTo(a.hours) ||
				a.index - b.index
		);

	const applied = floors.map(() => R(0));
	for (let cent = 0; cent < leftoverCents; cent++) {
		const target = order[cent % order.length].index;
		applied[target] = add(applied[target], 0.01);
	}

	let roundingAdjustment = R(0);
	const shares: PayrollProjectShare[] = merged.map((line, index) => {
		roundingAdjustment = add(roundingAdjustment, applied[index]);
		return {
			project_id: line.project_id,
			project_code: line.project_code ?? null,
			project_name: line.project_name ?? null,
			client_name: line.client_name ?? null,
			hours: round2(line.hours),
			amount: round2(add(floors[index], applied[index])),
			rounding_adjustment: round2(applied[index]),
			basis: line.project_id === null ? 'no_project' : 'project',
		};
	});

	return { shares, roundingAdjustment: round2(roundingAdjustment) };
}

/* ── database reads ────────────────────────────────────────────────── */

type DbRow = Record<string, unknown>;

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function str(row: DbRow, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	return typeof value === 'string' ? value : String(value);
}

interface EmployeeIdentity {
	id: number;
	code: string;
	name: string;
	status: string | null;
	isDeleted: boolean;
	employeeType: string | null;
}

interface SlipRow {
	id: number;
	employeeId: number;
	employerCost: number;
}

interface FrozenAllocation {
	id: number;
	allocationUid: string;
	slipId: number;
	employeeId: number;
	employeeCode: string;
	employeeName: string;
	payStream: 'payroll' | 'contract';
	version: number;
	kind: 'finalization' | 'reconstruction' | 'revision';
	recordedEmployerCost: number;
	totalLoggedHours: number;
	projectHours: number;
	noProjectHours: number;
	roundingAdjustment: number;
	shares: PayrollProjectShare[];
}

interface MonthHours {
	byEmployee: Map<number, PayrollHourLine[]>;
}

async function loadEmployees(
	db: SqlConnection
): Promise<Map<number, EmployeeIdentity>> {
	const [rows] = await db.execute(
		`SELECT id, employee_id,
            CONCAT_WS(' ', first_name, last_name) AS name,
            status, isDelete, employee_type
       FROM employees`
	);
	const employees = new Map<number, EmployeeIdentity>();
	for (const row of rows as DbRow[]) {
		const id = num(row, 'id');
		if (id === null) continue;
		employees.set(id, {
			id,
			code: str(row, 'employee_id') ?? `#${id}`,
			name: str(row, 'name')?.trim() || `Employee #${id}`,
			status: str(row, 'status'),
			isDeleted: Number(num(row, 'isDelete') ?? 0) === 1,
			employeeType: str(row, 'employee_type'),
		});
	}
	return employees;
}

interface ProfileRow {
	canonical: DbRow | null;
	legacy: DbRow | null;
}

async function loadProfiles(
	db: SqlConnection
): Promise<Map<number, ProfileRow[]>> {
	const profiles = new Map<number, ProfileRow[]>();
	const [canonicalRows] = await db.execute(
		`SELECT * FROM employee_salary_profile WHERE is_active = 1`
	);
	for (const row of canonicalRows as DbRow[]) {
		const employeeId = num(row, 'employee_id');
		if (employeeId === null) continue;
		const list = profiles.get(employeeId) ?? [];
		list.push({ canonical: row, legacy: null });
		profiles.set(employeeId, list);
	}
	const [legacyRows] = await db.execute(
		`SELECT * FROM salary_structures WHERE is_active = 1`
	);
	for (const row of legacyRows as DbRow[]) {
		const employeeId = num(row, 'employee_id');
		if (employeeId === null) continue;
		const list = profiles.get(employeeId) ?? [];
		list.push({ canonical: null, legacy: row });
		profiles.set(employeeId, list);
	}
	return profiles;
}

/**
 * The profile in force on the first day of `month`. The eligible canonical
 * Salary Profile always wins; the legacy `salary_structures` row is only used
 * when no canonical profile covers the month (as a field fallback alongside a
 * chosen canonical, exactly like `batchGetSalaryProfiles` in the payroll
 * calculator, so the report's estimate cannot disagree with the slip Payroll
 * Generate would price).
 */
function profileForMonth(
	rows: ProfileRow[] | undefined,
	monthDay: string
): DbRow | null {
	if (!rows || rows.length === 0) return null;
	const covers = (row: DbRow) => {
		const from = str(row, 'effective_from');
		const to = str(row, 'effective_to');
		const fromDay = from ? from.slice(0, 10) : null;
		const toDay = to ? to.slice(0, 10) : null;
		if (fromDay && fromDay > monthDay) return false;
		if (toDay && toDay < monthDay) return false;
		return true;
	};
	const rank = (row: DbRow) => {
		const from = str(row, 'effective_from')?.slice(0, 10) ?? '';
		const id = num(row, 'id') ?? 0;
		return { from, id };
	};
	const newestEligible = (side: 'canonical' | 'legacy'): DbRow | null => {
		const eligible = rows
			.map((entry) => entry[side])
			.filter((row): row is DbRow => row !== null && covers(row));
		if (eligible.length === 0) return null;
		eligible.sort((a, b) => {
			const left = rank(a);
			const right = rank(b);
			return right.from.localeCompare(left.from) || right.id - left.id;
		});
		return eligible[0];
	};
	const canonical = newestEligible('canonical');
	const legacy = newestEligible('legacy');
	if (!canonical && !legacy) return null;
	return normalizeSalaryProfile(canonical, legacy);
}

async function loadSlips(
	db: SqlConnection,
	monthDay: string
): Promise<SlipRow[]> {
	const [rows] = await db.execute(
		`SELECT id, employee_id, employer_cost FROM payroll_slips WHERE month = ?`,
		[monthDay]
	);
	return (rows as DbRow[]).map((row) => ({
		id: Number(num(row, 'id') ?? 0),
		employeeId: Number(num(row, 'employee_id') ?? 0),
		employerCost: Number(num(row, 'employer_cost') ?? 0),
	}));
}

async function loadRunStatus(
	db: SqlConnection,
	monthDay: string
): Promise<string | null> {
	const [year, month] = monthDay.split('-').map(Number);
	const [rows] = await db.execute(
		`SELECT status FROM payroll_runs
      WHERE year = ? AND month = ?
      ORDER BY run_number DESC LIMIT 1`,
		[year, month]
	);
	const row = (rows as DbRow[])[0];
	return row ? str(row, 'status') : null;
}

async function loadFrozenAllocations(
	db: SqlConnection,
	monthDay: string
): Promise<FrozenAllocation[]> {
	const [rows] = await db.execute(
		`SELECT a.id, a.allocation_uid, a.payroll_slip_id, a.employee_id,
            a.employee_code, a.employee_name, a.pay_stream, a.version, a.kind,
            a.recorded_employer_cost, a.total_logged_hours, a.project_hours,
            a.no_project_hours, a.rounding_adjustment
       FROM payroll_employee_allocations a
      WHERE a.month = ?
        AND a.version = (
          SELECT MAX(a2.version) FROM payroll_employee_allocations a2
           WHERE a2.payroll_slip_id = a.payroll_slip_id
        )`,
		[monthDay]
	);
	const allocations = (rows as DbRow[]).map((row) => ({
		id: Number(num(row, 'id') ?? 0),
		allocationUid: str(row, 'allocation_uid') ?? '',
		slipId: Number(num(row, 'payroll_slip_id') ?? 0),
		employeeId: Number(num(row, 'employee_id') ?? 0),
		employeeCode: str(row, 'employee_code') ?? '',
		employeeName: str(row, 'employee_name') ?? '',
		payStream: (str(row, 'pay_stream') ?? 'payroll') as 'payroll' | 'contract',
		version: Number(num(row, 'version') ?? 1),
		kind: (str(row, 'kind') ?? 'finalization') as
			| 'finalization'
			| 'reconstruction'
			| 'revision',
		recordedEmployerCost: Number(num(row, 'recorded_employer_cost') ?? 0),
		totalLoggedHours: Number(num(row, 'total_logged_hours') ?? 0),
		projectHours: Number(num(row, 'project_hours') ?? 0),
		noProjectHours: Number(num(row, 'no_project_hours') ?? 0),
		roundingAdjustment: Number(num(row, 'rounding_adjustment') ?? 0),
		shares: [] as PayrollProjectShare[],
	}));
	if (allocations.length === 0) return allocations;

	const byId = new Map(allocations.map((entry) => [entry.id, entry]));
	const [shareRows] = await db.execute(
		`SELECT s.allocation_id, s.project_id, s.project_code, s.project_name,
            s.client_name, s.hours, s.amount, s.rounding_adjustment, s.basis
       FROM payroll_employee_allocation_shares s
       JOIN payroll_employee_allocations a ON a.id = s.allocation_id
      WHERE a.month = ?
        AND a.version = (
          SELECT MAX(a2.version) FROM payroll_employee_allocations a2
           WHERE a2.payroll_slip_id = a.payroll_slip_id
        )
      ORDER BY s.id`,
		[monthDay]
	);
	for (const row of shareRows as DbRow[]) {
		const allocation = byId.get(Number(num(row, 'allocation_id') ?? 0));
		if (!allocation) continue;
		allocation.shares.push({
			project_id: num(row, 'project_id'),
			project_code: str(row, 'project_code'),
			project_name: str(row, 'project_name'),
			client_name: str(row, 'client_name'),
			hours: Number(num(row, 'hours') ?? 0),
			amount: Number(num(row, 'amount') ?? 0),
			rounding_adjustment: Number(num(row, 'rounding_adjustment') ?? 0),
			basis: (str(row, 'basis') ?? 'project') as PayrollProjectShare['basis'],
		});
	}
	return allocations;
}

/**
 * Every Logged Hour of the month, per Employee and Project. Uses the same
 * canonical parser and employee-resolution rule as the payroll calculator's
 * batch reader, so the allocation denominator cannot drift from the hours the
 * slip was priced at. A Project that no longer exists is not a reliable
 * destination: its hours stay in the denominator as No project.
 */
async function loadMonthHours(
	db: SqlConnection,
	monthDay: string
): Promise<MonthHours> {
	const monthPrefix = monthDay.slice(0, 7);
	const [assignmentRows] = await db.execute(
		`SELECT uaa.employee_id, uaa.project_id, uaa.daily_entries,
            u.employee_id AS user_employee_id,
            u.email AS user_email, u.username AS user_username,
            p.project_code, COALESCE(p.project_title, p.name) AS project_name,
            p.client_name
       FROM user_activity_assignments uaa
       LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
       LEFT JOIN projects p ON p.project_id = uaa.project_id AND p.isDelete = 0
      WHERE uaa.status <> 'Cancelled'
        AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
	);
	const [employees] = await db.execute(
		`SELECT id, email, username FROM employees WHERE isDelete = 0`
	);
	const [users] = await db.execute(
		`SELECT employee_id, email, username FROM users
      WHERE isDelete = 0 AND employee_id IS NOT NULL`
	);
	const identifiers = buildLoggedHoursIdentifierMap(
		employees as Array<{
			id: number | string;
			email?: string | null;
			username?: string | null;
		}>,
		users as Array<{
			employee_id: number | string | null;
			email?: string | null;
			username?: string | null;
		}>
	);

	const byEmployee = new Map<number, Map<string, PayrollHourLine>>();
	for (const row of assignmentRows as DbRow[]) {
		const employeeId = resolveLoggedHoursEmployeeId(
			row as unknown as AssignmentResolutionRow,
			identifiers
		);
		if (!employeeId) continue;
		const hours = sumLoggedHoursForMonth([row.daily_entries], monthPrefix);
		if (hours <= 0) continue;
		const projectCode = str(row, 'project_code');
		const projectName = str(row, 'project_name');
		const rawProjectId = num(row, 'project_id');
		// A project id without a live Project row is not a reliable destination.
		const projectId =
			rawProjectId !== null && (projectCode || projectName)
				? rawProjectId
				: null;
		const key = projectId === null ? 'no-project' : String(projectId);
		const destinations = byEmployee.get(employeeId) ?? new Map();
		const existing = destinations.get(key);
		if (existing) {
			existing.hours = round2(add(existing.hours, hours));
		} else {
			destinations.set(key, {
				project_id: projectId,
				project_code: projectId === null ? null : projectCode,
				project_name: projectId === null ? null : projectName,
				client_name: projectId === null ? null : str(row, 'client_name'),
				hours: round2(hours),
			});
		}
		byEmployee.set(employeeId, destinations);
	}

	const result: MonthHours = { byEmployee: new Map() };
	for (const [employeeId, destinations] of byEmployee) {
		result.byEmployee.set(
			employeeId,
			[...destinations.values()].sort((a, b) => {
				if (a.project_id === b.project_id) return 0;
				if (a.project_id === null) return 1;
				if (b.project_id === null) return -1;
				return a.project_id - b.project_id;
			})
		);
	}
	return result;
}

/* ── the month's interpretation ────────────────────────────────────── */

export interface PayrollMonthInterpretation {
	month: string;
	monthLabel: string;
	currency: string;
	totals: PayrollExpenditure;
	employees: PayrollEmployeeCost[];
	coverage: CoverageNotice[];
}

function monthLabelOf(month: string): string {
	const names = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December',
	];
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12)
		return month;
	return `${names[monthNumber - 1]} ${year}`;
}

function isLockedStatus(status: string | null): boolean {
	return status === 'finalized' || status === 'paid';
}

/**
 * The month's employee-cost interpretation: recorded allocations where they
 * are frozen and applicable, payroll-based estimates otherwise, and every gap
 * disclosed. Reads through the caller's connection.
 */
export async function loadPayrollMonth(
	db: SqlConnection,
	month: string
): Promise<PayrollMonthInterpretation> {
	const monthDay = `${month}-01`;
	const [
		employees,
		profiles,
		slips,
		runStatus,
		allocations,
		hours,
		workingDays,
		schedule,
	] = await Promise.all([
		loadEmployees(db),
		loadProfiles(db),
		loadSlips(db, monthDay),
		loadRunStatus(db, monthDay),
		loadFrozenAllocations(db, monthDay),
		loadMonthHours(db, monthDay),
		getWorkingDaysForMonth(month, db),
		getEffectivePayrollSchedule(monthDay, db),
	]);

	const slipByEmployee = new Map(slips.map((slip) => [slip.employeeId, slip]));
	const allocationBySlip = new Map(
		allocations.map((allocation) => [allocation.slipId, allocation])
	);
	const locked = isLockedStatus(runStatus);

	const population = new Set<number>();
	for (const slip of slips) population.add(slip.employeeId);
	for (const [employeeId, list] of profiles) {
		if (profileForMonth(list, monthDay)) {
			const employee = employees.get(employeeId);
			if (
				employee &&
				!employee.isDeleted &&
				(employee.status === 'active' || employee.status === null)
			) {
				population.add(employeeId);
			}
		}
	}
	for (const employeeId of hours.byEmployee.keys()) {
		const employee = employees.get(employeeId);
		if (employee && !employee.isDeleted) population.add(employeeId);
	}

	const rows: PayrollEmployeeCost[] = [];
	for (const employeeId of [...population].sort((a, b) => a - b)) {
		const employee = employees.get(employeeId);
		const slip = slipByEmployee.get(employeeId) ?? null;
		const allocation = slip ? (allocationBySlip.get(slip.id) ?? null) : null;
		const profile = profileForMonth(profiles.get(employeeId), monthDay);
		const destinations = hours.byEmployee.get(employeeId) ?? [];
		const hourLines = destinations.map((line) => ({ ...line }));
		const loggedHours = round2(
			destinations.reduce((sum, line) => add(sum, line.hours), R(0))
		);
		const projectHours = round2(
			destinations
				.filter((line) => line.project_id !== null)
				.reduce((sum, line) => add(sum, line.hours), R(0))
		);
		const noProjectHours = round2(loggedHours - projectHours);

		const recorded =
			slip !== null && allocation !== null && locked ? allocation : null;
		const payStream: PayrollEmployeeCost['pay_stream'] = recorded
			? recorded.payStream
			: profile
				? String(
						profile.salary_type ?? profile.pay_type ?? 'monthly'
					).toLowerCase() === 'contract'
					? 'contract'
					: 'payroll'
				: 'unknown';

		let estimatedAmount: number | null = null;
		if (!recorded && profile) {
			try {
				const estimate = calculatePayroll({
					employeeId,
					month: monthDay,
					salaryProfile: profile,
					payrollSchedule: schedule,
					attendance: {
						standardWorkingDays: workingDays.workingDays,
						loggedHours,
					},
					includeBonus: true,
				}) as { employer_cost?: number } | null;
				estimatedAmount =
					estimate && Number.isFinite(Number(estimate.employer_cost))
						? Number(estimate.employer_cost)
						: null;
			} catch {
				estimatedAmount = null;
			}
		}

		const missingSlip = slip === null && profile !== null && runStatus !== null;
		const missingPricing = slip === null && profile === null && loggedHours > 0;
		const allocationMissing = slip !== null && locked && allocation === null;

		let shares: PayrollProjectShare[];
		if (recorded) {
			shares = recorded.shares;
		} else {
			shares = allocateEmployerCost(estimatedAmount ?? 0, hourLines).shares;
		}
		// A recorded Employee's hours are the frozen allocation's hours: a later
		// timesheet edit must not change the hours shown beside frozen cost.
		const shownHours: PayrollHourLine[] = recorded
			? recorded.shares
					.filter((share) => share.basis !== 'no_logged_hours')
					.map((share) => ({
						project_id: share.project_id,
						project_code: share.project_code,
						project_name: share.project_name,
						client_name: share.client_name,
						hours: share.hours,
					}))
			: hourLines;

		const status: PayrollEmployeeCost['status'] = recorded
			? recorded.recordedEmployerCost === 0
				? 'known_zero'
				: 'recorded'
			: estimatedAmount !== null
				? 'estimated'
				: 'unknown';

		rows.push({
			employee_id: employeeId,
			employee_code:
				recorded?.employeeCode || employee?.code || `#${employeeId}`,
			employee_name:
				recorded?.employeeName || employee?.name || `Employee #${employeeId}`,
			pay_stream: payStream,
			status,
			recorded_amount: recorded ? recorded.recordedEmployerCost : null,
			estimated_amount: recorded ? null : estimatedAmount,
			logged_hours: recorded ? recorded.totalLoggedHours : loggedHours,
			project_hours: recorded ? recorded.projectHours : projectHours,
			no_project_hours: recorded ? recorded.noProjectHours : noProjectHours,
			no_logged_hours: recorded
				? recorded.totalLoggedHours === 0
				: loggedHours === 0,
			missing_slip: missingSlip,
			missing_pricing: missingPricing,
			allocation_missing: allocationMissing,
			source: {
				payroll_slip_id: slip?.id ?? null,
				allocation_id: recorded?.id ?? null,
				allocation_version: recorded?.version ?? null,
				allocation_kind: recorded?.kind ?? null,
				month,
			},
			shares,
			hours_by_project: shownHours,
		});
	}

	const totals = summarizePayroll(rows);
	const coverage = payrollNotices(rows, totals, runStatus, allocations, slips);
	return {
		month,
		monthLabel: monthLabelOf(month),
		currency: PAYROLL_CURRENCY,
		totals,
		employees: rows,
		coverage,
	};
}

/** Month totals over the given rows — a filtered drilldown states its own. */
export function summarizePayroll(
	rows: readonly PayrollEmployeeCost[]
): PayrollExpenditure {
	let recordedTotal = R(0);
	let estimatedTotal = R(0);
	let allocated = R(0);
	let unallocated = R(0);
	let hours = R(0);
	let projectHours = R(0);
	let noProjectHours = R(0);
	let rounding = R(0);
	let recordedCount = 0;
	let knownZeroCount = 0;
	let estimatedCount = 0;
	let missingSlip = 0;
	let missingPricing = 0;
	let allocationMissing = 0;

	for (const row of rows) {
		if (row.recorded_amount !== null) {
			recordedTotal = add(recordedTotal, row.recorded_amount);
			if (row.recorded_amount === 0) knownZeroCount++;
			else recordedCount++;
			for (const share of row.shares) {
				rounding = add(rounding, share.rounding_adjustment);
				if (share.basis === 'project') allocated = add(allocated, share.amount);
				else unallocated = add(unallocated, share.amount);
			}
		} else if (row.estimated_amount !== null) {
			estimatedTotal = add(estimatedTotal, row.estimated_amount);
			estimatedCount++;
		}
		hours = add(hours, row.logged_hours);
		projectHours = add(projectHours, row.project_hours);
		noProjectHours = add(noProjectHours, row.no_project_hours);
		if (row.missing_slip) missingSlip++;
		if (row.missing_pricing) missingPricing++;
		if (row.allocation_missing) allocationMissing++;
	}

	return {
		currency: PAYROLL_CURRENCY,
		recorded_total: round2(recordedTotal),
		estimated_total: round2(estimatedTotal),
		allocated_total: round2(allocated),
		unallocated_total: round2(unallocated),
		total_logged_hours: round2(hours),
		project_hours: round2(projectHours),
		no_project_hours: round2(noProjectHours),
		rounding_adjustment: round2(rounding),
		recorded_count: recordedCount,
		known_zero_count: knownZeroCount,
		estimated_count: estimatedCount,
		missing_slip_count: missingSlip,
		missing_pricing_count: missingPricing,
		allocation_missing_count: allocationMissing,
	};
}

/** The coverage the employee-cost section discloses, never silently. */
function payrollNotices(
	rows: readonly PayrollEmployeeCost[],
	totals: PayrollExpenditure,
	runStatus: string | null,
	allocations: readonly FrozenAllocation[],
	slips: readonly SlipRow[]
): CoverageNotice[] {
	const notices: CoverageNotice[] = [];
	const locked = isLockedStatus(runStatus);
	const recordedRows = rows.filter((row) => row.recorded_amount !== null);

	if (runStatus === null) {
		notices.push({
			code: 'payroll_not_generated',
			label: 'Payroll has not been generated for this month',
			detail:
				'No Payroll Run exists for the month, so employee cost is shown as a payroll-based estimate, not recorded cost.',
			severity: 'warning',
		});
	} else if (!locked && recordedRows.length === 0) {
		notices.push({
			code: 'payroll_not_finalized',
			label: 'Payroll not finalized for this month',
			detail:
				'The month’s Payroll Run is not finalized, so employee cost is an estimate; Payroll Finalize freezes the recorded allocation.',
			severity: 'warning',
		});
	}
	if (totals.missing_slip_count > 0) {
		notices.push({
			code: 'payroll_slip_missing',
			label: 'Payroll Slips missing for employees with a Salary Profile',
			detail: `${totals.missing_slip_count} employee(s) have a Salary Profile covering the month but no Payroll Slip; their cost stays an estimate until Generate and Finalize.`,
			severity: 'warning',
		});
	}
	if (totals.missing_pricing_count > 0) {
		notices.push({
			code: 'payroll_pricing_missing',
			label: 'No Salary Profile covers this month',
			detail: `${totals.missing_pricing_count} employee(s) logged hours without a Salary Profile for the month; their cost is unknown, not zero.`,
			severity: 'warning',
		});
	}
	if (totals.allocation_missing_count > 0) {
		notices.push({
			code: 'payroll_allocation_missing',
			label: 'Finalized Payroll Slips without a frozen allocation',
			detail: `${totals.allocation_missing_count} finalized Payroll Slip(s) predate saved Project allocations; their cost stays an estimate until a reviewed reconstruction.`,
			severity: 'warning',
		});
	}
	if (
		locked &&
		slips.length > 0 &&
		allocations.length === 0 &&
		totals.allocation_missing_count === 0
	) {
		notices.push({
			code: 'payroll_allocation_missing',
			label: 'Finalized Payroll Slips without a frozen allocation',
			detail:
				'The month is finalized but no Payroll Slip has a saved Project allocation; employee cost is an estimate pending a reviewed reconstruction.',
			severity: 'warning',
		});
	}
	const noHours = recordedRows.filter((row) => row.no_logged_hours);
	if (noHours.length > 0) {
		notices.push({
			code: 'payroll_no_logged_hours',
			label: 'Recorded cost without Logged Hours',
			detail: `${noHours.length} employee(s) have recorded employer cost but no Logged Hours this month; the whole amount stays Unallocated Employee Cost.`,
			severity: 'info',
		});
	}
	const noProject = recordedRows.filter((row) => row.no_project_hours > 0);
	if (noProject.length > 0) {
		notices.push({
			code: 'payroll_no_project_hours',
			label: 'Logged Hours without a Project',
			detail: `${noProject.length} employee(s) logged hours without a Project; those hours stay in the allocation denominator and their share remains Unallocated Employee Cost.`,
			severity: 'info',
		});
	}
	// A corrected attribution is disclosed like every other evidence state: the
	// report shows the selected version and the revision history stays readable
	// (#309).
	const revised = allocations.filter((allocation) => allocation.kind === 'revision');
	if (locked && revised.length > 0) {
		notices.push({
			code: 'payroll_allocation_revised',
			label: 'Project cost allocation revised',
			detail: `${revised.length} recorded allocation(s) were corrected through an explicit revision; the report shows the selected version and the full history remains available.`,
			severity: 'info',
		});
	}
	return notices;
}

/** The employee-cost drilldown, optionally narrowed to one Employee. */
export async function loadPayrollDrilldown(
	db: SqlConnection,
	month: string,
	employeeId: number | null
): Promise<{
	interpretation: PayrollMonthInterpretation;
	employees: PayrollEmployeeCost[];
	totals: PayrollExpenditure;
}> {
	const interpretation = await loadPayrollMonth(db, month);
	const employees =
		employeeId === null
			? interpretation.employees
			: interpretation.employees.filter(
					(row) => row.employee_id === employeeId
				);
	return {
		interpretation,
		employees,
		totals:
			employeeId === null ? interpretation.totals : summarizePayroll(employees),
	};
}

/**
 * Confirmed recorded employee cost per Project and currency, for the
 * previous-month comparison. Only applicable (locked-run) allocations count.
 */
export async function loadMonthAllocatedProjectCost(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const monthDay = `${month}-01`;
	const runStatus = await loadRunStatus(db, monthDay);
	if (!isLockedStatus(runStatus)) return new Map();
	const [rows] = await db.execute(
		`SELECT s.project_id, SUM(s.amount) AS amount
       FROM payroll_employee_allocation_shares s
       JOIN payroll_employee_allocations a ON a.id = s.allocation_id
      WHERE a.month = ?
        AND a.version = (
          SELECT MAX(a2.version) FROM payroll_employee_allocations a2
           WHERE a2.payroll_slip_id = a.payroll_slip_id
        )
        AND s.project_id IS NOT NULL
      GROUP BY s.project_id`,
		[monthDay]
	);
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows as DbRow[]) {
		const projectId = num(row, 'project_id');
		if (projectId === null) continue;
		costs.set(
			projectId,
			new Map([[PAYROLL_CURRENCY, Number(num(row, 'amount') ?? 0)]])
		);
	}
	return costs;
}

/**
 * The same recorded cost of every month before `month`: the Cost to Date
 * base's employee-cost side. A frozen allocation exists only for a month
 * whose run was locked, so the allocation row is its own lock evidence.
 */
export async function loadAllocatedProjectCostBefore(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const [rows] = await db.execute(
		`SELECT s.project_id, SUM(s.amount) AS amount
       FROM payroll_employee_allocation_shares s
       JOIN payroll_employee_allocations a ON a.id = s.allocation_id
      WHERE a.month < ?
        AND a.version = (
          SELECT MAX(a2.version) FROM payroll_employee_allocations a2
           WHERE a2.payroll_slip_id = a.payroll_slip_id
        )
        AND s.project_id IS NOT NULL
      GROUP BY s.project_id`,
		[`${month}-01`]
	);
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows as DbRow[]) {
		const projectId = num(row, 'project_id');
		if (projectId === null) continue;
		costs.set(
			projectId,
			new Map([[PAYROLL_CURRENCY, Number(num(row, 'amount') ?? 0)]])
		);
	}
	return costs;
}

/** Months that carry recorded employee cost, newest first. */
export async function loadPayrollAllocationMonths(
	db: SqlConnection
): Promise<string[]> {
	const [rows] = await db.execute(
		`SELECT DISTINCT DATE_FORMAT(month, '%Y-%m') AS month
       FROM payroll_employee_allocations`
	);
	return (rows as DbRow[])
		.map((row) => str(row, 'month'))
		.filter((month): month is string => !!month);
}

/* ── freeze at Payroll Finalize ────────────────────────────────────── */

export interface FreezeSummary {
	allocations: number;
	total: number;
}

/**
 * Freeze the month's recorded employer cost for every Payroll Slip, in the
 * caller's transaction. Called by Payroll Finalize after the run's
 * `draft → finalized` transition has matched its row, so the allocation and
 * the lock commit or roll back together. The version is per slip: a
 * re-finalization after an authorized reopen appends the next version and the
 * unique key refuses duplicates.
 */
export async function freezeMonthAllocations(
	db: SqlConnection,
	monthDay: string,
	actorId: number | null
): Promise<FreezeSummary> {
	const slips = await loadSlips(db, monthDay);
	if (slips.length === 0) {
		return { allocations: 0, total: 0 };
	}
	const [employees, profiles, hours] = await Promise.all([
		loadEmployees(db),
		loadProfiles(db),
		loadMonthHours(db, monthDay),
	]);

	let total = R(0);
	for (const slip of slips) {
		const [existing] = await db.execute(
			`SELECT COALESCE(MAX(version), 0) AS version
         FROM payroll_employee_allocations
        WHERE payroll_slip_id = ?`,
			[slip.id]
		);
		const version =
			Number(num((existing as DbRow[])[0] ?? {}, 'version') ?? 0) + 1;
		const profile = profileForMonth(profiles.get(slip.employeeId), monthDay);
		const payStream =
			profile &&
			String(
				profile.salary_type ?? profile.pay_type ?? 'monthly'
			).toLowerCase() === 'contract'
				? 'contract'
				: 'payroll';
		const employee = employees.get(slip.employeeId);
		const employeeCode = employee?.code ?? `#${slip.employeeId}`;
		const employeeName = employee?.name ?? `Employee #${slip.employeeId}`;
		const outcome = allocateEmployerCost(
			slip.employerCost,
			hours.byEmployee.get(slip.employeeId) ?? []
		);
		const projectHours = outcome.shares
			.filter((share) => share.basis === 'project')
			.reduce((sum, share) => add(sum, share.hours), R(0));
		const noProjectHours = outcome.shares
			.filter((share) => share.basis === 'no_project')
			.reduce((sum, share) => add(sum, share.hours), R(0));
		const allocationUid = `payroll-alloc-${slip.id}-v${version}`;

		const [inserted] = await db.execute(
			`INSERT INTO payroll_employee_allocations
         (allocation_uid, payroll_slip_id, month, employee_id, employee_code,
          employee_name, pay_stream, version, kind, recorded_employer_cost,
          currency, total_logged_hours, project_hours, no_project_hours,
          rounding_adjustment, frozen_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'finalization', ?, ?, ?, ?, ?, ?, ?)`,
			[
				allocationUid,
				slip.id,
				monthDay,
				slip.employeeId,
				employeeCode,
				employeeName,
				payStream,
				version,
				round2(slip.employerCost),
				PAYROLL_CURRENCY,
				outcome.shares
					.reduce((sum, share) => add(sum, share.hours), R(0))
					.toNumber(),
				projectHours.toNumber(),
				noProjectHours.toNumber(),
				outcome.roundingAdjustment,
				actorId,
			]
		);
		const allocationId = Number(
			(inserted as { insertId?: number }).insertId ?? 0
		);
		for (const share of outcome.shares) {
			await db.execute(
				`INSERT INTO payroll_employee_allocation_shares
           (allocation_id, project_id, project_code, project_name, client_name,
            hours, amount, rounding_adjustment, basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					allocationId,
					share.project_id,
					share.project_code,
					share.project_name,
					share.client_name,
					share.hours,
					share.amount,
					share.rounding_adjustment,
					share.basis,
				]
			);
		}
		await db.execute(
			`INSERT INTO payroll_allocation_events
         (allocation_uid, source_table, source_id, version, command, actor_user_id, snapshot)
       VALUES (?, 'payroll_slips', ?, ?, 'frozen', ?, ?)`,
			[
				allocationUid,
				slip.id,
				version,
				actorId,
				JSON.stringify({
					payroll_slip_id: slip.id,
					month: monthDay,
					employee_id: slip.employeeId,
					recorded_employer_cost: round2(slip.employerCost),
					rounding_adjustment: outcome.roundingAdjustment,
					shares: outcome.shares,
				}),
			]
		);
		total = add(total, slip.employerCost);
	}
	return { allocations: slips.length, total: round2(total) };
}
