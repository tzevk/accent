import { expect, test } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { ADMIN_USER, EMPLOYEE_USER } from '../lib/fixtures';

/**
 * Auth flow: the session cookie contract, the login → session → logout
 * lifecycle through the real UI, and RBAC enforced by the payroll API.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('session lifecycle', () => {
	test('rejects a bad password; a good login sets an HttpOnly session cookie', async ({
		request,
	}) => {
		const bad = await request.post('/api/login', {
			data: { username: ADMIN_USER.username, password: 'definitely-wrong' },
		});
		expect(bad.status()).toBe(401);

		const good = await request.post('/api/login', {
			data: { username: ADMIN_USER.username, password: ADMIN_USER.password },
		});
		expect(good.status()).toBe(200);

		const setCookie = good.headers()['set-cookie'] ?? '';
		expect(setCookie).toContain('session=');
		expect(setCookie.toLowerCase()).toContain('httponly');
		expect(setCookie.toLowerCase()).toContain('samesite=lax');

		writeArtifact('auth-cookie-contract', {
			badLoginStatus: bad.status(),
			goodLoginStatus: good.status(),
			httpOnly: /httponly/i.test(setCookie),
			sameSiteLax: /samesite=lax/i.test(setCookie),
			legacyCookiesCleared: [
				'auth',
				'user_id',
				'is_super_admin',
				'session_permissions',
			].every((name) => setCookie.includes(`${name}=;`)),
			ok: true,
		});
		expect(readArtifact('auth-cookie-contract')).toMatchObject({ ok: true });
	});

	test('UI login issues a working session and logout revokes it', async ({
		page,
	}) => {
		await page.goto('/signin');
		await page.locator('#email').fill(EMPLOYEE_USER.email);
		await page.locator('input[type="password"]').fill(EMPLOYEE_USER.password);
		await page.locator('button[type="submit"]').click();
		await page.waitForURL('**/user/dashboard');

		const before = await page.request.get('/api/session');
		expect(before.status()).toBe(200);
		expect((await before.json()).authenticated).toBe(true);

		const logout = await page.request.post('/api/logout');
		expect(logout.status()).toBe(200);

		const after = await page.request.get('/api/session');
		expect(after.status()).toBe(200);
		expect((await after.json()).authenticated).toBe(false);

		writeArtifact('auth-session-lifecycle', {
			authenticatedBeforeLogout: true,
			authenticatedAfterLogout: false,
			logoutStatus: logout.status(),
			ok: true,
		});
	});
});

test.describe('RBAC through the payroll API', () => {
	test.use({ storageState: 'e2e/.auth/employee.json' });

	test('an employee account cannot read payroll slips', async ({ request }) => {
		const res = await request.get('/api/payroll/slips?month=2019-01-01');
		expect(res.status()).toBe(403);

		writeArtifact('auth-rbac-employee-denied', {
			endpoint: 'GET /api/payroll/slips',
			status: res.status(),
			ok: true,
		});
	});
});

test.describe('anonymous access', () => {
	test('payroll slips require a session', async ({ request }) => {
		const res = await request.get('/api/payroll/slips?month=2019-01-01');
		expect(res.status()).toBe(401);
	});
});
