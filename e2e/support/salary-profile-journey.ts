/**
 * Journey helpers for the #447 Salary Profiles browser proof.
 *
 * The spec keeps the business sequence readable; these helpers own only the
 * mechanics and the independent persistence assertions. Every selector is a
 * user-facing role, label or visible text. No helper starts a server, seeds a
 * database outside the Playwright fixtures, or bypasses normal sign-in.
 */
import {
	expect,
	type Browser,
	type Dialog,
	type Page,
	type Response,
} from '@playwright/test';
import type { Connection } from 'mysql2/promise';
import {
	CORRECTED_CTC,
	INITIAL_CTC,
	REVISION_CTC,
	readSalaryProfilesState,
	type SalaryAgreementRow,
	type SalaryProfilesFixture,
	type SalaryProfilesState,
} from '../fixtures/salary-profiles.ts';
import { signInThroughUi, type E2ECredentials } from './auth.ts';
import { guardPayrollWrites } from './payroll-review-journey.ts';

export interface SalaryCommandResult {
	operation: string;
	agreement_id: number;
	timeline_version: number;
	classification: string;
	effective_from: string;
	effective_to: string | null;
}

interface SalaryCommandBody {
	success: boolean;
	data: SalaryCommandResult;
	error?: string;
	code?: string;
}

interface SingleGenerationBody {
	success: boolean;
	message?: string;
	data?: {
		id?: number;
		employee_id?: number;
		month?: string;
		ctc_used?: number;
	};
	error?: string;
	code?: string;
}

interface SalaryTimelineBody {
	success: boolean;
	data: {
		timeline_version: number;
		agreements: Array<{
			agreement_id: number;
			classification: 'current' | 'scheduled' | 'previous' | 'cancelled';
		}>;
	};
	error?: string;
}

interface ExpectedSalaryCommand {
	operation: 'create-initial' | 'correct' | 'revise' | 'cancel';
	/**
	 * The command classifies the row against the server date (today). The
	 * fixture's payroll months are 2032-2035, so a row that covers that month is
	 * still "scheduled" from the server's point of view.
	 */
	classification: 'current' | 'scheduled' | 'previous' | 'cancelled';
	/**
	 * The editor's follow-up timeline read classifies against its as-of date
	 * (the fixture month), where the same row is already the covering agreement.
	 */
	asOfClassification: 'current' | 'scheduled' | 'previous' | 'cancelled';
}

function isSalaryProfileCommand(response: Response): boolean {
	const url = new URL(response.url());
	return (
		response.request().method() === 'POST' &&
		url.pathname === '/api/payroll/salary-profile'
	);
}

function isSalaryTimelineReadFor(
	response: Response,
	employeeId: number
): boolean {
	if (response.request().method() !== 'GET') return false;
	const url = new URL(response.url());
	return (
		url.pathname === '/api/payroll/salary-profile' &&
		url.searchParams.get('employee_id') === String(employeeId)
	);
}

function isDirectoryResponse(response: Response): boolean {
	return (
		new URL(response.url()).pathname === '/api/payroll/employees-with-profiles'
	);
}

function directoryResponseFor(
	response: Response,
	params: Record<string, string>
): boolean {
	if (!isDirectoryResponse(response) || response.request().method() !== 'GET') {
		return false;
	}
	const url = new URL(response.url());
	return Object.entries(params).every(
		([key, value]) => url.searchParams.get(key) === value
	);
}

/**
 * The app's query client keeps directory results fresh for 30 seconds, so
 * switching back to a combination already loaded in this session renders from
 * cache with no request at all. Track the combinations this page has fetched
 * and only wait for a response that will actually happen.
 */
const seenDirectoryKeys = new WeakMap<Page, Set<string>>();
const trackedDirectoryPages = new WeakSet<Page>();
const DIRECTORY_STREAMS = ['all', 'payroll', 'contract', 'missing'] as const;

function directoryKey(date: string, search: string, stream: string): string {
	return `${date}|${search.trim()}|${stream}`;
}

function trackDirectoryResponses(page: Page): Set<string> {
	let keys = seenDirectoryKeys.get(page);
	if (keys === undefined) {
		keys = new Set<string>();
		seenDirectoryKeys.set(page, keys);
	}
	if (!trackedDirectoryPages.has(page)) {
		trackedDirectoryPages.add(page);
		const recorded = keys;
		page.on('response', (response) => {
			if (!isDirectoryResponse(response)) return;
			const url = new URL(response.url());
			recorded.add(
				directoryKey(
					url.searchParams.get('date') ?? '',
					url.searchParams.get('search') ?? '',
					url.searchParams.get('stream') ?? 'all'
				)
			);
		});
	}
	return keys;
}

async function currentStream(page: Page): Promise<string> {
	const pressed = await Promise.all(
		DIRECTORY_STREAMS.map(async (stream) =>
			(await page
				.getByRole('button', {
					name:
						stream === 'missing'
							? 'Missing Profile'
							: stream === 'all'
								? 'All'
								: stream.charAt(0).toUpperCase() + stream.slice(1),
					exact: true,
				})
				.getAttribute('aria-pressed')) === 'true'
				? stream
				: null
		)
	);
	return pressed.find((stream) => stream !== null) ?? 'all';
}

async function expectedDirectoryKey(
	page: Page,
	stream: string
): Promise<string> {
	const date = await page
		.getByLabel('Agreements as of', { exact: true })
		.inputValue();
	const search = await page
		.getByLabel('Search employees', { exact: true })
		.inputValue();
	return directoryKey(date, search, stream);
}

function employeeEditorUrl(
	fixture: SalaryProfilesFixture,
	employeeId: number,
	date: string
): string {
	return `/admin/payroll/salary-profiles/${employeeId}?date=${encodeURIComponent(
		date
	)}`;
}

function directoryRow(
	page: Page,
	employee: { fullName: string; employeeCode: string }
) {
	return page.locator('li').filter({
		has: page.getByRole('link', {
			name: `Open salary profile for ${employee.fullName} (${employee.employeeCode})`,
			exact: true,
		}),
	});
}

function agreementFor(
	state: SalaryProfilesState,
	agreementId: number
): SalaryAgreementRow {
	const agreement = state.agreements.find((row) => row.id === agreementId);
	if (!agreement) {
		throw new Error(`Agreement ${agreementId} is not in the fixture state.`);
	}
	return agreement;
}

function agreementsFor(
	state: SalaryProfilesState,
	employeeId: number
): SalaryAgreementRow[] {
	return state.agreements.filter((row) => row.employeeId === employeeId);
}

function timelineVersion(
	state: SalaryProfilesState,
	employeeId: number
): number {
	return (
		state.timelines.find((row) => row.employeeId === employeeId)?.version ?? 0
	);
}

function numeric(value: unknown): number {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		throw new Error(
			`Expected a finite number, received ${JSON.stringify(value)}`
		);
	}
	return number;
}

function previousDay(date: string): string {
	const [year, month, day] = date.split('-').map(Number);
	const value = new Date(Date.UTC(year, month - 1, day));
	value.setUTCDate(value.getUTCDate() - 1);
	return value.toISOString().slice(0, 10);
}

/* ── identities and workspace entry ────────────────────────────────── */

const DAILY_ACTIVITY_HEADING = 'Activity Update Required';
const UNSAVED_SALARY_CONFIRM =
	'You have unsaved salary changes. Leave this page and discard them?';

/**
 * The signed-in user's own dashboard mounts a one-per-session "Activity Update
 * Required" overlay when an assigned activity has no daily entry for today.
 * The fixture's in-progress activity has pending entries, so a fresh sign-in
 * session really sees it. It is a native modal <dialog>, which makes the rest
 * of the page inert and blocks the Admin menu, so it must be dismissed before
 * any workspace interaction.
 *
 * The prompt is decided by the dashboard's tier-1 activity read and mounts with
 * the dashboard shell, so this waits for that shell and then dismisses through
 * the prompt's own button. Nothing sleeps: when the fixture has no pending
 * entries the prompt is simply absent and the helper is a no-op. Only
 * /user/dashboard can render this overlay (the Admin dashboard is a different
 * component), so every other route returns immediately — which keeps the call
 * safe after any full navigation that could land back on the dashboard.
 */
export async function dismissDailyActivityPrompt(page: Page): Promise<void> {
	if (!/^\/user\/dashboard\/?$/.test(new URL(page.url()).pathname)) return;

	// The shell paints only after the tier-1 activity read settled, which is the
	// same update that decides whether the overlay opens.
	await expect(
		page.getByRole('navigation', { name: 'Breadcrumb' })
	).toBeVisible();

	const prompt = page.getByRole('dialog').filter({
		hasText: DAILY_ACTIVITY_HEADING,
	});
	if ((await prompt.count()) === 0) return;
	await prompt
		.getByRole('button', { name: 'Remind Later', exact: true })
		.click();
	await expect(prompt).toBeHidden();
}

export async function signInAsEditor(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await signInThroughUi(page, credentials(fixture.editor));
	await expect(page).toHaveURL(/\/user\/dashboard/);
	await dismissDailyActivityPrompt(page);
}

/**
 * The proxy's API budget is per session, and this owned journey is denser than
 * a human session (dev double renders plus notification polling). A fresh
 * sign-in gives the next phase its own documented budget instead of sleeping
 * through a throttle or weakening the limiter.
 */
export async function refreshSalarySession(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await page.context().clearCookies();
	await signInAsEditor(page, fixture);
}

function credentials(identity: {
	username: string;
	password: string;
}): E2ECredentials {
	return { username: identity.username, password: identity.password };
}

/**
 * A payroll-only, non-admin session must see the Payroll group and reach the
 * workspace without being shown unrelated Admin groups. The menu is the real
 * navigation path, not a direct URL jump.
 */
export async function openSalaryProfilesThroughPayrollMenu(
	page: Page
): Promise<void> {
	await expect(
		page.getByRole('button', { name: 'Admin', exact: true })
	).toBeVisible();
	// The Admin control opens on mouseenter and toggles on click; a click after
	// the hover would close it again. A pointer user opens it by hovering.
	await page.getByRole('button', { name: 'Admin', exact: true }).hover();
	// Scope to the flyout: the persistent admin sidebar legitimately lists every
	// master and report, so a page-wide count would prove nothing about the menu.
	const flyout = page.locator('.admin-dropdown');
	await expect(
		flyout.getByRole('button', { name: 'Payroll', exact: true })
	).toBeVisible();
	await expect(
		flyout.getByRole('button', { name: 'Cash & Expenses', exact: true })
	).toHaveCount(0);
	await expect(
		flyout.getByRole('link', { name: 'User Master', exact: true })
	).toHaveCount(0);
	// The group list works the same way: hover flies out the item column.
	await flyout.getByRole('button', { name: 'Payroll', exact: true }).hover();
	const salaryProfiles = flyout.getByRole('link', {
		name: 'Salary Profiles',
		exact: true,
	});
	await expect(salaryProfiles).toBeVisible();
	await salaryProfiles.click();
	await expect(
		page.getByRole('heading', { name: 'Salary Profiles', exact: true })
	).toBeVisible();
}

/* ── directory ─────────────────────────────────────────────────────── */

export async function chooseDirectoryDate(
	page: Page,
	date: string
): Promise<void> {
	const seen = trackDirectoryResponses(page);
	const stream = await currentStream(page);
	const search = await page
		.getByLabel('Search employees', { exact: true })
		.inputValue();
	const willFetch = !seen.has(directoryKey(date, search, stream));
	const response = willFetch
		? page.waitForResponse((candidate) =>
				directoryResponseFor(candidate, { date })
			)
		: null;
	await page.getByLabel('Agreements as of', { exact: true }).fill(date);
	await response;
}

export async function searchDirectory(
	page: Page,
	value: string
): Promise<void> {
	const seen = trackDirectoryResponses(page);
	const stream = await currentStream(page);
	const date = await page
		.getByLabel('Agreements as of', { exact: true })
		.inputValue();
	const willFetch = !seen.has(directoryKey(date, value, stream));
	const response = willFetch
		? page.waitForResponse((candidate) =>
				directoryResponseFor(candidate, { search: value })
			)
		: null;
	await page.getByLabel('Search employees', { exact: true }).fill(value);
	await response;
}

export async function chooseDirectoryStream(
	page: Page,
	label: 'All' | 'Payroll' | 'Contract' | 'Missing Profile',
	stream: 'all' | 'payroll' | 'contract' | 'missing'
): Promise<void> {
	const button = page.getByRole('button', { name: label, exact: true });
	if ((await button.getAttribute('aria-pressed')) === 'true') return;
	const seen = trackDirectoryResponses(page);
	const willFetch = !seen.has(await expectedDirectoryKey(page, stream));
	const response = willFetch
		? page.waitForResponse((candidate) => {
				if (!isDirectoryResponse(candidate)) return false;
				const url = new URL(candidate.url());
				return stream === 'all'
					? !url.searchParams.has('stream')
					: url.searchParams.get('stream') === stream;
			})
		: null;
	await button.click();
	await expect(button).toHaveAttribute('aria-pressed', 'true');
	await response;
}

/**
 * Search the namespaced directory and prove all three filters plus the
 * Employee-Type versus Salary-Type separation. The missing Employee has a
 * non-Payroll Employee Type; the Contract agreement belongs to a Payroll
 * Employee Type.
 */
export async function expectFixtureDirectory(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await chooseDirectoryStream(page, 'All', 'all');
	await chooseDirectoryDate(page, fixture.asOfDate);
	await searchDirectory(page, fixture.searchToken);

	const missing = directoryRow(page, fixture.employees.noProfile);
	const contract = directoryRow(page, fixture.employees.contract);
	const zero = directoryRow(page, fixture.employees.zero);

	await expect(missing).toHaveCount(1);
	await expect(contract).toHaveCount(1);
	await expect(zero).toHaveCount(1);
	await expect(missing).toContainText('No salary profile');
	await expect(missing).toContainText('Employee Type: Deputation');
	await expect(contract).toContainText('Contract');
	await expect(contract).toContainText('Employee Type: Payroll');
	await expect(contract).toContainText('₹45,000.00');
	await expect(zero).toContainText('No salary profile');

	await chooseDirectoryStream(page, 'Missing Profile', 'missing');
	await expect(missing).toBeVisible();
	await expect(contract).toHaveCount(0);
	await expect(zero).toBeVisible();

	await chooseDirectoryStream(page, 'Contract', 'contract');
	await expect(contract).toBeVisible();
	await expect(missing).toHaveCount(0);

	await chooseDirectoryStream(page, 'All', 'all');
	await expect(missing).toBeVisible();
	await page.screenshot({
		path: 'e2e/artifacts/salary-profiles-list-desktop.png',
		fullPage: true,
	});
}

export async function openEmployeeFromDirectory(
	page: Page,
	fixture: SalaryProfilesFixture,
	employeeId: number
): Promise<void> {
	const employee =
		employeeId === fixture.employees.contract.id
			? fixture.employees.contract
			: employeeId === fixture.employees.zero.id
				? fixture.employees.zero
				: fixture.employees.noProfile;
	await directoryRow(page, employee)
		.getByRole('link', {
			name: 'Open profile',
			exact: true,
		})
		.click();
	await expect(page).toHaveURL(
		new RegExp(`/admin/payroll/salary-profiles/${employeeId}\\?date=`)
	);
	await expect(
		page.getByRole('heading', { name: employee.fullName, exact: true })
	).toBeVisible();
}

/* ── create, correct, conflict ─────────────────────────────────────── */

/**
 * The missing Employee's editor must distinguish "no agreement" from "zero":
 * there is no recorded CTC and no estimate, not a fabricated ₹0.00.
 */
export async function expectMissingSalaryEditor(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await expect(
		page.getByRole('heading', { name: 'No salary agreement', exact: true })
	).toBeVisible();
	await expect(page.getByText(/No agreement covers/).first()).toBeVisible();
	await expect(
		page.getByText(/No monthly CTC is recorded on this agreement/)
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Create Salary Profile', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Edit agreement', exact: true })
	).toHaveCount(0);
	await expect(
		page.getByText('Employee Type (directory category):')
	).toBeVisible();
	await expect(
		page.getByText(fixture.employees.noProfile.employeeType, { exact: true })
	).toBeVisible();
}

export async function createInitialSalaryAgreement(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<SalaryCommandResult> {
	await page
		.getByRole('button', { name: 'Create Salary Profile', exact: true })
		.click();

	const ctc = page.getByLabel('Monthly CTC', { exact: true });
	await expect(ctc).toBeEditable();
	await page
		.getByRole('button', { name: 'Review new agreement', exact: true })
		.click();
	await expect(page.getByText('Enter the monthly CTC')).toBeVisible();
	await expect(ctc).toBeFocused();

	await ctc.fill(String(INITIAL_CTC));
	await page.getByLabel('Standard daily hours', { exact: true }).fill('8');
	await page.getByLabel('PL entitlement (days)', { exact: true }).fill('21');
	await expect(page.getByLabel('Effective from', { exact: true })).toHaveValue(
		fixture.employees.noProfile.joiningDate
	);

	const estimate = page.getByRole('region', {
		name: 'Estimated pay breakdown',
	});
	await expect(estimate).toBeVisible();
	await expect(estimate).toContainText('Monthly CTC');
	await expect(estimate).toContainText('₹50,000.00');
	await expect(estimate).toContainText('Basis Hours =');
	await expect(estimate).toContainText(
		'Hourly Rate = Monthly CTC ÷ Basis Hours'
	);
	await expect(
		estimate.getByText(/Estimate only — not a generated Payroll Slip/)
	).toBeVisible();

	await page
		.getByRole('button', { name: 'Review new agreement', exact: true })
		.click();
	const review = page.getByRole('region', {
		name: 'Review new salary agreement',
	});
	await expect(review).toBeVisible();
	await expect(review).toContainText('₹50,000.00');

	const result = await saveSalaryCommand(page, fixture, 'Save new agreement', {
		operation: 'create-initial',
		classification: 'scheduled',
		asOfClassification: 'current',
	});
	await expect(page.getByText(/Salary Profile created/)).toBeVisible();
	return result;
}

/**
 * Two real editors holding the same expected timeline version: the first
 * correction commits, the second receives a stale-version conflict and keeps
 * its entered value. The same agreement identity is proven by the DB read in
 * the spec.
 */
export async function correctUnusedAgreementWithConflict(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<SalaryCommandResult> {
	const editorUrl = page.url();
	await page
		.getByRole('button', { name: 'Edit agreement', exact: true })
		.click();
	await expect(page.getByText('Editing: correction')).toBeVisible();
	await page
		.getByLabel('Monthly CTC', { exact: true })
		.fill(String(CORRECTED_CTC));

	const stale = await page.context().newPage();
	try {
		await stale.goto(editorUrl);
		await expect(
			stale.getByRole('button', { name: 'Edit agreement', exact: true })
		).toBeVisible();
		await stale
			.getByRole('button', { name: 'Edit agreement', exact: true })
			.click();
		await stale.getByLabel('Monthly CTC', { exact: true }).fill('53000');

		await page
			.getByRole('button', { name: 'Review correction', exact: true })
			.click();
		const corrected = await saveSalaryCommand(
			page,
			fixture,
			'Save correction',
			{
				operation: 'correct',
				classification: 'scheduled',
				asOfClassification: 'current',
			}
		);
		await expect(page.getByText(/Agreement corrected/)).toBeVisible();

		const conflictResponse = stale.waitForResponse((response) =>
			isSalaryProfileCommand(response)
		);
		await stale
			.getByRole('button', { name: 'Review correction', exact: true })
			.click();
		await stale
			.getByRole('button', { name: 'Save correction', exact: true })
			.click();
		const response = await conflictResponse;
		expect(response.status()).toBe(409);
		const body = (await response.json()) as SalaryCommandBody;
		expect(body.success).toBe(false);
		expect(body.code).toBe('stale_version');
		await expect(
			stale.getByRole('alert').filter({
				hasText: 'This salary timeline changed since you opened it.',
			})
		).toBeVisible();
		await expect(stale.getByLabel('Monthly CTC', { exact: true })).toHaveValue(
			'53000'
		);
		return corrected;
	} finally {
		await stale.close();
	}
}

/* ── generation and used protection ────────────────────────────────── */

/**
 * The Payroll Run page exposes only all-population Generate. Worker-M requires
 * the supported single-Employee mode so an unrelated CRUD fixture cannot block
 * this write, so the signed-in browser posts the route's documented
 * `employee_id` request (real handler and persistence, no mock) and the same
 * Payroll Run page then proves the persisted slip is visible. The exclusive
 * fixture month and production handler remain authoritative.
 */
export async function generateSingleEmployeePayrollThroughBrowser(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<SingleGenerationBody> {
	await page.goto('/admin/payroll');
	// Playwright matches role names against the whole accessible name; the
	// heading carries the month's run-status badge after "Payroll Run".
	await expect(
		page.getByRole('heading', { name: /^Payroll Run.*$/ })
	).toBeVisible();
	const initialSlips = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/slips' &&
			new URL(response.url()).searchParams.get('month') === fixture.month
	);
	await page.getByLabel('Month:', { exact: true }).fill(fixture.monthSlug);
	await expect(page.getByLabel('Month:', { exact: true })).toHaveValue(
		fixture.monthSlug
	);
	await initialSlips;

	const result = await page.evaluate(
		async (input: { employeeId: number; month: string }) => {
			const response = await fetch('/api/payroll/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					employee_id: input.employeeId,
					month: input.month,
				}),
			});
			return {
				status: response.status,
				body: (await response.json()) as SingleGenerationBody,
			};
		},
		{ employeeId: fixture.employees.noProfile.id, month: fixture.month }
	);
	expect(result.status).toBe(201);
	expect(result.body.success).toBe(true);
	expect(result.body.data?.employee_id).toBe(fixture.employees.noProfile.id);
	expect(String(result.body.data?.month)).toContain(fixture.monthSlug);

	// Re-read the real page so the proof is the visible persisted slip, not the
	// route response.
	await page.goto('/admin/payroll');
	await expect(
		page.getByRole('heading', { name: /^Payroll Run.*$/ })
	).toBeVisible();
	const generatedSlips = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/slips' &&
			new URL(response.url()).searchParams.get('month') === fixture.month
	);
	await page.getByLabel('Month:', { exact: true }).fill(fixture.monthSlug);
	await generatedSlips;
	await expect(
		page.getByRole('link', {
			name: fixture.employees.noProfile.fullName,
			exact: true,
		})
	).toBeVisible();
	return result.body;
}

export async function expectUsedAgreementProtection(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await page.goto(
		employeeEditorUrl(fixture, fixture.employees.noProfile.id, fixture.asOfDate)
	);
	await expect(
		page.getByRole('heading', {
			name: fixture.employees.noProfile.fullName,
			exact: true,
		})
	).toBeVisible();
	await expect(
		page.getByText('Used by payroll', { exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Edit agreement', exact: true })
	).toHaveCount(0);
	await expect(
		page.getByText(
			'Used by payroll. Editing is blocked so recorded payroll keeps its terms.'
		)
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'New Salary Revision', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Leave usage (read-only)', exact: true })
	).toBeVisible();
	await expect(
		page.getByText('PL used this year', { exact: true }).locator('..')
	).toContainText('2');
	await expect(
		page.getByText('PL entitlement stored', { exact: true }).locator('..')
	).toContainText('21');
}

/* ── revision and cancellation ─────────────────────────────────────── */

export async function createScheduledSalaryRevision(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<SalaryCommandResult> {
	await page
		.getByRole('button', { name: 'New Salary Revision', exact: true })
		.click();
	await expect(
		page.getByLabel('Revisions start month', { exact: true })
	).toHaveValue(fixture.revisionMonthSlug);
	await expect(page.getByLabel('Monthly CTC', { exact: true })).toHaveValue(
		new RegExp(`^${CORRECTED_CTC}(?:\\.0+)?$`)
	);
	await expect(
		page.getByLabel('Standard daily hours', { exact: true })
	).toHaveValue(/^8(?:\.0+)?$/);
	await page
		.getByLabel('Monthly CTC', { exact: true })
		.fill(String(REVISION_CTC));
	await expect(
		page.getByLabel('PL entitlement (days)', { exact: true })
	).toHaveValue('21');
	await page.screenshot({
		path: 'e2e/artifacts/salary-profiles-editor-desktop.png',
		fullPage: true,
	});

	await page
		.getByRole('button', { name: 'Review revision', exact: true })
		.click();
	const review = page.getByRole('region', { name: 'Review salary revision' });
	await expect(review).toBeVisible();
	await expect(review).toContainText('₹52,000.00');
	await expect(review).toContainText('₹60,000.00');
	await expect(review).toContainText(
		'The previous agreement ends the day before'
	);

	const result = await saveSalaryCommand(page, fixture, 'Save revision', {
		operation: 'revise',
		classification: 'scheduled',
		asOfClassification: 'scheduled',
	});
	await expect(page.getByText(/Salary revision saved/)).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Scheduled', exact: true })
	).toBeVisible();
	return result;
}

export async function cancelScheduledSalaryRevision(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<SalaryCommandResult> {
	const scheduled = page
		.getByRole('heading', { name: 'Scheduled', exact: true })
		.locator('..');
	await scheduled
		.getByRole('button', { name: 'Cancel scheduled agreement', exact: true })
		.click();
	await page
		.getByLabel('Cancellation reason', { exact: true })
		.fill('E2E434 abandoned hike');
	await expect(
		page.getByRole('heading', { name: 'Cancel scheduled agreement' })
	).toBeVisible();
	const result = await saveSalaryCommand(
		page,
		fixture,
		'Confirm cancellation',
		{
			operation: 'cancel',
			classification: 'cancelled',
			asOfClassification: 'cancelled',
		}
	);
	await expect(
		page.getByText(/cancelled\. The predecessor coverage is restored/)
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Cancelled', exact: true })
	).toBeVisible();
	await expect(page.getByText('E2E434 abandoned hike')).toBeVisible();
	return result;
}

/**
 * Click a save control and prove the command both succeeded and left the
 * editor on a freshly read timeline.
 *
 * A successful command invalidates the timeline query, and the editor's next
 * Edit/Revise/Cancel click captures its expected version from that query. So the
 * follow-up timeline GET is the settle barrier: without it, the next click can
 * send the previous version and a legitimate 409 would look like a product
 * bug. The refetched body must carry the version the command returned and the
 * expected classification, and the visible "Refreshing latest terms…" status
 * must clear before the helper returns.
 *
 * The two classifications are deliberately separate: the command classifies the
 * row against the server date, while the editor's read classifies it against the
 * editor's as-of date. The fixture's payroll months are far in the future, so a
 * row the editor already treats as covering is still "scheduled" to the command.
 */
async function saveSalaryCommand(
	page: Page,
	fixture: SalaryProfilesFixture,
	buttonName: string,
	expected: ExpectedSalaryCommand
): Promise<SalaryCommandResult> {
	const responsePromise = page.waitForResponse((response) =>
		isSalaryProfileCommand(response)
	);
	const settledTimeline = page.waitForResponse((response) =>
		isSalaryTimelineReadFor(response, fixture.employees.noProfile.id)
	);
	await page.getByRole('button', { name: buttonName, exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(200);
	const body = (await response.json()) as SalaryCommandBody;
	expect(body.success).toBe(true);
	expect(body.data.operation).toBe(expected.operation);
	expect(body.data.classification).toBe(expected.classification);

	const timelineResponse = await settledTimeline;
	expect(timelineResponse.status()).toBe(200);
	const timeline = (await timelineResponse.json()) as SalaryTimelineBody;
	expect(timeline.success).toBe(true);
	expect(timeline.data.timeline_version).toBe(body.data.timeline_version);
	const settledAgreement = timeline.data.agreements.find(
		(agreement) => agreement.agreement_id === body.data.agreement_id
	);
	expect(settledAgreement?.classification).toBe(expected.asOfClassification);
	await expect(
		page.getByRole('status').filter({ hasText: 'Refreshing latest terms' })
	).toBeHidden();
	return body.data;
}

/* ── unchanged recorded slip ───────────────────────────────────────── */

/**
 * Attach the existing payroll-write guard only around the read-only slip
 * inspection, compare the independent DB state before and after, then remove
 * the guard so later intentional writes are not misreported.
 */
export async function expectEarlierSlipUnchanged(
	page: Page,
	connection: Connection,
	fixture: SalaryProfilesFixture
): Promise<void> {
	const before = await readSalaryProfilesState(connection, fixture);
	await page.goto('/admin/payroll');
	await expect(
		page.getByRole('heading', { name: /^Payroll Run.*$/ })
	).toBeVisible();
	const slipsForMonth = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/slips' &&
			new URL(response.url()).searchParams.get('month') === fixture.month
	);
	await page.getByLabel('Month:', { exact: true }).fill(fixture.monthSlug);
	await slipsForMonth;

	const name = page.getByRole('link', {
		name: fixture.employees.noProfile.fullName,
		exact: true,
	});
	await expect(name).toBeVisible();
	const payrollWrites = guardPayrollWrites(page);
	try {
		await name.click();
		await expect(page).toHaveURL(/\/admin\/payroll\/slips\/\d+/);
		await expect(
			page.getByRole('heading', { name: 'Payroll Slip', exact: true })
		).toBeVisible();
		// The recorded slip shows the employee name in its header and in the
		// identity row, so the proof is that the name is present, not unique.
		await expect(
			page.getByText(fixture.employees.noProfile.fullName).first()
		).toBeVisible();
		await expect(
			page.getByText('NET SALARY PAYABLE', { exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Download PDF', exact: true })
		).toBeVisible();
		await expect(
			page.getByText(/^CTC :$/).locator('xpath=following-sibling::td[1]')
		).toContainText(String(CORRECTED_CTC));
		await expect(
			page
				.getByText(/^HOURS LOGGED :$/)
				.locator('xpath=following-sibling::td[1]')
		).toContainText('160');
	} finally {
		payrollWrites.stop();
	}
	expect(payrollWrites.violations).toEqual([]);

	const after = await readSalaryProfilesState(connection, fixture);
	expect(after.run).toEqual(before.run);
	expect(after.slips).toEqual(before.slips);
	expect(after.uses).toEqual(before.uses);
	expect(after.agreements).toEqual(before.agreements);
	expect(after.audits).toEqual(before.audits);
}

/* ── read-only, zero, visual and navigation proof ──────────────────── */

export async function expectReadOnlySalaryView(
	browser: Browser,
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	const context = await browser.newContext({
		baseURL: new URL(page.url()).origin,
		viewport: { width: 1440, height: 900 },
	});
	try {
		const readerPage = await context.newPage();
		await signInThroughUi(readerPage, credentials(fixture.reader));
		await expect(readerPage).toHaveURL(/\/user\/dashboard/);
		await dismissDailyActivityPrompt(readerPage);
		await readerPage.goto(
			employeeEditorUrl(
				fixture,
				fixture.employees.noProfile.id,
				fixture.asOfDate
			)
		);
		await expect(
			readerPage.getByText(
				'Your role can read salary profiles but cannot change them.',
				{ exact: true }
			)
		).toBeVisible();
		await expect(
			readerPage.getByRole('heading', { name: 'Salary history', exact: true })
		).toBeVisible();
		await expect(
			readerPage.getByText('Used by payroll', { exact: true })
		).toBeVisible();
		for (const label of [
			'Create Salary Profile',
			'Edit agreement',
			'New Salary Revision',
			'Cancel scheduled agreement',
		]) {
			await expect(
				readerPage.getByRole('button', { name: label, exact: true })
			).toHaveCount(0);
		}
		await readerPage.screenshot({
			path: 'e2e/artifacts/salary-profiles-readonly-desktop.png',
			fullPage: true,
		});
	} finally {
		await context.close();
	}
}

/** A canonical zero CTC is a real amount, distinct from an unrecorded CTC. */
export async function expectExplicitZeroAgreement(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await page.goto(
		employeeEditorUrl(fixture, fixture.employees.zero.id, fixture.zeroAsOfDate)
	);
	const estimate = page.getByRole('region', {
		name: 'Estimated pay breakdown',
	});
	await expect(estimate).toBeVisible();
	const ctcRow = estimate
		.getByText('Monthly CTC used', { exact: true })
		.locator('..');
	await expect(ctcRow).toContainText('₹0.00');
	await expect(
		page.getByText(/No monthly CTC is recorded on this agreement/)
	).toHaveCount(0);
	await expect(page.getByText('Used by payroll', { exact: true })).toHaveCount(
		0
	);
}

/**
 * Desktop 1440 and mobile 390 proof of the actual editor: identity, history,
 * terms and estimate remain visible in reading order with no horizontal page
 * overflow. Screenshots live under the harness' ignored artifacts directory.
 */
export async function captureDesktopAndMobileEditor(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(
		employeeEditorUrl(fixture, fixture.employees.noProfile.id, fixture.asOfDate)
	);
	await expect(
		page.getByRole('heading', { name: 'Salary history', exact: true })
	).toBeVisible();
	await page.screenshot({
		path: 'e2e/artifacts/salary-profiles-history-desktop.png',
		fullPage: true,
	});

	await page.setViewportSize({ width: 390, height: 844 });
	const sections = [
		page.getByRole('heading', {
			name: fixture.employees.noProfile.fullName,
			exact: true,
		}),
		page.getByRole('heading', { name: 'Salary history', exact: true }),
		page.getByRole('heading', { name: 'Agreement terms', exact: true }),
		page.getByRole('heading', {
			name: 'Estimated pay breakdown',
			exact: true,
		}),
	];
	const boxes: Array<{ x: number; y: number; width: number; height: number }> =
		[];
	for (const section of sections) {
		await expect(section).toBeVisible();
		const box = await section.boundingBox();
		expect(box).not.toBeNull();
		if (box === null) throw new Error('section has no bounding box');
		boxes.push(box);
	}
	for (let index = 1; index < boxes.length; index += 1) {
		expect(boxes[index].y).toBeGreaterThan(boxes[index - 1].y);
	}
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
	await page.screenshot({
		path: 'e2e/artifacts/salary-profiles-editor-mobile.png',
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 900 });
}

/**
 * Dirty-navigation proof for the two distinct surfaces the editor ships:
 *
 * 1. Browser Back — the editor's sentinel + popstate guard opens the in-app
 *    Stay/Discard <dialog>. Stay keeps the draft and the editor. That prompt is
 *    a DOM dialog, so it is driven only by its role buttons; a recorder proves
 *    the Back surface raises no native dialog at the same time.
 * 2. In-app link — leaving through an ordinary link (the real Navbar path) is
 *    stopped by the capture-phase click guard, which asks window.confirm. That
 *    is a native browser dialog, so it is decided through Playwright's `dialog`
 *    event exactly once and the decision plus its consequence are asserted.
 *
 * Both surfaces are integrated (f67ce88e, #458): sentinel arming/consumption,
 * double-Discard traversal and unmount cleanup are covered by the component
 * regression, so this journey proves the user-visible behaviour only.
 */
export async function expectDirtyNavigationGuard(
	page: Page,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await page.goto(
		employeeEditorUrl(fixture, fixture.employees.noProfile.id, fixture.asOfDate)
	);
	await page
		.getByRole('button', { name: 'New Salary Revision', exact: true })
		.click();
	const ctc = page.getByLabel('Monthly CTC', { exact: true });
	await ctc.fill('61000');
	// Sentinel arming/consumption is covered by the component regression; here
	// the user-visible proof is that a dirty Browser Back raises the prompt and
	// Stay keeps the draft. `history.length` is a depth counter that a real
	// session's earlier traversals also move, so it cannot identify the sentinel.
	const editorPattern = new RegExp(
		`/admin/payroll/salary-profiles/${fixture.employees.noProfile.id}(?:\\?|$)`
	);

	// Surface 1: Browser Back. No native dialog may fire here — the prompt is
	// the editor's own <dialog> — so record native dialogs and assert none.
	const nativeDialogsDuringBack: string[] = [];
	const recordNativeDialog = (dialog: Dialog) => {
		nativeDialogsDuringBack.push(`${dialog.type()}: ${dialog.message()}`);
		void dialog.dismiss();
	};
	page.on('dialog', recordNativeDialog);
	try {
		await page.evaluate(() => window.history.back());
		await expect(
			page.getByRole('dialog').filter({
				hasText: 'The browser Back button would discard this draft',
			})
		).toBeVisible();
		await page.getByRole('button', { name: 'Stay', exact: true }).click();
		await expect(page).toHaveURL(editorPattern);
		await expect(ctc).toHaveValue('61000');
	} finally {
		page.off('dialog', recordNativeDialog);
	}
	expect(nativeDialogsDuringBack).toEqual([]);

	// Surface 2: a normal in-app link, not a scripted history jump. The
	// capture-phase link guard asks window.confirm; decide it through
	// Playwright's dialog event and prove the accepted decision let the
	// navigation leave the editor. The handler is `once`, so it cannot outlive
	// this navigation or consume a later dialog.
	const decidedNativeDialogs: Array<{ type: string; message: string }> = [];
	page.once('dialog', (dialog) => {
		decidedNativeDialogs.push({
			type: dialog.type(),
			message: dialog.message(),
		});
		void dialog.accept();
	});
	await openSalaryProfilesThroughPayrollMenu(page);
	expect(decidedNativeDialogs).toEqual([
		{ type: 'confirm', message: UNSAVED_SALARY_CONFIRM },
	]);
	await expect(page).not.toHaveURL(editorPattern);
}

/* ── independent DB assertions ─────────────────────────────────────── */

export function expectInitialState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture
): void {
	expect(state.run).toEqual({
		id: fixture.runId,
		month: Number(fixture.month.slice(5, 7)),
		year: Number(fixture.month.slice(0, 4)),
		runNumber: 1,
		status: 'draft',
	});
	expect(agreementsFor(state, fixture.employees.noProfile.id)).toEqual([]);
	const contract = agreementFor(state, fixture.agreements.contract);
	expect(contract.salaryType).toBe('contract');
	expect(contract.employerCost).toBe(fixture.amounts.contractCtc);
	expect(contract.gross).toBeNull();
	expect(contract.grossSalary).toBeNull();
	const zero = agreementFor(state, fixture.agreements.zero);
	expect(zero.salaryType).toBe('monthly');
	expect(zero.employerCost).toBe(0);
	expect(zero.gross).toBeNull();
	expect(zero.grossSalary).toBeNull();
	expect(state.uses).toEqual([]);
	expect(state.slips).toEqual([]);
	expect(state.audits).toEqual([]);
	expect(timelineVersion(state, fixture.employees.noProfile.id)).toBe(0);
	const leave = state.leaveSummaries.filter(
		(row) => row.employeeId === fixture.employees.noProfile.id
	);
	expect(leave).toHaveLength(1);
	expect(leave[0].totalPrivilegeLeave).toBe(fixture.amounts.plUsed);
}

export function expectCreatedState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture,
	created: SalaryCommandResult
): void {
	const agreements = agreementsFor(state, fixture.employees.noProfile.id);
	expect(agreements).toHaveLength(1);
	const agreement = agreements[0];
	expect(agreement.id).toBe(created.agreement_id);
	expect(agreement.employerCost).toBe(fixture.amounts.initialCtc);
	expect(agreement.gross).toBeNull();
	expect(agreement.grossSalary).toBeNull();
	expect(agreement.contractAmount).toBeNull();
	expect(agreement.salaryType).toBe('monthly');
	expect(agreement.effectiveFrom).toBe(fixture.employees.noProfile.joiningDate);
	expect(agreement.effectiveTo).toBeNull();
	expect(agreement.isActive).toBe(1);
	expect(agreement.plTotal).toBe(fixture.amounts.plEntitlement);
	expect(timelineVersion(state, fixture.employees.noProfile.id)).toBe(
		created.timeline_version
	);
	const audits = state.audits.filter(
		(row) => row.employeeId === fixture.employees.noProfile.id
	);
	expect(audits.map((row) => row.action)).toEqual(['create']);
	expect(audits[0].entityId).toBe(created.agreement_id);
	expect(audits[0].performedBy).toBe(fixture.editor.userId);
	expect(audits[0].performedAt).not.toBeNull();
	expect(numeric(audits[0].newValues?.employer_cost)).toBe(
		fixture.amounts.initialCtc
	);
}

export function expectCorrectedState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture,
	created: SalaryCommandResult,
	corrected: SalaryCommandResult
): void {
	const agreements = agreementsFor(state, fixture.employees.noProfile.id);
	expect(agreements).toHaveLength(1);
	const agreement = agreements[0];
	expect(agreement.id).toBe(created.agreement_id);
	expect(corrected.agreement_id).toBe(created.agreement_id);
	expect(agreement.employerCost).toBe(fixture.amounts.correctedCtc);
	expect(agreement.gross).toBeNull();
	expect(agreement.grossSalary).toBeNull();
	expect(timelineVersion(state, fixture.employees.noProfile.id)).toBe(
		corrected.timeline_version
	);
	const audits = state.audits.filter(
		(row) => row.employeeId === fixture.employees.noProfile.id
	);
	expect(audits.map((row) => row.action)).toEqual(['create', 'correct']);
	const correction = audits[1];
	expect(correction.entityId).toBe(created.agreement_id);
	expect(correction.performedBy).toBe(fixture.editor.userId);
	expect(correction.performedAt).not.toBeNull();
	expect(numeric(correction.oldValues?.employer_cost)).toBe(
		fixture.amounts.initialCtc
	);
	expect(numeric(correction.newValues?.employer_cost)).toBe(
		fixture.amounts.correctedCtc
	);
}

export function expectGeneratedState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture,
	corrected: SalaryCommandResult
): void {
	expect(state.run?.status).toBe('draft');
	const agreements = agreementsFor(state, fixture.employees.noProfile.id);
	expect(agreements).toHaveLength(1);
	const agreement = agreements[0];
	expect(agreement.id).toBe(corrected.agreement_id);
	const slips = state.slips.filter(
		(row) => row.employeeId === fixture.employees.noProfile.id
	);
	expect(slips).toHaveLength(1);
	const slip = slips[0];
	expect(slip.month).toBe(fixture.month);
	expect(slip.ctcUsed).toBe(fixture.amounts.correctedCtc);
	expect(slip.loggedHours).toBe(fixture.amounts.loggedHours);
	expect(slip.salaryProfileId).toBe(corrected.agreement_id);
	expect(slip.salaryProfileSource).toBe('employee_salary_profile');
	expect(slip.salaryType).toBe('monthly');
	expect(slip.gross ?? 0).toBeGreaterThan(0);
	expect(slip.totalEarnings ?? 0).toBeGreaterThan(0);
	expect(slip.paymentStatus).toBe('pending');
	const uses = state.uses.filter(
		(row) => row.employeeId === fixture.employees.noProfile.id
	);
	expect(uses).toHaveLength(1);
	expect(uses[0]).toMatchObject({
		month: fixture.month,
		agreementId: corrected.agreement_id,
		agreementSource: 'employee_salary_profile',
		evidence: 'payroll_generation',
		isAmbiguous: 0,
		firstUsedBy: fixture.editor.userId,
	});
	expect(
		timelineVersion(state, fixture.employees.noProfile.id)
	).toBeGreaterThan(corrected.timeline_version);
}

export function expectRevisionState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture,
	corrected: SalaryCommandResult,
	revision: SalaryCommandResult,
	generated: SalaryProfilesState
): void {
	const agreements = agreementsFor(state, fixture.employees.noProfile.id);
	expect(agreements).toHaveLength(2);
	const predecessor = agreementFor(state, corrected.agreement_id);
	const successor = agreementFor(state, revision.agreement_id);
	expect(successor.employerCost).toBe(fixture.amounts.revisionCtc);
	expect(successor.gross).toBeNull();
	expect(successor.grossSalary).toBeNull();
	expect(successor.contractAmount).toBeNull();
	expect(successor.effectiveFrom).toBe(fixture.revisionMonth);
	expect(successor.effectiveTo).toBeNull();
	expect(successor.isActive).toBe(1);
	expect(predecessor.effectiveTo).toBe(previousDay(fixture.revisionMonth));
	expect(predecessor.employerCost).toBe(fixture.amounts.correctedCtc);
	const audits = state.audits
		.filter((row) => row.employeeId === fixture.employees.noProfile.id)
		.map((row) => row.action);
	expect(audits).toEqual(['create', 'correct', 'revise']);
	const reviseAudit = state.audits.find(
		(row) =>
			row.employeeId === fixture.employees.noProfile.id &&
			row.action === 'revise'
	);
	expect(reviseAudit?.entityId).toBe(revision.agreement_id);
	expect(reviseAudit?.performedBy).toBe(fixture.editor.userId);
	expect(reviseAudit?.performedAt).not.toBeNull();
	expect(numeric(reviseAudit?.newValues?.employer_cost)).toBe(
		fixture.amounts.revisionCtc
	);
	expect(state.slips).toEqual(generated.slips);
	expect(state.uses).toEqual(generated.uses);
	expect(timelineVersion(state, fixture.employees.noProfile.id)).toBe(
		revision.timeline_version
	);
}

export function expectCancelledState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture,
	corrected: SalaryCommandResult,
	revision: SalaryCommandResult,
	cancelled: SalaryCommandResult,
	beforeCancel: SalaryProfilesState
): void {
	expect(cancelled.operation).toBe('cancel');
	const predecessor = agreementFor(state, corrected.agreement_id);
	const cancelledRow = agreementFor(state, revision.agreement_id);
	expect(predecessor.effectiveTo).toBeNull();
	expect(cancelledRow.isActive).toBe(0);
	expect(cancelledRow.cancelledAt).not.toBeNull();
	expect(cancelledRow.cancelledBy).toBe(fixture.editor.userId);
	expect(cancelledRow.cancelledReason).toBe('E2E434 abandoned hike');
	const audits = state.audits
		.filter((row) => row.employeeId === fixture.employees.noProfile.id)
		.map((row) => row.action);
	expect(audits).toEqual(['create', 'correct', 'revise', 'cancel']);
	const cancelAudit = state.audits.find(
		(row) =>
			row.employeeId === fixture.employees.noProfile.id &&
			row.action === 'cancel'
	);
	expect(cancelAudit?.entityId).toBe(revision.agreement_id);
	expect(cancelAudit?.performedBy).toBe(fixture.editor.userId);
	expect(cancelAudit?.performedAt).not.toBeNull();
	expect(cancelAudit?.newValues?.cancelled_reason).toBe(
		'E2E434 abandoned hike'
	);
	expect(state.slips).toEqual(beforeCancel.slips);
	expect(state.uses).toEqual(beforeCancel.uses);
	expect(timelineVersion(state, fixture.employees.noProfile.id)).toBe(
		cancelled.timeline_version
	);
}

export function expectZeroAgreementState(
	state: SalaryProfilesState,
	fixture: SalaryProfilesFixture
): void {
	const agreement = agreementFor(state, fixture.agreements.zero);
	expect(agreement.employerCost).toBe(0);
	expect(agreement.gross).toBeNull();
	expect(agreement.grossSalary).toBeNull();
	expect(agreement.contractAmount).toBeNull();
	expect(agreement.salaryType).toBe('monthly');
	expect(agreement.effectiveFrom).toBe(fixture.zeroMonth);
	expect(
		state.uses.filter((row) => row.employeeId === fixture.employees.zero.id)
	).toEqual([]);
	expect(
		state.slips.filter((row) => row.employeeId === fixture.employees.zero.id)
	).toEqual([]);
}
