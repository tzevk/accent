import { expect, test, type Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { rows } from '../lib/db';

/**
 * The dashboard's main landmark and skip link (ticket #338).
 *
 * Proved here: the dashboard content column is the route's only main
 * landmark; the shared layout's skip link is the page's first tab stop, is
 * off-screen until it takes focus, and moves focus to that landmark; the tab
 * stop after it is the landmark's own first interactive element; and the
 * scroll port reserves the fixed header's 64px, so an element focused deep in
 * the page is never left under it. The admin live-monitoring route renders the
 * same dashboard component, so exactly one landmark holds there too.
 */

const OUTCOME = trackArtifactOutcome();

const SKIP_LINK_NAME = 'Skip to main content';

// Every focusable element, in document order — the tab order under test.
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

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

// Twenty-four assignments inside the activity table's default date window:
// enough rendered rows to put interactive content below the fold, which is
// where the header-overlap check needs it.
const ASSIGNMENTS = Array.from({ length: 24 }, (_, index) => ({
	id: `e2e-lm-${index + 1}`,
	project_id: 1,
	project_code: 'E2E-LM',
	project_name: 'Landmark fixture project',
	discipline: 'Civil',
	activity_name: `Pour concrete ${index + 1}`,
	sub_activity_name: 'Formwork',
	status: 'In Progress',
	due_date: '2026-10-05',
	daily_entries: [],
}));

async function stubDashboardData(page: Page): Promise<void> {
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
					assignments: ASSIGNMENTS,
					accessibleProjects: [],
					emptyProjects: [],
					stats: {},
				},
			}),
		})
	);
}

// The activity reminder overlay is another ticket's surface; mark today's
// reminder as already seen so it stays out of these assertions.
async function suppressActivityReminder(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const today = new Date().toISOString().split('T')[0];
		sessionStorage.setItem(`activity_reminder_${today}`, '1');
	});
}

async function openDashboard(page: Page, url: string): Promise<void> {
	await stubDashboardData(page);
	await suppressActivityReminder(page);
	await page.goto(url);
	await expect(page.getByRole('main')).toBeVisible();
	await expect(page.getByText('Punch In', { exact: true })).toBeVisible();
	// The activity section is lazy; its interactive rows are what the
	// header-overlap check focuses.
	await expect(page.getByText('Pour concrete 1', { exact: true })).toBeVisible();
}

// The fixed header, measured from the rendered page rather than from the
// stylesheet, so a restyle cannot move the value under test.
async function headerBox(page: Page): Promise<{
	top: number;
	bottom: number;
	height: number;
}> {
	const box = await page.evaluate(() => {
		const nav = Array.from(document.querySelectorAll('nav')).find(
			(candidate) => getComputedStyle(candidate).position === 'fixed'
		);
		if (!nav) return null;
		const rect = nav.getBoundingClientRect();
		return { top: rect.top, bottom: rect.bottom, height: rect.height };
	});
	expect(box, 'the page renders its fixed header').not.toBeNull();
	return box!;
}

// The focused element's position against the header, from rendered geometry.
async function focusedElementBox(page: Page): Promise<{
	clearance: number;
	overlap: number;
	inView: boolean;
}> {
	return page.evaluate(() => {
		const nav = Array.from(document.querySelectorAll('nav')).find(
			(candidate) => getComputedStyle(candidate).position === 'fixed'
		);
		const element = document.activeElement;
		if (!nav || !element || element === document.body) {
			return { clearance: Number.NaN, overlap: Number.NaN, inView: false };
		}
		const headerRect = nav.getBoundingClientRect();
		const rect = element.getBoundingClientRect();
		return {
			clearance: Math.round(rect.top - headerRect.bottom),
			overlap: Math.round(
				Math.max(
					0,
					Math.min(rect.bottom, headerRect.bottom) - Math.max(rect.top, headerRect.top)
				)
			),
			inView: rect.top >= headerRect.bottom && rect.bottom <= window.innerHeight,
		};
	});
}

// The landmark's top edge against the header's bottom edge: the gap the
// reserved band leaves, or the amount of the header it hides.
async function mainClearance(page: Page): Promise<number> {
	return page.evaluate(() => {
		const nav = Array.from(document.querySelectorAll('nav')).find(
			(candidate) => getComputedStyle(candidate).position === 'fixed'
		);
		const main = document.querySelector('main');
		if (!nav || !main) return Number.NaN;
		return Math.round(main.getBoundingClientRect().top - nav.getBoundingClientRect().bottom);
	});
}

// The skip link's own jump: from the bottom of the page, focus it and activate
// it, so the browser brings the landmark back into view from above.
async function activateSkipLinkFromBottom(page: Page): Promise<void> {
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.getByRole('link', { name: SKIP_LINK_NAME }).focus();
	await page.keyboard.press('Enter');
}

const observed: Record<string, unknown> = {};

test.describe('the dashboard route exposes a main landmark and a skip link', () => {
	test.use({ storageState: 'e2e/.auth/employee.json' });
	test.describe.configure({ mode: 'serial', timeout: 120_000 });

	test('the skip link is the first tab stop and moves focus to the main landmark', async ({
		page,
	}) => {
		await openDashboard(page, '/user/dashboard');

		// Exactly one landmark, and it is the dashboard's content column — not
		// a wrapper — because it holds the attendance content.
		const main = page.getByRole('main');
		await expect(main).toHaveCount(1);
		await expect(main).toContainText("Today's Attendance");

		// One skip link for the whole page: the shared layout's, with no
		// second one from the dashboard chrome.
		const skip = page.getByRole('link', { name: SKIP_LINK_NAME });
		await expect(skip).toHaveCount(1);

		// Off-screen until focused, inside the viewport once focused.
		const hidden = await skip.boundingBox();
		expect(hidden, 'the skip link is rendered before it is focused').not.toBeNull();
		expect(hidden!.x, 'an unfocused skip link sits off-screen').toBeLessThan(0);

		// The first tab stop on the page: the document's first focusable
		// element, ahead of the sidebar's own navigation.
		const order = await page.evaluate((selector) => {
			const all = Array.from(document.querySelectorAll(selector));
			const aside = document.querySelector('aside');
			return {
				total: all.length,
				firstIsSkipLink: all[0]?.classList.contains('skip-link') ?? false,
				firstText: all[0]?.textContent?.trim() ?? null,
				precedesSidebar: aside
					? Boolean(
							all[0]?.compareDocumentPosition(aside) &&
								Node.DOCUMENT_POSITION_FOLLOWING
						)
					: null,
			};
		}, FOCUSABLE);
		expect(order.firstIsSkipLink, 'the first focusable element is the skip link').toBe(
			true
		);
		expect(order.firstText).toBe(SKIP_LINK_NAME);
		expect(order.precedesSidebar, 'the skip link precedes the sidebar').toBe(true);
		expect(order.total, 'the page has focusable content to skip').toBeGreaterThan(1);

		await page.keyboard.press('Tab');
		const focused = await page.evaluate(() => {
			const element = document.activeElement;
			return {
				tag: element?.tagName ?? null,
				text: element?.textContent?.trim() ?? null,
				href: element?.getAttribute('href') ?? null,
			};
		});
		expect(focused, 'the first tab press lands on the skip link').toEqual({
			tag: 'A',
			text: SKIP_LINK_NAME,
			href: '#main-content',
		});

		const shown = await skip.boundingBox();
		expect(shown!.x, 'the focused skip link is on screen').toBeGreaterThanOrEqual(0);
		expect(shown!.y, 'the focused skip link is on screen').toBeGreaterThan(0);

		// Activating it moves focus to the main landmark.
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main-content$/);
		const landmarkFocus = await page.evaluate(() => {
			const element = document.activeElement;
			return { tag: element?.tagName ?? null, id: element?.id ?? null };
		});
		expect(landmarkFocus, 'activating the skip link focuses the landmark').toEqual({
			tag: 'MAIN',
			id: 'main-content',
		});

		// The next tab stop is the landmark's own first interactive element.
		await page.keyboard.press('Tab');
		const next = await page.evaluate(
			(selector) => {
				const main = document.querySelector('main');
				const first = main?.querySelector(selector) ?? null;
				return {
					isFirstInMain: Boolean(first && document.activeElement === first),
					inMain: Boolean(document.activeElement?.closest('main')),
					firstLabel:
						first?.getAttribute('aria-label') ??
						first?.textContent?.trim() ??
						null,
				};
			},
			FOCUSABLE
		);
		expect(
			next.isFirstInMain,
			'tab #2 reaches the landmark first interactive element'
		).toBe(true);
		expect(next.inMain).toBe(true);

		observed.dashboardRoute = {
			mainCount: await main.count(),
			skipLinkCount: await skip.count(),
			firstTabStop: focused,
			landmarkFocus,
			nextTabStop: next,
		};
	});

	test('the scroll container reserves the header height, and a deep element clears it', async ({
		page,
	}) => {
		await openDashboard(page, '/user/dashboard');

		const header = await headerBox(page);
		expect(header.height, 'the fixed header is h-16 (64px)').toBe(64);
		expect(header.top, 'the fixed header sits at the top of the viewport').toBe(0);

		// The rule: the scroll port reserves exactly the header's height, the
		// value the layout itself carries for the fixed header.
		const padding = await page.evaluate(() => ({
			scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
			contentPaddingTop: getComputedStyle(
				document.querySelector('.content-with-sidebar') as Element
			).paddingTop,
		}));
		expect(
			padding.scrollPaddingTop,
			'the scroll container reserves the header height'
		).toBe('64px');
		expect(padding.scrollPaddingTop).toBe(`${header.height}px`);
		expect(padding.contentPaddingTop, 'the layout already offsets the header').toBe(
			'64px'
		);

		// A deep element focused from the top of the page: the browser scrolls
		// it into view, and it must land inside the viewport below the header.
		const target = await page.evaluate((selector) => {
			const main = document.querySelector('main');
			const all = main ? Array.from(main.querySelectorAll(selector)) : [];
			const belowFold = all.find(
				(element) => element.getBoundingClientRect().top > window.innerHeight
			);
			window.scrollTo(0, 0);
			if (!belowFold) return null;
			(belowFold as HTMLElement).focus();
			return {
				label:
					belowFold.getAttribute('aria-label') ??
					belowFold.textContent?.trim() ??
					null,
			};
		}, FOCUSABLE);
		expect(target, 'a below-the-fold element exists to focus').not.toBeNull();

		await expect
			.poll(() => focusedElementBox(page).then((box) => box.inView), {
				message: 'the focused element is scrolled into view below the header',
			})
			.toBe(true);
		const landed = await focusedElementBox(page);
		expect(
			landed.overlap,
			'the focused element does not overlap the header'
		).toBe(0);
		expect(
			landed.clearance,
			'the focused element clears the header'
		).toBeGreaterThanOrEqual(0);

		observed.headerOverlap = {
			header,
			scrollPadding: padding,
			deepFocus: { target, landed },
		};
	});

	test('the skip link jump lands the landmark below the header, and the header covers it without the rule', async ({
		page,
	}) => {
		await openDashboard(page, '/user/dashboard');
		const header = await headerBox(page);

		// The jump the fixed header would cover: activating the skip link from
		// the bottom brings the landmark back into view from above. With the
		// reserved band it lands one header-height below the top.
		await activateSkipLinkFromBottom(page);
		await expect
			.poll(() => mainClearance(page), {
				message: 'the landmark lands one header-height below the top',
			})
			.toBe(0);
		const below = await page.evaluate(() => {
			const nav = Array.from(document.querySelectorAll('nav')).find(
				(candidate) => getComputedStyle(candidate).position === 'fixed'
			)!;
			const main = document.querySelector('main')!;
			const headerRect = nav.getBoundingClientRect();
			const mainRect = main.getBoundingClientRect();
			return {
				overlap: Math.round(
					Math.max(
						0,
						Math.min(mainRect.bottom, headerRect.bottom) -
							Math.max(mainRect.top, headerRect.top)
					)
				),
			};
		});
		expect(below.overlap, 'the landmark sits clear of the header').toBe(0);

		// Control: with the reserved band removed, the same jump lands the
		// landmark flush at the top of the viewport, under the fixed header —
		// the assertion above is the rule at work, not a coincidence.
		await page.evaluate(() => {
			document.documentElement.style.scrollPaddingTop = '0px';
		});
		await activateSkipLinkFromBottom(page);
		await expect
			.poll(() => mainClearance(page), {
				message: 'without the reserved band the landmark lands at the viewport top',
			})
			.toBe(-header.height);
		const covered = await page.evaluate(() => {
			const nav = Array.from(document.querySelectorAll('nav')).find(
				(candidate) => getComputedStyle(candidate).position === 'fixed'
			)!;
			const main = document.querySelector('main')!;
			const headerRect = nav.getBoundingClientRect();
			const mainRect = main.getBoundingClientRect();
			return {
				overlap: Math.round(
					Math.max(
						0,
						Math.min(mainRect.bottom, headerRect.bottom) -
							Math.max(mainRect.top, headerRect.top)
					)
				),
			};
		});
		expect(
			covered.overlap,
			'without the reserved band the header covers the landmark'
		).toBeGreaterThan(0);

		// Restored: the rule puts the landmark back below the header.
		await page.evaluate(() => {
			document.documentElement.style.removeProperty('scroll-padding-top');
		});
		await activateSkipLinkFromBottom(page);
		await expect
			.poll(() => mainClearance(page), {
				message: 'the landmark lands one header-height below the top again',
			})
			.toBe(0);

		observed.skipLinkJump = { headerBottom: header.bottom, below, covered };
	});
});

test.describe('the admin live-monitoring route renders the same dashboard', () => {
	test.use({ storageState: 'e2e/.auth/admin.json' });
	test.describe.configure({ mode: 'serial', timeout: 120_000 });

	test('the same dashboard leaves exactly one main landmark on the route', async ({
		page,
	}) => {
		const users = await rows<{ id: number }>(
			'SELECT id FROM users WHERE username = ?',
			['e2e_employee']
		);
		expect(users, 'the harness seeds the employee fixture user').toHaveLength(1);

		await openDashboard(page, `/admin/live-monitoring/user/${users[0].id}`);

		const main = page.getByRole('main');
		await expect(main).toHaveCount(1);
		await expect(main).toContainText("Today's Attendance");

		// The page wrapper that used to carry the landmark no longer does: the
		// wrapper is a plain div and the dashboard's column is the landmark.
		const wrapperTag = await page.evaluate(() => {
			const main = document.querySelector('main');
			const wrapper = main?.parentElement?.parentElement;
			return wrapper?.tagName ?? null;
		});
		expect(wrapperTag, 'the live-monitoring wrapper is not a landmark').toBe('DIV');

		// The shared skip link renders here too — and only once.
		const skip = page.getByRole('link', { name: SKIP_LINK_NAME });
		await expect(skip).toHaveCount(1);

		observed.liveMonitoringRoute = {
			userId: users[0].id,
			mainCount: await main.count(),
			wrapperTag,
			skipLinkCount: await skip.count(),
		};
	});
});

test.afterAll(() => {
	writeArtifact('dashboard-landmark-skip-link', {
		landmark: 'main#main-content',
		skipLink: 'a.skip-link (SkipToMainLink, mounted by the root layout)',
		observed,
		ok: OUTCOME.ok,
	});
	const saved = readArtifact('dashboard-landmark-skip-link');
	expect(saved.ok).toBe(OUTCOME.ok);
	expect(OUTCOME.ok, 'every assertion above passed').toBe(true);
});
