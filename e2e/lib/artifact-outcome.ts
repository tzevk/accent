import { test } from '@playwright/test';

/**
 * The artifact a ticket spec publishes in `afterAll` must state
 * whether the spec actually passed, but Playwright hands `afterAll`
 * no `testInfo`. This records every test's outcome while the spec
 * runs, so the published artifact's `ok` states the real result
 * instead of a hardcoded `true`.
 */
export function trackArtifactOutcome(): { ok: boolean } {
	const outcome = { ok: true };
	test.afterEach(({}, testInfo) => {
		if (testInfo.status !== 'passed') {
			outcome.ok = false;
		}
	});
	return outcome;
}
