import ExcelJS from 'exceljs';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import {
	cleanupUtilizationFixture,
	seedUtilizationFixture,
	type UtilizationFixture,
} from '../fixtures/report-data.ts';

// The owned Next dev server compiles report routes on first visit. The
// assertions keep their own timeouts; this only bounds compilation time.
test.setTimeout(180_000);

const UTILIZATION_PERMISSIONS = ['reports:read'] as const;

let identity: JourneyUser | null = null;
let fixture: UtilizationFixture | null = null;

test.afterEach(async ({ db }) => {
	const ownedFixture = fixture;
	const ownedIdentity = identity;
	fixture = null;
	identity = null;
	try {
		if (ownedFixture !== null) {
			await cleanupUtilizationFixture(db, ownedFixture);
		}
	} finally {
		if (ownedIdentity !== null) await ownedIdentity.dispose();
	}
});

async function selectUtilizationMonth(
	page: Page,
	label: string
): Promise<void> {
	await page.getByRole('button', { name: 'Month', exact: true }).click();
	await page.getByRole('button', { name: label, exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Month', exact: true })
	).toContainText(label);
}

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `reports:read`.
 *
 * Starting state: one live Payroll employee with a Salary Profile and
 * Logged Hours in May 2033 (200h over two projects plus no-project) and June
 * 2033 (96h). May is 104.17% and June is 50.00% of the same 192h capacity.
 *
 * Action: open Employee Utilization, select June, then switch to May, and
 * expand the employee's project breakdown.
 *
 * Proof: June shows 96.00 logged / 50.00% / ₹25,846.15 bench; May shows 200.00
 * logged / 104.17% / ₹1,846.15 bench; the expansion shows Alpha 144h (120h
 * Technical Design + 24h Site Review), Beta 32h, No project 24h, footing to
 * the row's 200h.
 */
test('employee utilization switches month with known cost and hours and expands the correct project breakdown', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(
		db,
		`${namespace}-util`,
		UTILIZATION_PERMISSIONS
	);
	identity = user;
	const data = await seedUtilizationFixture(
		db,
		`${namespace}-util`,
		user.userId
	);
	fixture = data;

	await signInThroughUi(page, {
		username: user.username,
		password: user.password,
	});
	page.setDefaultNavigationTimeout(60_000);

	await page.goto('/reports/employee-utilization');
	await expect(
		page.getByRole('heading', { name: 'Employee Utilization', exact: true })
	).toBeVisible({ timeout: 60_000 });

	const row = page
		.getByTestId('utilization-row')
		.filter({ hasText: data.employee.code });

	await selectUtilizationMonth(page, data.months.june.label);
	await expect(row).toBeVisible({ timeout: 60_000 });
	await expect(page.getByTestId('utilization-summary')).toContainText(
		data.months.june.label
	);
	await expect(row.getByTestId('cell-capacity')).toHaveText('192.00');
	await expect(row.getByTestId('cell-logged')).toHaveText('96.00');
	await expect(row.getByTestId('cell-utilization')).toHaveText('50.00%');
	await expect(row.getByTestId('cell-band')).toHaveText('Under');
	await expect(row.getByTestId('cell-monthly-cost')).toHaveText('₹48,000.00');
	await expect(row.getByTestId('cell-bench-cost')).toHaveText('₹25,846.15');

	await selectUtilizationMonth(page, data.months.may.label);
	await expect(row.getByTestId('cell-logged')).toHaveText('200.00', {
		timeout: 60_000,
	});
	await expect(page.getByTestId('utilization-summary')).toContainText(
		data.months.may.label
	);
	await expect(row.getByTestId('cell-capacity')).toHaveText('192.00');
	await expect(row.getByTestId('cell-utilization')).toHaveText('104.17%');
	await expect(row.getByTestId('cell-band')).toHaveText('Over');
	await expect(row.getByTestId('cell-monthly-cost')).toHaveText('₹48,000.00');
	await expect(row.getByTestId('cell-bench-cost')).toHaveText('₹1,846.15');

	await row.getByTestId('row-expand').click();
	await expect(row.getByTestId('row-expand')).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	const panel = page.getByTestId('project-breakdown');
	await expect(panel).toBeVisible();
	await expect(panel).toHaveAttribute('data-logged-hours', '200');

	const alphaRow = panel.locator(
		`[data-testid="project-row"][data-project="${data.projects.alpha.projectId}"]`
	);
	await expect(alphaRow).toHaveAttribute(
		'data-hours',
		String(data.projects.alpha.hours)
	);
	await expect(alphaRow.getByTestId('breakdown-row-name')).toHaveText(
		data.projects.alpha.name
	);
	await expect(alphaRow.getByTestId('breakdown-row-code')).toHaveText(
		data.projects.alpha.code
	);
	await expect(alphaRow.getByTestId('breakdown-row-client')).toHaveText(
		data.projects.alpha.clientName
	);
	await expect(alphaRow.getByTestId('breakdown-row-hours')).toHaveText(
		'144.00'
	);

	for (const activity of data.projects.alpha.activities) {
		const activityRow = panel.locator(
			`[data-testid="activity-row"][data-activity="${activity.name}"][data-discipline="${activity.discipline ?? ''}"]`
		);
		await expect(activityRow).toHaveAttribute(
			'data-hours',
			String(activity.hours)
		);
		await expect(activityRow.getByTestId('activity-hours')).toHaveText(
			`${activity.hours.toFixed(2)}`
		);
	}

	const betaRow = panel.locator(
		`[data-testid="project-row"][data-project="${data.projects.beta.projectId}"]`
	);
	await expect(betaRow).toHaveAttribute('data-hours', '32');
	await expect(betaRow.getByTestId('breakdown-row-name')).toHaveText(
		data.projects.beta.name
	);
	await expect(betaRow.getByTestId('breakdown-row-hours')).toHaveText('32.00');

	const noProjectRow = panel.getByTestId('no-project-row');
	await expect(noProjectRow).toHaveAttribute('data-hours', '24');
	await expect(noProjectRow.getByTestId('breakdown-row-name')).toHaveText(
		'No project'
	);
	await expect(noProjectRow.getByTestId('breakdown-row-code')).toHaveText('—');
	await expect(noProjectRow.getByTestId('breakdown-row-client')).toHaveText(
		'—'
	);
	await expect(noProjectRow.getByTestId('breakdown-row-hours')).toHaveText(
		'24.00'
	);
	const noProjectActivity = panel.locator(
		'[data-testid="activity-row"][data-activity="Team Sync"][data-discipline=""]'
	);
	await expect(noProjectActivity).toHaveAttribute('data-hours', '24');
	await expect(noProjectActivity.getByTestId('activity-hours')).toHaveText(
		'24.00'
	);
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `reports:read`.
 *
 * Starting state: the same owned employee and salary rows, with June 2033
 * holding 96 Logged Hours and May's 200h sitting in the trailing window.
 *
 * Action: open Employee Utilization, select June 2033 and click `Export
 * Excel`.
 *
 * Proof: the downloaded `Utilization_2033-06.xlsx` has the Utilization sheet,
 * the exact month title and column headers, an employee row with capacity
 * 192 / logged 96 / 50.00% / Under and the fixed ₹48,000, ₹22,153.85 and
 * ₹25,846.15 costs, plus the employee's department summary row.
 */
test('employee utilization Excel export carries the selected month fixture values', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(
		db,
		`${namespace}-util-export`,
		UTILIZATION_PERMISSIONS
	);
	identity = user;
	const data = await seedUtilizationFixture(
		db,
		`${namespace}-util-export`,
		user.userId
	);
	fixture = data;

	await signInThroughUi(page, {
		username: user.username,
		password: user.password,
	});
	page.setDefaultNavigationTimeout(60_000);

	await page.goto('/reports/employee-utilization');
	await expect(
		page.getByRole('heading', { name: 'Employee Utilization', exact: true })
	).toBeVisible({ timeout: 60_000 });
	await selectUtilizationMonth(page, data.months.june.label);
	const row = page
		.getByTestId('utilization-row')
		.filter({ hasText: data.employee.code });
	await expect(row).toBeVisible({ timeout: 60_000 });

	const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
	await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(
		`Utilization_${data.months.june.slug}.xlsx`
	);
	const filePath = await download.path();
	if (!filePath)
		throw new Error('Playwright did not retain the downloaded workbook.');
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.readFile(filePath);
	const sheet = workbook.getWorksheet('Utilization');
	if (!sheet)
		throw new Error('The downloaded workbook has no Utilization sheet.');

	expect(sheet.getCell('A1').value).toBe(
		`Employee Utilization — ${data.months.june.label}`
	);
	const headers = Array.from(
		{ length: 14 },
		(_, index) => sheet.getRow(3).getCell(index + 1).value
	);
	expect(headers).toEqual([
		'Sr.',
		'Employee',
		'Department',
		'Partial window',
		'Capacity (h)',
		'Logged (h)',
		'April 2033',
		'May 2033',
		'Utilization %',
		'Flag',
		'Monthly Cost (₹)',
		'Utilized Cost (₹)',
		'Bench Cost (₹)',
		'Note',
	]);

	const employeeLabel = `${data.employee.fullName} (${data.employee.code})`;
	let employeeRowNumber = 0;
	for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber++) {
		if (sheet.getRow(rowNumber).getCell(2).value === employeeLabel) {
			employeeRowNumber = rowNumber;
			break;
		}
	}
	expect(employeeRowNumber).toBeGreaterThan(0);
	const exported = sheet.getRow(employeeRowNumber);
	expect(exported.getCell(3).value).toBe(data.employee.department);
	expect(exported.getCell(4).value).toBeNull();
	expect(exported.getCell(5).value).toBe(192);
	expect(exported.getCell(6).value).toBe(96);
	expect(exported.getCell(7).value).toBeNull();
	expect(Number(exported.getCell(8).value)).toBeCloseTo(104.17, 2);
	expect(exported.getCell(9).value).toBe(50);
	expect(exported.getCell(10).value).toBe('Under');
	expect(exported.getCell(11).value).toBe(48000);
	expect(Number(exported.getCell(12).value)).toBeCloseTo(22153.85, 2);
	expect(Number(exported.getCell(13).value)).toBeCloseTo(25846.15, 2);
	expect(exported.getCell(14).value).toBeNull();

	let summaryRowNumber = 0;
	for (
		let rowNumber = employeeRowNumber + 1;
		rowNumber <= sheet.rowCount;
		rowNumber++
	) {
		if (sheet.getRow(rowNumber).getCell(1).value === 'Department summary') {
			summaryRowNumber = rowNumber;
			break;
		}
	}
	expect(summaryRowNumber).toBeGreaterThan(0);
	let departmentRowNumber = 0;
	for (
		let rowNumber = summaryRowNumber + 2;
		rowNumber <= sheet.rowCount;
		rowNumber++
	) {
		if (sheet.getRow(rowNumber).getCell(1).value === data.employee.department) {
			departmentRowNumber = rowNumber;
			break;
		}
	}
	expect(departmentRowNumber).toBeGreaterThan(0);
	const departmentRow = sheet.getRow(departmentRowNumber);
	expect(departmentRow.getCell(2).value).toBe(1);
	expect(departmentRow.getCell(3).value).toBe(50);
	expect(departmentRow.getCell(4).value).toBe(96);
	expect(departmentRow.getCell(5).value).toBe(192);
	expect(Number(departmentRow.getCell(6).value)).toBeCloseTo(25846.15, 2);
	expect(departmentRow.getCell(7).value).toBe(0);
});
