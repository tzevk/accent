import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
	throw new Error(
		'[e2e] E2E_BASE_URL is not set. Run "npm run test:e2e" so the owned harness starts the disposable database and app server.'
	);
}

export default defineConfig({
	testDir: './e2e/specs',
	outputDir: './e2e/artifacts/test-results',
	timeout: 90_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		['list'],
		[
			'html',
			{ outputFolder: './e2e/artifacts/html-report', open: 'never' },
		],
	],
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
