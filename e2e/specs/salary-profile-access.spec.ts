import { test } from '../support/test.ts';
import {
	readSalaryProfilesState,
	type SalaryProfilesFixture,
} from '../fixtures/salary-profiles.ts';
import {
	expectDirtyNavigationGuard,
	expectNoSalaryWrites,
	expectReadOnlySalaryHistory,
	expectSeededUsedAgreementState,
	expectZeroAgreementState,
	expectExplicitZeroAgreement,
	signInAsEditor,
	signInAsReader,
} from '../support/salary-profile-journey.ts';

// The owned Next dev server compiles routes on first visit. Every assertion
// still waits for its observable result; this only bounds compilation time.
test.setTimeout(300_000);

// Actor: Payroll reader whose role grants exactly payroll:read.
// Starting state: Fixture Employee with one current agreement already recorded as used by payroll.
// Action: Sign in through /signin and open that Employee's salary editor.
// Proof: Salary history shows the exact persisted agreement as used and read-only, no write control exists, and every salary row is unchanged.
test('a read-only payroll role sees used salary history without write controls', async ({
	page,
	db,
	runtime,
	salaryProfiles,
}) => {
	const fixture: SalaryProfilesFixture = salaryProfiles;
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	const before = await readSalaryProfilesState(db, fixture);
	expectSeededUsedAgreementState(before, fixture);

	await signInAsReader(page, fixture);
	await expectReadOnlySalaryHistory(page, fixture, runtime.artifactsDir);

	const after = await readSalaryProfilesState(db, fixture);
	expectNoSalaryWrites(before, after);
});

// Actor: Payroll editor with payroll read/create/update/delete and no employees:*.
// Starting state: Fixture Employee with a stored monthly agreement whose CTC is exactly zero and whose legacy amounts are unset.
// Action: Sign in through /signin and open that Employee's salary editor at the seeded zero month.
// Proof: The estimate reads ₹0.00 as a recorded CTC rather than "not recorded", and the stored zero row stays exact with no use or slip.
test('a stored zero CTC reads as a recorded amount, not missing terms', async ({
	page,
	db,
	salaryProfiles,
}) => {
	const fixture: SalaryProfilesFixture = salaryProfiles;
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	const before = await readSalaryProfilesState(db, fixture);
	expectZeroAgreementState(before, fixture);

	await signInAsEditor(page, fixture);
	await expectExplicitZeroAgreement(page, fixture);

	const after = await readSalaryProfilesState(db, fixture);
	expectNoSalaryWrites(before, after);
});

// Actor: Payroll editor with payroll read/create/update/delete.
// Starting state: Fixture Employee with a current agreement already used by payroll and no saved draft.
// Action: Open New Salary Revision, change the CTC, press Browser Back then Stay, then leave through the Payroll menu and accept the discard confirm.
// Proof: Back raises the in-app prompt and Stay keeps the draft, the in-app link asks the exact confirm once, and leaving persists no agreement, audit, use, slip or timeline change.
test('an unsaved salary draft is guarded on Back and in-app navigation without writes', async ({
	page,
	db,
	salaryProfiles,
}) => {
	const fixture: SalaryProfilesFixture = salaryProfiles;
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	const before = await readSalaryProfilesState(db, fixture);
	expectSeededUsedAgreementState(before, fixture);

	await signInAsEditor(page, fixture);
	await expectDirtyNavigationGuard(page, fixture);

	const after = await readSalaryProfilesState(db, fixture);
	expectNoSalaryWrites(before, after);
});
