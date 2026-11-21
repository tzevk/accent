import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readEmployeeTimeState,
	seedEmployeeSelfTimesheetFixture,
	type EmployeeSelfTimesheetFixture,
} from '../fixtures/employee-time.ts';

let fixture: EmployeeSelfTimesheetFixture | null = null;

// The owned Next dev server compiles routes on first visit; assertions are not
// weakened, only the surrounding wall-clock budget accommodates that compile.
test.setTimeout(180_000);

test.afterEach(async () => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await owned.dispose();
});

// Actor: an ordinary Employee account linked through users.employee_id, with
// no report permissions.
// Starting state: Their own current-month and previous-month logged hours,
// plus another Employee's logged hours in the same previous month.
// Action: Open My Timesheet and select the previous offered month.
// Proof: The previous month's grid shows only this Employee's project and
// authored hours, not the other Employee's.
test('linked employee selects a different month and sees only their logged hours', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedEmployeeSelfTimesheetFixture(db, namespace);
	const seeded = fixture;
	await signInThroughUi(page, seeded.login);
	await page.goto('/user/timesheet');

	await expect(
		page.getByRole('heading', { name: 'My Timesheet', exact: true })
	).toBeVisible();
	const activeMonth = page.getByTestId('active-month');
	await expect(activeMonth).toHaveText(seeded.current.label);

	const table = page.getByRole('table');
	await expect(table.getByRole('caption')).toContainText(seeded.employee.name);
	const ownRow = table
		.getByRole('row')
		.filter({ hasText: seeded.project.code })
		.filter({ hasText: seeded.project.activityName })
		.first();
	await expect(ownRow).toBeVisible();
	const currentCells = ownRow.getByRole('cell');
	for (const entry of seeded.current.entries) {
		await expect(currentCells.nth(3 + entry.day - 1)).toHaveText(entry.clock);
	}
	await expect(currentCells.last()).toHaveText(seeded.current.totalClock);

	const previousLoaded = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			new URL(response.url()).pathname === '/api/me/timesheet' &&
			response.ok()
	);
	await page
		.getByRole('button', { name: 'Show the previous offered month' })
		.click();
	await previousLoaded;
	await expect(activeMonth).toHaveText(seeded.target.label);
	await expect(table.getByRole('caption')).toContainText(seeded.target.label);
	await expect(
		page.getByText(seeded.employee.code, { exact: true })
	).toBeVisible();
	await expect(
		page.getByText(seeded.project.code, { exact: true }).first()
	).toBeVisible();

	await expect(ownRow).toBeVisible();
	const cells = ownRow.getByRole('cell');
	for (const entry of seeded.target.entries) {
		await expect(cells.nth(3 + entry.day - 1)).toHaveText(entry.clock);
	}
	await expect(cells.last()).toHaveText(seeded.target.totalClock);
	await expect(
		page.getByText(seeded.other.project.code, { exact: true })
	).toHaveCount(0);
	await expect(
		page.getByText(seeded.other.project.activityName, { exact: true })
	).toHaveCount(0);

	const persisted = await readEmployeeTimeState(db, {
		userId: seeded.login.userId,
		projectId: seeded.project.id,
		assignmentId: seeded.assignmentId,
	});
	expect(persisted.linkedEmployeeId).toBe(seeded.employee.id);
	expect(persisted.membershipUserIds).toContain(seeded.login.userId);
	expect(persisted.assignment?.employeeId).toBe(seeded.employee.id);
	expect(persisted.assignment?.dailyEntries).toEqual(
		[...seeded.target.entries, ...seeded.current.entries].map(
			({ date, hours }) => ({ date, hours })
		)
	);
	expect(persisted.assignment?.totalHours).toBe(8);

	const otherPersisted = await readEmployeeTimeState(db, {
		userId: seeded.other.employee.linkedUserId,
		projectId: seeded.other.project.id,
		assignmentId: seeded.other.assignmentId,
	});
	expect(otherPersisted.linkedEmployeeId).toBe(seeded.other.employee.id);
	expect(otherPersisted.assignment?.totalHours).toBe(
		seeded.other.log.totalHours
	);
});
