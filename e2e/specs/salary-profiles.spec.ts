import { test, expect } from '../support/test.ts';
import {
	readSalaryProfilesState,
	type SalaryProfilesFixture,
} from '../fixtures/salary-profiles.ts';
import {
	cancelScheduledSalaryRevision,
	captureDesktopAndMobileEditor,
	correctUnusedAgreementWithConflict,
	createInitialSalaryAgreement,
	createScheduledSalaryRevision,
	expectCancelledState,
	expectCorrectedState,
	expectCreatedState,
	expectEarlierSlipUnchanged,
	expectExplicitZeroAgreement,
	expectDirtyNavigationGuard,
	expectFixtureDirectory,
	expectGeneratedState,
	expectInitialState,
	expectMissingSalaryEditor,
	expectReadOnlySalaryView,
	expectRevisionState,
	expectUsedAgreementProtection,
	expectZeroAgreementState,
	generateSingleEmployeePayrollThroughBrowser,
	openEmployeeFromDirectory,
	openSalaryProfilesThroughPayrollMenu,
	searchDirectory,
	refreshSalarySession,
	signInAsEditor,
} from '../support/salary-profile-journey.ts';

// The owned Next dev server compiles routes on first visit. Every assertion
// still waits for its observable result; this only bounds compilation time.
test.setTimeout(300_000);

test('salary profiles support a real correction, payroll protection and revision', async ({
	page,
	browser,
	db,
	salaryProfiles,
}) => {
	const fixture: SalaryProfilesFixture = salaryProfiles;
	const initial = await readSalaryProfilesState(db, fixture);
	expectInitialState(initial, fixture);

	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await signInAsEditor(page, fixture);
	await openSalaryProfilesThroughPayrollMenu(page);
	await expectFixtureDirectory(page, fixture);

	await openEmployeeFromDirectory(
		page,
		fixture,
		fixture.employees.noProfile.id
	);
	await expectMissingSalaryEditor(page, fixture);

	const created = await createInitialSalaryAgreement(page, fixture);
	const afterCreate = await readSalaryProfilesState(db, fixture);
	expectCreatedState(afterCreate, fixture, created);

	// Payroll filter after creation: the newly created Payroll agreement is
	// present and the Contract agreement remains outside this stream.
	await page.goto(
		`/admin/payroll/salary-profiles?date=${fixture.asOfDate}&stream=payroll`
	);
	await expect(
		page.getByRole('heading', { name: 'Salary Profiles', exact: true })
	).toBeVisible();
	await searchDirectory(page, fixture.searchToken);
	const masterRow = page.locator('li').filter({
		has: page.getByRole('link', {
			name: `Open salary profile for ${fixture.employees.noProfile.fullName} (${fixture.employees.noProfile.employeeCode})`,
			exact: true,
		}),
	});
	await expect(masterRow).toContainText('Payroll');
	await expect(masterRow).toContainText('₹50,000.00');
	await expect(
		page.locator('li').filter({
			has: page.getByRole('link', {
				name: `Open salary profile for ${fixture.employees.contract.fullName} (${fixture.employees.contract.employeeCode})`,
				exact: true,
			}),
		})
	).toHaveCount(0);
	await expect(
		page.locator('li').filter({
			has: page.getByRole('link', {
				name: `Open salary profile for ${fixture.employees.zero.fullName} (${fixture.employees.zero.employeeCode})`,
				exact: true,
			}),
		})
	).toHaveCount(0);
	await openEmployeeFromDirectory(
		page,
		fixture,
		fixture.employees.noProfile.id
	);

	const corrected = await correctUnusedAgreementWithConflict(page, fixture);
	const afterCorrection = await readSalaryProfilesState(db, fixture);
	expectCorrectedState(afterCorrection, fixture, created, corrected);

	// Each phase gets its own session budget; the limiter is per session.
	await refreshSalarySession(page, fixture);
	await generateSingleEmployeePayrollThroughBrowser(page, fixture);
	const afterGeneration = await readSalaryProfilesState(db, fixture);
	expectGeneratedState(afterGeneration, fixture, corrected);

	await expectUsedAgreementProtection(page, fixture);
	const afterUsedRead = await readSalaryProfilesState(db, fixture);
	expect(afterUsedRead.slips).toEqual(afterGeneration.slips);
	expect(afterUsedRead.agreements).toEqual(afterGeneration.agreements);
	expect(afterUsedRead.uses).toEqual(afterGeneration.uses);

	const revision = await createScheduledSalaryRevision(page, fixture);
	const afterRevision = await readSalaryProfilesState(db, fixture);
	expectRevisionState(
		afterRevision,
		fixture,
		corrected,
		revision,
		afterGeneration
	);

	const cancelled = await cancelScheduledSalaryRevision(page, fixture);
	const afterCancellation = await readSalaryProfilesState(db, fixture);
	expectCancelledState(
		afterCancellation,
		fixture,
		corrected,
		revision,
		cancelled,
		afterRevision
	);
	expect(afterCancellation.leaveSummaries).toEqual(initial.leaveSummaries);

	await refreshSalarySession(page, fixture);
	await expectEarlierSlipUnchanged(page, db, fixture);
	await expectReadOnlySalaryView(browser, page, fixture);
	await expectExplicitZeroAgreement(page, fixture);
	const zeroState = await readSalaryProfilesState(db, fixture);
	expectZeroAgreementState(zeroState, fixture);

	await captureDesktopAndMobileEditor(page, fixture);
	await expectDirtyNavigationGuard(page, fixture);
	const afterDirtyNavigation = await readSalaryProfilesState(db, fixture);
	expect(afterDirtyNavigation.agreements).toEqual(afterCancellation.agreements);
	expect(afterDirtyNavigation.slips).toEqual(afterCancellation.slips);
	expect(afterDirtyNavigation.uses).toEqual(afterCancellation.uses);
	expect(afterDirtyNavigation.audits).toEqual(afterCancellation.audits);
	expect(afterDirtyNavigation.leaveSummaries).toEqual(
		afterCancellation.leaveSummaries
	);
});
