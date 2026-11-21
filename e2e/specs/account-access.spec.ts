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
 * `users:create` admits the employee picker as well as account creation;
 * `vendors:read` is what the same screen separately loads for its vendor tab.
 * `employees:read` is what the landing permission editor uses to show the new
 * account's employee identity. No settings grant or super-admin bypass exists.
 */
const ACCOUNT_CREATOR_PERMISSIONS = [
	'users:read',
	'users:create',
	'vendors:read',
	'employees:read',
] as const;

/** Disabling access is an update to an existing account, nothing more. */
const ACCOUNT_ACCESS_PERMISSIONS = ['users:read', 'users:update'] as const;

// Actor: an administrator whose owned role grants exactly users:read,
// users:create, vendors:read and employees:read.
// Starting state: one namespaced employee exists with no user account and no
// linked login.
// Action: sign in through /signin, open User Management, choose Create User,
// pick that employee, submit the fixture's username and password.
// Proof: the browser lands on that new account's /masters/users/<id>/permissions
// editor showing the employee's name and email with 0 enabled modules; an
// independent database read of the URL's id shows the employee link, active
// status, no role and no permissions.
test('an administrator creates an employee account and lands in its permission editor', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedUserAdministrationFixture(
		db,
		`${namespace}-create`,
		{
			actorPermissions: ACCOUNT_CREATOR_PERMISSIONS,
			withEmployee: true,
		}
	);
	try {
		const employee = fixture.employee;
		if (!employee) {
			throw new Error(
				'[account-access] the employee candidate was not seeded.'
			);
		}

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

		const createUser = page.getByRole('button', {
			name: 'Create User',
			exact: true,
		});
		await expect(createUser).toBeEnabled();
		await createUser.click();
		await expect(
			page.getByRole('heading', { name: 'Create User', exact: true })
		).toBeVisible();

		await page
			.getByPlaceholder('Search employees...', { exact: true })
			.fill(employee.employeeCode);
		const employeeOption = page
			.getByRole('button')
			.filter({ hasText: employee.email });
		await expect(employeeOption).toBeVisible();
		await employeeOption.click();

		await page
			.getByPlaceholder('Enter username', { exact: true })
			.fill(fixture.newAccountUsername);
		await page
			.getByPlaceholder('Enter password (min 6 characters)', { exact: true })
			.fill(fixture.newAccountPassword);
		await page
			.getByPlaceholder('Confirm password', { exact: true })
			.fill(fixture.newAccountPassword);

		const createResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'POST' && url.pathname === '/api/users'
			);
		});
		await page
			.getByRole('button', { name: 'Create User', exact: true })
			.last()
			.click();
		expect((await createResponse).status()).toBe(201);

		await page.waitForURL(/\/masters\/users\/\d+\/permissions$/);
		const match = /\/masters\/users\/(\d+)\/permissions$/.exec(page.url());
		if (!match) {
			throw new Error(
				`[account-access] unexpected post-create URL: ${page.url()}`
			);
		}
		const createdUserId = Number(match[1]);

		await expect(
			page.getByRole('heading', { name: 'User Permissions', exact: true })
		).toBeVisible();
		await expect(
			page.getByText(`${employee.fullName} • ${employee.email}`, {
				exact: true,
			})
		).toBeVisible();
		await expect(page.getByText('0 enabled', { exact: true })).toBeVisible();
		await expect(
			page.getByRole('checkbox', { name: 'Enable Employees', exact: true })
		).not.toBeChecked();

		const stored = await readUserAccountState(db, createdUserId);
		expect(stored).not.toBeNull();
		expect(stored).toMatchObject({
			id: createdUserId,
			username: fixture.newAccountUsername,
			email: employee.email,
			employeeId: employee.id,
			roleId: null,
			status: 'active',
			isActive: 1,
			isDeleted: 0,
			isSuperAdmin: 0,
			permissions: [],
			fieldPermissions: {},
			lastPasswordChange: null,
			sessions: 0,
		});
		expect(stored?.id).not.toBe(fixture.actor.userId);
		fixture.trackCreatedUser(createdUserId);
	} finally {
		await fixture.dispose();
	}
});

// Actor: an administrator whose owned role grants exactly users:read and
// users:update.
// Starting state: one namespaced active target account with no role, no
// permissions and no sessions.
// Action: sign in through /signin, find that account in User Management and
// press Disable Access; then sign in as the target in a separate browser
// context.
// Proof: the row reports Access disabled and inactive, the database shows
// status inactive, is_active 0 and zero sessions, the target's Sign In returns
// Invalid credentials, and /user/dashboard still redirects it to /signin.
test('an administrator disables an account and it can no longer sign in', async ({
	page,
	db,
	namespace,
	browser,
	runtime,
}) => {
	const fixture = await seedUserAdministrationFixture(
		db,
		`${namespace}-disable`,
		{
			actorPermissions: ACCOUNT_ACCESS_PERMISSIONS,
			targetPermissions: [],
		}
	);
	try {
		const target = fixture.target;
		if (!target) {
			throw new Error('[account-access] the target account was not seeded.');
		}

		const before = await readUserAccountState(db, target.userId);
		expect(before).toMatchObject({
			status: 'active',
			isActive: 1,
			permissions: [],
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

		const disableResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'PUT' && url.pathname === '/api/users'
			);
		});
		await targetRow
			.getByRole('button', { name: 'Disable Access', exact: true })
			.click();
		expect((await disableResponse).status()).toBe(200);

		await expect(
			page.getByRole('status').filter({ hasText: 'Access disabled.' })
		).toBeVisible();
		await expect(
			page
				.getByRole('row')
				.filter({ hasText: target.username })
				.getByText('inactive', { exact: true })
		).toBeVisible();

		const after = await readUserAccountState(db, target.userId);
		expect(after).toMatchObject({
			status: 'inactive',
			isActive: 0,
			sessions: 0,
		});

		const targetContext = await browser.newContext({
			baseURL: runtime.baseUrl,
		});
		try {
			const targetPage = await targetContext.newPage();
			targetPage.setDefaultNavigationTimeout(60_000);
			await targetPage.goto('/signin');
			await targetPage
				.getByLabel('Username or Email', { exact: true })
				.fill(target.username);
			await targetPage
				.getByLabel('Password', { exact: true })
				.fill(target.password);
			const deniedResponse = targetPage.waitForResponse((response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/login'
				);
			});
			await targetPage
				.getByRole('button', { name: 'Sign In', exact: true })
				.click();
			expect((await deniedResponse).status()).toBe(401);

			await expect(targetPage.getByRole('alert')).toHaveText(
				'Invalid credentials'
			);
			await expect(targetPage).toHaveURL(/\/signin$/);
			expect((await readUserAccountState(db, target.userId))?.sessions).toBe(0);

			await targetPage.goto('/user/dashboard');
			await targetPage.waitForURL(
				(url) =>
					url.pathname === '/signin' &&
					url.searchParams.get('from') === '/user/dashboard'
			);
			await expect(
				targetPage.getByRole('heading', { name: 'Sign In', exact: true })
			).toBeVisible();
		} finally {
			await targetContext.close();
		}
	} finally {
		await fixture.dispose();
	}
});
