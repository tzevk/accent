import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
	throw new Error(
		'[e2e] E2E_BASE_URL is not set. Run "npm run test:e2e" so the owned harness starts the disposable database and app server.'
	);
}

// The harness publishes E2E_ARTIFACTS_DIR to every Playwright process. A
// full-suite group run points it at that group's directory; focused local
// invocations keep the historical shared e2e/artifacts locations.
const artifactsDir = process.env.E2E_ARTIFACTS_DIR ?? './e2e/artifacts';

export default defineConfig({
	testDir: './e2e/specs',
	outputDir: path.join(artifactsDir, 'test-results'),
	timeout: 90_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		['list'],
		[
			'html',
			{ outputFolder: path.join(artifactsDir, 'html-report'), open: 'never' },
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
