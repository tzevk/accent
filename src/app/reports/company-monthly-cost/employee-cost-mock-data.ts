/**
 * Company Monthly Cost fixtures — a full month and FY of company
 * cost with no database.
 *
 * What this is for: rendering the Monthly and Financial Year views the way a
 * working page looks — the summary cards, Project Wise sheets, By Employee /
 * By Project tables, and the Apr–Mar matrix — plus pinning the payload's
 * internal agreements in a test. It is a fixture. Nothing under
 * `src/app/api/` reads it.
 *
 * Two invariants the builders hold, because a fixture that breaks either is
 * worse than no fixture:
 *
 *  1. **Rows and aggregates agree.** Every employee and project row is the
 *     sum of its detail rows, and the totals are the sum of the details —
 *     the additions the page renders, computed once here from the same
 *     declaration. The known exception is the page's own display rate
 *     convention (`total_cost ÷ total_hours`, ROUND_HALF_UP to 2 dp), which
 *     the fixture states explicitly so a rounding drift shows in the test.
 *  2. **The FY matrix and the monthly views agree.** The FY months reuse the
 *     same per-employee, per-project monthly cells the monthly builder sums,
 *     so the same declaration feeds both: April's FY column and a mock April
 *     month state the same hours and cost.
 *
 * Money math goes through `@/lib/money` (Decimal.js, ROUND_HALF_UP) — the
 * repo rule for billing figures — and the declarations are plain data above
 * the builders, so a fixture author edits people, projects, and hours and the
 * amounts follow.
 */

import { R, add, div, mul, toNumber } from '@/lib/money';
import type {
	CoverageNotice,
	PayrollEmployeeCost,
	PayrollExpenditure,
} from '@/lib/company-expenditure/types';
import type {
	CompanyCostMeta,
	FYAllocationRow,
	FYCompanyCostData,
	MonthlyCompanyCostData,
	MonthlyCompanyCostRow,
} from './employee-cost-data-source';

// ─── Declaration ────────────────────────────────────────────────────

/** One employee's identity and monthly employer cost, before any split. */
export interface MockEmployeeSpec {
	id: number;
	employee_id: string;
	name: string;
	department: string;
	designation: string;
	/** Recorded employer cost for months the payroll is finalized. */
	recorded_cost: number;
	/** Payroll-based estimate for months still open. */
	estimated_cost: number;
}

/** One project's identity, the way the page labels it. */
export interface MockProjectSpec {
	id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
}

/** One employee's Logged Hours on one destination for one month. */
export interface MockHourSpec {
	employee: string;
	project: string;
	hours: number;
}

/** One month of company cost, as a fixture author thinks about it. */
export interface MockMonthSpec {
	month: string;
	/** Finalized months state recorded cost; open months state estimates. */
	finalized: boolean;
	hours: readonly MockHourSpec[];
}

/** One month selected for the FY matrix, with its declared hours. */
export interface MockFyMonthSpec {
	key: string;
	hours: readonly MockHourSpec[];
}

/** Which months the FY matrix carries hours on (Apr–Mar keys). */
export interface MockFyOptions {
	fyYear?: number;
	months?: readonly MockFyMonthSpec[];
}

// ─── Shapes ─────────────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export const MOCK_FY_MONTHS = [
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
	'Jan',
	'Feb',
	'Mar',
] as const;

export const MOCK_FY_MONTH_KEYS = [
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec',
	'jan',
	'feb',
	'mar',
] as const;

/** Display labels the FY matrix columns read. */
const MOCK_FY_KEY_LABELS: Record<string, string> = {
	apr: 'Apr',
	may: 'May',
	jun: 'Jun',
	jul: 'Jul',
	aug: 'Aug',
	sep: 'Sep',
	oct: 'Oct',
	nov: 'Nov',
	dec: 'Dec',
	jan: 'Jan',
	feb: 'Feb',
	mar: 'Mar',
};

/** `YYYY-MM` → `Month YYYY`, the label both views read. */
function monthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [y, m] = month.split('-').map(Number);
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
	if (!y || !m || m < 1 || m > 12) return month;
	return `${names[m - 1]} ${y}`;
}

/** `YYYY-MM` → `Mon-YY`, the Project Wise sheet's month cell. */
function compactMonthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [year, monthNumber] = month.split('-').map(Number);
	const names = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${names[monthNumber - 1]}-${String(year).slice(-2)}`;
}

/** `FY 2026–27`, the financial-year label the FY views read. */
function fyLabel(fyYear: number): string {
	return `FY ${fyYear}–${String(fyYear + 1).slice(-2)}`;
}

/** FY month keys (apr…mar) → calendar `YYYY-MM` for a financial year. */
function fyKeyToCalendarMonthMap(fyYear: number): Record<string, string> {
	return {
		apr: `${fyYear}-04`,
		may: `${fyYear}-05`,
		jun: `${fyYear}-06`,
		jul: `${fyYear}-07`,
		aug: `${fyYear}-08`,
		sep: `${fyYear}-09`,
		oct: `${fyYear}-10`,
		nov: `${fyYear}-11`,
		dec: `${fyYear}-12`,
		jan: `${fyYear + 1}-01`,
		feb: `${fyYear + 1}-02`,
		mar: `${fyYear + 1}-03`,
	};
}

function round2(value: number): number {
	return toNumber(div(R(value), 1).toDecimalPlaces(2));
}

/** Cost ÷ hours as a display rate, the page's own convention. */
function rateOf(cost: number, hours: number): number {
	return hours > 0 ? toNumber(div(R(cost), hours).toDecimalPlaces(2)) : 0;
}

// ─── Builder ────────────────────────────────────────────────────────

/**
 * Allocate one employee's monthly cost across destinations in proportion to
 * Logged Hours, the largest share absorbing the rounding cent so the shares
 * sum to the stated amount.
 */
function allocateShares(
	amount: number,
	hours: ReadonlyArray<{ key: string; hours: number }>
): Record<string, number> {
	const shares: Record<string, number> = {};
	const totalHours = hours.reduce((sum, line) => sum + line.hours, 0);
	if (hours.length === 0 || totalHours <= 0) return shares;
	const raw = hours.map((line) =>
		toNumber(div(mul(R(amount), line.hours), totalHours).toDecimalPlaces(2))
	);
	const stated = round2(amount);
	const drift = round2(stated - raw.reduce((sum, value) => sum + value, 0));
	let largest = 0;
	for (let i = 1; i < hours.length; i += 1) {
		if (hours[i].hours > hours[largest].hours) largest = i;
	}
	raw[largest] = round2(raw[largest] + drift);
	for (let i = 0; i < hours.length; i += 1) {
		shares[hours[i].key] = raw[i];
	}
	return shares;
}

export interface MockCostInputs {
	employees: readonly MockEmployeeSpec[];
	projects: readonly MockProjectSpec[];
}

/** Build one month of `MonthlyCompanyCostData` from declarations. */
export function mockCostData(
	spec: MockMonthSpec,
	inputs: MockCostInputs
): MonthlyCompanyCostData {
	if (!MONTH_RE.test(spec.month)) {
		throw new Error(`Invalid month (expected YYYY-MM): ${spec.month}`);
	}
	const employees: Record<string, MockEmployeeSpec> = {};
	for (const employee of inputs.employees) {
		employees[employee.employee_id] = employee;
	}
	const projects: Record<string, MockProjectSpec> = {};
	for (const project of inputs.projects) {
		projects[project.project_code] = project;
	}
	const linesByEmployee: Record<string, MockHourSpec[]> = {};
	for (const line of spec.hours) {
		if (!employees[line.employee]) {
			throw new Error(`Unknown employee in mock hours: ${line.employee}`);
		}
		if (!projects[line.project]) {
			throw new Error(`Unknown project in mock hours: ${line.project}`);
		}
		if (!Number.isFinite(line.hours) || line.hours <= 0) {
			throw new Error(
				`Mock hours must be positive: ${line.employee} → ${line.project}`
			);
		}
		(linesByEmployee[line.employee] ??= []).push(line);
	}

	const rows: MonthlyCompanyCostRow[] = [];
	for (const [code, lines] of Object.entries(linesByEmployee).sort(([a], [b]) =>
		a.localeCompare(b)
	)) {
		const employee = employees[code];
		const amount = spec.finalized
			? employee.recorded_cost
			: employee.estimated_cost;
		const shares = allocateShares(
			amount,
			lines.map((line) => ({ key: line.project, hours: line.hours }))
		);
		for (const line of lines) {
			const project = projects[line.project];
			const cost = shares[line.project] ?? 0;
			rows.push({
				sr_no: 0,
				employee_id: employee.id,
				employee_code: employee.employee_id,
				employee_name: employee.name,
				department: employee.department,
				designation: employee.designation,
				project_id: project.id,
				project_code: project.project_code,
				project_name: project.project_name,
				client_name: project.client_name,
				hourly_rate: rateOf(cost, line.hours),
				hours: round2(line.hours),
				cost,
				cost_status: spec.finalized ? 'recorded' : 'estimated',
				missing_salary_profile: false,
				recorded_cost: spec.finalized ? cost : 0,
				estimated_cost: spec.finalized ? 0 : cost,
			});
		}
	}
	rows.sort(
		(a, b) =>
			a.employee_name.localeCompare(b.employee_name) ||
			a.project_code.localeCompare(b.project_code)
	);
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	const employeeRows: MonthlyCompanyCostData['employee_rows'] = [];
	const employeeGroups: Record<number, MonthlyCompanyCostRow[]> = {};
	for (const row of rows) {
		(employeeGroups[row.employee_id] ??= []).push(row);
	}
	for (const group of Object.values(employeeGroups).sort(([a], [b]) =>
		a.employee_name.localeCompare(b.employee_name)
	)) {
		const first = group[0];
		const hours = round2(group.reduce((sum, row) => sum + row.hours, 0));
		const cost = round2(group.reduce((sum, row) => sum + row.cost, 0));
		const recorded = round2(
			group.reduce((sum, row) => sum + row.recorded_cost, 0)
		);
		const estimated = round2(
			group.reduce((sum, row) => sum + row.estimated_cost, 0)
		);
		employeeRows.push({
			sr_no: 0,
			employee_id: first.employee_id,
			employee_code: first.employee_code,
			employee_name: first.employee_name,
			department: first.department,
			designation: first.designation,
			hourly_rate: rateOf(cost, hours),
			hours,
			cost,
			recorded_cost: recorded,
			estimated_cost: estimated,
			missing_salary_profile: false,
			project_count: new Set(
				group
					.filter((row) => row.project_id !== null)
					.map((row) => row.project_id)
			).size,
		});
	}
	employeeRows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	const projectRows: MonthlyCompanyCostData['project_rows'] = [];
	const projectGroups: Record<string, MonthlyCompanyCostRow[]> = {};
	for (const row of rows) {
		const key =
			row.project_id !== null ? String(row.project_id) : row.project_code;
		(projectGroups[key] ??= []).push(row);
	}
	for (const group of Object.values(projectGroups).sort(
		([a], [b]) =>
			a.project_code.localeCompare(b.project_code) ||
			a.project_name.localeCompare(b.project_name)
	)) {
		const first = group[0];
		projectRows.push({
			sr_no: 0,
			project_id: first.project_id,
			project_code: first.project_code,
			project_name: first.project_name,
			client_name: first.client_name,
			hours: round2(group.reduce((sum, row) => sum + row.hours, 0)),
			cost: round2(group.reduce((sum, row) => sum + row.cost, 0)),
			recorded_cost: round2(
				group.reduce((sum, row) => sum + row.recorded_cost, 0)
			),
			estimated_cost: round2(
				group.reduce((sum, row) => sum + row.estimated_cost, 0)
			),
			employee_count: new Set(group.map((row) => row.employee_id)).size,
			missing_salary_profile_count: 0,
		});
	}
	projectRows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	const totalHours = round2(rows.reduce((sum, row) => sum + row.hours, 0));
	const totalCost = round2(rows.reduce((sum, row) => sum + row.cost, 0));
	const recordedCost = round2(
		rows.reduce((sum, row) => sum + row.recorded_cost, 0)
	);
	const estimatedCost = round2(
		rows.reduce((sum, row) => sum + row.estimated_cost, 0)
	);
	const year = Number(spec.month.slice(0, 4));
	const monthNumber = Number(spec.month.slice(5, 7));
	const fyYear = monthNumber >= 4 ? year : year - 1;

	return {
		month: spec.month,
		month_label: monthLabel(spec.month),
		fy_label: fyLabel(fyYear),
		fy_year: fyYear,
		rows,
		employee_rows: employeeRows,
		project_rows: projectRows,
		totals: {
			total_hours: totalHours,
			total_cost: totalCost,
			recorded_cost: recordedCost,
			estimated_cost: estimatedCost,
			blended_rate: rateOf(totalCost, totalHours),
			employee_count: Object.keys(employeeGroups).length,
			project_count: new Set(
				rows
					.filter((row) => row.project_id !== null)
					.map((row) => row.project_id)
			).size,
		},
		payroll: mockPayrollExpenditure(spec, inputs),
		coverage: mockCoverage(spec),
	};
}

/**
 * The month's employee-cost position, mirrored from `summarizePayroll`: the
 * recorded and estimated totals, counts, and Logged Hours the shared
 * interpretation would publish for the same declarations.
 */
function mockPayrollExpenditure(
	spec: MockMonthSpec,
	inputs: MockCostInputs
): PayrollExpenditure {
	const employees: Record<string, MockEmployeeSpec> = {};
	for (const employee of inputs.employees) {
		employees[employee.employee_id] = employee;
	}
	const linesByEmployee: Record<string, MockHourSpec[]> = {};
	for (const line of spec.hours) {
		(linesByEmployee[line.employee] ??= []).push(line);
	}
	let recordedTotal = R(0);
	let estimatedTotal = R(0);
	let estimatedAllocated = R(0);
	let estimatedUnallocated = R(0);
	let hours = R(0);
	let projectHours = R(0);
	let noProjectHours = R(0);
	let recordedCount = 0;
	let estimatedCount = 0;
	for (const [code, lines] of Object.entries(linesByEmployee)) {
		const employee = employees[code];
		const logged = lines.reduce((sum, line) => sum + line.hours, 0);
		hours = add(hours, logged);
		if (spec.finalized) {
			recordedTotal = add(recordedTotal, employee.recorded_cost);
			recordedCount += 1;
		} else {
			estimatedTotal = add(estimatedTotal, employee.estimated_cost);
			estimatedCount += 1;
			const shares = allocateShares(
				employee.estimated_cost,
				lines.map((line) => ({ key: line.project, hours: line.hours }))
			);
			for (const [project, amount] of Object.entries(shares)) {
				if (project === 'NO-PROJECT')
					estimatedUnallocated = add(estimatedUnallocated, amount);
				else estimatedAllocated = add(estimatedAllocated, amount);
			}
		}
		for (const line of lines) {
			if (line.project === 'NO-PROJECT') {
				noProjectHours = add(noProjectHours, line.hours);
			} else {
				projectHours = add(projectHours, line.hours);
			}
		}
	}
	return {
		currency: 'INR',
		recorded_total: round2(toNumber(recordedTotal)),
		estimated_total: round2(toNumber(estimatedTotal)),
		allocated_total: spec.finalized ? round2(toNumber(recordedTotal)) : 0,
		unallocated_total: 0,
		estimated_allocated_total: round2(toNumber(estimatedAllocated)),
		estimated_unallocated_total: round2(toNumber(estimatedUnallocated)),
		total_logged_hours: round2(toNumber(hours)),
		project_hours: round2(toNumber(projectHours)),
		no_project_hours: round2(toNumber(noProjectHours)),
		rounding_adjustment: 0,
		recorded_count: spec.finalized ? recordedCount : 0,
		known_zero_count: 0,
		estimated_count: spec.finalized ? 0 : estimatedCount,
		missing_slip_count: 0,
		missing_pricing_count: 0,
		allocation_missing_count: 0,
		unpriced_count: 0,
	};
}

/**
 * The coverage the month discloses. Open months carry the shared
 * `payroll_not_finalized` warning (code, label, and severity verbatim from
 * `payrollNotices`); finalized months carry no notices.
 */
function mockCoverage(spec: MockMonthSpec): CoverageNotice[] {
	if (spec.finalized) return [];
	return [
		{
			code: 'payroll_not_finalized',
			label: 'Payroll not finalized for this month',
			detail:
				'The month’s Payroll Run is not finalized, so employee cost is an estimate; Payroll Finalize freezes the recorded allocation.',
			severity: 'warning',
		},
	];
}

/**
 * The employee-cost drilldown behind one month: one entry per Employee with
 * recorded or estimated cost, shares, and hour lines, the shape the
 * expenditure view's payroll section reads.
 */
export function mockPayrollEmployees(
	spec: MockMonthSpec,
	inputs: MockCostInputs
): PayrollEmployeeCost[] {
	const data = mockCostData(spec, inputs);
	const employees: Record<string, MockEmployeeSpec> = {};
	for (const employee of inputs.employees) {
		employees[employee.employee_id] = employee;
	}
	const projects: Record<string, MockProjectSpec> = {};
	for (const project of inputs.projects) {
		projects[project.project_code] = project;
	}
	const rowsByEmployee: Record<string, MonthlyCompanyCostRow[]> = {};
	for (const row of data.rows) {
		(rowsByEmployee[row.employee_code] ??= []).push(row);
	}
	return Object.entries(rowsByEmployee)
		.map(([code, rows]) => {
			const employee = employees[code];
			const loggedHours = round2(rows.reduce((sum, row) => sum + row.hours, 0));
			const projectHours = round2(
				rows
					.filter((row) => row.project_id !== null)
					.reduce((sum, row) => sum + row.hours, 0)
			);
			const noProjectHours = round2(loggedHours - projectHours);
			return {
				employee_id: employee.id,
				employee_code: employee.employee_id,
				employee_name: employee.name,
				pay_stream: 'payroll',
				status: spec.finalized ? 'recorded' : 'estimated',
				recorded_amount: spec.finalized ? employee.recorded_cost : null,
				estimated_amount: spec.finalized ? null : employee.estimated_cost,
				logged_hours: loggedHours,
				project_hours: projectHours,
				no_project_hours: noProjectHours,
				no_logged_hours: false,
				missing_slip: false,
				missing_pricing: false,
				allocation_missing: false,
				source: {
					payroll_slip_id: spec.finalized ? 9000 + employee.id : null,
					allocation_id: spec.finalized ? 7000 + employee.id : null,
					allocation_version: spec.finalized ? 1 : null,
					allocation_kind: spec.finalized ? 'finalization' : null,
					month: spec.month,
				},
				shares: rows.map((row) => {
					const project = projects[row.project_code];
					return {
						project_id: project.id,
						project_code: project.id === null ? null : project.project_code,
						project_name: project.id === null ? null : project.project_name,
						client_name: project.id === null ? null : project.client_name,
						hours: row.hours,
						amount: row.cost,
						rounding_adjustment: 0,
						basis: project.id === null ? 'no_project' : 'project',
					};
				}),
				hours_by_project: rows.map((row) => {
					const project = projects[row.project_code];
					return {
						project_id: project.id,
						project_code: project.id === null ? null : project.project_code,
						project_name: project.id === null ? null : project.project_name,
						client_name: project.id === null ? null : project.client_name,
						hours: row.hours,
					};
				}),
				reconstruction: null,
			} satisfies PayrollEmployeeCost;
		})
		.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}

/** Build one financial year of `FYCompanyCostData` from monthly declarations. */
export function mockFyCostData(
	options: MockFyOptions,
	inputs: MockCostInputs,
	monthSpecs: Readonly<Record<string, MockMonthSpec>>
): FYCompanyCostData {
	const fyYear = options.fyYear ?? MOCK_FY_YEAR;
	const months = options.months ?? MOCK_FY_MONTH_SPECS;
	const calendar = fyKeyToCalendarMonthMap(fyYear);
	const monthKeys: Record<string, string> = {};
	for (const [key, month] of Object.entries(calendar)) {
		monthKeys[month] = key;
	}
	const rowsByKey: Record<string, FYAllocationRow> = {};
	for (const fyMonth of months) {
		const spec = monthSpecs[fyMonth.key];
		if (!spec) {
			throw new Error(`No mock month declared for FY key: ${fyMonth.key}`);
		}
		const data = mockCostData(
			{ ...spec, hours: fyMonth.hours, month: calendar[fyMonth.key] },
			inputs
		);
		const key = monthKeys[data.month] ?? fyMonth.key;
		for (const row of data.rows) {
			const groupKey = `${row.employee_id}::${row.project_code}`;
			let aggregate = rowsByKey[groupKey];
			if (!aggregate) {
				aggregate = {
					sr_no: 0,
					employee_id: row.employee_id,
					employee_code: row.employee_code,
					employee_name: row.employee_name,
					department: row.department,
					designation: row.designation,
					project_id: row.project_id,
					project_code: row.project_code,
					project_name: row.project_name,
					client_name: row.client_name,
					monthly_hours: {},
					monthly_cost: {},
					total_hours: 0,
					total_cost: 0,
					recorded_cost: 0,
					estimated_cost: 0,
					hourly_rate: 0,
				};
				rowsByKey[groupKey] = aggregate;
			}
			aggregate.monthly_hours[key] = round2(
				(aggregate.monthly_hours[key] ?? 0) + row.hours
			);
			aggregate.monthly_cost[key] = round2(
				(aggregate.monthly_cost[key] ?? 0) + row.cost
			);
			aggregate.total_hours = round2(aggregate.total_hours + row.hours);
			aggregate.total_cost = round2(aggregate.total_cost + row.cost);
			aggregate.recorded_cost = round2(
				aggregate.recorded_cost + row.recorded_cost
			);
			aggregate.estimated_cost = round2(
				aggregate.estimated_cost + row.estimated_cost
			);
		}
	}
	const rows = Object.values(rowsByKey).filter(
		(row) => row.total_hours > 0 || row.total_cost > 0
	);
	rows.sort(
		(a, b) =>
			a.employee_name.localeCompare(b.employee_name) ||
			a.project_code.localeCompare(b.project_code)
	);
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
		row.hourly_rate = rateOf(row.total_cost, row.total_hours);
	});

	const employeeGroups: Record<number, FYAllocationRow[]> = {};
	for (const row of rows) {
		(employeeGroups[row.employee_id] ??= []).push(row);
	}
	const employeeRows: FYCompanyCostData['employee_rows'] = Object.values(
		employeeGroups
	)
		.map((group) => {
			const first = group[0];
			const monthlyHours: Record<string, number> = {};
			const monthlyCost: Record<string, number> = {};
			for (const key of MOCK_FY_MONTH_KEYS) {
				monthlyHours[key] = round2(
					group.reduce((sum, row) => sum + (row.monthly_hours[key] ?? 0), 0)
				);
				monthlyCost[key] = round2(
					group.reduce((sum, row) => sum + (row.monthly_cost[key] ?? 0), 0)
				);
			}
			const totalHours = round2(
				group.reduce((sum, row) => sum + row.total_hours, 0)
			);
			const totalCost = round2(
				group.reduce((sum, row) => sum + row.total_cost, 0)
			);
			return {
				sr_no: 0,
				employee_id: first.employee_id,
				employee_code: first.employee_code,
				employee_name: first.employee_name,
				department: first.department,
				designation: first.designation,
				hourly_rate: rateOf(totalCost, totalHours),
				monthly_hours: monthlyHours,
				monthly_cost: monthlyCost,
				total_hours: totalHours,
				total_cost: totalCost,
				project_count: new Set(
					group
						.filter((row) => row.project_id !== null)
						.map((row) => row.project_id)
				).size,
			};
		})
		.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
	employeeRows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	const projectGroups: Record<string, FYAllocationRow[]> = {};
	for (const row of rows) {
		const key =
			row.project_id !== null ? String(row.project_id) : row.project_code;
		(projectGroups[key] ??= []).push(row);
	}
	const projectRows: FYCompanyCostData['project_rows'] = Object.values(
		projectGroups
	)
		.map((group) => {
			const first = group[0];
			const monthlyHours: Record<string, number> = {};
			const monthlyCost: Record<string, number> = {};
			for (const key of MOCK_FY_MONTH_KEYS) {
				monthlyHours[key] = round2(
					group.reduce((sum, row) => sum + (row.monthly_hours[key] ?? 0), 0)
				);
				monthlyCost[key] = round2(
					group.reduce((sum, row) => sum + (row.monthly_cost[key] ?? 0), 0)
				);
			}
			return {
				sr_no: 0,
				project_id: first.project_id,
				project_code: first.project_code,
				project_name: first.project_name,
				client_name: first.client_name,
				monthly_hours: monthlyHours,
				monthly_cost: monthlyCost,
				total_hours: round2(
					group.reduce((sum, row) => sum + row.total_hours, 0)
				),
				total_cost: round2(group.reduce((sum, row) => sum + row.total_cost, 0)),
				employee_count: new Set(group.map((row) => row.employee_id)).size,
			};
		})
		.sort(
			(a, b) =>
				a.project_code.localeCompare(b.project_code) ||
				a.project_name.localeCompare(b.project_name)
		);
	projectRows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	const monthlyHours: Record<string, number> = {};
	const monthlyCost: Record<string, number> = {};
	for (const key of MOCK_FY_MONTH_KEYS) {
		monthlyHours[key] = round2(
			rows.reduce((sum, row) => sum + (row.monthly_hours[key] ?? 0), 0)
		);
		monthlyCost[key] = round2(
			rows.reduce((sum, row) => sum + (row.monthly_cost[key] ?? 0), 0)
		);
	}
	const totalHours = round2(
		rows.reduce((sum, row) => sum + row.total_hours, 0)
	);
	const totalCost = round2(rows.reduce((sum, row) => sum + row.total_cost, 0));
	const recordedCost = round2(
		rows.reduce((sum, row) => sum + row.recorded_cost, 0)
	);
	const estimatedCost = round2(
		rows.reduce((sum, row) => sum + row.estimated_cost, 0)
	);

	return {
		fy_label: fyLabel(fyYear),
		fy_year: fyYear,
		months: [...MOCK_FY_MONTHS],
		month_keys: [...MOCK_FY_MONTH_KEYS],
		rows,
		employee_rows: employeeRows,
		project_rows: projectRows,
		totals: {
			monthly_hours: monthlyHours,
			monthly_cost: monthlyCost,
			total_hours: totalHours,
			total_cost: totalCost,
			recorded_cost: recordedCost,
			estimated_cost: estimatedCost,
			blended_rate: rateOf(totalCost, totalHours),
		},
		summary: {
			total_hours: totalHours,
			total_cost: totalCost,
			blended_rate: rateOf(totalCost, totalHours),
			employee_count: Object.keys(employeeGroups).length,
			project_count: new Set(
				rows
					.filter((row) => row.project_id !== null)
					.map((row) => row.project_id)
			).size,
		},
	};
}

// ─── Scenario ───────────────────────────────────────────────────────

/** The month every fixture example uses: September 2026, finalized. */
export const MOCK_MONTH = '2026-09';

/** The financial year the FY fixture covers: FY 2026–27. */
export const MOCK_FY_YEAR = 2026;

/** The shared fixture inputs: four employees, three projects, one bucket. */
export const MOCK_INPUTS: MockCostInputs = {
	employees: [
		{
			id: 101,
			employee_id: 'EMP001',
			name: 'Ananya Sharma',
			department: 'Engineering',
			designation: 'Senior Engineer',
			recorded_cost: 145000,
			estimated_cost: 145000,
		},
		{
			id: 102,
			employee_id: 'EMP002',
			name: 'Rohan Mehta',
			department: 'Engineering',
			designation: 'Engineer',
			recorded_cost: 98000,
			estimated_cost: 98000,
		},
		{
			id: 103,
			employee_id: 'EMP003',
			name: 'Kabir Nair',
			department: 'Design',
			designation: 'Designer',
			recorded_cost: 76000,
			estimated_cost: 76000,
		},
		{
			id: 104,
			employee_id: 'EMP004',
			name: 'Priya Iyer',
			department: 'Engineering',
			designation: 'Junior Engineer',
			recorded_cost: 62000,
			estimated_cost: 64000,
		},
	],
	projects: [
		{
			id: 201,
			project_code: 'PRJ-201',
			project_name: 'Harbour Metro Rail',
			client_name: 'Meridian Infra',
		},
		{
			id: 202,
			project_code: 'PRJ-202',
			project_name: 'Civic Water Grid',
			client_name: 'Northgate Utilities',
		},
		{
			id: 203,
			project_code: 'PRJ-203',
			project_name: 'Skyline Tower Audit',
			client_name: 'Bluepeak Developers',
		},
		{
			id: null,
			project_code: 'NO-PROJECT',
			project_name: 'No project',
			client_name: '',
		},
	],
};

/**
 * September 2026: the worked example. Ananya splits two projects, Rohan one,
 * Kabir one plus unassigned hours, Priya joins mid-month on one project.
 */
export const MOCK_SEPTEMBER_HOURS: readonly MockHourSpec[] = [
	{ employee: 'EMP001', project: 'PRJ-201', hours: 120 },
	{ employee: 'EMP001', project: 'PRJ-202', hours: 48 },
	{ employee: 'EMP002', project: 'PRJ-201', hours: 160 },
	{ employee: 'EMP003', project: 'PRJ-203', hours: 140 },
	{ employee: 'EMP003', project: 'NO-PROJECT', hours: 12 },
	{ employee: 'EMP004', project: 'PRJ-202', hours: 88 },
];

/** October 2026: an open month, so its cost stays an estimate. */
export const MOCK_OCTOBER_HOURS: readonly MockHourSpec[] = [
	{ employee: 'EMP001', project: 'PRJ-201', hours: 132 },
	{ employee: 'EMP001', project: 'PRJ-202', hours: 36 },
	{ employee: 'EMP002', project: 'PRJ-201', hours: 152 },
	{ employee: 'EMP002', project: 'PRJ-203', hours: 16 },
	{ employee: 'EMP003', project: 'PRJ-203', hours: 148 },
	{ employee: 'EMP004', project: 'PRJ-202', hours: 120 },
	{ employee: 'EMP004', project: 'NO-PROJECT', hours: 8 },
];

/** August 2026: a quieter finalized month for the FY trend. */
export const MOCK_AUGUST_HOURS: readonly MockHourSpec[] = [
	{ employee: 'EMP001', project: 'PRJ-201', hours: 112 },
	{ employee: 'EMP001', project: 'PRJ-202', hours: 40 },
	{ employee: 'EMP002', project: 'PRJ-201', hours: 144 },
	{ employee: 'EMP003', project: 'PRJ-203', hours: 136 },
];

/** The FY matrix months: Aug–Oct carry hours, the rest render empty. */
const MOCK_FY_MONTH_SPECS: readonly MockFyMonthSpec[] = [
	{ key: 'aug', hours: MOCK_AUGUST_HOURS },
	{ key: 'sep', hours: MOCK_SEPTEMBER_HOURS },
	{ key: 'oct', hours: MOCK_OCTOBER_HOURS },
];

const MOCK_FY_MONTH_FLAGS: Readonly<Record<string, MockMonthSpec>> = {
	aug: { month: '2026-08', finalized: true, hours: MOCK_AUGUST_HOURS },
	sep: { month: '2026-09', finalized: true, hours: MOCK_SEPTEMBER_HOURS },
	oct: { month: '2026-10', finalized: false, hours: MOCK_OCTOBER_HOURS },
};

/** Build the mock month. `month` defaults to `MOCK_MONTH`. */
export function mockMonth(
	month: string = MOCK_MONTH,
	inputs: MockCostInputs = MOCK_INPUTS
): MonthlyCompanyCostData {
	if (month === '2026-10') {
		return mockCostData(
			{ month, finalized: false, hours: MOCK_OCTOBER_HOURS },
			inputs
		);
	}
	if (month === '2026-08') {
		return mockCostData(
			{ month, finalized: true, hours: MOCK_AUGUST_HOURS },
			inputs
		);
	}
	return mockCostData(
		{ month, finalized: true, hours: MOCK_SEPTEMBER_HOURS },
		inputs
	);
}

/** Build the mock financial year. `fyYear` defaults to `MOCK_FY_YEAR`. */
export function mockFy(
	fyYear: number = MOCK_FY_YEAR,
	inputs: MockCostInputs = MOCK_INPUTS
): FYCompanyCostData {
	return mockFyCostData(
		{ fyYear, months: MOCK_FY_MONTH_SPECS },
		inputs,
		MOCK_FY_MONTH_FLAGS
	);
}

/** The meta probe's answer: the mock months, newest first. */
export function mockMeta(): CompanyCostMeta {
	return {
		financial_years: [
			{ year: MOCK_FY_YEAR, label: fyLabel(MOCK_FY_YEAR) },
			{ year: MOCK_FY_YEAR - 1, label: fyLabel(MOCK_FY_YEAR - 1) },
		],
		current_fy: MOCK_FY_YEAR,
		months: ['2026-10', '2026-09', '2026-08'],
		latest_month: '2026-10',
		current_month: '2026-10',
	};
}

// ─── Envelopes ──────────────────────────────────────────────────────

/**
 * The route's response envelope, mirrored so a preview can serve the page
 * without a server. Field-for-field the shape the page already reads.
 */
export interface MockApiResponse {
	success: boolean;
	data?: MonthlyCompanyCostData | FYCompanyCostData | null;
	meta?: CompanyCostMeta & {
		expenditure_months?: string[];
		employees?: unknown[];
	};
	view?: string;
	error?: string;
}

/** What the meta probe returns: months and FYs, with no matrix. */
export function mockMetaResponse(): MockApiResponse {
	return {
		success: true,
		meta: { ...mockMeta(), expenditure_months: [], employees: [] },
	};
}

/** What a month request returns: the whole monthly payload. */
export function mockMonthResponse(month: string = MOCK_MONTH): MockApiResponse {
	return { success: true, data: mockMonth(month), view: 'monthly' };
}

/** What an FY request returns: the whole FY matrix. */
export function mockFyResponse(fyYear: number = MOCK_FY_YEAR): MockApiResponse {
	return { success: true, data: mockFy(fyYear), view: 'fy' };
}

/**
 * What the expenditure reconciliation's payroll section reads for a month:
 * the employee drilldown, its totals, and the coverage, without a server.
 */
export interface MockPayrollResponse {
	data: {
		month: string;
		month_label: string;
		currency: string;
		totals: PayrollExpenditure;
		employees: PayrollEmployeeCost[];
		coverage: CoverageNotice[];
	};
}

export function mockPayrollResponse(
	month: string = MOCK_MONTH,
	inputs: MockCostInputs = MOCK_INPUTS
): MockPayrollResponse {
	const data = mockMonth(month, inputs);
	const spec: MockMonthSpec =
		month === '2026-10'
			? { month, finalized: false, hours: MOCK_OCTOBER_HOURS }
			: month === '2026-08'
				? { month, finalized: true, hours: MOCK_AUGUST_HOURS }
				: { month, finalized: true, hours: MOCK_SEPTEMBER_HOURS };
	return {
		data: {
			month,
			month_label: monthLabel(month),
			currency: 'INR',
			totals: data.payroll,
			employees: mockPayrollEmployees(spec, inputs),
			coverage: data.coverage,
		},
	};
}

/** Re-export the labels a preview page reads beside the payloads. */
export { monthLabel, compactMonthLabel, fyLabel, MOCK_FY_KEY_LABELS };
