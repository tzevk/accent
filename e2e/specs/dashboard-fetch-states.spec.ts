import { expect, test, type Locator, type Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';

/**
 * Dashboard fetch states (issue #340): an employee can tell a day that
 * recorded nothing from a page that could not load.
 *
 * Three flows are proven in the browser. The tier-1 endpoints are driven at
 * the network seam (`page.route`), so each state is the page's own disclosure
 * and not a database condition:
 *
 *  - A failed attendance fetch renders an error line that says what happened
 *    and names the next step. The line is visually distinct from the empty
 *    state (a live red alert, not neutral gray) and never disappears on its
 *    own — the same DOM node is still there after a wait well past any
 *    plausible auto-dismiss window.
 *  - A failed assignments fetch renders its own error line, and the rest of
 *    the day is unaffected: the attendance line stays silent.
 *  - Empty-but-successful payloads render the empty state, worded as nothing
 *    recorded, with no error line anywhere on the page.
 *  - One page renders both states at once, so the two lines are compared as
 *    they are actually painted — different colour, different tint, and only
 *    the error line announced.
 *
 * The employee signs in through the harness's own stored session; the page
 * under test is the real `/user/dashboard`.
 */

const OUTCOME = trackArtifactOutcome();

/** How long the spec waits before deciding a line is not auto-dismissed. */
const AUTO_DISMISS_WINDOW_MS = 10_000;

/** The next step both error lines name. */
const NEXT_STEP = 'Refresh the page, or tell support if it stays broken.';

/** The empty state's wording: nothing recorded, never an error. */
const EMPTY_DAY_WORDING = 'Nothing recorded yet today.';

/** Pinned rendered colours, read with `getComputedStyle` (Tailwind v4 tokens). */
const ERROR_RED = 'oklch(0.505 0.213 27.518)'; // text-red-700
const ERROR_TINT = 'oklch(0.971 0.013 17.38)'; // bg-red-50, the error line only
const EMPTY_GRAY = 'oklch(0.446 0.03 256.802)'; // text-gray-600
const NO_TINT = 'rgba(0, 0, 0, 0)';

/** The dashboard's tier-1 attendance endpoint. */
const ATTENDANCE_URL = /\/api\/users\/\d+\/attendance$/;
/** The dashboard's tier-1 activity-assignments endpoint. */
const ASSIGNMENTS_URL = /\/api\/users\/\d+\/activity-assignments$/;

// A successful attendance payload for a day that recorded nothing: no login,
// no logout, no first punch waiting in the background.
const EMPTY_ATTENDANCE = {
	inTime: null,
	outTime: null,
	loginTime: null,
	logoutTime: null,
	currentMonth: '2026-10',
	daysInMonth: 31,
	daysPresent: 0,
	weeklyOff: 0,
	holidays: 0,
	overtimeHours: 0,
	idleTime: 0,
	leaves: { total: 24, used: 0, balance: 24 },
};

// The same day with a login, used to prove an assignments failure says nothing
// about the attendance line: this day is recorded.
const RECORDED_ATTENDANCE = { ...EMPTY_ATTENDANCE, loginTime: '09:12:00' };

/** Empty-but-successful payload for the assignments endpoint. */
const EMPTY_ASSIGNMENTS = {
	success: true,
	data: {
		assignments: [],
		accessibleProjects: [],
		emptyProjects: [],
		stats: {},
	},
};

/** Fail a tier-1 endpoint the way a broken backend does. */
async function failEndpoint(page: Page, url: RegExp): Promise<void> {
	await page.route(url, (route) =>
		route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({ success: false, error: 'Internal Server Error' }),
		})
	);
}

/** Answer a tier-1 endpoint successfully with the given payload. */
async function stubEndpoint(
	page: Page,
	url: RegExp,
	body: unknown
): Promise<void> {
	await page.route(url, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body),
		})
	);
}

/** Both endpoints answer successfully with a day that recorded nothing. */
async function stubEmptyDay(page: Page): Promise<void> {
	await stubEndpoint(page, ATTENDANCE_URL, {
		success: true,
		data: EMPTY_ATTENDANCE,
	});
	await stubEndpoint(page, ASSIGNMENTS_URL, EMPTY_ASSIGNMENTS);
}

/** Open the dashboard and wait for the attendance card it renders. */
async function openDashboard(page: Page): Promise<void> {
	await page.goto('/user/dashboard');
	await expect(page.getByTestId('attendance-card')).toBeVisible();
	await expect(page.getByText('Punch In', { exact: true })).toBeVisible();
}

/** Rendered colour of a line's text — the visual proof of its kind. */
async function textColour(line: Locator): Promise<string> {
	return line.evaluate((element) => getComputedStyle(element).color);
}

/** Rendered background of a line — the error line is the only tinted one. */
async function backgroundTint(line: Locator): Promise<string> {
	return line.evaluate((element) => getComputedStyle(element).backgroundColor);
}

const observed: Record<string, unknown> = {};

test.describe('dashboard fetch states', () => {
	test.use({ storageState: 'e2e/.auth/employee.json' });
	test.describe.configure({ mode: 'serial', timeout: 120_000 });

	test('a failed attendance fetch says so, names the next step and stays', async ({
		page,
	}) => {
		await stubEndpoint(page, ASSIGNMENTS_URL, EMPTY_ASSIGNMENTS);
		await failEndpoint(page, ATTENDANCE_URL);
		await openDashboard(page);

		const errorLine = page.getByTestId('attendance-fetch-error');
		await expect(
			errorLine,
			'the attendance card discloses the failed fetch'
		).toBeVisible();

		// What happened, and what to do about it.
		await expect(errorLine).toContainText('Attendance could not load.');
		await expect(errorLine).toContainText(NEXT_STEP);

		// Distinct from the empty state: an announced alert in error red on a
		// red tint, while the empty wording is not rendered at all.
		await expect(errorLine).toHaveAttribute('data-state', 'error');
		await expect(errorLine).toHaveAttribute('role', 'alert');
		expect(await textColour(errorLine)).toBe(ERROR_RED);
		expect(await backgroundTint(errorLine)).toBe(ERROR_TINT);
		await expect(page.getByTestId('attendance-empty-state')).toHaveCount(0);

		// The error came from one endpoint, so no line about the other one.
		await expect(page.getByTestId('assignments-fetch-error')).toHaveCount(0);

		// No tile reads as a failure: the missing times are plain dashes, not
		// the `--:--` placeholder that read as a broken fetch.
		const card = page.getByTestId('attendance-card');
		await expect(card.getByText('--:--')).toHaveCount(0);
		await expect(card.getByText('–', { exact: true })).toHaveCount(3);

		// No auto-dismiss: tag the rendered node, wait well past any plausible
		// dismissal window, and find the same node still carrying the line. A
		// reload or a React remount would have dropped the tag.
		await errorLine.evaluate((element) =>
			element.setAttribute('data-observed-node', 'this one')
		);
		await page.waitForTimeout(AUTO_DISMISS_WINDOW_MS);
		await expect(errorLine).toBeVisible();
		await expect(errorLine).toHaveAttribute('data-observed-node', 'this one');
		await expect(errorLine).toContainText(NEXT_STEP);
		await expect(errorLine).toHaveCount(1);

		observed.attendanceError = {
			text: 'Attendance could not load. Refresh the page, or tell support if it stays broken.',
			colour: await textColour(errorLine),
			tint: await backgroundTint(errorLine),
			role: 'alert',
			stillPresentAfterMs: AUTO_DISMISS_WINDOW_MS,
			sameNodeAfterWait: true,
		};
	});

	test('a failed assignments fetch says so, and the day stays unaffected', async ({
		page,
	}) => {
		await stubEndpoint(page, ATTENDANCE_URL, {
			success: true,
			data: RECORDED_ATTENDANCE,
		});
		await failEndpoint(page, ASSIGNMENTS_URL);
		await openDashboard(page);

		const errorLine = page.getByTestId('assignments-fetch-error');
		await expect(
			errorLine,
			'the activity section discloses the failed fetch'
		).toBeVisible();
		await expect(errorLine).toContainText('Project activities could not load.');
		await expect(errorLine).toContainText(NEXT_STEP);
		await expect(errorLine).toHaveAttribute('role', 'alert');
		expect(await textColour(errorLine)).toBe(ERROR_RED);
		expect(await backgroundTint(errorLine)).toBe(ERROR_TINT);

		// The failure of one endpoint says nothing about the other: the
		// attendance card keeps its recorded day and renders no error.
		await expect(page.getByTestId('attendance-fetch-error')).toHaveCount(0);
		await expect(page.getByTestId('attendance-empty-state')).toHaveCount(0);
		await expect(page.getByText('9:12 AM')).toBeVisible();

		// The section does not spin or retry behind the reader's back: no
		// loading message, no table of its own.
		await expect(page.getByText('Loading assignments…')).toHaveCount(0);
		await expect(page.getByText('No activities yet.', { exact: false })).toHaveCount(
			0
		);

		await errorLine.evaluate((element) =>
			element.setAttribute('data-observed-node', 'this one')
		);
		await page.waitForTimeout(AUTO_DISMISS_WINDOW_MS);
		await expect(errorLine).toBeVisible();
		await expect(errorLine).toHaveAttribute('data-observed-node', 'this one');
		await expect(errorLine).toHaveCount(1);

		observed.assignmentsError = {
			text: 'Project activities could not load. Refresh the page, or tell support if it stays broken.',
			colour: await textColour(errorLine),
			tint: await backgroundTint(errorLine),
			role: 'alert',
			attendanceErrorCount: await page
				.getByTestId('attendance-fetch-error')
				.count(),
			stillPresentAfterMs: AUTO_DISMISS_WINDOW_MS,
			sameNodeAfterWait: true,
		};
	});

	test('a day with no data is named as recorded, never as an error', async ({
		page,
	}) => {
		await stubEmptyDay(page);
		await openDashboard(page);

		const emptyState = page.getByTestId('attendance-empty-state');
		await expect(
			emptyState,
			'the attendance card names the empty day'
		).toBeVisible();
		await expect(emptyState).toHaveText(EMPTY_DAY_WORDING);
		await expect(emptyState).toHaveAttribute('data-state', 'empty');

		// Neutral, and not an alert: no role, no tint, no error red.
		expect(await textColour(emptyState)).toBe(EMPTY_GRAY);
		expect(await backgroundTint(emptyState)).toBe(NO_TINT);
		expect(
			await emptyState.evaluate((element) => element.getAttribute('role'))
		).toBeNull();

		// No error anywhere on the page. Next's own route announcer carries
		// role="alert" page-wide, so the card is where the check belongs.
		const card = page.getByTestId('attendance-card');
		await expect(page.getByTestId('attendance-fetch-error')).toHaveCount(0);
		await expect(page.getByTestId('assignments-fetch-error')).toHaveCount(0);
		await expect(page.locator('[data-state="error"]')).toHaveCount(0);
		await expect(card.locator('[role="alert"]')).toHaveCount(0);

		// The missing times are plain dashes, never `--:--`.
		await expect(card.getByText('--:--')).toHaveCount(0);
		await expect(card.getByText('–', { exact: true })).toHaveCount(3);

		observed.emptyDay = {
			text: EMPTY_DAY_WORDING,
			colour: await textColour(emptyState),
			tint: await backgroundTint(emptyState),
			alertCount: 0,
			errorLines: 0,
			tilePlaceholders: '–',
		};
	});

	test('the error line and the empty state are visually distinct on one page', async ({
		page,
	}) => {
		// Both states at once: the empty day on top, the failed assignments
		// fetch below it. Comparing the rendered colours of the two lines on
		// one page is the distinctness proof, and it survives any palette.
		await stubEndpoint(page, ATTENDANCE_URL, {
			success: true,
			data: EMPTY_ATTENDANCE,
		});
		await failEndpoint(page, ASSIGNMENTS_URL);
		await openDashboard(page);

		const errorLine = page.getByTestId('assignments-fetch-error');
		const emptyState = page.getByTestId('attendance-empty-state');
		await expect(errorLine).toBeVisible();
		await expect(emptyState).toBeVisible();

		const [errorColour, emptyColour] = [
			await textColour(errorLine),
			await textColour(emptyState),
		];
		const [errorTint, emptyTint] = [
			await backgroundTint(errorLine),
			await backgroundTint(emptyState),
		];
		expect(errorColour).not.toBe(emptyColour);
		expect(errorTint).not.toBe(emptyTint);
		// Each also holds its pinned value, so the difference is the intended
		// one: error red on a red tint, neutral gray on nothing.
		expect(errorColour).toBe(ERROR_RED);
		expect(errorTint).toBe(ERROR_TINT);
		expect(emptyColour).toBe(EMPTY_GRAY);
		expect(emptyTint).toBe(NO_TINT);

		// One is announced as an alert; the other is plain text.
		await expect(errorLine).toHaveAttribute('role', 'alert');
		expect(
			await emptyState.evaluate((element) => element.getAttribute('role'))
		).toBeNull();
		await expect(errorLine).toContainText(NEXT_STEP);
		await expect(emptyState).toHaveText(EMPTY_DAY_WORDING);

		observed.distinctStates = {
			errorColour,
			emptyColour,
			errorTint,
			emptyTint,
			coloursDiffer: errorColour !== emptyColour,
			tintsDiffer: errorTint !== emptyTint,
		};
	});
});

test.afterAll(() => {
	writeArtifact('dashboard-fetch-states', {
		autoDismissWindowMs: AUTO_DISMISS_WINDOW_MS,
		nextStep: NEXT_STEP,
		pinnedColours: { errorRed: ERROR_RED, emptyGray: EMPTY_GRAY },
		observed,
		ok: OUTCOME.ok,
	});
	const saved = readArtifact('dashboard-fetch-states');
	expect(saved.ok).toBe(OUTCOME.ok);
	expect(OUTCOME.ok, 'every assertion above passed').toBe(true);
});
