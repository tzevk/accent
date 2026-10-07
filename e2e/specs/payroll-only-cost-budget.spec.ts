import { test, expect } from '@playwright/test';
import { rows } from '../lib/db';
import { writeArtifact } from '../lib/artifacts';
import {
	BUDGET_PAYROLL_MONTH,
	BUDGET_PAYROLL_PROJECTS,
	seedBudgetPayrollFixtures,
	cleanupBudgetPayrollFixtures,
	type BudgetPayrollFixture,
} from '../lib/budget-payroll-fixtures';

interface ReportData {
	projects: Array<{ project_id: number; employee_cost: number; incurred_cost: number }>;
	budgets: { comparisons: Array<{
		project_id: number; outcome: string; incurred_cost: number | null;
		variance: number | null;
	}> };
}

test.use({ storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.90' } });
test.describe.configure({ mode: 'serial', timeout: 120_000 });
let fixture: BudgetPayrollFixture;
const evidence: Record<string, unknown> = { month: BUDGET_PAYROLL_MONTH };

test.beforeAll(async () => { fixture = await seedBudgetPayrollFixtures(); });
test.afterAll(async () => {
	writeArtifact('payroll-only-cost-budget', evidence);
	await cleanupBudgetPayrollFixtures();
});

test('compares recorded payroll-only and known-zero payroll costs with approved budgets', async ({ request, page }) => {
	for (const projectId of [fixture.positiveProjectId, fixture.zeroProjectId]) {
		const create = await request.post('/api/admin/cost-budgets', { data: {
			project_id: projectId, amount: 500, currency: 'INR', scope: 'project_incurred_cost',
			period_start: '2017-06-01', period_end: '2017-06-30',
			basis_note: 'E2E payroll-only monthly cost budget',
		} });
		expect(create.status(), await create.text()).toBe(201);
		const budget = (await create.json()).data as { id: number };
		for (const [command, version] of [['submit', 1], ['approve', 2]] as const) {
			const response = await request.post(`/api/admin/cost-budgets/${budget.id}/commands`, {
				data: { command, expected_version: version,
					evidence_reference: 'E2E-PAYROLL-BUDGET-APPROVAL' },
			});
			expect(response.status(), await response.text()).toBe(200);
		}
	}
	const report = await request.get(`/api/reports/employee-project-monthly-cost?view=expenditure&month=${BUDGET_PAYROLL_MONTH}`);
	expect(report.status(), await report.text()).toBe(200);
	const data = (await report.json()).data as ReportData;
	evidence.report = data;
	for (const [projectId, cost, variance] of [
		[fixture.positiveProjectId, 600, -100], [fixture.zeroProjectId, 0, 500],
	]) {
		const project = data.projects.find(row => row.project_id === projectId);
		expect(project?.employee_cost).toBe(cost);
		expect(project?.incurred_cost).toBe(cost);
		const comparison = data.budgets.comparisons.find(row => row.project_id === projectId);
		expect(comparison?.outcome).toBe('compared');
		expect(comparison?.incurred_cost).toBe(cost);
		expect(comparison?.variance).toBe(variance);
	}
	const stored = await rows<{ id: number; employer_cost: string; allocated: string }>(
		`SELECT ps.id, ps.employer_cost, SUM(s.amount) AS allocated FROM payroll_slips ps
		 JOIN payroll_employee_allocations a ON a.payroll_slip_id = ps.id
		 JOIN payroll_employee_allocation_shares s ON s.allocation_id = a.id
		 WHERE ps.id IN (?, ?) GROUP BY ps.id, ps.employer_cost ORDER BY ps.id`,
		[fixture.positiveSlipId, fixture.zeroSlipId]
	);
	evidence.payrollStorage = stored;
	expect(stored.map(row => [Number(row.employer_cost), Number(row.allocated)]))
		.toEqual([[1000, 1000], [0, 0]]);
	const budgets = await rows<{ state: string; amount: string; evidence: string }>(
		`SELECT state, amount, approval_evidence_reference AS evidence FROM project_cost_budgets
		 WHERE project_id IN (?, ?) ORDER BY project_id`,
		[fixture.positiveProjectId, fixture.zeroProjectId]
	);
	evidence.budgets = budgets;
	expect(budgets.map(row => [row.state, Number(row.amount), row.evidence])).toEqual([
		['approved', 500, 'E2E-PAYROLL-BUDGET-APPROVAL'],
		['approved', 500, 'E2E-PAYROLL-BUDGET-APPROVAL'],
	]);
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill('June 2017');
	await page.getByRole('button', { name: 'June 2017', exact: true }).click();
	for (const [code, cost, variance] of [
		[BUDGET_PAYROLL_PROJECTS.positive, 600, -100],
		[BUDGET_PAYROLL_PROJECTS.zero, 0, 500],
	] as const) {
		const row = page.locator(`[data-testid="budget-comparison-row"][data-project-code="${code}"][data-currency="INR"]`);
		await expect(row).toHaveAttribute('data-outcome', 'compared');
		await expect(row).toHaveAttribute('data-incurred', String(cost));
		await expect(row).toHaveAttribute('data-variance', String(variance));
	}
	await page.screenshot({ path: 'e2e/artifacts/payroll-only-cost-budget.png', fullPage: true });
});
