import { expect, test, type Locator, type Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';

/**
 * Dashboard motion under `prefers-reduced-motion: reduce` (ticket #335,
 * ADR-0027's one-guard rule).
 *
 * The dashboard's motion — the pulse dots on the attendance tiles, the idle
 * warning's clock icon and the scale-in entrance of both warning overlays —
 * runs behind the project's single reduced-motion block in `globals.css`.
 * Every assertion below reads RENDERED state: `getComputedStyle` over the
 * live DOM, never source text. The control describe re-reads the same
 * elements with the preference off, so "nothing animates" can only come
 * from the guard — an element that never moved would read `none` too.
 *
 * The two overlay states and the Punch In dot render only for real dashboard
 * data, so the spec stubs the two dashboard GET payloads at the network
 * seam: that is what puts the page into each state under test.
 */

const OUTCOME = trackArtifactOutcome();

// `loginTime` set: the Punch In and Total Time tiles each render their pulse
// dot only once a login exists.
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
	id: 'e2e-rm-1',
	project_id: 1,
	project_code: 'E2E-RM',
	project_name: 'Reduced motion fixture project',
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

type MotionState = {
	animationName: string;
	animationDuration: string;
	animationIterationCount: string;
	transform: string;
	opacity: string;
	transitionDuration: string;
};

async function readMotion(target: Locator): Promise<MotionState> {
	return target.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			animationName: style.animationName,
			animationDuration: style.animationDuration,
			animationIterationCount: style.animationIterationCount,
			transform: style.transform,
			opacity: style.opacity,
			transitionDuration: style.transitionDuration,
		};
	});
}

async function expectHeld(
	target: Locator,
	label: string
): Promise<MotionState> {
	const state = await readMotion(target);
	expect(state.animationName, `${label} must run no animation`).toBe('none');
	expect(state.animationDuration, `${label} must have no duration`).toBe('0s');
	expect(state.animationIterationCount, `${label} must not repeat`).toBe('1');
	expect(state.transitionDuration, `${label} must not transition`).toBe('0s');
	return state;
}

// A tile's pulse dot, reached through the tile's own label so the locator
// survives a restyle of the tile markup.
function tileDot(page: Page, label: string): Locator {
	return page
		.getByText(label, { exact: true })
		.locator(
			'xpath=ancestor::div[.//div[@data-motion="pulse"]][1]//div[@data-motion="pulse"]'
		);
}

const observed: Record<string, unknown> = {};

test.describe('dashboard motion with the reduced-motion preference', () => {
	test.use({ storageState: 'e2e/.auth/employee.json', reducedMotion: 'reduce' });
	test.describe.configure({ mode: 'serial', timeout: 150_000 });

	test('the pulse dots on the attendance tiles hold still', async ({
		page,
	}) => {
		await stubDashboardData(page, false);
		await page.goto('/user/dashboard');
		await expect(page.getByText('Punch In', { exact: true })).toBeVisible();

		const punchIn = tileDot(page, 'Punch In');
		const totalTime = tileDot(page, 'Total Time');
		const idle = tileDot(page, 'Idle');
		for (const [name, dot] of [
			['Punch In', punchIn],
			['Total Time', totalTime],
			['Idle', idle],
		] as const) {
			await expect(dot, `the ${name} tile renders its dot`).toBeVisible();
			await expectHeld(dot, `the ${name} status dot`);
		}

		// Every motion-marked element on the surface — the three tile dots
		// above plus the hero idle badge — holds still together.
		const marked = page.locator('[data-motion="pulse"]');
		await expect(marked).toHaveCount(4);
		const dots: unknown[] = [];
		for (let i = 0; i < 4; i++) {
			const dot = marked.nth(i);
			await expect(dot).toBeVisible();
			dots.push(await expectHeld(dot, `pulse dot #${i + 1}`));
		}
		observed.tileDots = dots;
	});

	test('the activity reminder overlay appears statically, with its cue left on screen', async ({
		page,
	}) => {
		await stubDashboardData(page, true);
		await page.goto('/user/dashboard');

		const overlay = page.getByRole('dialog', {
			name: 'Activity Update Required',
		});
		await expect(overlay).toBeVisible();

		const panel = overlay.locator('[data-motion="scale-in"]');
		await expect(panel).toHaveCount(1);
		await expect(panel).toBeVisible();

		const state = await expectHeld(panel, 'the activity reminder panel');
		expect(state.transform, 'the panel must not be scaled').toBe('none');
		expect(state.opacity, 'the panel must be fully opaque').toBe('1');

		// The static cue left behind: the warning glyph and both lines of the
		// overlay's message stay on screen when the entrance is removed.
		await expect(panel.getByText('Activity Update Required')).toBeVisible();
		await expect(
			panel.getByText('You have pending entries for today')
		).toBeVisible();
		await expect(panel.locator('svg').first()).toBeVisible();
		observed.activityReminderPanel = state;
	});

	test('the idle warning overlay appears statically and its clock icon holds still', async ({
		page,
	}) => {
		await stubDashboardData(page, false);
		await page.goto('/user/dashboard');

		// The idle monitor warns after a minute without interaction, so the
		// test simply leaves the page alone until the overlay appears.
		const overlay = page.getByRole('dialog', { name: 'Idle Warning' });
		await expect(overlay).toBeVisible({ timeout: 100_000 });

		const panel = overlay.locator('[data-motion="scale-in"]');
		await expect(panel).toHaveCount(1);
		const state = await expectHeld(panel, 'the idle warning panel');
		expect(state.transform, 'the panel must not be scaled').toBe('none');
		expect(state.opacity, 'the panel must be fully opaque').toBe('1');

		// The clock icon in the idle duration row is the overlay's pulsing
		// cue; it holds still, and the icon itself stays on screen.
		const clock = overlay.locator('[data-motion="pulse"]');
		await expect(clock).toHaveCount(1);
		await expect(clock).toBeVisible();
		const clockState = await expectHeld(clock, "the idle warning's clock icon");

		// With the warning up, the hero badge has switched to its pulsing
		// state — every marked dot on the page holds still with it.
		const marked = page.locator('[data-motion="pulse"]');
		expect(await marked.count()).toBeGreaterThanOrEqual(4);
		for (let i = 0; i < (await marked.count()); i++) {
			await expectHeld(marked.nth(i), `pulse dot #${i + 1}`);
		}
		observed.idleWarningPanel = state;
		observed.idleClockIcon = clockState;
	});
});

test.describe('dashboard motion without the preference (control)', () => {
	test.use({
		storageState: 'e2e/.auth/employee.json',
		reducedMotion: 'no-preference',
	});

	test('the same dots and overlay entrance animate when motion is allowed', async ({
		page,
	}) => {
		await stubDashboardData(page, true);
		await page.goto('/user/dashboard');
		await expect(page.getByText('Punch In', { exact: true })).toBeVisible();

		// The control proves the emulation is live and the marked elements
		// really carry motion: without the preference the Punch In dot runs
		// Tailwind's pulse, so the reduced-motion result above is the guard.
		const dot = await readMotion(tileDot(page, 'Punch In'));
		expect(dot.animationName).toBe('pulse');
		expect(dot.animationDuration).toBe('2s');
		expect(dot.animationIterationCount).toBe('infinite');

		const panel = page
			.getByRole('dialog', { name: 'Activity Update Required' })
			.locator('[data-motion="scale-in"]');
		const motion = await readMotion(panel);
		expect(motion.animationName).toBe('scaleIn');
		expect(motion.animationDuration).toBe('0.25s');
		observed.control = { punchInDot: dot, reminderPanel: motion };
	});
});

test.afterAll(() => {
	writeArtifact('dashboard-reduced-motion', {
		reducedMotion: 'reduce',
		targets: [
			'tile status dots',
			'idle warning clock icon',
			'activity reminder panel',
			'idle warning panel',
		],
		observed,
		ok: OUTCOME.ok,
	});
	const saved = readArtifact('dashboard-reduced-motion');
	expect(saved.ok).toBe(OUTCOME.ok);
	expect(OUTCOME.ok, 'every assertion above passed').toBe(true);
});
