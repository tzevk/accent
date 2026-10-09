import { test } from '@playwright/test';

/**
 * The artifact a ticket spec publishes in `afterAll` must state
 * whether the spec actually passed, but Playwright hands `afterAll`
 * no `testInfo`. This records every test's outcome while the spec
 * runs, so the published artifact's `ok` states the real result
 * instead of a hardcoded `true`.
 *
 * `ok` defaults to false: `afterEach` never fires when a `beforeAll`
 * hook fails (no test body executes), so a default-true flag would
 * publish a false-green artifact on exactly that path. It flips true
 * only after a passing test with no prior failure, and any non-pass
 * flips it sticky-false.
 */
export function trackArtifactOutcome(): { ok: boolean } {
	const outcome = { ok: false };
	let failed = false;
	test.afterEach(({}, testInfo) => {
		if (testInfo.status !== 'passed') {
			failed = true;
			outcome.ok = false;
		} else if (!failed) {
			outcome.ok = true;
		}
	});
	return outcome;
}
