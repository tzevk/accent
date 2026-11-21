import type { Page } from '@playwright/test';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readEmployeeTimeState,
	seedTimesheetReportFixture,
	type TimesheetReportFixture,
} from '../fixtures/employee-time.ts';

let fixture: TimesheetReportFixture | null = null;

// The owned Next dev server compiles routes on first visit; assertions are not
// weakened, only the surrounding wall-clock budget accommodates that compile.
test.setTimeout(180_000);

test.afterEach(async () => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await owned.dispose();
});

async function selectMonth(page: Page, label: string) {
	const monthSelect = page.getByRole('button', { name: 'Month', exact: true });
	await monthSelect.click();
	await page.getByPlaceholder('Search...').fill(label);
	await page.getByRole('button', { name: label, exact: true }).click();
	await expect(monthSelect).toContainText(label);
}

// Actor: a reporting user with reports:read and no admin or project grants.
// Starting state: A linked Employee with authored logged hours in one target
// month and scoped Project membership.
// Action: Open Timesheet Report, select that Employee, then select the seeded
// month.
// Proof: The grid shows the Employee's code/name, authored project hours and
// total, and the saved rows still exist.
test('reporting user selects the employee and month and sees the matching seeded grid', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedTimesheetReportFixture(db, namespace);
	const seeded = fixture;
	await signInThroughUi(page, seeded.login);
	await page.goto('/reports/timesheet-report');

	await expect(
		page.getByRole('heading', { name: 'Monthly Time Sheet', exact: true })
	).toBeVisible();
	await expect(page.getByText('Access Denied', { exact: true })).toHaveCount(0);

	const employeeSelect = page.getByRole('button', {
		name: 'Employee',
		exact: true,
	});
	await employeeSelect.click();
	await page.getByPlaceholder('Search...').fill(seeded.employee.code);
	const employeeOption = `${seeded.employee.name} (${seeded.employee.code})`;
	await page.getByRole('button', { name: employeeOption, exact: true }).click();
	await expect(employeeSelect).toContainText(seeded.employee.code);

	await selectMonth(page, seeded.currentMonthLabel);
	const gridRegion = page.getByRole('region', {
		name: 'Monthly timesheet grid',
	});
	await expect(gridRegion).toBeVisible();
	await expect(
		gridRegion.getByText(seeded.project.code, { exact: true })
	).toHaveCount(0);

	await selectMonth(page, seeded.target.label);
	await expect(gridRegion).toBeVisible();
	await expect(
		page.getByText(seeded.employee.code, { exact: true })
	).toBeVisible();
	const table = gridRegion.getByRole('table');
	await expect(table.getByRole('caption')).toContainText(seeded.employee.name);
	await expect(table.getByRole('caption')).toContainText(seeded.target.label);

	const row = table
		.getByRole('row')
		.filter({ hasText: seeded.project.code })
		.filter({ hasText: seeded.project.activityName })
		.first();
	await expect(row).toBeVisible();

	const cells = row.getByRole('cell');
	for (const entry of seeded.target.entries) {
		await expect(cells.nth(3 + entry.day - 1)).toHaveText(entry.clock);
	}
	await expect(cells.last()).toHaveText(seeded.target.totalClock);

	const persisted = await readEmployeeTimeState(db, {
		userId: seeded.employee.linkedUserId,
		projectId: seeded.project.id,
		assignmentId: seeded.assignmentId,
	});
	expect(persisted.linkedEmployeeId).toBe(seeded.employee.id);
	expect(persisted.membershipUserIds).toContain(seeded.employee.linkedUserId);
	expect(persisted.assignment?.dailyEntries).toEqual(
		seeded.target.entries.map(({ date, hours }) => ({ date, hours }))
	);
	expect(persisted.assignment?.totalHours).toBe(seeded.target.totalHours);
});
