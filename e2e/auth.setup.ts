import { test as setup } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN_USER, EMPLOYEE_USER } from './lib/fixtures';

/**
 * Authenticates the two fixture accounts once and stores their cookie jars, so
 * specs start signed in (admin by default; the RBAC spec swaps in the employee
 * state). Uses the real sign-in page, including its redirect and cookie flow.
 */
async function signIn(
	page: Page,
	user: { email: string; password: string },
	landing: string
): Promise<void> {
	await page.goto('/signin');
	await page.locator('#email').fill(user.email);
	await page.locator('input[type="password"]').fill(user.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL(`**${landing}`);
}

setup('authenticate admin', async ({ page }) => {
	await signIn(page, ADMIN_USER, '/admin/dashboard');
	await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('authenticate employee', async ({ page }) => {
	await signIn(page, EMPLOYEE_USER, '/user/dashboard');
	await page.context().storageState({ path: 'e2e/.auth/employee.json' });
});
