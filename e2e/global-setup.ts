import { closeDb, rows } from './lib/db';
import { cleanupFixtures, E2E_MONTH, seedFixtures } from './lib/fixtures';

/**
 * Global setup: purge leftovers from the previous run, refuse to touch a month
 * that is already locked by real data, then seed the fixture namespace.
 */
export default async function globalSetup(): Promise<void> {
	try {
		await cleanupFixtures();

		const existingRun = await rows<{ status: string }>(
			`SELECT status FROM payroll_runs
        WHERE month = 1 AND year = 2019 AND run_number = 1`
		);
		if (existingRun.length > 0) {
			throw new Error(
				`E2E month ${E2E_MONTH} already has a payroll run (status: ${existingRun[0].status}). ` +
					'Point the harness at another month instead of touching real payroll data.'
			);
		}

		const seeded = await seedFixtures();
		console.log(
			`[e2e] fixtures seeded for ${E2E_MONTH} (admin #${seeded.adminUserId}, ` +
				`worker employee #${seeded.workerEmployeeId}, zero-hours employee #${seeded.zeroHoursEmployeeId})`
		);
	} finally {
		await closeDb();
	}
}
