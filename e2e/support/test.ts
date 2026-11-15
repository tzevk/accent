import { expect, test as base } from '@playwright/test';
import type { Connection } from 'mysql2/promise';
import {
	fixtureNamespace,
	parseE2ERuntime,
	type E2ERuntime,
} from '../../scripts/e2e/contracts.ts';
import { connectFixtureReader } from './runtime.ts';

export interface E2EWorkerFixtures {
	runtime: E2ERuntime;
	/** Independent mysql2 reader; the fixture closes it after the worker ends. */
	db: Connection;
}

export interface E2ETestFixtures {
	/** `E2E-<issue>-<run>-<worker>`. */
	namespace: string;
}

/**
 * The only supported Playwright entry point for the financial smoke journey.
 * It fails closed when the owned orchestrator did not publish E2E_* values.
 */
export const test = base.extend<E2ETestFixtures, E2EWorkerFixtures>({
	runtime: [
		async ({}, use) => {
			await use(parseE2ERuntime());
		},
		{ scope: 'worker' },
	],
	db: [
		async ({ runtime }, use) => {
			const connection = await connectFixtureReader(runtime);
			try {
				await use(connection);
			} finally {
				await connection.end();
			}
		},
		{ scope: 'worker' },
	],
	namespace: async ({ runtime }, use, testInfo) => {
		await use(fixtureNamespace(runtime.runTag, testInfo.workerIndex));
	},
});

export { expect };
