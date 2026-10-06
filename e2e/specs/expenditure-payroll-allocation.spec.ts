import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	ALLOCATION_BONUS_AMOUNT,
	ALLOCATION_EMPLOYEES,
	ALLOCATION_ESTIMATE_MONTH,
	ALLOCATION_EXPECTED,
	ALLOCATION_MONTH,
	ALLOCATION_MONTH_DAY,
	ALLOCATION_PROJECTS,
	cleanupExpenditureAllocationFixtures,
	loginAllocationFinanceReader,
	loginAllocationReader,
	seedExpenditureAllocationFixtures,
	type SeededAllocation,
} from '../lib/expenditure-allocation-fixtures';

/**
 * Ticket #307 — recorded employer-cost allocation, end to end.
 *
 * The fixture file states every amount as a literal derived from the payroll
 * rules; this spec asserts those literals against the real app (authenticated
 * requests, the actual report controls) and independently against MySQL. No
 * expectation is computed by the module under test.
 *
 * Flow: refuse before a run → generate → estimates before finalization →
 * missing-slip disclosure → finalize (freeze) → repeated/concurrent finalize
 * refused → report + drilldown + browser → reopen/re-finalize versions →
 * later timesheet/Salary Profile edits cannot move frozen shares → paid payroll
 * cannot reopen → authorization and error outcomes.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.33' },
});
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const MONTH = ALLOCATION_MONTH;
const MONTH_DAY = ALLOCATION_MONTH_DAY;
const ESTIMATE_MONTH = ALLOCATION_ESTIMATE_MONTH;
const MONTH_LABEL = 'February 2026';

interface PayrollTotals {
	currency: string;
	recorded_total: number;
	estimated_total: number;
	allocated_total: number;
	unallocated_total: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	recorded_count: number;
	known_zero_count: number;
	estimated_count: number;
	missing_slip_count: number;
	missing_pricing_count: number;
	allocation_missing_count: number;
}

interface PayrollShare {
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	hours: number;
	amount: number;
	rounding_adjustment: number;
	basis: string;
}

interface PayrollEmployee {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	pay_stream: string;
	status: string;
	recorded_amount: number | null;
	estimated_amount: number | null;
	logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	no_logged_hours: boolean;
	missing_slip: boolean;
	missing_pricing: boolean;
	allocation_missing: boolean;
	source: {
		payroll_slip_id: number | null;
		allocation_id: number | null;
		allocation_version: number | null;
		allocation_kind: string | null;
		month: string;
	};
	shares: PayrollShare[];
}

interface PayrollDrilldown {
	month: string;
	month_label: string;
	currency: string;
	totals: PayrollTotals;
	employees: PayrollEmployee[];
	coverage: Array<{ code: string; label: string; detail: string; severity: string }>;
}

interface ReconciliationData {
	month: string;
	month_label: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{
			currency: string;
			incurred_project_cost: number;
			company_overhead: number;
			unallocated_cost: number;
			incurred_cost: number;
		}>;
		groups: Array<{ key: string; amount: number }>;
		record_count: number;
	};
	projects: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		currency: string;
		incurred_cost: number;
		employee_cost: number;
		estimated_employee_cost: number;
		logged_hours: number;
	}>;
	payroll: PayrollTotals;
	coverage: Array<{ code: string; label: string; detail: string; severity: string }>;
}

let seeded: SeededAllocation;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
const allocationTotals = () => ({
	allocations: `SELECT COUNT(*) AS n FROM payroll_employee_allocations WHERE month = ?`,
	shares: `SELECT COUNT(*) AS n FROM payroll_employee_allocation_shares s
             JOIN payroll_employee_allocations a ON a.id = s.allocation_id
            WHERE a.month = ?`,
	events: `SELECT COUNT(*) AS n FROM payroll_allocation_events e
             JOIN payroll_employee_allocations a ON a.allocation_uid = e.allocation_uid
            WHERE a.month = ?`,
});

async function count(sql: string, params: unknown[] = [MONTH_DAY]): Promise<number> {
	const [row] = await rows<{ n: number }>(sql, params);
	return Number(row.n);
}

function publish(): void {
	writeArtifact('expenditure-payroll-allocation', {
		...evidence,
		fixtureScope: {
			projects: Object.values(ALLOCATION_PROJECTS).map((p) => p.code),
			employees: Object.values(ALLOCATION_EMPLOYEES).map((e) => e.code),
			months: [MONTH, ESTIMATE_MONTH],
			bonusAmount: ALLOCATION_BONUS_AMOUNT,
		},
	});
}

async function reconciliation(
	request: APIRequestContext,
	month: string,
	projectId?: number
): Promise<ReconciliationData> {
	const params = new URLSearchParams({ view: 'expenditure', month });
	if (projectId !== undefined) params.set('project_id', String(projectId));
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost?${params.toString()}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ReconciliationData;
}

async function payrollDrilldown(
	request: APIRequestContext,
	month: string,
	employeeId?: number
): Promise<PayrollDrilldown> {
	const params = new URLSearchParams({ month });
	if (employeeId !== undefined) params.set('employee_id', String(employeeId));
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost/payroll?${params.toString()}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as PayrollDrilldown;
}

function coverageCodes(
	payload: { coverage: Array<{ code: string }> }
): string[] {
	return payload.coverage.map((entry) => entry.code);
}

function employeeOf(data: PayrollDrilldown, code: string): PayrollEmployee {
	const found = data.employees.find((row) => row.employee_code === code);
	expect(found, `employee ${code} in drilldown`).toBeTruthy();
	return found!;
}

function shareOf(
	employee: PayrollEmployee,
	projectCode: string | null
): PayrollShare {
	const found = employee.shares.find((share) =>
		projectCode === null
			? share.project_id === null
			: share.project_code === projectCode
	);
	expect(found, `share ${projectCode ?? 'no project'}`).toBeTruthy();
	return found!;
}

/** Every finalized slip's frozen shares must add back to its employer cost. */
async function allocationReconciliation(): Promise<
	Array<{ slip_id: number; employer_cost: string; allocated: string }>
> {
	return rows(
		`SELECT a.payroll_slip_id AS slip_id, ps.employer_cost,
            SUM(s.amount) AS allocated
       FROM payroll_employee_allocations a
       JOIN payroll_slips ps ON ps.id = a.payroll_slip_id
       JOIN payroll_employee_allocation_shares s ON s.allocation_id = a.id
      WHERE a.month = ?
        AND a.version = (
          SELECT MAX(a2.version) FROM payroll_employee_allocations a2
           WHERE a2.payroll_slip_id = a.payroll_slip_id
        )
      GROUP BY a.payroll_slip_id, ps.employer_cost`,
		[MONTH_DAY]
	);
}

test.beforeAll(async () => {
	seeded = await seedExpenditureAllocationFixtures();
	evidence.seeded = {
		projectIds: seeded.projectIds,
		employeeIds: seeded.employeeIds,
	};
});

test.afterAll(async () => {
	publish();
	await cleanupExpenditureAllocationFixtures();
});

test('refuses to finalize before a Payroll Run exists, leaving no allocation', async ({
	request,
}) => {
	const response = await request.post('/api/payroll/runs/finalize', {
		data: { month: MONTH_DAY },
	});
	expect(response.status()).toBe(404);
	const body = await response.json();
	expect(body.success).toBe(false);

	expect(await count(allocationTotals().allocations)).toBe(0);
	expect(await count(allocationTotals().shares)).toBe(0);
	expect(await count(allocationTotals().events)).toBe(0);
	evidence.beforeRun = { finalizeStatus: 404, allocations: 0 };
});

test('generates the month through the real Payroll flow and states every fixture slip', async ({
	request,
}) => {
	const employeeIds = Object.values(seeded.employeeIds);
	const response = await request.post('/api/payroll/generate', {
		data: {
			month: MONTH_DAY,
			all: true,
			include_bonus: true,
			bonus_employee_ids: employeeIds,
		},
	});
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);

	const slips = await rows<{
		employee_id: number;
		employer_cost: string;
		gross: string;
	}>(
		`SELECT employee_id, employer_cost, gross FROM payroll_slips WHERE month = ?`,
		[MONTH_DAY]
	);
	const byEmployee = new Map(
		slips.map((slip) => [Number(slip.employee_id), slip])
	);
	const expected = ALLOCATION_EXPECTED.employees;
	expect(
		Number(byEmployee.get(seeded.employeeIds.splitMonthly)?.employer_cost)
	).toBe(expected.splitMonthly.slipEmployerCost);
	expect(
		Number(byEmployee.get(seeded.employeeIds.contractRounding)?.employer_cost)
	).toBe(expected.contractRounding.slipEmployerCost);
	expect(
		Number(byEmployee.get(seeded.employeeIds.noHoursBonus)?.employer_cost)
	).toBe(expected.noHoursBonus.slipEmployerCost);
	expect(
		Number(byEmployee.get(seeded.employeeIds.knownZero)?.employer_cost)
	).toBe(expected.knownZero.slipEmployerCost);
	expect(
		Number(byEmployee.get(seeded.employeeIds.missingPricing)?.employer_cost)
	).toBe(expected.missingPricing.slipEmployerCost);

	// Only the three fixture employees with cost carry a nonzero slip: every
	// other seeded employee logs no hours in 2026-02 and has statutory
	// contributions off, so their generated slip is a known zero.
	expect(await count(
		`SELECT COUNT(*) AS n FROM payroll_slips WHERE month = ? AND employer_cost <> 0`,
		[MONTH_DAY]
	)).toBe(3);

	const [run] = await rows<{ status: string }>(
		`SELECT status FROM payroll_runs WHERE year = 2026 AND month = 2`,
		[]);
	expect(run.status).toBe('draft');
	expect(await count(allocationTotals().allocations)).toBe(0);
	evidence.generated = { slips: slips.length, nonzero: 3, run: run.status };
});

test('shows estimates separately from recorded cost before finalization', async ({
	request,
}) => {
	const data = await reconciliation(request, MONTH);
	// No confirmed cost exists yet: the company total is not stated, and the
	// estimates are disclosed in their own section instead of being folded in.
	expect(data.company.incurred_cost).toBeNull();
	expect(data.payroll.recorded_total).toBe(0);
	expect(data.payroll.currency).toBe('INR');
	expect(coverageCodes(data)).toContain('payroll_not_finalized');
	expect(coverageCodes(data)).not.toContain('payroll_employee_cost_not_incorporated');

	const drilldown = await payrollDrilldown(
		request,
		MONTH,
		seeded.employeeIds.splitMonthly
	);
	const employee = employeeOf(drilldown, 'E2E-ALLOC-01');
	expect(employee.status).toBe('estimated');
	expect(employee.recorded_amount).toBeNull();
	expect(employee.estimated_amount).toBe(
		ALLOCATION_EXPECTED.employees.splitMonthly.recorded
	);
	expect(employee.source.payroll_slip_id).not.toBeNull();
	expect(employee.source.allocation_id).toBeNull();
	expect(employee.shares.map((share) => share.amount)).toEqual([
		10833.33, 9750, 5416.67,
	]);

	evidence.beforeFinalize = {
		companyIncurredCost: data.company.incurred_cost,
		recordedTotal: data.payroll.recorded_total,
		estimate: employee.estimated_amount,
		coverage: coverageCodes(data),
	};
});

test('discloses a missing Payroll Slip without inventing recorded cost', async ({
	request,
}) => {
	const slip = await rows<{ id: number }>(
		`SELECT id FROM payroll_slips WHERE month = ? AND employee_id = ?`,
		[MONTH_DAY, seeded.employeeIds.splitMonthly]
	);
	const deleted = await request.delete(`/api/payroll/slips?id=${slip[0].id}`);
	expect(deleted.status(), await deleted.text()).toBe(200);

	const data = await reconciliation(request, MONTH);
	expect(coverageCodes(data)).toContain('payroll_slip_missing');
	const drilldown = await payrollDrilldown(
		request,
		MONTH,
		seeded.employeeIds.splitMonthly
	);
	const employee = employeeOf(drilldown, 'E2E-ALLOC-01');
	expect(employee.missing_slip).toBe(true);
	expect(employee.status).toBe('estimated');
	expect(employee.recorded_amount).toBeNull();
	expect(employee.estimated_amount).toBe(26000);

	// Put the slip back through the real Generate path, and prove the gap is
	// gone before finalizing.
	const regenerate = await request.post('/api/payroll/generate', {
		data: { month: MONTH_DAY, employee_ids: [seeded.employeeIds.splitMonthly] },
	});
	expect(regenerate.status(), await regenerate.text()).toBe(200);
	const after = await reconciliation(request, MONTH);
	expect(coverageCodes(after)).not.toContain('payroll_slip_missing');
	evidence.missingSlip = {
		deleted: 200,
		coverage: coverageCodes(data),
		estimate: employee.estimated_amount,
	};
});

test('refuses finalization while a slip is missing, then freezes every slip atomically', async ({
	request,
}) => {
	// A deliberate gap: delete one slip and confirm the gate names the month
	// incomplete and writes no allocation.
	const slip = await rows<{ id: number; employee_id: number }>(
		`SELECT id, employee_id FROM payroll_slips WHERE month = ? AND employee_id = ?`,
		[MONTH_DAY, seeded.employeeIds.contractRounding]
	);
	await request.delete(`/api/payroll/slips?id=${slip[0].id}`);
	const refused = await request.post('/api/payroll/runs/finalize', {
		data: { month: MONTH_DAY },
	});
	expect(refused.status()).toBe(409);
	const refusedBody = await refused.json();
	expect(refusedBody.success).toBe(false);
	expect(await count(allocationTotals().allocations)).toBe(0);
	const [run] = await rows<{ status: string }>(
		`SELECT status FROM payroll_runs WHERE year = 2026 AND month = 2`
	);
	expect(run.status).toBe('draft');

	// Regenerate the missing slip and finalize for real.
	const regenerate = await request.post('/api/payroll/generate', {
		data: { month: MONTH_DAY, employee_ids: [slip[0].employee_id] },
	});
	expect(regenerate.status(), await regenerate.text()).toBe(200);

	const finalized = await request.post('/api/payroll/runs/finalize', {
		data: { month: MONTH_DAY },
	});
	expect(finalized.status(), await finalized.text()).toBe(200);
	const finalizedBody = await finalized.json();
	expect(finalizedBody.success).toBe(true);

	const slipCount = await count(
		`SELECT COUNT(*) AS n FROM payroll_slips WHERE month = ?`,
		[MONTH_DAY]
	);
	expect(await count(allocationTotals().allocations)).toBe(slipCount);
	expect(await count(allocationTotals().events)).toBe(slipCount);

	// Every frozen allocation reconciles exactly to its Payroll Slip.
	const frozen = await allocationReconciliation();
	expect(frozen).toHaveLength(slipCount);
	for (const row of frozen) {
		expect(Number(row.allocated)).toBe(Number(row.employer_cost));
	}
	const versions = await rows<{ version: number }>(
		`SELECT DISTINCT version FROM payroll_employee_allocations WHERE month = ?`,
		[MONTH_DAY]
	);
	expect(versions.map((row) => Number(row.version))).toEqual([1]);

	evidence.finalize = {
		refusalStatus: refused.status(),
		refusedMessage: refusedBody.error,
		slips: slipCount,
		allocations: slipCount,
	};
});

test('repeated finalization is refused and changes nothing', async ({
	request,
}) => {
	const before = await count(allocationTotals().allocations);
	const response = await request.post('/api/payroll/runs/finalize', {
		data: { month: MONTH_DAY },
	});
	expect(response.status()).toBe(409);
	const body = await response.json();
	expect(body.success).toBe(false);
	expect(await count(allocationTotals().allocations)).toBe(before);
	const versions = await rows<{ version: number }>(
		`SELECT DISTINCT version FROM payroll_employee_allocations WHERE month = ?`,
		[MONTH_DAY]
	);
	expect(versions.map((row) => Number(row.version))).toEqual([1]);
	evidence.repeatedFinalize = { status: 409, allocations: before };
});

test('reports the frozen recorded cost, hours, and rounding in the company reconciliation', async ({
	request,
}) => {
	const data = await reconciliation(request, MONTH);
	const expected = ALLOCATION_EXPECTED.month;

	expect(data.payroll.recorded_total).toBe(expected.recordedTotal);
	expect(data.payroll.estimated_total).toBe(0);
	expect(data.payroll.allocated_total).toBe(
		expected.project1 + expected.project2
	);
	expect(data.payroll.unallocated_total).toBe(expected.unallocated);
	expect(data.payroll.rounding_adjustment).toBe(expected.roundedAdjustment);
	expect(data.payroll.total_logged_hours).toBe(expected.totalHours);
	expect(data.payroll.project_hours).toBe(expected.projectHours);
	expect(data.payroll.no_project_hours).toBe(expected.noProjectHours);
	expect(data.payroll.recorded_count).toBe(expected.recordedCount);
	expect(data.payroll.estimated_count).toBe(0);
	expect(data.payroll.missing_slip_count).toBe(0);
	expect(data.payroll.missing_pricing_count).toBe(0);
	expect(data.payroll.allocation_missing_count).toBe(0);

	// Company Incurred Cost counts the recorded employee cost once: the INR
	// slice carries the three reconciliation groups.
	expect(data.company.currency).toBe('INR');
	expect(data.company.incurred_cost).toBe(expected.recordedTotal);
	const inr = data.company.currency_totals.find((row) => row.currency === 'INR')!;
	expect(inr.incurred_project_cost).toBe(expected.project1 + expected.project2);
	expect(inr.company_overhead).toBe(0);
	expect(inr.unallocated_cost).toBe(expected.unallocated);
	expect(inr.incurred_cost).toBe(expected.recordedTotal);
	const group = (key: string) =>
		data.company.groups.find((entry) => entry.key === key)?.amount;
	expect(group('incurred_project_cost')).toBe(expected.project1 + expected.project2);
	expect(group('unallocated_cost')).toBe(expected.unallocated);

	const p1 = data.projects.find(
		(row) => row.project_code === ALLOCATION_PROJECTS.p1.code
	)!;
	expect(p1.employee_cost).toBe(expected.project1);
	expect(p1.logged_hours).toBe(
		ALLOCATION_EXPECTED.employees.splitMonthly.projectHours +
			ALLOCATION_EXPECTED.employees.contractRounding.projectHours
	);
	expect(p1.incurred_cost).toBe(expected.project1);
	const p2 = data.projects.find(
		(row) => row.project_code === ALLOCATION_PROJECTS.p2.code
	)!;
	expect(p2.employee_cost).toBe(expected.project2);
	expect(p2.incurred_cost).toBe(expected.project2);

	// No payroll coverage warnings survive a complete finalization.
	const codes = coverageCodes(data);
	for (const code of [
		'payroll_not_finalized',
		'payroll_slip_missing',
		'payroll_pricing_missing',
		'payroll_allocation_missing',
		'payroll_not_generated',
	]) {
		expect(codes).not.toContain(code);
	}

	evidence.reconciled = {
		payroll: data.payroll,
		project1: p1,
		project2: p2,
		company: data.company,
	};
});

test('drills into each employee with shares, hours, source slip, and adjustments', async ({
	request,
}) => {
	const employees = ALLOCATION_EXPECTED.employees;
	const split = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.splitMonthly),
		'E2E-ALLOC-01'
	);
	expect(split.status).toBe('recorded');
	expect(split.pay_stream).toBe(employees.splitMonthly.payStream);
	expect(split.recorded_amount).toBe(employees.splitMonthly.recorded);
	expect(split.estimated_amount).toBeNull();
	expect(split.logged_hours).toBe(employees.splitMonthly.hours);
	expect(split.project_hours).toBe(employees.splitMonthly.projectHours);
	expect(split.no_project_hours).toBe(employees.splitMonthly.noProjectHours);
	expect(split.no_logged_hours).toBe(false);
	expect(split.source.allocation_kind).toBe('finalization');
	expect(split.source.allocation_version).toBe(1);
	expect(split.source.payroll_slip_id).toBeGreaterThan(0);
	const p1 = shareOf(split, ALLOCATION_PROJECTS.p1.code);
	expect(p1.hours).toBe(80);
	expect(p1.amount).toBe(employees.splitMonthly.shares.p1);
	expect(p1.rounding_adjustment).toBe(employees.splitMonthly.adjustments.p1);
	expect(p1.basis).toBe('project');
	expect(p1.project_name).toBe(ALLOCATION_PROJECTS.p1.name);
	expect(p1.client_name).toBe(ALLOCATION_PROJECTS.p1.client);
	const noProject = shareOf(split, null);
	expect(noProject.basis).toBe('no_project');
	expect(noProject.hours).toBe(40);
	expect(noProject.amount).toBe(employees.splitMonthly.shares.noProject);
	expect(noProject.rounding_adjustment).toBe(
		employees.splitMonthly.adjustments.noProject
	);

	// The contract pay stream is allocated by the same rule.
	const contract = employeeOf(
		await payrollDrilldown(
			request,
			MONTH,
			seeded.employeeIds.contractRounding
		),
		'E2E-ALLOC-02'
	);
	expect(contract.pay_stream).toBe('contract');
	expect(contract.recorded_amount).toBe(employees.contractRounding.recorded);
	expect(shareOf(contract, ALLOCATION_PROJECTS.p2.code).amount).toBe(
		employees.contractRounding.shares.p2
	);
	expect(shareOf(contract, ALLOCATION_PROJECTS.p2.code).rounding_adjustment).toBe(
		employees.contractRounding.adjustments.p2
	);

	// Nonzero cost with no Logged Hours stays fully unallocated.
	const noHours = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.noHoursBonus),
		'E2E-ALLOC-03'
	);
	expect(noHours.recorded_amount).toBe(employees.noHoursBonus.recorded);
	expect(noHours.logged_hours).toBe(0);
	expect(noHours.no_logged_hours).toBe(true);
	expect(noHours.shares).toHaveLength(1);
	expect(noHours.shares[0].basis).toBe('no_logged_hours');
	expect(noHours.shares[0].amount).toBe(employees.noHoursBonus.shares.noLoggedHours);

	// A finalized zero is a known zero, not a missing amount.
	const knownZero = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.knownZero),
		'E2E-ALLOC-04'
	);
	expect(knownZero.status).toBe('known_zero');
	expect(knownZero.recorded_amount).toBe(0);
	expect(knownZero.missing_slip).toBe(false);
	expect(knownZero.missing_pricing).toBe(false);

	evidence.drilldown = {
		split: split.shares,
		contract: contract.shares,
		noHours: noHours.shares,
		knownZero: knownZero.status,
	};
});

test('states the current-month payroll-based estimate and missing pricing', async ({
	request,
}) => {
	const data = await reconciliation(request, ESTIMATE_MONTH);
	expect(data.payroll.recorded_total).toBe(0);
	expect(coverageCodes(data)).toContain('payroll_not_generated');
	expect(coverageCodes(data)).toContain('payroll_pricing_missing');

	const estimate = employeeOf(
		await payrollDrilldown(
			request,
			ESTIMATE_MONTH,
			seeded.employeeIds.estimateOnly
		),
		'E2E-ALLOC-05'
	);
	expect(estimate.status).toBe('estimated');
	expect(estimate.estimated_amount).toBe(
		ALLOCATION_EXPECTED.estimateMonth.estimateOnlyEstimated
	);
	expect(estimate.logged_hours).toBe(
		ALLOCATION_EXPECTED.employees.estimateOnly.hours
	);
	expect(shareOf(estimate, ALLOCATION_PROJECTS.p1.code).amount).toBe(
		ALLOCATION_EXPECTED.estimateMonth.estimateOnlyP1
	);
	expect(shareOf(estimate, ALLOCATION_PROJECTS.p2.code).amount).toBe(
		ALLOCATION_EXPECTED.estimateMonth.estimateOnlyP2
	);

	const missing = employeeOf(
		await payrollDrilldown(
			request,
			ESTIMATE_MONTH,
			seeded.employeeIds.missingPricing
		),
		'E2E-ALLOC-06'
	);
	expect(missing.missing_pricing).toBe(true);
	expect(missing.status).toBe('unknown');
	expect(missing.recorded_amount).toBeNull();
	expect(missing.estimated_amount).toBeNull();
	expect(missing.logged_hours).toBe(
		ALLOCATION_EXPECTED.estimateMonth.missingPricingHours
	);

	evidence.estimateMonth = {
		estimate: estimate.estimated_amount,
		estimateShares: estimate.shares,
		missingPricing: {
			status: missing.status,
			hours: missing.logged_hours,
		},
	};
});

test('shows recorded employee cost in the real report controls', async ({
	page,
}) => {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(MONTH_LABEL);
	await page.getByRole('button', { name: MONTH_LABEL, exact: true }).click();

	const summary = page.getByTestId('payroll-summary');
	await expect(summary).toBeVisible();
	await expect(summary).toHaveAttribute(
		'data-recorded-total',
		String(ALLOCATION_EXPECTED.month.recordedTotal)
	);
	await expect(summary).toHaveAttribute(
		'data-unallocated-total',
		String(ALLOCATION_EXPECTED.month.unallocated)
	);

	const row = page
		.getByTestId('payroll-employee-row')
		.filter({ hasText: 'E2E-ALLOC-01' });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute(
		'data-recorded',
		String(ALLOCATION_EXPECTED.employees.splitMonthly.recorded)
	);
	await expect(row).toHaveAttribute(
		'data-hours',
		String(ALLOCATION_EXPECTED.employees.splitMonthly.hours)
	);
	await row.getByTestId('payroll-employee-expand').click();
	const noProject = page
		.getByTestId('payroll-share-row')
		.filter({ hasText: 'No project' });
	await expect(noProject).toBeVisible();
	await expect(noProject).toHaveAttribute(
		'data-amount',
		String(ALLOCATION_EXPECTED.employees.splitMonthly.shares.noProject)
	);
	await expect(noProject).toHaveAttribute('data-adjustment', '0.01');
	await expect(noProject).toHaveAttribute('data-hours', '40');

	const projectRow = page
		.getByTestId('expenditure-project-row')
		.filter({ hasText: ALLOCATION_PROJECTS.p1.code });
	await expect(projectRow).toHaveAttribute(
		'data-employee-cost',
		String(ALLOCATION_EXPECTED.month.project1)
	);

	evidence.browser = {
		recordedTotal: ALLOCATION_EXPECTED.month.recordedTotal,
		employeeRow: 'E2E-ALLOC-01',
		noProjectShare: ALLOCATION_EXPECTED.employees.splitMonthly.shares.noProject,
	};
});

test('reopen returns the month to estimates while keeping the frozen history, and concurrent finalization writes one version', async ({
	request,
}) => {
	const reopened = await request.post('/api/payroll/runs/reopen', {
		data: { month: MONTH_DAY },
	});
	expect(reopened.status(), await reopened.text()).toBe(200);

	const beforeReFinalize = await reconciliation(request, MONTH);
	expect(beforeReFinalize.payroll.recorded_total).toBe(0);
	expect(coverageCodes(beforeReFinalize)).toContain('payroll_not_finalized');
	// The version-1 allocation is history now, not a second competing truth.
	expect(await count(allocationTotals().allocations)).toBe(
		await count(`SELECT COUNT(*) AS n FROM payroll_slips WHERE month = ?`)
	);

	const [first, second] = await Promise.all([
		request.post('/api/payroll/runs/finalize', { data: { month: MONTH_DAY } }),
		request.post('/api/payroll/runs/finalize', { data: { month: MONTH_DAY } }),
	]);
	const statuses = [first.status(), second.status()].sort();
	expect(statuses).toEqual([200, 409]);

	const versions = await rows<{ version: number }>(
		`SELECT version, COUNT(*) AS n FROM payroll_employee_allocations WHERE month = ?
      GROUP BY version ORDER BY version`,
		[MONTH_DAY]
	);
	expect(versions.map((row) => Number(row.version))).toEqual([1, 2]);
	const slipCount = await count(
		`SELECT COUNT(*) AS n FROM payroll_slips WHERE month = ?`,
		[MONTH_DAY]
	);
	expect(Number(versions[1].n)).toBe(slipCount);

	const after = await reconciliation(request, MONTH);
	expect(after.payroll.recorded_total).toBe(
		ALLOCATION_EXPECTED.month.recordedTotal
	);
	const frozen = await allocationReconciliation();
	for (const row of frozen) {
		expect(Number(row.allocated)).toBe(Number(row.employer_cost));
	}

	evidence.concurrency = {
		reopen: reopened.status(),
		concurrentFinalize: statuses,
		versions: versions.map((row) => Number(row.version)),
	};
});

test('later timesheet and Salary Profile edits cannot alter frozen shares or Payroll Slips', async ({
	request,
}) => {
	const before = await rows<{ id: number; amount: string; version: number }>(
		`SELECT a.id, SUM(s.amount) AS amount, a.version
       FROM payroll_employee_allocations a
       JOIN payroll_employee_allocation_shares s ON s.allocation_id = a.id
      WHERE a.month = ? AND a.employee_id = ? AND a.version = 2
      GROUP BY a.id, a.version`,
		[MONTH_DAY, seeded.employeeIds.splitMonthly]
	);
	expect(before).toHaveLength(1);
	const slipBefore = await rows<{ employer_cost: string }>(
		`SELECT employer_cost FROM payroll_slips WHERE month = ? AND employee_id = ?`,
		[MONTH_DAY, seeded.employeeIds.splitMonthly]
	);

	// Timesheet: add hours to the frozen month (through the fixture row, the
	// way the assignment screen writes them).
	await exec(
		`UPDATE user_activity_assignments
        SET daily_entries = ?
      WHERE id = ?`,
		[
			JSON.stringify([
				{ date: `${MONTH}-28`, hours: 8 },
				{ date: `${MONTH}-27`, hours: 8 },
			]),
			`e2e-alloc-assign-01-p1`,
		]
	);

	// Salary Profile: a new, much larger CTC effective from the frozen month
	// through the real payroll profile route.
	const profile = await request.post('/api/payroll/salary-profile', {
		data: {
			employee_id: seeded.employeeIds.splitMonthly,
			gross_salary: 99000,
			employer_cost: 99000,
			effective_from: MONTH_DAY,
			salary_type: 'monthly',
			std_hours_per_day: 8,
			std_working_days: 26,
		},
	});
	expect(profile.status(), await profile.text()).toBe(200);

	const data = await reconciliation(request, MONTH);
	expect(data.payroll.recorded_total).toBe(
		ALLOCATION_EXPECTED.month.recordedTotal
	);
	const p1 = data.projects.find(
		(row) => row.project_code === ALLOCATION_PROJECTS.p1.code
	)!;
	expect(p1.employee_cost).toBe(ALLOCATION_EXPECTED.month.project1);

	const split = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.splitMonthly),
		'E2E-ALLOC-01'
	);
	expect(split.recorded_amount).toBe(
		ALLOCATION_EXPECTED.employees.splitMonthly.recorded
	);
	expect(split.source.allocation_version).toBe(2);
	expect(shareOf(split, ALLOCATION_PROJECTS.p1.code).amount).toBe(
		ALLOCATION_EXPECTED.employees.splitMonthly.shares.p1
	);

	const after = await rows<{ id: number; amount: string; version: number }>(
		`SELECT a.id, SUM(s.amount) AS amount, a.version
       FROM payroll_employee_allocations a
       JOIN payroll_employee_allocation_shares s ON s.allocation_id = a.id
      WHERE a.month = ? AND a.employee_id = ? AND a.version = 2
      GROUP BY a.id, a.version`,
		[MONTH_DAY, seeded.employeeIds.splitMonthly]
	);
	expect(after).toEqual(before);
	const slipAfter = await rows<{ employer_cost: string }>(
		`SELECT employer_cost FROM payroll_slips WHERE month = ? AND employee_id = ?`,
		[MONTH_DAY, seeded.employeeIds.splitMonthly]
	);
	expect(slipAfter).toEqual(slipBefore);

	evidence.laterEdits = {
		allocationBefore: before[0],
		allocationAfter: after[0],
		slipEmployerCost: Number(slipBefore[0].employer_cost),
	};
});

test('keeps historical Project identity after a rename', async ({ request }) => {
	const original = ALLOCATION_PROJECTS.p1;
	await exec(`UPDATE projects SET name = ?, project_title = ? WHERE project_id = ?`, [
		'E2E Allocation Project One (renamed)',
		'E2E Allocation Project One (renamed)',
		seeded.projectIds.p1,
	]);
	try {
		const split = employeeOf(
			await payrollDrilldown(request, MONTH, seeded.employeeIds.splitMonthly),
			'E2E-ALLOC-01'
		);
		expect(shareOf(split, original.code).project_name).toBe(original.name);
		const data = await reconciliation(request, MONTH);
		const row = data.projects.find(
			(candidate) => candidate.project_id === seeded.projectIds.p1
		)!;
		expect(row.project_name).toBe(original.name);
		evidence.renamedProject = {
			frozenName: original.name,
			observed: row.project_name,
		};
	} finally {
		await exec(`UPDATE projects SET name = ?, project_title = ? WHERE project_id = ?`, [
			original.name,
			original.name,
			seeded.projectIds.p1,
		]);
	}
});

test('paid payroll cannot reopen, and the frozen allocation stays recorded', async ({
	request,
}) => {
	const paid = await request.post('/api/payroll/runs/mark-paid', {
		data: { month: MONTH_DAY, payment_date: `${MONTH}-27` },
	});
	expect(paid.status(), await paid.text()).toBe(200);

	const reopen = await request.post('/api/payroll/runs/reopen', {
		data: { month: MONTH_DAY },
	});
	expect(reopen.status()).toBe(409);

	const data = await reconciliation(request, MONTH);
	expect(data.payroll.recorded_total).toBe(
		ALLOCATION_EXPECTED.month.recordedTotal
	);
	evidence.paid = { markPaid: 200, reopen: 409 };
});

test('refuses unauthorized readers and invalid requests without leaking values', async ({
	request,
	playwright,
}) => {
	const reader = await loginAllocationReader(playwright, E2E_ENV.baseURL);
	const financeReader = await loginAllocationFinanceReader(
		playwright,
		E2E_ENV.baseURL
	);
	try {
		for (const context of [reader, financeReader]) {
			const view = await context.get(
				`/api/reports/employee-project-monthly-cost?view=expenditure&month=${MONTH}`
			);
			expect(view.status()).toBe(403);
			const payroll = await context.get(
				`/api/reports/employee-project-monthly-cost/payroll?month=${MONTH}`
			);
			expect(payroll.status()).toBe(403);
			// The employee-cost views keep their existing reports:read contract
			// (#306); only the financial reconciliation and its drilldowns are
			// source-gated.
			const monthly = await context.get(
				`/api/reports/employee-project-monthly-cost?view=monthly&month=${MONTH}`
			);
			expect(monthly.status()).toBe(200);
			const body = await view.text();
			expect(body).not.toContain('E2E-ALLOC-01');
			expect(body).not.toContain('36500');
		}
	} finally {
		await reader.dispose();
		await financeReader.dispose();
	}

	const missingMonth = await request.get(
		'/api/reports/employee-project-monthly-cost/payroll'
	);
	expect(missingMonth.status()).toBe(400);
	const badMonth = await request.get(
		'/api/reports/employee-project-monthly-cost/payroll?month=2026-13'
	);
	expect(badMonth.status()).toBe(400);
	const badEmployee = await request.get(
		`/api/reports/employee-project-monthly-cost/payroll?month=${MONTH}&employee_id=abc`
	);
	expect(badEmployee.status()).toBe(400);
	const unknownEmployee = await request.get(
		`/api/reports/employee-project-monthly-cost/payroll?month=${MONTH}&employee_id=99999999`
	);
	expect(unknownEmployee.status()).toBe(404);

	evidence.authorization = {
		reportReader: 403,
		financeReader: 403,
		missingMonth: 400,
		unknownEmployee: 404,
	};
});
