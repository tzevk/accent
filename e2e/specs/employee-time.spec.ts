import type {
	APIRequestContext,
	APIResponse,
	Page,
	Response,
} from '@playwright/test';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	AUTHORED_OVERNIGHT_PERIOD,
	readEmployeeTimeState,
	readWorkPeriods,
	readWorkPeriodAssignmentIdentity,
	seedEmployeeSelfTimesheetFixture,
	seedEmployeeWorkPeriodFixture,
	type FixtureProject,
	type TimeLogin,
} from '../fixtures/employee-time.ts';

let fixture: { dispose(): Promise<void> } | null = null;

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
	const seeded = await seedEmployeeSelfTimesheetFixture(db, namespace);
	fixture = seeded;
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

async function signInThroughRequest(
	client: APIRequestContext,
	login: TimeLogin
): Promise<void> {
	const response = await client.post('/api/login', {
		data: { username: login.username, password: login.password },
	});
	expect(response.status()).toBe(200);
	expect((await response.json()).success).toBe(true);
}
async function expectMutation(
	response: APIResponse | Response
): Promise<string> {
	expect(response.ok()).toBe(true);
	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	expect(body.affected_rows).toBe(1);
	const id: unknown = body.data.id;
	expect(typeof id).toBe('string');
	if (typeof id !== 'string') {
		throw new Error('[employee-time] mutation returned no id');
	}
	return id;
}

function projectRow(page: Page, project: FixtureProject, activityName: string) {
	return page
		.getByRole('table')
		.getByRole('row')
		.filter({ hasText: project.code })
		.filter({ hasText: activityName })
		.first();
}

async function expectMonthlyTotal(page: Page, elapsed: string): Promise<void> {
	const total = page
		.getByRole('row')
		.filter({ hasText: 'Total Monthly Hours' });
	await expect(total.getByRole('cell').last()).toHaveText(elapsed);
}

// Actor: an Employee and the Project Lead acting through real authenticated
// requests and the Employee dashboard form.
// Starting state: one fixed older Work Period spanning Sunday/Monday, a
// month boundary and a week boundary, plus one duration-only legacy row.
// Action: the manager records 2024-06-30 23:30 to 2024-07-01 01:30 IST; the
// Employee separately saves a finished period through My Project Activities.
// Proof: the overnight period keeps one identity, contributes 00:30 to June
// and 01:30 to July, credits quantity 3 once in July, and joins the unchanged
// 01:15 legacy row for an exact July total of 02:45 in My Timesheet.
test('work period reaches My Timesheet across IST midnight', async ({
	page,
	request,
	db,
	namespace,
}) => {
	const seeded = await seedEmployeeWorkPeriodFixture(db, namespace);
	fixture = seeded;
	await signInThroughRequest(request, seeded.manager);
	const overnightId = await expectMutation(
		await request.post('/api/work-periods', {
			data: {
				manager: true,
				projectId: seeded.primary.project.id,
				assignmentId: seeded.primary.assignmentId,
				...AUTHORED_OVERNIGHT_PERIOD,
			},
		})
	);

	await signInThroughUi(page, seeded.login);
	await expect(
		page.getByRole('heading', { name: 'My Project Activities', exact: true })
	).toBeVisible();
	const activityTable = page.getByRole('table', {
		name: 'Project activity table',
	});
	await expect(activityTable).toBeVisible();
	const reminder = page.getByRole('dialog', {
		name: 'Activity Update Required',
	});
	await expect(reminder).toBeVisible();
	await reminder
		.getByRole('button', { name: 'Update Now', exact: true })
		.click();
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	const editor = page.getByRole('form', { name: 'Work Period editor' });
	await expect(editor).toBeVisible();
	await expect(
		activityTable.getByLabel('Project', { exact: true })
	).toBeVisible();

	const project = page.getByLabel('Project', { exact: true });
	await project.selectOption({
		label: `${seeded.primary.project.code} – ${seeded.primary.project.name}`,
	});
	const discipline = page.getByLabel('Discipline', { exact: true });
	await expect(discipline).toContainText(seeded.discipline.name);
	await discipline.selectOption(seeded.discipline.id);
	const activity = page.getByLabel('Activity', { exact: true });
	await expect(activity).toContainText(seeded.primary.name);
	await activity.selectOption(seeded.primary.id);
	const subActivity = page.getByLabel('Sub Activity', { exact: true });
	await expect(subActivity).toHaveText('No sub-activity');
	await expect(subActivity).toBeDisabled();
	await expect(subActivity).toHaveValue('');
	const startTime = seeded.self.start.slice(11);
	const endTime = seeded.self.end.slice(11);
	await page
		.getByLabel('Date Completed', { exact: true })
		.fill(seeded.self.dateCompleted);
	await page.getByLabel('Start Period', { exact: true }).fill(startTime);
	await page.getByLabel('End Period', { exact: true }).fill(endTime);
	await page.getByLabel('Quantity', { exact: true }).fill('2.5');
	await page
		.getByRole('textbox', { name: 'Remarks', exact: true })
		.fill(seeded.self.remarks);

	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' &&
			new URL(response.url()).pathname === '/api/work-periods'
	);
	await page
		.getByRole('button', { name: 'Save Work Period', exact: true })
		.click();
	const selfId = await expectMutation(await saved);
	const identity = await readWorkPeriodAssignmentIdentity(
		db,
		seeded.primary.assignmentId
	);
	expect(identity.projectActivityId).not.toBe(seeded.primary.id);
	expect(identity).toMatchObject({
		disciplineId: seeded.discipline.id,
		catalogActivityId: seeded.primary.id,
		catalogSubActivityId: null,
	});

	// Reopen the Employee's weekly view. Yesterday can belong to the previous
	// week on Monday; the fixture names that week explicitly in IST.
	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'My Project Activities', exact: true })
	).toBeVisible();
	const currentWeekResponse = await page
		.context()
		.request.get('/api/work-periods');
	expect(currentWeekResponse.status()).toBe(200);
	const currentWeek = await currentWeekResponse.json();
	expect(currentWeek.success).toBe(true);
	if (currentWeek.data.weekStart !== seeded.self.weekStart) {
		await page
			.getByRole('button', { name: 'Previous week', exact: true })
			.click();
	}
	const reopened = activityTable
		.getByRole('row')
		.filter({ hasText: seeded.self.remarks });
	await expect(reopened).toHaveCount(1);
	await expect(reopened).toContainText(seeded.primary.project.code);
	await expect(reopened).toContainText(seeded.primary.name);

	for (const [weekStart, weekSeconds, weekQuantity] of [
		['2024-06-24', 1_800, 0],
		['2024-07-01', 5_400, 3],
	] as const) {
		const response = await page
			.context()
			.request.get(`/api/work-periods?week=${weekStart}`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		const period = body.data.periods.find(
			(row: { id: string }) => row.id === overnightId
		);
		expect(period).toMatchObject({
			id: overnightId,
			assignmentId: seeded.primary.assignmentId,
			projectId: seeded.primary.project.id,
			start: AUTHORED_OVERNIGHT_PERIOD.start,
			end: AUTHORED_OVERNIGHT_PERIOD.end,
			quantity: 3,
			dateCompleted: '2024-07-01',
			durationSeconds: 7_200,
			weekSeconds,
			weekQuantity,
		});
	}

	// This is the CI-owned dashboard -> My Timesheet seam, not a direct API
	// assertion. Month deep links then make the authored oracle independent of
	// the machine's local timezone and the current calendar month.
	await page
		.getByTestId('attendance-card')
		.getByRole('link', { name: 'Timesheet', exact: true })
		.click();
	await expect(
		page.getByRole('heading', { name: 'My Timesheet', exact: true })
	).toBeVisible();

	await page.goto(`/user/timesheet?month=${seeded.self.month}`);
	const selfCells = projectRow(
		page,
		seeded.primary.project,
		seeded.primary.name
	).getByRole('cell');
	await expect(selfCells.nth(3 + seeded.self.day - 1)).toHaveText(
		seeded.self.clock
	);
	await expect(selfCells.last()).toHaveText(seeded.self.totalClock);
	await expectMonthlyTotal(page, seeded.self.totalClock);

	await page.goto('/user/timesheet?month=2024-06');
	const juneCells = projectRow(
		page,
		seeded.primary.project,
		seeded.primary.name
	).getByRole('cell');
	await expect(juneCells.nth(3 + 30 - 1)).toHaveText('00:30');
	await expect(juneCells.last()).toHaveText('0:30:00');
	await expectMonthlyTotal(page, '0:30:00');

	await page.goto('/user/timesheet?month=2024-07');
	const julyCells = projectRow(
		page,
		seeded.primary.project,
		seeded.primary.name
	).getByRole('cell');
	await expect(julyCells.nth(3)).toHaveText('01:30');
	await expect(julyCells.last()).toHaveText('1:30:00');
	const legacyCells = projectRow(
		page,
		seeded.secondary.project,
		seeded.secondary.name
	).getByRole('cell');
	await expect(legacyCells.nth(3)).toHaveText('01:15');
	await expect(legacyCells.last()).toHaveText('1:15:00');
	await expectMonthlyTotal(page, '2:45:00');

	const periods = await readWorkPeriods(db, { employeeId: seeded.employee.id });
	expect(periods).toHaveLength(2);
	expect(periods.find((period) => period.id === overnightId)).toMatchObject({
		assignmentId: seeded.primary.assignmentId,
		employeeId: seeded.employee.id,
		startMs: Date.parse(`${AUTHORED_OVERNIGHT_PERIOD.start}:00+05:30`),
		endMs: Date.parse(`${AUTHORED_OVERNIGHT_PERIOD.end}:00+05:30`),
		quantity: 3,
		dateCompleted: '2024-07-01',
		remarks: AUTHORED_OVERNIGHT_PERIOD.remarks,
	});
	expect(periods.find((period) => period.id === selfId)).toMatchObject({
		assignmentId: seeded.primary.assignmentId,
		startMs: Date.parse(`${seeded.self.start}:00+05:30`),
		endMs: Date.parse(`${seeded.self.end}:00+05:30`),
		quantity: 2.5,
		dateCompleted: seeded.self.dateCompleted,
		remarks: seeded.self.remarks,
	});
	const legacyState = await readEmployeeTimeState(db, {
		userId: seeded.login.userId,
		projectId: seeded.secondary.project.id,
		assignmentId: seeded.secondary.assignmentId,
	});
	expect(legacyState.assignment?.dailyEntries).toEqual([
		{ date: '2024-07-01', hours: 1.25 },
	]);
	expect(legacyState.assignment?.totalHours).toBe(1.25);
});
