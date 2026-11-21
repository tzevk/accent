import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import { createJourneyUser } from '../fixtures/journey-user.ts';
import {
	deleteWorkLogs,
	findWorkLogIdsByTitle,
	seedWorkLog,
	type StoredWorkLogRow,
} from '../fixtures/service-workflows.ts';

/**
 * Each test starts with the narrowest grant its action needs: creating and
 * listing one's own log needs only a signed-in account, editing needs
 * `work_logs:update`, and deleting needs `work_logs:delete`.
 */
const WORK_LOG_UPDATE_PERMISSIONS = ['work_logs:update'] as const;
const WORK_LOG_DELETE_PERMISSIONS = ['work_logs:delete'] as const;

// The owned dev server compiles the work-logs page and its API on first visit;
// every assertion still waits for the visible result.
test.setTimeout(180_000);

/** The page defaults its day filter to the browser's UTC ISO date. */
function todayInputValue(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Actor: an ordinary signed-in employee whose custom role grants no extra
 * permissions; listing and creating one's own log needs only the account.
 *
 * Starting state: a fresh employee account with no saved work log for today.
 *
 * Action: open My Work Logs, add a log with a namespaced title, description,
 * category, 45 minutes, High priority and In Progress status, save it, reload
 * the selected day, then reopen the saved row's form.
 *
 * Proof: the saved title, description and 45 mins are visible before and
 * after the reload, the reopened form redisplays every authored value, and an
 * independent database read of the one row for that employee matches each
 * field and today's log date.
 */
test('employee saves a work log and reopens it from the selected day', async ({
	page,
	db,
	namespace,
}) => {
	const logDate = todayInputValue();
	const title = `${namespace} saved work log`;
	const description = `${namespace} save detail: reconcile the vendor statement.`;
	const category = `${namespace}-Reconciliation`;
	const user = await createJourneyUser(db, `${namespace}-work-log-save`, []);
	let createdWorkLogId: number | null = null;

	try {
		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});
		await page.goto('/work-logs');
		await expect(
			page.getByRole('heading', { name: 'My Work Logs', exact: true })
		).toBeVisible();
		await expect(
			page.getByText('No work logs found for this date.', { exact: true })
		).toBeVisible();

		await page
			.getByRole('button', { name: 'Add Work Log', exact: true })
			.click();
		await expect(
			page.getByRole('heading', { name: 'Add Work Log', exact: true })
		).toBeVisible();
		const form = page.locator('form');
		await page.getByPlaceholder('Brief description of the task').fill(title);
		await page
			.getByPlaceholder(
				'Detailed description of what you plan to do or what you did...'
			)
			.fill(description);
		await page
			.getByPlaceholder('e.g., Development, Meeting, Research')
			.fill(category);
		await page.getByPlaceholder('30', { exact: true }).fill('45');
		await form.getByRole('combobox').nth(1).selectOption('high');
		await form.getByRole('combobox').nth(2).selectOption('in_progress');

		await page.getByRole('button', { name: 'Save Log', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Add Work Log', exact: true })
		).toBeHidden();
		await expect(
			page.getByRole('heading', { name: title, exact: true })
		).toBeVisible();
		await expect(page.getByText(description, { exact: true })).toBeVisible();
		await expect(page.getByText('45 mins', { exact: true })).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: title, exact: true })
		).toBeVisible();
		await expect(page.getByText(description, { exact: true })).toBeVisible();
		await expect(page.getByText('45 mins', { exact: true })).toBeVisible();

		await page.getByTitle('Edit', { exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Edit Work Log', exact: true })
		).toBeVisible();
		const reopenedForm = page.locator('form');
		await expect(reopenedForm.locator('input[type="date"]')).toHaveValue(
			logDate
		);
		await expect(
			page.getByPlaceholder('Brief description of the task')
		).toHaveValue(title);
		await expect(
			page.getByPlaceholder(
				'Detailed description of what you plan to do or what you did...'
			)
		).toHaveValue(description);
		await expect(page.getByPlaceholder('30', { exact: true })).toHaveValue(
			'45'
		);
		await expect(reopenedForm.getByRole('combobox').nth(1)).toHaveValue('high');
		await expect(reopenedForm.getByRole('combobox').nth(2)).toHaveValue(
			'in_progress'
		);
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Edit Work Log', exact: true })
		).toBeHidden();

		const [rows] = await db.execute<StoredWorkLogRow[]>(
			'SELECT * FROM user_work_logs WHERE user_id = ? AND title = ?',
			[user.userId, title]
		);
		expect(rows).toHaveLength(1);
		createdWorkLogId = rows[0].id;
		expect(rows[0]).toMatchObject({
			user_id: user.userId,
			log_date: logDate,
			log_type: 'done',
			title,
			description,
			category,
			priority: 'high',
			status: 'in_progress',
			time_spent: 45,
			project_id: null,
		});
	} finally {
		try {
			const workLogIds =
				createdWorkLogId === null
					? await findWorkLogIdsByTitle(db, user.userId, title)
					: [createdWorkLogId];
			await deleteWorkLogs(db, workLogIds);
		} finally {
			await user.dispose();
		}
	}
});

/**
 * Actor: an ordinary signed-in employee whose custom role grants exactly
 * work_logs:update; no create, delete or administrator rights.
 *
 * Starting state: one saved log for today with a namespaced title, Low
 * priority, Pending status, 15 minutes and a known category.
 *
 * Action: open My Work Logs, choose Edit on that row, change title,
 * description, category, time, priority and status, then update and reload.
 *
 * Proof: the edited row and new title are visible after the reload with the old
 * title gone, and an independent database read of the same primary key holds
 * every edited value.
 */
test('employee edits a seeded work log and the changed fields persist', async ({
	page,
	db,
	namespace,
}) => {
	const logDate = todayInputValue();
	const originalTitle = `${namespace} seeded edit target`;
	const editedTitle = `${namespace} edited work log`;
	const originalDescription = `${namespace} original detail that should be replaced.`;
	const editedDescription = `${namespace} edited detail: approve the revised totals.`;
	const editedCategory = `${namespace}-Approval`;
	const user = await createJourneyUser(
		db,
		`${namespace}-work-log-edit`,
		WORK_LOG_UPDATE_PERMISSIONS
	);
	let workLogId: number | null = null;

	try {
		workLogId = await seedWorkLog(db, {
			userId: user.userId,
			logDate,
			title: originalTitle,
			description: originalDescription,
			category: `${namespace}-Original`,
			priority: 'low',
			status: 'pending',
			timeSpent: 15,
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});
		await page.goto('/work-logs');
		await expect(
			page.getByRole('heading', { name: originalTitle, exact: true })
		).toBeVisible();

		await page.getByTitle('Edit', { exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Edit Work Log', exact: true })
		).toBeVisible();
		await expect(
			page.getByPlaceholder('Brief description of the task')
		).toHaveValue(originalTitle);

		const form = page.locator('form');
		await page
			.getByPlaceholder('Brief description of the task')
			.fill(editedTitle);
		await page
			.getByPlaceholder(
				'Detailed description of what you plan to do or what you did...'
			)
			.fill(editedDescription);
		await page
			.getByPlaceholder('e.g., Development, Meeting, Research')
			.fill(editedCategory);
		await page.getByPlaceholder('30', { exact: true }).fill('75');
		await form.getByRole('combobox').nth(1).selectOption('high');
		await form.getByRole('combobox').nth(2).selectOption('in_progress');
		await page.getByRole('button', { name: 'Update Log', exact: true }).click();

		await expect(
			page.getByRole('heading', { name: 'Edit Work Log', exact: true })
		).toBeHidden();
		await expect(
			page.getByRole('heading', { name: editedTitle, exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: originalTitle, exact: true })
		).toHaveCount(0);
		await expect(
			page.getByText(editedDescription, { exact: true })
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: editedTitle, exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: originalTitle, exact: true })
		).toHaveCount(0);
		await expect(
			page.getByText(editedDescription, { exact: true })
		).toBeVisible();
		await expect(page.getByText('75 mins', { exact: true })).toBeVisible();

		const [rows] = await db.execute<StoredWorkLogRow[]>(
			'SELECT * FROM user_work_logs WHERE id = ?',
			[workLogId]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			user_id: user.userId,
			log_date: logDate,
			title: editedTitle,
			description: editedDescription,
			category: editedCategory,
			priority: 'high',
			status: 'in_progress',
			time_spent: 75,
		});
	} finally {
		try {
			const workLogIds =
				workLogId === null
					? await findWorkLogIdsByTitle(db, user.userId, originalTitle)
					: [workLogId];
			await deleteWorkLogs(db, workLogIds);
		} finally {
			await user.dispose();
		}
	}
});

/**
 * Actor: an ordinary signed-in employee whose custom role grants exactly
 * work_logs:delete; no create, update or administrator rights.
 *
 * Starting state: one saved log for today with a unique title, distinct from
 * the edit fixture.
 *
 * Action: open My Work Logs, press Delete on that row, accept the browser's
 * confirmation, then reload the selected day.
 *
 * Proof: the row disappears and the empty state returns after the reload,
 * while an independent database read by its primary key finds no row.
 */
test('employee deletes a separately seeded work log after confirming', async ({
	page,
	db,
	namespace,
}) => {
	const logDate = todayInputValue();
	const title = `${namespace} seeded delete target`;
	const user = await createJourneyUser(
		db,
		`${namespace}-work-log-delete`,
		WORK_LOG_DELETE_PERMISSIONS
	);
	let workLogId: number | null = null;

	try {
		workLogId = await seedWorkLog(db, {
			userId: user.userId,
			logDate,
			title,
			description: `${namespace} delete detail: this row exists only for removal.`,
			priority: 'medium',
			status: 'completed',
			timeSpent: 20,
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});
		await page.goto('/work-logs');
		await expect(
			page.getByRole('heading', { name: title, exact: true })
		).toBeVisible();

		let deleteConfirmation: string | null = null;
		page.once('dialog', (dialog) => {
			deleteConfirmation = dialog.message();
			void dialog.accept();
		});
		await page.getByTitle('Delete', { exact: true }).click();
		await expect
			.poll(() => deleteConfirmation)
			.toBe('Are you sure you want to delete this work log?');

		await expect(
			page.getByRole('heading', { name: title, exact: true })
		).toHaveCount(0);
		await expect(
			page.getByText('No work logs found for this date.', { exact: true })
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: title, exact: true })
		).toHaveCount(0);
		await expect(
			page.getByText('No work logs found for this date.', { exact: true })
		).toBeVisible();

		const [rows] = await db.execute<StoredWorkLogRow[]>(
			'SELECT * FROM user_work_logs WHERE id = ?',
			[workLogId]
		);
		expect(rows).toHaveLength(0);
	} finally {
		try {
			const workLogIds =
				workLogId === null
					? await findWorkLogIdsByTitle(db, user.userId, title)
					: [workLogId];
			await deleteWorkLogs(db, workLogIds);
		} finally {
			await user.dispose();
		}
	}
});
