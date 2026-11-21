import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createDeskWorker,
	findDeskTasksByOwnerAndTitle,
	readDeskTask,
	seedDeskTask,
} from '../fixtures/desk-work.ts';

// The owned Next dev server compiles the dashboard route on first visit. Every
// assertion still waits for its observable result; this only bounds that work.
test.setTimeout(300_000);

// Actor: an ordinary employee whose custom role grants no permissions.
// Starting state: a fresh active user with no tasks and no session rows.
// Action: sign in, open the sidebar Tasks panel, add a uniquely titled task,
// reload the dashboard, and reopen the panel.
// Proof: the task is visible again after the reload, and an independent MySQL
// read finds exactly one pending task owned by this user with the entered
// title and the form's default medium priority.
test('creates a personal task and finds it after reopening the dashboard', async ({
	page,
	db,
	namespace,
}) => {
	const worker = await createDeskWorker(db, `${namespace}-task-author`, []);
	const title = `${namespace} personal task`;

	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: worker.username,
			password: worker.password,
		});

		await page
			.getByRole('button', { name: 'Tasks', exact: true })
			.first()
			.click();
		await expect(
			page.getByRole('heading', { name: 'My Tasks', exact: true })
		).toBeVisible({ timeout: 60_000 });

		await page.getByRole('button', { name: 'Add task', exact: true }).click();
		await page.getByPlaceholder('What needs to be done?').fill(title);

		const createResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === '/api/todos'
		);
		await page.getByRole('button', { name: 'Add Task', exact: true }).click();
		expect((await createResponse).status()).toBe(201);

		await expect(page.getByText(title, { exact: true })).toBeVisible();

		const saved = await findDeskTasksByOwnerAndTitle(db, worker.userId, title);
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({
			userId: worker.userId,
			title,
			priority: 'medium',
			status: 'pending',
			completedAt: null,
		});

		// Reopen: the sidebar writes the panel preference to localStorage, so a
		// real reload restores the open panel and fetches the task from MySQL.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'My Tasks', exact: true })
		).toBeVisible({ timeout: 60_000 });
		await expect(page.getByText(title, { exact: true })).toBeVisible();
	} finally {
		await worker.dispose();
	}
});

// Actor: a second ordinary employee whose custom role grants no permissions.
// Starting state: an independently seeded open, high-priority task owned by
// that user; no other actor owns it.
// Action: sign in, open the sidebar Tasks panel, and complete the task through
// its round checkbox, then reload and reopen the panel.
// Proof: the PUT response carries the completed task, the title leaves the
// pending list, the pending counter drops to zero, and the reloaded panel no
// longer lists it; an independent MySQL read shows status completed with a
// recorded completion time.
//
// The panel's own completed-list toggle cannot be exercised here: its
// completed count comes from the same `todos` state that removes a task the
// moment it is completed while the completed view is hidden
// (src/components/TodoList.jsx, the `pendingCount`/`completedCount` derivation
// and `handleToggleStatus`). The reachable visible state is the cleared
// pending list; the stored completed row is the independent proof.
test('completes an independently seeded open task and clears it from pending', async ({
	page,
	db,
	namespace,
}) => {
	const worker = await createDeskWorker(db, `${namespace}-task-owner`, []);
	const title = `${namespace} seeded open task`;
	const seeded = await seedDeskTask(db, worker.userId, title, {
		priority: 'high',
	});

	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: worker.username,
			password: worker.password,
		});

		await page
			.getByRole('button', { name: 'Tasks', exact: true })
			.first()
			.click();
		const tasksHeading = page.getByRole('heading', {
			name: 'My Tasks',
			exact: true,
		});
		await expect(tasksHeading).toBeVisible({ timeout: 60_000 });
		const tasksHeader = tasksHeading.locator('xpath=../../..');

		const taskTitle = page.getByText(title, { exact: true });
		await expect(taskTitle).toBeVisible();
		await expect(
			tasksHeader.getByText('1 pending', { exact: true })
		).toBeVisible();

		const completeResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'PUT' &&
				new URL(response.url()).pathname === '/api/todos'
		);
		// The first button in the task row is its round completion checkbox; the
		// list has no accessible label for it, so anchor on the title row.
		await taskTitle
			.locator('xpath=../../..')
			.getByRole('button')
			.first()
			.click();
		const completed = await completeResponse;
		expect(completed.ok()).toBe(true);
		expect(await completed.json()).toMatchObject({
			success: true,
			data: { id: seeded.id, status: 'completed' },
		});

		await expect(page.getByText(title, { exact: true })).toHaveCount(0);
		await expect(
			tasksHeader.getByText('0 pending', { exact: true })
		).toBeVisible();

		const stored = await readDeskTask(db, seeded.id);
		expect(stored).not.toBeNull();
		expect(stored).toMatchObject({
			id: seeded.id,
			userId: worker.userId,
			title,
			priority: 'high',
			status: 'completed',
		});
		expect(stored?.completedAt).not.toBeNull();

		await page.reload();
		const reloadedHeading = page.getByRole('heading', {
			name: 'My Tasks',
			exact: true,
		});
		await expect(reloadedHeading).toBeVisible({ timeout: 60_000 });
		const reloadedHeader = reloadedHeading.locator('xpath=../../..');
		await expect(
			reloadedHeader.getByText('0 pending', { exact: true })
		).toBeVisible();
		await expect(page.getByText(title, { exact: true })).toHaveCount(0);
	} finally {
		await worker.dispose();
	}
});
