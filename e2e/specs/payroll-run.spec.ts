import { test, expect } from '../support/test.ts';
import type { Dialog } from '@playwright/test';
import { signInThroughUi } from '../support/auth.ts';
import {
	readPayrollRunState,
	seedPayrollRunFixture,
	type PayrollOperationsFixture,
} from '../fixtures/payroll-operations.ts';

// The owned Next dev server compiles routes on first visit; every assertion
// still waits for its observable result, this only bounds compilation time.
test.setTimeout(300_000);

const monthLabel = (month: string) =>
	new Intl.DateTimeFormat('en-IN', {
		month: 'long',
		year: 'numeric',
	}).format(new Date(month));

const dateLabel = (date: string) =>
	new Intl.DateTimeFormat('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	}).format(new Date(date));

const currencyLabel = (value: number) =>
	new Intl.NumberFormat('en-IN', {
		style: 'currency',
		currency: 'INR',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);

let fixture: PayrollOperationsFixture | null = null;

test.afterEach(async () => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await owned.dispose();
});

// Actor: Payroll operator with payroll:read from the admin reference role and payroll:update directly on the user, never a super-admin.
// Starting state: One owned draft Payroll Run month with one active Employee, a Salary Profile covering that month, and its recorded Payroll Slip; no saved roster.
// Action: Open the month on the Payroll Run dashboard and choose Finalize Payroll Run, accepting the confirmation that names the eligible count and totals.
// Proof: The header becomes Finalized, Generate is disabled, completeness switches from live eligibility to the saved-roster wording with 1.00 eligible, and the independent database read has a version-1 roster, frozen totals, salary use and employer-cost allocation for this Employee.
test('finalizing an eligible draft month locks the saved employee roster', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedPayrollRunFixture(db, namespace, { status: 'draft' });
	const seeded = fixture;
	if (!seeded.operator)
		throw new Error('The run fixture must own an operator.');
	const operator = seeded.operator;
	const employee = seeded.employee;
	const run = seeded.run;
	const month = monthLabel(run.month);
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	await signInThroughUi(page, operator);
	await page.goto('/admin/payroll');
	await expect(
		page.getByRole('heading', { name: /^Payroll Run/ })
	).toBeVisible();

	const runRead = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/runs' &&
			new URL(response.url()).searchParams.get('month') === run.month
	);
	const slipsRead = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/slips' &&
			new URL(response.url()).searchParams.get('month') === run.month
	);
	await page.getByLabel('Month:', { exact: true }).fill(run.monthSlug);
	expect((await runRead).ok()).toBe(true);
	expect((await slipsRead).ok()).toBe(true);

	const header = page.getByRole('heading', { name: /^Payroll Run/ });
	await expect(header.getByText('Draft', { exact: true })).toBeVisible();
	const completeness = page.getByRole('region', {
		name: 'Payroll completeness',
	});
	const definitionValue = (label: string) =>
		completeness.getByText(label, { exact: true }).locator('xpath=..');
	await expect(
		completeness.getByText(
			'Eligibility follows employment dates for this month, across Payroll and Contract pay streams.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(definitionValue('Eligible employees')).toContainText('1.00');
	await expect(definitionValue('Payroll Slips')).toContainText('1.00');
	await expect(
		completeness.getByText(
			'Every eligible employee has a covering Salary Profile and Payroll Slip. The run is ready for final review.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: employee.fullName, exact: true })
	).toBeVisible();
	const finalizeButton = page.getByRole('button', {
		name: 'Finalize Payroll Run',
		exact: true,
	});
	await expect(finalizeButton).toBeEnabled();

	let dialogMessage = '';
	page.once('dialog', async (dialog: Dialog) => {
		dialogMessage = dialog.message();
		await dialog.accept();
	});
	const finalized = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/runs/finalize' &&
			response.request().method() === 'POST'
	);
	await finalizeButton.click();
	expect((await finalized).status()).toBe(200);

	expect(dialogMessage).toContain(`Finalize the Payroll Run for ${month}?`);
	expect(dialogMessage).toContain('Eligible employees: 1.00');
	expect(dialogMessage).toContain('Payroll Slips: 1.00');
	expect(dialogMessage).toContain(`Net Pay: ${currencyLabel(45_000)}`);
	await expect(
		page.getByRole('status').filter({
			hasText: `Payroll Run for ${month} finalized — 1 employees locked`,
		})
	).toBeVisible();
	await expect(header.getByText('Finalized', { exact: true })).toBeVisible();
	await expect(finalizeButton).toBeDisabled();
	await expect(
		completeness.getByText(
			'Employee coverage saved at finalization. Later employee changes do not change this roster.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(definitionValue('Eligible employees')).toContainText('1.00');
	await expect(definitionValue('Payroll Slips')).toContainText('1.00');

	const stored = await readPayrollRunState(db, seeded);
	expect(stored.run).toMatchObject({
		id: run.id,
		status: 'finalized',
		totalEmployees: 1,
		totalGross: 50_000,
		totalDeductions: 5_000,
		totalNetPay: 45_000,
		totalEmployerContribution: 0,
		finalizedBy: operator.userId,
	});
	expect(stored.run?.finalizedAt).not.toBeNull();
	expect(stored.slips).toEqual([
		{
			id: seeded.slip.id,
			employeeId: employee.employeeId,
			month: run.month,
			paymentStatus: 'pending',
			paymentDate: null,
			paymentReference: null,
			totalEarnings: 50_000,
			totalDeductions: 5_000,
			netPay: 45_000,
			employerCost: 50_000,
		},
	]);
	expect(stored.rosters).toEqual([
		{
			runId: run.id,
			month: run.month,
			version: 1,
			frozenBy: operator.userId,
			members: [
				{
					employee_id: employee.employeeId,
					employee_code: employee.employeeCode,
					name: employee.fullName,
					employment_start: run.month,
					employment_end: null,
					profile_date: run.month,
					profile_source: 'employee_salary_profile',
					profile_id: employee.salaryProfileId,
					salary_type: 'monthly',
				},
			],
		},
	]);
	expect(stored.uses).toEqual([
		{
			employeeId: employee.employeeId,
			month: run.month,
			agreementId: employee.salaryProfileId,
			agreementSource: 'employee_salary_profile',
			evidence: 'payroll_finalization',
		},
	]);
	expect(stored.allocations).toEqual([
		{
			payrollSlipId: seeded.slip.id,
			version: 1,
			recordedEmployerCost: 50_000,
			payStream: 'payroll',
		},
	]);
	expect(stored.audits).toContainEqual({
		entityType: 'payroll_run',
		entityId: run.id,
		action: 'finalize',
		employeeId: null,
		payrollRunId: run.id,
	});
});

// Actor: Payroll operator with payroll:read from the admin reference role and payroll:update directly on the user, never a super-admin.
// Starting state: An independent Payroll Run month already finalized, with one pending Payroll Slip and no payment date.
// Action: Choose an explicit payment date on the Payroll Run dashboard and choose Mark month paid, accepting the confirmation that names the batch.
// Proof: The derived header reads Paid, the slip's expanded details show that payment date and Paid, and the independent database read has the same date on the slip while the run stays finalized.
test('marking a finalized month paid records the chosen payment date', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedPayrollRunFixture(db, namespace, {
		status: 'finalized',
	});
	const seeded = fixture;
	if (!seeded.operator)
		throw new Error('The run fixture must own an operator.');
	const operator = seeded.operator;
	const employee = seeded.employee;
	const run = seeded.run;
	const paymentDate = run.monthEnd;
	const month = monthLabel(run.month);
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	const before = await readPayrollRunState(db, seeded);
	expect(before.run?.status).toBe('finalized');
	expect(before.slips[0]?.paymentStatus).toBe('pending');
	expect(before.slips[0]?.paymentDate).toBeNull();

	await signInThroughUi(page, operator);
	await page.goto('/admin/payroll');
	await expect(
		page.getByRole('heading', { name: /^Payroll Run/ })
	).toBeVisible();

	// The heading paints before the dashboard's first slips read settles, so the
	// month picker is only safe to drive once that read has replaced its loading
	// line with its own loaded status line.
	const slipsStatus = page
		.getByRole('status')
		.filter({ hasText: /Showing \d+ payroll employees? for / });
	await expect(slipsStatus).toBeVisible();

	await page.getByLabel('Month:', { exact: true }).fill(run.monthSlug);
	await expect(slipsStatus).toHaveText(
		`Showing 1 payroll employee for ${month}`
	);

	const header = page.getByRole('heading', { name: /^Payroll Run/ });
	await expect(header.getByText('Finalized', { exact: true })).toBeVisible();
	const row = page.getByRole('row').filter({
		has: page.getByRole('link', { name: employee.fullName, exact: true }),
	});
	await expect(row).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Mark month paid', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Reopen', exact: true })
	).toHaveCount(0);
	await page.getByLabel('Payment date:', { exact: true }).fill(paymentDate);

	let dialogMessage = '';
	page.once('dialog', async (dialog: Dialog) => {
		dialogMessage = dialog.message();
		await dialog.accept();
	});
	const marked = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/runs/mark-paid' &&
			response.request().method() === 'POST'
	);
	await page
		.getByRole('button', { name: 'Mark month paid', exact: true })
		.click();
	expect((await marked).status()).toBe(200);

	expect(dialogMessage).toContain(
		`Mark all 1 Payroll Slips for ${month} paid on ${paymentDate}?`
	);
	await expect(
		page.getByRole('status').filter({
			hasText: `1 Payroll Slip for ${month} marked paid on ${paymentDate}.`,
		})
	).toBeVisible();
	await expect(header.getByText('Paid', { exact: true })).toBeVisible();

	await expect(row.getByText('paid', { exact: true })).toBeVisible();
	await row
		.getByRole('button', {
			name: `Expand attendance and deduction details for ${employee.fullName}`,
			exact: true,
		})
		.click();
	await expect(
		page.getByText(`Payment date: ${dateLabel(paymentDate)}`, {
			exact: true,
		})
	).toBeVisible();

	const stored = await readPayrollRunState(db, seeded);
	expect(stored.run?.status).toBe('finalized');
	expect(stored.run?.totalEmployees).toBe(1);
	expect(stored.run?.totalNetPay).toBe(45_000);
	expect(stored.slips).toEqual([
		{
			id: seeded.slip.id,
			employeeId: employee.employeeId,
			month: run.month,
			paymentStatus: 'paid',
			paymentDate,
			paymentReference: null,
			totalEarnings: 50_000,
			totalDeductions: 5_000,
			netPay: 45_000,
			employerCost: 50_000,
		},
	]);
	expect(stored.audits).toContainEqual({
		entityType: 'payroll_slip',
		entityId: seeded.slip.id,
		action: 'update',
		employeeId: employee.employeeId,
		payrollRunId: null,
	});
});
