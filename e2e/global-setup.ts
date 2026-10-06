import {
	cleanupAttendanceFixtures,
	seedAttendanceFixtures,
} from './lib/attendance-fixtures';
import { deleteArtifact } from './lib/artifacts';
import { closeDb, exec, rows } from './lib/db';
import {
	cleanupExpenditureCurrencyFixtures,
	seedExpenditureCurrencyFixtures,
} from './lib/expenditure-currency-fixtures';
import {
	cleanupExpenditureFixtures,
	seedExpenditureFixtures,
} from './lib/expenditure-fixtures';
import { cleanupFixtures, E2E_MONTH, seedFixtures } from './lib/fixtures';
import {
	cleanupUtilizationFixtures,
	seedUtilizationFixtures,
} from './lib/utilization-fixtures';

/**
 * Global setup: purge leftovers from the previous run, refuse to touch a month
 * that is already locked by real data, then seed the fixture namespace.
 */
export default async function globalSetup(): Promise<void> {
	try {
		await cleanupFixtures();
		await cleanupAttendanceFixtures();
		await cleanupUtilizationFixtures();
		await cleanupExpenditureFixtures();
		await cleanupExpenditureCurrencyFixtures();

		// The proxy counts `auth` requests in MySQL fixed windows keyed by the
		// trusted IP header; browser sign-ins carry no such header, so they land
		// under the shared `unknown:anon:auth` bucket. Clear it so repeated runs
		// inside the same 15-minute window start from zero (the harness makes
		// fewer than 10 unauthenticated logins per run; specs that need their own
		// budget set the header and purge their own rows).
		await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
			'%:anon:auth',
		]);

		// The stored-xss spec persists its coverage into its own artifact as it
		// runs (Playwright restarts the worker after a failure, which wipes
		// module state) and reads it back to assert every write path was
		// covered. The file must start empty each run, or a previous run's
		// coverage would mask a path this run never exercised.
		deleteArtifact('security-stored-xss');

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
				`worker employee #${seeded.workerEmployeeId}, zero-hours employee #${seeded.zeroHoursEmployeeId}, ` +
				`bonus employees #${seeded.bonusEmployeeId}/#${seeded.zeroBonusEmployeeId}/#${seeded.contractBonusEmployeeId}/#${seeded.lateBonusEmployeeId}, ` +
				`preview employee #${seeded.previewBonusEmployeeId})`
		);

		const attendance = await seedAttendanceFixtures();
		console.log(
			`[e2e] attendance fixtures seeded for ${attendance.month} ` +
				`(${attendance.employees} employees, ${attendance.punches} punches, ` +
				`${attendance.attendance} attendance rows, ` +
				`${attendance.assignments} assignments, ` +
				`${attendance.profiles} salary profiles)`
		);

		const utilization = await seedUtilizationFixtures();
		console.log(
			`[e2e] utilization fixtures seeded for ${utilization.month} ` +
			`(${utilization.employees} employees, ${utilization.attendance} attendance rows, ` +
				`${utilization.assignments} assignments, ` +
				`${utilization.loggedDays} logged days, ` +
				`${utilization.linkedUsers} linked user accounts, ` +
				`${utilization.activityLogs} activity logs, ` +
				`${utilization.screenTimeDays} screen-time days, ` +
				`${utilization.holidays} optional holiday, ` +
				`${utilization.profiles} salary profiles)`
		);

		const expenditure = await seedExpenditureFixtures();
		console.log(
			`[e2e] expenditure fixtures seeded for ${expenditure.month} and ${expenditure.nextMonth} ` +
				`(${expenditure.costs} direct costs, ` +
				`${Object.keys(expenditure.projects).length} projects)`
		);

		const currency = await seedExpenditureCurrencyFixtures();
		console.log(
			`[e2e] expenditure currency fixtures seeded for ${currency.months.join(', ')} ` +
				`(${currency.costs} direct costs, ` +
				`${Object.keys(currency.projects).length} projects)`
		);
	} finally {
		await closeDb();
	}
}
