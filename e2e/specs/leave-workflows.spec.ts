/**
 * Leave application browser journeys.
 *
 * Four independent outcomes, each with its own disposable applicant/approver
 * pair, owned Employee row, balance and pending application where required:
 * submit, withdraw, approve and reject. Every test signs in once through the
 * real /signin form, so one full attempt of this file makes exactly four
 * anonymous login requests (no wrong-password or relogin attempts).
 * Persistence is proven by reloading the page and independently reading the
 * owned rows through the fixture connection; approval additionally proves the
 * attendance rows and capped balance ledger the API writes.
 */
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readLeaveApplicationById,
	readLeaveApplicationByReason,
	readLeaveApplicationsForUser,
	readLeaveAttendanceForRange,
	readLeaveBalance,
	seedLeaveWorkflowFixture,
	SUBMITTED_LEAVE,
	type LeaveWorkflowApplication,
	type LeaveWorkflowFixture,
} from '../fixtures/leave-workflows.ts';

// The owned Next dev server compiles the leave pages and routes on first
// visit. Every assertion still waits for its observable result; this only
// bounds compilation time for the four distinct first visits.
test.setTimeout(240_000);
// The app formats dates with en-IN in the browser; pin the zone so a fixed
// calendar date never renders as the previous day on a non-UTC machine.
test.use({ timezoneId: 'UTC' });

let fixture: LeaveWorkflowFixture | null = null;

test.beforeEach(async ({ page }) => {
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async () => {
	const owned = fixture;
	fixture = null;
	if (owned !== null) await owned.cleanup();
});

// Actor: applicant whose custom role grants exactly leaves:read and leaves:create.
// Starting state: linked Employee with a 2031 Privilege Leave ledger row (10 total, 3 used) and no leave applications.
// Action: sign in, open My Leaves, apply for two working days from the real form, then reload the page.
// Proof: the row shows the authored dates/reason/type, 2 days and pending status before and after reload; the database has exactly that pending row for this applicant.
test('an applicant submits two working days and the pending request survives a reload', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedLeaveWorkflowFixture(db, `${namespace}-submit`);
	const workflow = fixture;
	expect(workflow.seededApplication).toBeNull();
	expect(workflow.leaveType.code).toBe('PL');
	expect(workflow.leaveType.name).toBe('Privilege Leave');
	expect(
		await readLeaveApplicationsForUser(db, workflow.applicant.userId)
	).toEqual([]);
	expect(
		await readLeaveBalance(
			db,
			workflow.applicant.employeeId,
			workflow.leaveType.id,
			2031
		)
	).toEqual({ total: 10, used: 3 });
	const reason = `${SUBMITTED_LEAVE.reasonPrefix} ${workflow.namespace}`;

	await signInThroughUi(page, workflow.applicant);

	await page.goto('/user/leaves');
	await expect(
		page.getByRole('heading', { name: 'My Leaves', exact: true })
	).toBeVisible();
	await expect(page.getByText(/No leave applications yet/)).toBeVisible();

	await page
		.getByRole('button', { name: 'Apply for Leave', exact: true })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Apply for Leave' });
	await expect(dialog).toBeVisible();

	const leaveTypeOption = dialog.getByRole('option', {
		name: /^Privilege Leave/,
		includeHidden: true,
	});
	await expect(leaveTypeOption).toBeAttached();
	await dialog
		.getByRole('combobox')
		.selectOption(String(workflow.leaveType.id));
	const dateInputs = dialog.locator('input[type="date"]');
	await expect(dateInputs).toHaveCount(2);
	await dateInputs.nth(0).fill(SUBMITTED_LEAVE.startDate);
	await dateInputs.nth(1).fill(SUBMITTED_LEAVE.endDate);
	await dialog
		.getByPlaceholder('Briefly describe the reason for your leave…')
		.fill(reason);
	await expect(
		dialog.getByText('Duration: 2 days', { exact: true })
	).toBeVisible();

	const createResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' &&
			new URL(response.url()).pathname === '/api/leaves'
	);
	await dialog
		.getByRole('button', { name: 'Submit Application', exact: true })
		.click();

	const created = await createResponse;
	expect(created.ok()).toBe(true);
	expect(await created.json()).toMatchObject({
		success: true,
		data: {
			leave_type_id: workflow.leaveType.id,
			start_date: '2031-12-01',
			end_date: '2031-12-02',
			half_day: false,
			duration_days: 2,
			sandwich_days_count: 0,
			reason,
			status: 'pending',
		},
	});
	await expect(
		page.getByText('Leave application submitted', { exact: true })
	).toBeVisible();
	await expect(dialog).toBeHidden();

	const row = page.getByRole('row').filter({ hasText: reason });
	await expect(row).toBeVisible();
	const cells = row.getByRole('cell');
	await expect(cells).toHaveCount(7);
	await expect(cells.nth(0)).toHaveText('01 Dec 2031 – 02 Dec 2031');
	await expect(cells.nth(1)).toContainText('Privilege Leave');
	await expect(cells.nth(1)).toContainText('Paid');
	await expect(cells.nth(2)).toHaveText('2');
	await expect(cells.nth(3)).toHaveText(reason);
	await expect(cells.nth(4)).toHaveText('pending');
	await expect(cells.nth(5)).toHaveText('—');
	await expect(cells.nth(6)).toContainText('Withdraw');

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'My Leaves', exact: true })
	).toBeVisible();
	const reloadedRow = page.getByRole('row').filter({ hasText: reason });
	await expect(reloadedRow).toBeVisible();
	await expect(reloadedRow.getByRole('cell').nth(4)).toHaveText('pending');

	const stored = await readLeaveApplicationByReason(
		db,
		workflow.applicant.userId,
		reason
	);
	expect(stored).toMatchObject({
		leaveTypeId: workflow.leaveType.id,
		startDate: '2031-12-01',
		endDate: '2031-12-02',
		halfDay: false,
		durationDays: 2,
		reason,
		status: 'pending',
		reviewedBy: null,
		reviewedAt: null,
		reviewNotes: null,
		writtenAttendance: null,
		isDelete: 0,
	});
	expect(stored?.id).toBeGreaterThan(0);
	const ownedApplications = await readLeaveApplicationsForUser(
		db,
		workflow.applicant.userId
	);
	expect(ownedApplications).toHaveLength(1);
	expect(ownedApplications[0]?.id).toBe(stored?.id);
});

// Actor: applicant whose custom role grants exactly leaves:read and leaves:create.
// Starting state: one independently seeded pending Privilege Leave application for 10 Dec 2031.
// Action: sign in, open My Leaves, press Withdraw on that row, then reload the page.
// Proof: the row disappears and the empty state appears after reload; the database row stays pending with isDelete=1.
test('an applicant withdraws a seeded pending request and it stays withdrawn after reload', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedLeaveWorkflowFixture(
		db,
		`${namespace}-withdraw`,
		'withdraw'
	);
	const workflow = fixture;
	const seeded = workflow.seededApplication;
	if (seeded === null) {
		throw new Error('[leave-workflows] expected a seeded withdrawal request.');
	}
	expect(seeded.startDate).toBe('2031-12-10');
	expect(seeded.reason).toBe(
		`E2E withdrawal pending request ${workflow.namespace}`
	);
	const before = await readLeaveApplicationById(db, seeded.id);
	expect(before).toMatchObject({
		status: 'pending',
		reviewedBy: null,
		isDelete: 0,
	});

	await signInThroughUi(page, workflow.applicant);

	await page.goto('/user/leaves');
	await expect(
		page.getByRole('heading', { name: 'My Leaves', exact: true })
	).toBeVisible();
	const row = page.getByRole('row').filter({ hasText: seeded.reason });
	await expect(row).toBeVisible();
	await expect(row.getByRole('cell').nth(0)).toHaveText('10 Dec 2031');
	await expect(row.getByRole('cell').nth(4)).toHaveText('pending');
	await expect(row.getByRole('button', { name: 'Withdraw' })).toBeVisible();

	const deleteResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'DELETE' &&
			new URL(response.url()).pathname === `/api/leaves/${seeded.id}`
	);
	await row.getByRole('button', { name: 'Withdraw' }).click();

	const deleted = await deleteResponse;
	expect(deleted.ok()).toBe(true);
	expect(await deleted.json()).toEqual({ success: true });
	await expect(
		page.getByText('Application withdrawn', { exact: true })
	).toBeVisible();
	await expect(row).toHaveCount(0);

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'My Leaves', exact: true })
	).toBeVisible();
	await expect(page.getByText(/No leave applications yet/)).toBeVisible();
	await expect(
		page.getByRole('row').filter({ hasText: seeded.reason })
	).toHaveCount(0);

	const after = await readLeaveApplicationById(db, seeded.id);
	expect(after).toMatchObject({
		status: 'pending',
		reviewedBy: null,
		isDelete: 1,
	});
});

// Actor: approver whose custom role grants exactly leaves:read and leaves:approve.
// Starting state: one independently seeded pending Privilege Leave application for 08 Dec 2031 and a 2031 ledger of 10 total / 3 used.
// Action: sign in, open Leave Requests, approve that row through its confirm, then reopen the Approved tab and reload.
// Proof: the approved row names the approver and survives reload; the database stores the reviewer, one PL attendance row for the date, and used=4.
test('an approver approves a seeded pending request and attendance plus balance are saved', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedLeaveWorkflowFixture(
		db,
		`${namespace}-approve`,
		'approve'
	);
	const workflow = fixture;
	const seeded = workflow.seededApplication;
	if (seeded === null) {
		throw new Error('[leave-workflows] expected a seeded approval request.');
	}
	expect(seeded.startDate).toBe('2031-12-08');
	expect(seeded.reason).toBe(
		`E2E approval pending request ${workflow.namespace}`
	);
	expect(workflow.balance).toEqual({
		year: 2031,
		total: 10,
		used: 3,
		remaining: 7,
	});
	const before = await readLeaveApplicationById(db, seeded.id);
	expect(before).toMatchObject({
		status: 'pending',
		reviewedBy: null,
		isDelete: 0,
	});
	expect(
		await readLeaveBalance(
			db,
			workflow.applicant.employeeId,
			workflow.leaveType.id,
			2031
		)
	).toEqual({ total: 10, used: 3 });
	expect(
		await readLeaveAttendanceForRange(
			db,
			workflow.applicant.employeeId,
			'2031-12-08',
			'2031-12-08'
		)
	).toEqual([]);

	await signInThroughUi(page, workflow.approver);

	await page.goto('/employees/leaves');
	await expect(
		page.getByRole('heading', { name: 'Leave Requests', exact: true })
	).toBeVisible();
	const row = page.getByRole('row').filter({ hasText: seeded.reason });
	await expect(row).toBeVisible();
	const rowCells = row.getByRole('cell');
	await expect(rowCells).toHaveCount(8);
	await expect(rowCells.nth(0)).toHaveText(workflow.applicant.username);
	await expect(rowCells.nth(1)).toContainText('Privilege Leave');
	await expect(rowCells.nth(1)).toContainText('Paid');
	await expect(rowCells.nth(2)).toHaveText('08 Dec 2031');
	await expect(rowCells.nth(3)).toHaveText('1');
	await expect(rowCells.nth(4)).toHaveText(seeded.reason);
	await expect(rowCells.nth(5)).toHaveText('pending');
	await expect(rowCells.nth(6)).toHaveText('—');

	const confirmMessage = page.waitForEvent('dialog').then(async (dialog) => {
		const message = dialog.message();
		await dialog.accept();
		return message;
	});
	const patchResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'PATCH' &&
			new URL(response.url()).pathname === `/api/leaves/${seeded.id}`
	);
	await row.getByRole('button', { name: 'Approve' }).click();

	expect(await confirmMessage).toBe(
		`Approve ${workflow.applicant.username}'s leave (1 day(s))?`
	);
	const approved = await patchResponse;
	expect(approved.ok()).toBe(true);
	expect(await approved.json()).toMatchObject({
		success: true,
		data: { id: seeded.id, status: 'approved', review_notes: null },
	});
	await expect(page.getByText('Leave approved', { exact: true })).toBeVisible();
	await expect(row).toHaveCount(0);

	await page.getByRole('button', { name: 'Approved', exact: true }).click();
	const approvedRow = page.getByRole('row').filter({ hasText: seeded.reason });
	await expect(approvedRow).toBeVisible();
	await expect(approvedRow.getByRole('cell').nth(5)).toHaveText('approved');
	await expect(approvedRow.getByRole('cell').nth(6)).toHaveText(
		workflow.approver.username
	);

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'Leave Requests', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Approved', exact: true }).click();
	const reloadedApprovedRow = page
		.getByRole('row')
		.filter({ hasText: seeded.reason });
	await expect(reloadedApprovedRow).toBeVisible();
	await expect(reloadedApprovedRow.getByRole('cell').nth(5)).toHaveText(
		'approved'
	);
	await expect(reloadedApprovedRow.getByRole('cell').nth(6)).toHaveText(
		workflow.approver.username
	);

	const stored = await readLeaveApplicationById(db, seeded.id);
	expect(stored).toMatchObject({
		status: 'approved',
		reviewedBy: workflow.approver.userId,
		reviewNotes: null,
		isDelete: 0,
	});
	expect(stored?.reviewedAt).not.toBeNull();
	const audit = stored?.writtenAttendance as {
		version?: unknown;
		attendance?: unknown;
		balances?: unknown;
	} | null;
	expect(audit?.version).toBe(2);
	expect(audit?.attendance).toEqual([
		{ date: '2031-12-08', prev_status: null },
	]);
	expect(audit?.balances).toEqual([
		{ leave_type_id: workflow.leaveType.id, year: 2031, days: 1 },
	]);

	const attendance = await readLeaveAttendanceForRange(
		db,
		workflow.applicant.employeeId,
		seeded.startDate,
		seeded.endDate
	);
	expect(attendance).toHaveLength(1);
	expect(attendance[0]).toMatchObject({
		date: '2031-12-08',
		status: 'PL',
		remarks: `Leave #${seeded.id}`,
		approvedBy: workflow.approver.userId,
	});
	expect(
		await readLeaveBalance(
			db,
			workflow.applicant.employeeId,
			workflow.leaveType.id,
			2031
		)
	).toEqual({ total: 10, used: 4 });
});

// Actor: approver whose custom role grants exactly leaves:read and leaves:approve.
// Starting state: a separate independently seeded pending Privilege Leave application for 09 Dec 2031 and a 2031 ledger of 10 total / 3 used.
// Action: sign in, open Leave Requests, reject that row with a required reason, then reopen the Rejected tab and reload.
// Proof: the rejected row and reason survive reload; the database stores reviewer and notes but no attendance row and no balance deduction.
test('an approver rejects a separate seeded pending request with a saved reason and no attendance', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedLeaveWorkflowFixture(db, `${namespace}-reject`, 'reject');
	const workflow = fixture;
	const seeded: LeaveWorkflowApplication | null = workflow.seededApplication;
	if (seeded === null) {
		throw new Error('[leave-workflows] expected a seeded rejection request.');
	}
	expect(seeded.startDate).toBe('2031-12-09');
	expect(seeded.reason).toBe(
		`E2E rejection pending request ${workflow.namespace}`
	);
	const rejectionReason =
		'E2E rejection: staffing coverage is already arranged';
	const before = await readLeaveApplicationById(db, seeded.id);
	expect(before).toMatchObject({
		status: 'pending',
		reviewedBy: null,
		isDelete: 0,
	});
	expect(
		await readLeaveBalance(
			db,
			workflow.applicant.employeeId,
			workflow.leaveType.id,
			2031
		)
	).toEqual({ total: 10, used: 3 });

	await signInThroughUi(page, workflow.approver);

	await page.goto('/employees/leaves');
	await expect(
		page.getByRole('heading', { name: 'Leave Requests', exact: true })
	).toBeVisible();
	const row = page.getByRole('row').filter({ hasText: seeded.reason });
	await expect(row).toBeVisible();
	await expect(row.getByRole('cell').nth(2)).toHaveText('09 Dec 2031');
	await expect(row.getByRole('cell').nth(5)).toHaveText('pending');

	await row.getByRole('button', { name: 'Reject' }).click();
	const dialog = page.getByRole('dialog', {
		name: 'Reject Leave Application',
	});
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(workflow.applicant.username);
	const rejectButton = dialog.getByRole('button', {
		name: 'Reject Application',
	});
	await expect(rejectButton).toBeDisabled();
	await dialog.getByPlaceholder('Reason for rejection…').fill(rejectionReason);
	await expect(rejectButton).toBeEnabled();

	const patchResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'PATCH' &&
			new URL(response.url()).pathname === `/api/leaves/${seeded.id}`
	);
	await rejectButton.click();

	const rejected = await patchResponse;
	expect(rejected.ok()).toBe(true);
	expect(await rejected.json()).toMatchObject({
		success: true,
		data: {
			id: seeded.id,
			status: 'rejected',
			review_notes: rejectionReason,
		},
	});
	await expect(page.getByText('Leave rejected', { exact: true })).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(row).toHaveCount(0);

	await page.getByRole('button', { name: 'Rejected', exact: true }).click();
	const rejectedRow = page.getByRole('row').filter({ hasText: seeded.reason });
	await expect(rejectedRow).toBeVisible();
	const rejectedCells = rejectedRow.getByRole('cell');
	await expect(rejectedCells.nth(4)).toHaveText(seeded.reason);
	await expect(rejectedCells.nth(5)).toHaveText('rejected');
	await expect(rejectedCells.nth(6)).toContainText(workflow.approver.username);
	await expect(rejectedCells.nth(6)).toContainText(rejectionReason);

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'Leave Requests', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Rejected', exact: true }).click();
	const reloadedRejectedRow = page
		.getByRole('row')
		.filter({ hasText: seeded.reason });
	await expect(reloadedRejectedRow).toBeVisible();
	await expect(reloadedRejectedRow.getByRole('cell').nth(5)).toHaveText(
		'rejected'
	);
	await expect(reloadedRejectedRow.getByRole('cell').nth(6)).toContainText(
		rejectionReason
	);

	const stored = await readLeaveApplicationById(db, seeded.id);
	expect(stored).toMatchObject({
		status: 'rejected',
		reviewedBy: workflow.approver.userId,
		reviewNotes: rejectionReason,
		writtenAttendance: null,
		isDelete: 0,
	});
	expect(stored?.reviewedAt).not.toBeNull();
	expect(
		await readLeaveAttendanceForRange(
			db,
			workflow.applicant.employeeId,
			seeded.startDate,
			seeded.endDate
		)
	).toEqual([]);
	expect(
		await readLeaveBalance(
			db,
			workflow.applicant.employeeId,
			workflow.leaveType.id,
			2031
		)
	).toEqual({ total: 10, used: 3 });
});
