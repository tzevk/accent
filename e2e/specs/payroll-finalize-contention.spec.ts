/**
 * Payroll finalization vs unrelated fixture teardown on the owned MariaDB
 * target.
 *
 * This is the browser-free regression for the CI deadlock whose roster INSERT
 * failed with ER_LOCK_DEADLOCK while a parallel payroll-run fixture was torn
 * down. It runs in its own full-suite group because the finalization read holds
 * the global sorted Employee/Salary-Profile locks and writes one roster row;
 * sharing a database with the browser payroll journeys would recreate the
 * contention this test exists to prove deterministically.
 */
import { test } from '../support/test.ts';
import { runFinalizeAgainstFixtureTeardown } from '../support/salary-contention/index.ts';

test.setTimeout(180_000);

test.describe('payroll finalization on the owned MariaDB target', () => {
	test('roster snapshot save and an unrelated fixture teardown cannot deadlock', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runFinalizeAgainstFixtureTeardown({ db, runtime, namespace });
	});
});
