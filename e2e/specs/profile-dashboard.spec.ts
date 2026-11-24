import type { RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createEmployeeDashboardFixture,
	createProfileSelfServiceFixture,
} from '../fixtures/profile-dashboard.ts';

// The owned Next dev server compiles routes on first visit. Every assertion
// still waits for its observable result; this only bounds compilation time.
test.setTimeout(300_000);

// Actor: a signed-in employee whose custom role grants exactly users:update.
// Starting state: an active user with a stored @e2e.invalid email and no direct grants.
// Action: open /profile, replace Email, press Save, then reload the page.
// Proof: "Profile updated"; the reopened Email field and an independent users row both show the new address.
test('saves a new email on My Profile and keeps it after reopening', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await createProfileSelfServiceFixture(
		db,
		`${namespace}-profile`
	);
	try {
		expect(fixture.storedPermissions).toEqual({
			role: ['users:update'],
			user: [],
		});

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: fixture.journey.username,
			password: fixture.journey.password,
		});

		await page.goto('/profile');
		await expect(
			page.getByRole('heading', { name: 'My Profile', exact: true })
		).toBeVisible();

		// The page's labels are not programmatically associated with their
		// inputs, so the field is located from the label a person reads.
		const emailField = page
			.locator('form label')
			.filter({ hasText: 'Email' })
			.locator('xpath=../input');
		await expect(emailField).toHaveValue(fixture.currentEmail);

		const saveResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'PUT' &&
				new URL(response.url()).pathname === '/api/users'
		);
		await emailField.fill(fixture.savedEmail);
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		expect((await saveResponse).ok()).toBe(true);
		await expect(
			page.getByText('Profile updated', { exact: true })
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'My Profile', exact: true })
		).toBeVisible();
		await expect(emailField).toHaveValue(fixture.savedEmail);

		const [rows] = await db.execute<RowDataPacket[]>(
			'SELECT email FROM users WHERE id = ? AND isDelete = 0',
			[fixture.journey.userId]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.email).toBe(fixture.savedEmail);
		expect(rows[0]?.email).not.toBe(fixture.currentEmail);
	} finally {
		await fixture.dispose();
	}
});

// Actor: a signed-in employee with no permission grants, linked to an owned Employee record.
// Starting state: one app-entry day at DB midnight, 6 of 20 leave days used,
// and three 'P' attendance days with 2.5 authored Payable OT hours.
// Action: sign in, read the Today's Attendance card, then press Timesheet.
// Proof: Present 3/<days in month>, Payable OT 2.5h, Leaves 6.0/20.0 with 14 remaining,
// and Log In 12:00 AM. The linked Timesheet keeps 24 status-based hours.
test('shows recorded attendance separately from app entry and opens their Timesheet', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await createEmployeeDashboardFixture(
		db,
		`${namespace}-dashboard`
	);
	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: fixture.journey.username,
			password: fixture.journey.password,
		});

		const [activityRows] = await db.execute<RowDataPacket[]>(
			`SELECT COUNT(DISTINCT DATE(created_at)) AS days
       FROM user_activity_logs
      WHERE user_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
			[fixture.journey.userId, fixture.monthKey]
		);
		expect(Number(activityRows[0]?.days)).toBe(fixture.appEntryDays);

		const attendanceCard = page.getByTestId('attendance-card');
		await expect(attendanceCard).toBeVisible();
		await expect(page.getByTestId('present-figure')).toHaveText(
			new RegExp(`^${fixture.presentDays}\\s*/\\s*${fixture.daysInMonth}$`)
		);
		await expect(page.getByTestId('present-denominator')).toHaveText(
			`/ ${fixture.daysInMonth}`
		);
		await expect(page.getByTestId('overtime-figure')).toHaveText(
			`${fixture.payableOvertimeHours}h`
		);
		await expect(page.getByTestId('leave-figure')).toContainText(
			fixture.leaveUsed
		);
		await expect(page.getByTestId('leave-denominator')).toHaveText(
			`/ ${fixture.leaveTotal}`
		);
		await expect(page.getByTestId('leave-balance')).toContainText(
			`${fixture.leaveBalance} remaining`
		);
		await expect(page.getByTestId('login-figure')).toHaveText('12:00 AM');

		await attendanceCard.getByRole('link', { name: 'Timesheet' }).click();
		await page.waitForURL((url) => url.pathname === '/user/timesheet');
		await expect(
			page.getByRole('heading', { name: 'My Timesheet', exact: true })
		).toBeVisible();
		await expect(page.getByTestId('active-month')).toHaveText(
			fixture.monthLabel
		);

		// The grid renders Employee Code in the header block above the <table>;
		// the table itself only carries the employee's name and month in its
		// caption. Both are evidence that this is the linked employee's sheet.
		await expect(
			page.getByText(fixture.employeeCode, { exact: true })
		).toBeVisible();
		const timesheet = page.getByRole('table', {
			name: /Monthly time sheet for/,
		});
		await expect(timesheet).toBeVisible();
		const caption = timesheet.getByRole('caption');
		await expect(caption).toContainText(fixture.employeeName);
		await expect(caption).toContainText(fixture.monthLabel);
		await expect(timesheet).toContainText('24:00:00');
	} finally {
		await fixture.dispose();
	}
});
