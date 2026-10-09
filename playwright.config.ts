import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV } from './e2e/lib/env';

/**
 * E2E harness (Playwright).
 *
 * Boots the production build (`next build` first: `npm run e2e`) with the
 * database credentials mapped onto the PROD_DB_* vars the app reads when
 * NODE_ENV=production, then drives real flows through the browser and the
 * API. Every flow writes a JSON artifact under e2e/artifacts/.
 */
export default defineConfig({
	testDir: 'e2e',
	outputDir: 'test-results',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: [['list'], ['html', { open: 'never' }]],
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: E2E_ENV.baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	projects: [
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/,
		},
		{
			name: 'chromium',
			testMatch: /.*\.spec\.ts/,
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'e2e/.auth/admin.json',
			},
		},
	],
	webServer: {
		command: `npx next start -p ${E2E_ENV.port}`,
		url: `${E2E_ENV.baseURL}/signin`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			...Object.fromEntries(
				Object.entries(process.env).filter(
					(entry): entry is [string, string] => entry[1] !== undefined
				)
			),
			NODE_ENV: 'production',
			DB_HOST: E2E_ENV.db.host,
			DB_PORT: String(E2E_ENV.db.port),
			PROD_DB_NAME: E2E_ENV.db.name,
			PROD_DB_USER: E2E_ENV.db.user,
			PROD_DB_PASSWORD: E2E_ENV.db.password,
			DB_SSL_MODE:
				process.env.E2E_DB_SSL_MODE ||
				process.env.DB_SSL_MODE ||
				(E2E_ENV.db.host.includes('.aivencloud.com') ? 'require' : 'off'),
		},
	},
});
