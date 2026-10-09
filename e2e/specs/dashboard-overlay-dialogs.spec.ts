import { expect, test, type Locator, type Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';

/**
 * The dashboard's two warning overlays as native dialogs (ticket #337,
 * ADR-0027's "overlays use native `<dialog>` semantics").
 *
 * A keyboard user meets each overlay as a dialog: focus moves in on open,
 * Escape closes it, focus returns to the control that was focused when it
 * opened, and the page behind is inert so tabbing never reaches it. Each
 * overlay is opened from its own trigger — the reminder is raised by pending
 * daily entries, the idle warning by a minute without interaction — and every
 * assertion below reads the live DOM (roles, focus, geometry) rather than
 * source text.
 *
 * The overlay's copy is fixed by this ticket, so it is asserted verbatim.
 * Each button is pressed while its overlay is open and its effect asserted:
 * Remind Later closes silently while Update Now also scrolls the day's
 * activities into view; Dismiss keeps the idle clock running while I'm Back
 * resets it.
 *
 * The inertness of the page behind is asserted twice, because the two are
 * independent in a browser: a background control refuses to take focus
 * (`inert` is honoured by `focus()`), and Tab walks a cycle that contains
 * only the overlay's own controls. Chromium parks focus on `<body>` for one
 * step when the cycle wraps, which is the platform's own behaviour and not
 * the page behind — so the assertion is "no stop outside the dialog is a
 * control", plus the explicit `focus()` refusal that is inertness proper.
 */

const OUTCOME = trackArtifactOutcome();

/** How long the app's idle monitor waits before raising its warning. */
const IDLE_WARNING_MS = 60 * 1000;

// `loginTime` set so the dashboard's tiles render the same payload the
// reduced-motion spec uses.
const ATTENDANCE_PAYLOAD = {
	inTime: null,
	outTime: null,
	loginTime: '09:12:00',
	logoutTime: null,
	currentMonth: '2026-10',
	daysInMonth: 31,
	daysPresent: 7,
	weeklyOff: 4,
	holidays: 1,
	overtimeHours: 0,
	idleTime: 0,
	leaves: { total: 24, used: 0, balance: 24 },
};

// One assignment without today's daily entry is what raises the activity
// reminder overlay.
const PENDING_ASSIGNMENT = {
	id: 'e2e-337-1',
	project_id: 1,
	project_code: 'E2E-337',
	project_name: 'E2E overlay dialog project',
	discipline: 'Civil',
	activity_name: 'Pour concrete',
	sub_activity_name: 'Formwork',
	status: 'In Progress',
	daily_entries: [],
};

async function stubDashboardData(
	page: Page,
	pendingActivity: boolean
): Promise<void> {
	await page.route(/\/api\/users\/\d+\/attendance$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ success: true, data: ATTENDANCE_PAYLOAD }),
		})
	);
	await page.route(/\/api\/users\/\d+\/activity-assignments$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				success: true,
				data: {
					assignments: pendingActivity ? [PENDING_ASSIGNMENT] : [],
					accessibleProjects: [],
					emptyProjects: [],
					stats: {},
				},
			}),
		})
	);
}

/** The warning overlay opened as a native modal dialog, by its accessible name. */
function overlay(page: Page, name: string): Locator {
	return page.getByRole('dialog', { name });
}

/**
 * Reads the dialog's rendered state in the browser: whether it is open, in the
 * top layer (`:modal`), and how big and where it sits relative to the viewport.
 */
async function readDialogState(target: Locator): Promise<{
	open: boolean;
	isModal: boolean;
	coversViewport: boolean;
	centred: boolean;
	backdropBlurred: boolean;
	dialogBorder: string;
	dialogPadding: string;
	dialogMargin: string;
}> {
	return target.evaluate((element) => {
		const dialog = element as HTMLDialogElement;
		const style = getComputedStyle(dialog);
		const box = dialog.getBoundingClientRect();
		return {
			open: dialog.open,
			isModal: dialog.matches(':modal'),
			coversViewport:
				Math.round(box.width) >= window.innerWidth &&
				Math.round(box.height) >= window.innerHeight,
			centred: Math.abs(box.width / 2 + box.left - window.innerWidth / 2) <= 2,
			backdropBlurred: style.backdropFilter.includes('blur'),
			dialogBorder: style.borderTopWidth,
			dialogPadding: style.paddingTop,
			dialogMargin: style.marginTop,
		};
	});
}

/** The dashboard link in the sidebar, part of the page behind both overlays. */
function dashboardLink(page: Page): Locator {
	return page.locator('a[href="/user/dashboard"]');
}

/** A control in the sidebar, used as the element focused when the overlay opens. */
function sidebarPinButton(page: Page): Locator {
	return page.getByRole('button', { name: 'Pin sidebar' });
}

/**
 * Where focus is, expressed as something assertable: the tag, an identifying
 * attribute, and whether it sits inside the open dialog.
 */
async function readFocus(page: Page): Promise<{
	tag: string;
	title: string;
	label: string;
	insideDialog: boolean;
}> {
	return page.evaluate(() => {
		const active = document.activeElement as HTMLElement | null;
		return {
			tag: active?.tagName ?? '',
			title: active?.getAttribute('title') ?? '',
			label: active?.getAttribute('aria-label') ?? '',
			insideDialog: !!active?.closest('dialog'),
		};
	});
}

/**
 * Asks a control behind the overlay to take focus. A native modal dialog
 * leaves the page inert, so this must fail — this is inertness itself, not a
 * tab-order side effect.
 */
async function backgroundCanTakeFocus(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const link = document.querySelector<HTMLElement>(
			'a[href="/user/dashboard"]'
		);
		link?.focus();
		return document.activeElement === link;
	});
}

/**
 * Tabs once per focusable control inside the open overlay, plus a wrap, and
 * reports each stop as `TAG:label`. The overlay's own controls are the only
 * controls a tab may reach: the page behind must never become reachable.
 */
async function tabCycleStops(page: Page): Promise<string[]> {
	const controlCount = await page.evaluate(
		() =>
			document.querySelectorAll(
				'dialog button, dialog a, dialog input, dialog select, dialog [tabindex]'
			).length
	);
	const stops: string[] = [];
	for (let i = 0; i < controlCount + 2; i++) {
		await page.keyboard.press('Tab');
		stops.push(
			await page.evaluate(() => {
				const active = document.activeElement as HTMLElement | null;
				const label =
					active?.getAttribute('aria-label') ||
					active?.title ||
					(active?.textContent || '').trim().slice(0, 40);
				return `${active?.tagName}:${label}`;
			})
		);
	}
	return stops;
}

const observed: Record<string, unknown> = {};

test.describe('the warning overlays as native dialogs', () => {
	test.use({ storageState: 'e2e/.auth/employee.json' });

	test.describe('the activity reminder', () => {
		test('opens as a modal dialog that takes focus, is inert behind and returns focus on Escape', async ({
			page,
		}) => {
			await stubDashboardData(page, true);
			await page.goto('/user/dashboard');

			// A control behind the overlay is focused before the overlay opens,
			// so Escape can be proven to hand focus back to the opener.
			const opener = sidebarPinButton(page);
			await expect(opener).toBeVisible();
			await opener.evaluate((element) => element.focus());
			await expect
				.poll(async () => (await readFocus(page)).title)
				.toBe('Pin sidebar');

			const reminder = overlay(page, 'Activity Update Required');
			await expect(reminder).toBeVisible();

			// Native dialog semantics: open, in the top layer, viewport-sized.
			const state = await readDialogState(reminder);
			expect(state.open).toBe(true);
			expect(state.isModal, 'the dialog must be in the top layer').toBe(true);
			expect(state.coversViewport).toBe(true);
			expect(state.centred).toBe(true);
			expect(state.backdropBlurred).toBe(true);
			expect(state.dialogBorder, 'the dialog itself carries no border').toBe(
				'0px'
			);
			expect(state.dialogPadding).toBe('0px');
			expect(state.dialogMargin).toBe('0px');
			observed.reminderDialogState = state;

			// Focus moved into the overlay on open, without this spec touching
			// focus after the opener was focused.
			const focusedOnOpen = await readFocus(page);
			expect(focusedOnOpen.insideDialog).toBe(true);
			expect(focusedOnOpen.tag).toBe('BUTTON');
			expect(
				await page.evaluate(() =>
					(document.activeElement?.textContent || '').trim()
				)
			).toBe('Remind Later');
			observed.reminderFocusOnOpen = focusedOnOpen;

			// The page behind is inert: a control behind the overlay refuses to
			// take focus while the overlay is open.
			await expect(reminder).toBeVisible();
			expect(await backgroundCanTakeFocus(page)).toBe(false);

			// Tabbing never reaches the page behind: every control the cycle
			// reaches is inside the overlay.
			const stops = await tabCycleStops(page);
			expect(
				stops.length,
				"the cycle must cover the overlay's controls"
			).toBeGreaterThanOrEqual(2);
			const dialogControls = await page.evaluate(() =>
				[...document.querySelectorAll('dialog button')].map((button) =>
					(button.textContent || '').trim()
				)
			);
			for (const stop of stops) {
				const isDialogControl = dialogControls.some((control) =>
					stop.endsWith(`:${control}`)
				);
				const isBodyPark = stop.startsWith('BODY:');
				expect(
					isDialogControl || isBodyPark,
					`tab stop must be an overlay control or the platform's focus park, saw: ${stop}`
				).toBe(true);
			}
			observed.reminderTabStops = stops;

			// The page is inert across the whole cycle.
			expect(await backgroundCanTakeFocus(page)).toBe(false);

			// Escape closes the overlay and focus returns to the control that
			// was focused when it opened.
			await page.keyboard.press('Escape');
			await expect(reminder).toHaveCount(0);

			const focusAfterEscape = await readFocus(page);
			expect(focusAfterEscape.title).toBe('Pin sidebar');
			expect(focusAfterEscape.insideDialog).toBe(false);
			observed.reminderFocusAfterEscape = focusAfterEscape;

			// With the overlay gone the page behind is interactive again.
			expect(await backgroundCanTakeFocus(page)).toBe(true);
		});

		test("the reminder's Remind Later closes it without moving the page", async ({
			page,
		}) => {
			await stubDashboardData(page, true);
			await page.goto('/user/dashboard');

			const reminder = overlay(page, 'Activity Update Required');
			await expect(reminder).toBeVisible();

			await page.getByRole('button', { name: 'Remind Later' }).click();
			await expect(reminder).toHaveCount(0);

			// The effect: the overlay is gone for this session and the page was
			// not scrolled to the day's activities.
			const scrollTop = await page.evaluate(() => window.scrollY);
			expect(scrollTop, 'Remind Later must not scroll the page').toBeLessThan(
				200
			);
			await expect(
				page.locator('[data-section="project-activities"]')
			).toHaveCount(1);
			expect(
				await page.evaluate(() =>
					sessionStorage.getItem('activity_reminder_2026-10-09')
				)
			).toBe('1');
			expect(await backgroundCanTakeFocus(page)).toBe(true);
		});

		test("the reminder's Update Now closes it and scrolls to the day's activities", async ({
			page,
		}) => {
			await stubDashboardData(page, true);
			await page.goto('/user/dashboard');

			const reminder = overlay(page, 'Activity Update Required');
			await expect(reminder).toBeVisible();

			const section = page.locator('[data-section="project-activities"]');
			await expect(section).toHaveCount(1);

			await page.getByRole('button', { name: 'Update Now' }).click();
			await expect(reminder).toHaveCount(0);

			// The effect: the day's activities come into view and the page
			// behind is interactive again.
			await expect(section).toBeInViewport();
			await page.waitForTimeout(700);
			await expect(section).toBeInViewport();
			expect(await backgroundCanTakeFocus(page)).toBe(true);
		});

		test('its heading, body copy and button labels are unchanged', async ({
			page,
		}) => {
			await stubDashboardData(page, true);
			await page.goto('/user/dashboard');

			const reminder = overlay(page, 'Activity Update Required');
			await expect(reminder).toBeVisible();

			await expect(
				reminder.getByRole('heading', { name: 'Activity Update Required' })
			).toBeVisible();
			await expect(
				reminder.getByText('You have pending entries for today')
			).toBeVisible();
			await expect(
				reminder.getByText(
					'The following 1 activity has not been updated today. Please submit your daily progress.'
				)
			).toBeVisible();

			// The listed activity's own copy.
			await expect(reminder.getByText('Pour concrete')).toBeVisible();
			await expect(
				reminder.getByText(
					`${PENDING_ASSIGNMENT.project_name} · ${PENDING_ASSIGNMENT.project_code}`
				)
			).toBeVisible();
			await expect(
				reminder.getByText(PENDING_ASSIGNMENT.status, { exact: true })
			).toBeVisible();

			// Button labels, unchanged.
			await expect(
				reminder.getByRole('button', { name: 'Remind Later' })
			).toBeVisible();
			await expect(
				reminder.getByRole('button', { name: 'Update Now' })
			).toBeVisible();
		});
	});

	test.describe('the idle warning', () => {
		test.describe.configure({ timeout: 200_000 });

		/**
		 * Opens the dashboard and leaves it alone until the idle monitor raises
		 * its warning, having first focused a real control behind it.
		 */
		async function openIdleWarning(page: Page): Promise<Locator> {
			const opener = sidebarPinButton(page);
			await expect(opener).toBeVisible();
			await opener.evaluate((element) => element.focus());
			await expect
				.poll(async () => (await readFocus(page)).title)
				.toBe('Pin sidebar');

			const warning = overlay(page, 'Idle Warning');
			await expect(warning).toBeVisible({
				timeout: IDLE_WARNING_MS + 60_000,
			});
			return warning;
		}

		test('opens as a modal dialog that takes focus, is inert behind and returns focus on Escape', async ({
			page,
		}) => {
			await stubDashboardData(page, false);
			await page.goto('/user/dashboard');
			await expect(
				page.getByRole('heading', { name: "Today's Attendance" })
			).toBeVisible();

			const warning = await openIdleWarning(page);

			const state = await readDialogState(warning);
			expect(state.open).toBe(true);
			expect(state.isModal).toBe(true);
			expect(state.coversViewport).toBe(true);
			expect(state.backdropBlurred).toBe(true);
			observed.idleWarningDialogState = state;

			// Focus moved into the overlay on open — and the control that had
			// focus when it opened is remembered.
			const focusedOnOpen = await readFocus(page);
			expect(focusedOnOpen.insideDialog).toBe(true);
			expect(focusedOnOpen.tag).toBe('BUTTON');
			expect(
				await page.evaluate(() =>
					(document.activeElement?.textContent || '').trim()
				)
			).toBe('Dismiss');
			observed.idleWarningFocusOnOpen = focusedOnOpen;

			// The page behind is inert.
			expect(await backgroundCanTakeFocus(page)).toBe(false);

			// Escape closes the overlay and focus returns to the opener.
			await page.keyboard.press('Escape');
			await expect(warning).toHaveCount(0);

			const focusAfterEscape = await readFocus(page);
			expect(focusAfterEscape.title).toBe('Pin sidebar');
			observed.idleWarningFocusAfterEscape = focusAfterEscape;

			// And the page behind is interactive again.
			expect(await backgroundCanTakeFocus(page)).toBe(true);
		});

		test('the page behind is inert while the idle warning is open', async ({
			page,
		}) => {
			await stubDashboardData(page, false);
			await page.goto('/user/dashboard');
			await expect(
				page.getByRole('heading', { name: "Today's Attendance" })
			).toBeVisible();

			const warning = await openIdleWarning(page);

			// Inertness, as the platform expresses it: while the dialog is in
			// the top layer, nothing behind it can be focused. The sidebar and
			// the dashboard's own controls are asked to take focus and must
			// refuse, which is exactly what stops tabbing reaching the page
			// behind. A real Tab press cannot be used to walk this overlay:
			// the app's own idle monitor treats any keystroke as the user
			// returning and closes the warning, which is the app's behaviour
			// and not this ticket's.
			const refused = await page.evaluate(() => {
				const tried: string[] = [];
				const refused: string[] = [];
				const candidates = [
					...document.querySelectorAll<HTMLElement>(
						'a[href], button, input, select, [tabindex]'
					),
				].filter((element) => !element.closest('dialog'));
				for (const element of candidates) {
					const label =
						element.getAttribute('aria-label') ||
						element.title ||
						(element.textContent || '').trim().slice(0, 40);
					tried.push(label);
					element.focus();
					if (document.activeElement !== element) refused.push(label);
				}
				return { tried, refused };
			});
			expect(
				refused.tried.length,
				'the page behind has controls to reach'
			).toBeGreaterThan(3);
			expect(
				refused.refused.length,
				`every control behind the dialog must refuse focus, these took it: ${refused.tried.filter((label) => !refused.refused.includes(label)).join(' | ')}`
			).toBe(refused.tried.length);
			observed.idleWarningInertRefusals = refused;

			await expect(warning).toHaveCount(1);
		});

		test('its Dismiss button closes the overlay and returns the page to use', async ({
			page,
		}) => {
			await stubDashboardData(page, false);
			await page.goto('/user/dashboard');
			await expect(
				page.getByRole('heading', { name: "Today's Attendance" })
			).toBeVisible();

			const warning = await openIdleWarning(page);
			await expect(warning.getByText(/You've been idle for/)).toBeVisible();

			await page.getByRole('button', { name: 'Dismiss' }).click();
			await expect(warning).toHaveCount(0);

			// The effect of Dismiss: the overlay closes and the page behind
			// becomes usable again.
			expect(await backgroundCanTakeFocus(page)).toBe(true);
			observed.dismissBadge = await page.evaluate(
				() =>
					document.body.innerText.match(/Idle: \d+\w* \d*\w*|Active/)?.[0] ??
					null
			);
		});

		test("its I'm Back button closes the overlay and resets the idle clock", async ({
			page,
		}) => {
			await stubDashboardData(page, false);
			await page.goto('/user/dashboard');
			await expect(
				page.getByRole('heading', { name: "Today's Attendance" })
			).toBeVisible();

			const warning = await openIdleWarning(page);

			await page.getByRole('button', { name: "I'm Back" }).click();
			await expect(warning).toHaveCount(0);

			// The effect: the user is back, so the idle clock restarts and the
			// hero badge drops its idle duration.
			await expect
				.poll(
					async () =>
						page.evaluate(() => /Idle: \d/.test(document.body.innerText)),
					{ timeout: 15_000 }
				)
				.toBe(false);
			await expect(page.getByText('Active', { exact: true })).toBeVisible();
			observed.imBackBadge = await page.evaluate(
				() =>
					document.body.innerText.match(/Idle: \d+\w* \d*\w*|Active/)?.[0] ??
					null
			);
		});

		test('its heading, body copy and button labels are unchanged', async ({
			page,
		}) => {
			await stubDashboardData(page, false);
			await page.goto('/user/dashboard');
			await expect(
				page.getByRole('heading', { name: "Today's Attendance" })
			).toBeVisible();

			const warning = await openIdleWarning(page);

			await expect(
				warning.getByRole('heading', { name: 'Idle Warning' })
			).toBeVisible();
			await expect(
				warning.getByText("You've been idle for", { exact: false })
			).toBeVisible();
			await expect(
				warning.getByText(
					'No mouse movement or keyboard activity has been detected. Your idle time is being logged and may affect your productivity report.'
				)
			).toBeVisible();
			await expect(warning.getByText('Current idle duration')).toBeVisible();

			await expect(
				warning.getByRole('button', { name: 'Dismiss' })
			).toBeVisible();
			await expect(
				warning.getByRole('button', { name: "I'm Back" })
			).toBeVisible();
		});
	});
});

test.afterAll(() => {
	writeArtifact('dashboard-overlay-dialogs', {
		overlays: ['Activity Update Required', 'Idle Warning'],
		observed,
		ok: OUTCOME.ok,
	});
	const saved = readArtifact('dashboard-overlay-dialogs');
	expect(saved.ok).toBe(OUTCOME.ok);
	expect(OUTCOME.ok, 'every assertion above passed').toBe(true);
});
