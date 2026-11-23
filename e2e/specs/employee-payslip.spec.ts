import { readFile } from 'node:fs/promises';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readPayrollRunState,
	seedEmployeePayslipFixture,
	type EmployeePayslipFixture,
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

let fixture: EmployeePayslipFixture | null = null;

test.afterEach(async () => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await owned.dispose();
});

// Actor: The current Employee, signed in with an ordinary account whose empty custom role grants no payroll permission.
// Starting state: One finalized Payroll Run month whose only Payroll Slip belongs to that Employee and is already paid on its month-end date.
// Action: Open My Payroll Slips, download the month's PDF, then reload the page.
// Proof: The row shows the month, ₹45,000.00, paid and the payment date before and after reload; the downloaded file is named for this Employee and month, is a real PDF containing that same identity and month, and the independent database read keeps the slip paid on that date.
test('an employee opens a paid Payslip and downloads the matching PDF', async ({
	page,
	db,
	namespace,
}, testInfo) => {
	fixture = await seedEmployeePayslipFixture(db, namespace);
	const seeded = fixture;
	const employee = seeded.employee;
	const run = seeded.run;
	const month = monthLabel(run.month);
	const paidOn = dateLabel(seeded.paymentDate);
	const expectedFilename = `Payroll_Slip_${employee.fullName.replace(
		/\s+/g,
		'_'
	)}_${run.monthSlug}.pdf`;
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	await signInThroughUi(page, seeded.employeeUser);
	await page.goto('/user/payslips');
	await expect(
		page.getByRole('heading', { name: 'My Payroll Slips', exact: true })
	).toBeVisible();

	const payslipRow = () =>
		page
			.getByRole('row')
			.filter({ hasText: month })
			.filter({ hasText: currencyLabel(45_000) });
	await expect(payslipRow()).toHaveCount(1);
	await expect(payslipRow()).toContainText(month);
	await expect(payslipRow()).toContainText(currencyLabel(45_000));
	await expect(payslipRow().getByText('paid', { exact: true })).toBeVisible();
	await expect(payslipRow()).toContainText(paidOn);

	const downloadPromise = page.waitForEvent('download');
	await payslipRow().getByRole('button', { name: 'PDF', exact: true }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(expectedFilename);
	const savedPath = testInfo.outputPath('employee-payslip.pdf');
	await download.saveAs(savedPath);
	const pdf = await readFile(savedPath);
	expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
	expect(pdf.length).toBeGreaterThan(1000);
	const pdfText = pdf.toString('latin1');
	expect(pdfText).toContain(employee.fullName);
	expect(pdfText).toContain(
		`PAYROLL SLIP FOR THE MONTH OF ${month.toUpperCase()}`
	);
	expect(pdfText).toContain('NET SALARY PAYABLE');
	expect(pdfText).toContain('45,000');

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'My Payroll Slips', exact: true })
	).toBeVisible();
	await expect(payslipRow()).toHaveCount(1);
	await expect(payslipRow().getByText('paid', { exact: true })).toBeVisible();
	await expect(payslipRow()).toContainText(paidOn);

	const stored = await readPayrollRunState(db, seeded);
	expect(stored.run?.status).toBe('finalized');
	expect(stored.slips).toEqual([
		{
			id: seeded.slip.id,
			employeeId: employee.employeeId,
			month: run.month,
			paymentStatus: 'paid',
			paymentDate: seeded.paymentDate,
			paymentReference: null,
			totalEarnings: 50_000,
			totalDeductions: 5_000,
			netPay: 45_000,
			employerCost: 50_000,
		},
	]);
});
