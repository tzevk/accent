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
// Starting state: 3 current-month app-entry days (today at midnight), 6 of 20 leave days used, and 3 'P' attendance days.
// Action: sign in, read the Today's Attendance card, then press Timesheet.
// Proof: Present 3/<days in month>, Leaves 6.0/20.0 with 14 remaining, Log In 12:00 AM; the linked employee's Timesheet shows the same seeded 3 days as 24:00:00.
test('shows the linked employee’s seeded attendance and opens their Timesheet', async ({
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

		const attendanceCard = page.getByTestId('attendance-card');
		await expect(attendanceCard).toBeVisible();
		await expect(page.getByTestId('present-figure')).toHaveText(
			new RegExp(`^${fixture.presentDays}\\s*/\\s*${fixture.daysInMonth}$`)
		);
		await expect(page.getByTestId('present-denominator')).toHaveText(
			`/ ${fixture.daysInMonth}`
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

		const timesheet = page.getByRole('table', {
			name: /Monthly time sheet for/,
		});
		await expect(timesheet).toBeVisible();
		await expect(timesheet).toContainText(fixture.employeeCode);
		await expect(timesheet).toContainText(fixture.employeeName);
		await expect(timesheet).toContainText('24:00:00');
	} finally {
		await fixture.dispose();
	}
});
