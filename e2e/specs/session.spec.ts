import type { Page } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../support/test.ts';
import { createJourneyUser } from '../fixtures/journey-user.ts';
import { signInThroughUi } from '../support/auth.ts';

// The owned Next dev server compiles routes on first visit. Every assertion
// still waits for its observable result; this only bounds compilation time.
test.setTimeout(300_000);

function parsePermissions(value: unknown): string[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((entry): entry is string => typeof entry === 'string');
}

async function countSessions(db: Connection, userId: number): Promise<number> {
	const [rows] = await db.execute<RowDataPacket[]>(
		'SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?',
		[userId]
	);
	return Number(rows[0]?.total ?? 0);
}

async function readStoredPermissions(
	db: Connection,
	userId: number
): Promise<{ role: string[]; user: string[] }> {
	const [rows] = await db.execute<RowDataPacket[]>(
		`SELECT r.permissions AS role_permissions,
              u.permissions AS user_permissions
         FROM users u
         LEFT JOIN roles_master r ON r.id = u.role_id
        WHERE u.id = ?`,
		[userId]
	);
	return {
		role: parsePermissions(rows[0]?.role_permissions),
		user: parsePermissions(rows[0]?.user_permissions),
	};
}

async function expectSignInForm(page: Page) {
	await expect(
		page.getByRole('heading', { name: 'Sign In', exact: true })
	).toBeVisible();
}

// Actor: an employee account whose custom role grants no permissions.
// Starting state: a fresh active user with a real password and no session rows.
// Action: submit /signin, open the sidebar account menu, choose Log out, then revisit /user/dashboard.
// Proof: the employee greeting, then the Sign In form; the stored session disappears and reentry keeps from=/user/dashboard.
test('signs in, logs out, and refuses protected reentry', async ({
	page,
	db,
	namespace,
}) => {
	const journey = await createJourneyUser(db, `${namespace}-lifecycle`, []);
	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: journey.username,
			password: journey.password,
		});

		await expect(
			page
				.getByRole('heading', { level: 1 })
				.filter({ hasText: journey.username })
		).toBeVisible();
		expect(await countSessions(db, journey.userId)).toBe(1);

		const accountMenu = page.getByRole('button', { name: journey.username });
		await accountMenu.click();
		const logoutResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === '/api/logout'
		);
		await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
		expect((await logoutResponse).ok()).toBe(true);

		await page.waitForURL((url) => url.pathname === '/signin');
		await expectSignInForm(page);
		expect(await countSessions(db, journey.userId)).toBe(0);

		await page.goto('/user/dashboard');
		await page.waitForURL(
			(url) =>
				url.pathname === '/signin' &&
				url.searchParams.get('from') === '/user/dashboard'
		);
		await expectSignInForm(page);
	} finally {
		await journey.dispose();
	}
});

// Actor: an anonymous visitor.
// Starting state: no session cookie and no browser session.
// Action: open the protected /user/dashboard URL.
// Proof: the Sign In form at /signin with from=/user/dashboard, never the dashboard.
test('redirects a signed-out visitor from a protected page to sign in', async ({
	page,
}) => {
	page.setDefaultNavigationTimeout(60_000);
	await page.goto('/user/dashboard');
	await page.waitForURL(
		(url) =>
			url.pathname === '/signin' &&
			url.searchParams.get('from') === '/user/dashboard'
	);
	await expectSignInForm(page);
});

// Actor: an employee account with an empty custom role and no direct grants.
// Starting state: a fresh active user whose stored role and user permissions are both empty.
// Action: sign in through /signin, then open /admin/dashboard.
// Proof: the admin layout redirects to /user/dashboard with the employee greeting and no Admin Dashboard heading.
test('redirects an employee without rights away from the admin dashboard', async ({
	page,
	db,
	namespace,
}) => {
	const journey = await createJourneyUser(db, `${namespace}-no-admin`, []);
	try {
		const stored = await readStoredPermissions(db, journey.userId);
		expect(stored).toEqual({ role: [], user: [] });

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: journey.username,
			password: journey.password,
		});

		await page.goto('/admin/dashboard');
		await page.waitForURL((url) => url.pathname === '/user/dashboard');
		await expect(
			page
				.getByRole('heading', { level: 1 })
				.filter({ hasText: journey.username })
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Admin Dashboard', exact: true })
		).toHaveCount(0);
	} finally {
		await journey.dispose();
	}
});

// Actor: an anonymous visitor submitting the sign-in form.
// Starting state: a real active account with a known username and zero session rows.
// Action: enter that username with a wrong password and press Sign In.
// Proof: the Invalid credentials alert stays on /signin and no session row is created.
test('refuses a known account with the wrong password', async ({
	page,
	db,
	namespace,
}) => {
	const journey = await createJourneyUser(
		db,
		`${namespace}-wrong-password`,
		[]
	);
	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		expect(await countSessions(db, journey.userId)).toBe(0);

		await page.goto('/signin');
		await page
			.getByLabel('Username or Email', { exact: true })
			.fill(journey.username);
		await page
			.getByLabel('Password', { exact: true })
			.fill(`${journey.password}-wrong`);

		const loginResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === '/api/login'
		);
		await page.getByRole('button', { name: 'Sign In', exact: true }).click();
		expect((await loginResponse).status()).toBe(401);

		await expect(
			page.getByRole('alert').filter({ hasText: 'Invalid credentials' })
		).toHaveText('Invalid credentials');
		await expect(page).toHaveURL(/\/signin$/);
		await expectSignInForm(page);
		expect(await countSessions(db, journey.userId)).toBe(0);
	} finally {
		await journey.dispose();
	}
});
