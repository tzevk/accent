import { exec, rows } from './db';

export const BUDGET_PAYROLL_MONTH = '2017-06';
const MONTH_DAY = `${BUDGET_PAYROLL_MONTH}-01`;
const EMPLOYEE_CODES = ['E2E-BUDGET-PAY-01', 'E2E-BUDGET-PAY-02'];
export const BUDGET_PAYROLL_PROJECTS = {
	positive: 'E2E-BUDGET-PAY-POS',
	zero: 'E2E-BUDGET-PAY-ZERO',
} as const;

export interface BudgetPayrollFixture {
	positiveProjectId: number;
	zeroProjectId: number;
	positiveSlipId: number;
	zeroSlipId: number;
}

export async function cleanupBudgetPayrollFixtures(): Promise<void> {
	const foreignSlips = await rows<{ id: number }>(
		`SELECT ps.id FROM payroll_slips ps LEFT JOIN employees e ON e.id = ps.employee_id
		 WHERE ps.month = ? AND (e.employee_id IS NULL OR e.employee_id NOT IN (?, ?))`,
		[MONTH_DAY, ...EMPLOYEE_CODES]
	);
	if (foreignSlips.length)
		throw new Error(
			'Refusing to clean a payroll-budget month with foreign slips'
		);
	const ownedSlips = await rows<{ id: number }>(
		`SELECT ps.id FROM payroll_slips ps JOIN employees e ON e.id = ps.employee_id
		 WHERE ps.month = ? AND e.employee_id IN (?, ?)`,
		[MONTH_DAY, ...EMPLOYEE_CODES]
	);
	const runs = await rows<{ id: number }>(
		`SELECT id FROM payroll_runs WHERE year = 2017 AND month = 6`
	);
	if (runs.length && !ownedSlips.length) {
		throw new Error(
			'Refusing to remove a payroll run without owned payroll-budget slips'
		);
	}
	const projectCodes = Object.values(BUDGET_PAYROLL_PROJECTS);
	await exec(
		`DELETE ev FROM project_cost_budget_events ev JOIN project_cost_budgets b ON b.id = ev.source_id
		 JOIN projects p ON p.project_id = b.project_id
		 WHERE ev.source_table = 'project_cost_budgets' AND p.project_code IN (?, ?)`,
		projectCodes
	);
	await exec(
		`DELETE b FROM project_cost_budgets b JOIN projects p ON p.project_id = b.project_id
		 WHERE p.project_code IN (?, ?)`,
		projectCodes
	);
	await exec(
		`DELETE ev FROM payroll_allocation_events ev JOIN payroll_slips ps ON ps.id = ev.source_id
		 JOIN employees e ON e.id = ps.employee_id
		 WHERE ev.source_table = 'payroll_slips' AND ps.month = ? AND e.employee_id IN (?, ?)`,
		[MONTH_DAY, ...EMPLOYEE_CODES]
	);
	await exec(
		`DELETE s FROM payroll_employee_allocation_shares s JOIN payroll_employee_allocations a ON a.id = s.allocation_id
		 JOIN employees e ON e.id = a.employee_id WHERE a.month = ? AND e.employee_id IN (?, ?)`,
		[MONTH_DAY, ...EMPLOYEE_CODES]
	);
	await exec(
		`DELETE a FROM payroll_employee_allocations a JOIN employees e ON e.id = a.employee_id
		 WHERE a.month = ? AND e.employee_id IN (?, ?)`,
		[MONTH_DAY, ...EMPLOYEE_CODES]
	);
	await exec(
		`DELETE ps FROM payroll_slips ps JOIN employees e ON e.id = ps.employee_id
		 WHERE ps.month = ? AND e.employee_id IN (?, ?)`,
		[MONTH_DAY, ...EMPLOYEE_CODES]
	);
	if (ownedSlips.length)
		await exec(`DELETE FROM payroll_runs WHERE year = 2017 AND month = 6`);
	// Slips of our own employees in any month, before the employee delete:
	// inert gate slips from other fixtures' months survive the month-scoped
	// delete above, and an aborted run leaves them behind to trip the
	// employee delete (FK). Namespace-scoped, so no real data is touched.
	await exec(
		`DELETE ps FROM payroll_slips ps JOIN employees e ON e.id = ps.employee_id
		 WHERE e.employee_id IN (?, ?)`,
		EMPLOYEE_CODES
	);
	await exec(
		`DELETE FROM employees WHERE employee_id IN (?, ?)`,
		EMPLOYEE_CODES
	);
	await exec(`DELETE FROM projects WHERE project_code IN (?, ?)`, projectCodes);
}

/** Archived finalization snapshots; no pricing function computes the expected amounts. */
export async function seedBudgetPayrollFixtures(): Promise<BudgetPayrollFixture> {
	await cleanupBudgetPayrollFixtures();
	const projectIds: number[] = [];
	const slipIds: number[] = [];
	for (const [index, code] of Object.values(
		BUDGET_PAYROLL_PROJECTS
	).entries()) {
		const project = await exec(
			`INSERT INTO projects (project_code, name, project_title, client_name, status, isDelete)
			 VALUES (?, ?, ?, 'E2E Budget Payroll Client', 'active', 0)`,
			[code, code, code]
		);
		projectIds.push(project.insertId);
		const employee = await exec(
			`INSERT INTO employees (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
			 VALUES (?, 'E2E Budget', ?, ?, 'active', 'Payroll', '2017-01-01', 0)`,
			[
				EMPLOYEE_CODES[index],
				index === 0 ? 'Positive' : 'Zero',
				`e2e.budget.pay.${index}@accent.test`,
			]
		);
		const amount = index === 0 ? 1000 : 0;
		const projectAmount = index === 0 ? 600 : 0;
		const unallocatedAmount = index === 0 ? 400 : 0;
		const slip = await exec(
			`INSERT INTO payroll_slips
			 (month, employee_id, gross, basic, hra, conveyance, call_allowance, total_earnings,
			 total_deductions, net_pay, pf_employer, esic_employer, total_employer_contributions, employer_cost, payment_status)
			 VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, ?, 0, 0, 0, ?, 'pending')`,
			[MONTH_DAY, employee.insertId, amount, amount, amount, amount, amount]
		);
		slipIds.push(slip.insertId);
		const uid = `payroll-alloc-${slip.insertId}-v1`;
		const allocation = await exec(
			`INSERT INTO payroll_employee_allocations
			 (allocation_uid, payroll_slip_id, month, employee_id, employee_code, employee_name, pay_stream,
			 version, kind, recorded_employer_cost, currency, total_logged_hours, project_hours,
			 no_project_hours, rounding_adjustment)
			 VALUES (?, ?, ?, ?, ?, ?, 'payroll', 1, 'finalization', ?, 'INR', 10, 6, 4, 0)`,
			[
				uid,
				slip.insertId,
				MONTH_DAY,
				employee.insertId,
				EMPLOYEE_CODES[index],
				`E2E Budget ${index === 0 ? 'Positive' : 'Zero'}`,
				amount,
			]
		);
		await exec(
			`INSERT INTO payroll_employee_allocation_shares
			 (allocation_id, project_id, project_code, project_name, client_name, hours, amount, rounding_adjustment, basis)
			 VALUES (?, ?, ?, ?, 'E2E Budget Payroll Client', 6, ?, 0, 'project'),
			 (?, NULL, NULL, NULL, NULL, 4, ?, 0, 'no_project')`,
			[
				allocation.insertId,
				project.insertId,
				code,
				code,
				projectAmount,
				allocation.insertId,
				unallocatedAmount,
			]
		);
		await exec(
			`INSERT INTO payroll_allocation_events
			 (allocation_uid, source_table, source_id, version, command, snapshot)
			 VALUES (?, 'payroll_slips', ?, 1, 'frozen', ?)`,
			[
				uid,
				slip.insertId,
				JSON.stringify({
					month: MONTH_DAY,
					recorded_employer_cost: amount,
					shares: [
						{ project_id: project.insertId, hours: 6, amount: projectAmount },
						{ project_id: null, hours: 4, amount: unallocatedAmount },
					],
				}),
			]
		);
	}
	await exec(
		`INSERT INTO payroll_runs (month, year, run_number, status) VALUES (6, 2017, 1, 'finalized')`
	);
	return {
		positiveProjectId: projectIds[0],
		zeroProjectId: projectIds[1],
		positiveSlipId: slipIds[0],
		zeroSlipId: slipIds[1],
	};
}
