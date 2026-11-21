import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readUserAccountState,
	seedUserAdministrationFixture,
} from '../fixtures/user-administration.ts';

// The owned Next dev server compiles these masters routes on first visit. The
// assertions below are unchanged; the budget only covers that compilation.
test.setTimeout(300_000);

/**
 * The editor reads the account with users:read and saves with users:update.
 * Because it can only grant permissions the caller already holds, the same
 * role carries employees:read and employees:create.
 */
const PERMISSION_EDITOR_PERMISSIONS = [
	'users:read',
	'users:update',
	'employees:read',
	'employees:create',
] as const;

const TARGET_INITIAL_PERMISSIONS = ['employees:read'] as const;
const TARGET_EXPECTED_PERMISSIONS = [
	'employees:create',
	'employees:read',
] as const;

/** A password reset writes one existing account; no other grant is needed. */
const PASSWORD_RESET_PERMISSIONS = ['users:read', 'users:update'] as const;

// Actor: an administrator whose owned role grants exactly users:read,
// users:update, employees:read and employees:create.
// Starting state: one namespaced role-less target with exactly employees:read
// as its direct permission.
// Action: sign in, open the target from User Management, add Create for
// Employees in its permission editor and save, then leave the editor, reopen
// the target from the list and reload.
// Proof: the saved notification appears; the database holds exactly
// employees:read + employees:create and the nested Employees module with
// read/create; the reopened editor after reload shows both controls pressed
// and the module enabled.
test('an administrator edits one permission and reopens the saved grant', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedUserAdministrationFixture(
		db,
		`${namespace}-permissions`,
		{
			actorPermissions: PERMISSION_EDITOR_PERMISSIONS,
			targetPermissions: TARGET_INITIAL_PERMISSIONS,
		}
	);
	try {
		const target = fixture.target;
		if (!target) {
			throw new Error(
				'[user-administration] the target account was not seeded.'
			);
		}

		const before = await readUserAccountState(db, target.userId);
		expect(before).toMatchObject({
			id: target.userId,
			roleId: null,
			status: 'active',
			isActive: 1,
			permissions: [...TARGET_INITIAL_PERMISSIONS],
			sessions: 0,
		});

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: fixture.actor.username,
			password: fixture.actor.password,
		});

		await page.goto('/masters/users');
		await expect(
			page.getByRole('heading', { name: 'User Management', exact: true })
		).toBeVisible();
		await page
			.getByPlaceholder('Search by username, email, or name...', {
				exact: true,
			})
			.fill(target.username);

		const targetRow = page
			.getByRole('row')
			.filter({ hasText: target.username });
		await expect(targetRow).toBeVisible();
		await targetRow
			.getByRole('button', { name: 'Manage Permissions', exact: true })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/masters/users/${target.userId}/permissions$`)
		);
		await expect(
			page.getByRole('heading', { name: 'User Permissions', exact: true })
		).toBeVisible();

		await expect(
			page.getByRole('checkbox', { name: 'Disable Employees', exact: true })
		).toBeChecked();
		const configureEmployees = page.getByRole('button', {
			name: 'Configure Employees',
			exact: true,
		});
		await expect(configureEmployees).toBeEnabled();
		await configureEmployees.click();

		await expect(
			page.getByRole('button', { name: 'read for Employees', exact: true })
		).toHaveAttribute('aria-pressed', 'true');
		const createForEmployees = page.getByRole('button', {
			name: 'create for Employees',
			exact: true,
		});
		await expect(createForEmployees).toHaveAttribute('aria-pressed', 'false');
		await createForEmployees.click();
		await expect(createForEmployees).toHaveAttribute('aria-pressed', 'true');

		const saveResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'PUT' && url.pathname === '/api/users'
			);
		});
		await page
			.getByRole('button', { name: 'Save Permissions', exact: true })
			.click();
		expect((await saveResponse).status()).toBe(200);
		await expect(
			page.getByText('Permissions saved successfully!', { exact: true })
		).toBeVisible();
		await expect(
			page.getByText('Unsaved changes', { exact: true })
		).toHaveCount(0);

		const saved = await readUserAccountState(db, target.userId);
		expect(saved).not.toBeNull();
		expect([...(saved?.permissions ?? [])].sort()).toEqual([
			...TARGET_EXPECTED_PERMISSIONS,
		]);
		const modules = saved?.fieldPermissions.modules as
			| Record<string, { enabled?: boolean; crud?: Record<string, boolean> }>
			| undefined;
		expect(modules?.employees).toMatchObject({
			enabled: true,
			crud: { read: true, create: true },
		});

		// Leave the editor, reopen the same account from the user list, then
		// force a server read so the proof cannot come from React Query state.
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await page.waitForURL(/\/masters\/users$/);
		await page
			.getByPlaceholder('Search by username, email, or name...', {
				exact: true,
			})
			.fill(target.username);
		const reopenedRow = page
			.getByRole('row')
			.filter({ hasText: target.username });
		await expect(reopenedRow).toBeVisible();
		await expect(
			reopenedRow.getByRole('button', {
				name: '2 permissions',
				exact: true,
			})
		).toBeVisible();
		await reopenedRow
			.getByRole('button', { name: 'Manage Permissions', exact: true })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/masters/users/${target.userId}/permissions$`)
		);

		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'User Permissions', exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('checkbox', { name: 'Disable Employees', exact: true })
		).toBeChecked();
		await page
			.getByRole('button', { name: 'Configure Employees', exact: true })
			.click();
		await expect(
			page.getByRole('button', { name: 'read for Employees', exact: true })
		).toHaveAttribute('aria-pressed', 'true');
		await expect(
			page.getByRole('button', { name: 'create for Employees', exact: true })
		).toHaveAttribute('aria-pressed', 'true');

		const afterReopen = await readUserAccountState(db, target.userId);
		expect([...(afterReopen?.permissions ?? [])].sort()).toEqual([
			...TARGET_EXPECTED_PERMISSIONS,
		]);
	} finally {
		await fixture.dispose();
	}
});

// Actor: an administrator whose owned role grants exactly users:read and
// users:update.
// Starting state: one namespaced role-less target with a known old password,
// no permissions and no sessions.
// Action: sign in, open Reset Password for that target in User Management and
// save the fixture's distinct new password; then sign in as the target in a
// separate browser context with that new password.
// Proof: the success message names the target, the database records a password
// change and still stores no sessions, and the target reaches /user/dashboard
// with its own greeting using only the new credential.
test('an administrator resets a target password and the new credential signs in', async ({
	page,
	db,
	namespace,
	browser,
	runtime,
}) => {
	const fixture = await seedUserAdministrationFixture(
		db,
		`${namespace}-reset`,
		{
			actorPermissions: PASSWORD_RESET_PERMISSIONS,
			targetPermissions: [],
		}
	);
	try {
		const target = fixture.target;
		if (!target) {
			throw new Error(
				'[user-administration] the target account was not seeded.'
			);
		}
		expect(target.newPassword).not.toBe(target.password);

		const before = await readUserAccountState(db, target.userId);
		expect(before).toMatchObject({
			status: 'active',
			isActive: 1,
			permissions: [],
			lastPasswordChange: null,
			sessions: 0,
		});

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: fixture.actor.username,
			password: fixture.actor.password,
		});

		await page.goto('/masters/users');
		await expect(
			page.getByRole('heading', { name: 'User Management', exact: true })
		).toBeVisible();
		await page
			.getByPlaceholder('Search by username, email, or name...', {
				exact: true,
			})
			.fill(target.username);

		const targetRow = page
			.getByRole('row')
			.filter({ hasText: target.username });
		await expect(targetRow).toBeVisible();
		await targetRow
			.getByRole('button', { name: 'Reset Password', exact: true })
			.click();
		await expect(
			page.getByRole('heading', { name: 'Reset Password', exact: true })
		).toBeVisible();

		await page
			.getByPlaceholder('Enter new password', { exact: true })
			.fill(target.newPassword);
		await page
			.getByPlaceholder('Confirm new password', { exact: true })
			.fill(target.newPassword);

		const resetResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'POST' &&
				url.pathname === '/api/users/reset-password'
			);
		});
		await page
			.getByRole('button', { name: 'Reset Password', exact: true })
			.last()
			.click();
		expect((await resetResponse).status()).toBe(200);
		await expect(
			page.getByText(
				`Password reset successfully for user "${target.username}"`,
				{ exact: true }
			)
		).toBeVisible();

		const afterReset = await readUserAccountState(db, target.userId);
		expect(afterReset).toMatchObject({
			status: 'active',
			isActive: 1,
			permissions: [],
			sessions: 0,
		});
		expect(afterReset?.lastPasswordChange).not.toBeNull();

		const targetContext = await browser.newContext({
			baseURL: runtime.baseUrl,
		});
		try {
			const targetPage = await targetContext.newPage();
			targetPage.setDefaultNavigationTimeout(60_000);
			await signInThroughUi(targetPage, {
				username: target.username,
				password: target.newPassword,
			});
			await expect(
				targetPage
					.getByRole('heading', { level: 1 })
					.filter({ hasText: target.username })
			).toBeVisible();
			expect((await readUserAccountState(db, target.userId))?.sessions).toBe(1);
		} finally {
			await targetContext.close();
		}
	} finally {
		await fixture.dispose();
	}
});
