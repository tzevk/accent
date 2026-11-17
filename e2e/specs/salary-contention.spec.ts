/**
 * Issue #446 — deterministic Salary Profiles contention proof.
 *
 * These tests run under the owned `npm run test:e2e` harness: the disposable
 * MariaDB database, migrations, fixture hooks and owned Next process all belong
 * to that harness. The browser is not involved; the scenarios drive the exported
 * salary command, generation and durable-use seams over separate real
 * connections and prove the transactional ordering with observed InnoDB lock
 * waits rather than sleeps or simultaneous-promise luck.
 *
 * Every scenario starts its salary-write transactions with the production
 * `beginSalaryWriteTransaction` protocol (explicit per-transaction READ
 * COMMITTED), the same protocol the salary routes, generation, finalization and
 * use backfill use, and fails closed if the server did not apply it.
 */
import { test } from '../support/test.ts';
import {
	runCorrectionBeforeGeneration,
	runFailureRollback,
	runGenerationBeforeCorrection,
	runLegacyOnboarding,
	runSameVersionDifferentMonths,
	runSlipDeletionReopen,
} from '../support/salary-contention/index.ts';

test.setTimeout(180_000);

test.describe('salary profile contention on the owned MariaDB target', () => {
	test('a committed correction is the agreement blocked generation records', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runCorrectionBeforeGeneration({ db, runtime, namespace });
	});

	test('a committed generation use makes the blocked correction conflict', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runGenerationBeforeCorrection({ db, runtime, namespace });
	});

	test('one expected version accepts exactly one different-month mutation', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runSameVersionDifferentMonths({ db, runtime, namespace });
	});

	test('slip deletion and run reopen cannot unlock a used future month', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runSlipDeletionReopen({ db, runtime, namespace });
	});

	test('required audit and durable-use failures roll back their whole transaction', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runFailureRollback({ db, runtime, namespace });
	});

	test('legacy-only onboarding cannot backdate a historical initial agreement', async ({
		db,
		runtime,
		namespace,
	}) => {
		await runLegacyOnboarding({ db, runtime, namespace });
	});
});
