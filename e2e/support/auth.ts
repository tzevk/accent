import type { Page } from '@playwright/test';

export interface E2ECredentials {
	username: string;
	password: string;
}

/**
 * Sign in through the real /signin form and wait for the dashboard redirect.
 * There is no test-only authentication bypass; fixtures must seed an ordinary
 * active user with a bcrypt password and let the application create the session.
 */
export async function signInThroughUi(
	page: Page,
	credentials: E2ECredentials
): Promise<void> {
	await page.goto('/signin');
	await page.getByLabel('Username or Email', { exact: true }).fill(credentials.username);
	await page.getByLabel('Password', { exact: true }).fill(credentials.password);
	await page.getByRole('button', { name: 'Sign In', exact: true }).click();
	await page.waitForURL(/\/(?:admin|user)\/dashboard/, { timeout: 30_000 });
}
