// @vitest-environment node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	E2E_AUTH_BUCKET_LIMIT,
	E2E_CI_RETRIES,
	E2E_MAX_PLANNED_LOGINS_PER_GROUP,
	E2E_STARTUP_PROBE_LOGINS,
	FULL_SUITE_GROUPS,
	assertGroupCoverage,
	assertGroupPlan,
	discoverSpecFiles,
	planFullSuiteGroups,
	shouldGroupFullSuite,
	type E2EGroupDefinition,
} from './groups.ts';

const PROJECT_ROOT = path.resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'..'
);

function plan(
	name: string,
	specs: readonly (readonly [file: string, plannedLogins: number])[]
): E2EGroupDefinition {
	return {
		name,
		specs: specs.map(([file, plannedLogins]) => ({ file, plannedLogins })),
	};
}

function captureError(run: () => unknown): Error {
	try {
		run();
	} catch (error) {
		if (error instanceof Error) return error;
		throw error;
	}
	throw new Error('Expected the group plan to be rejected');
}

describe('anonymous login budget', () => {
	it('fits four planned logins plus the startup probe through one retry', () => {
		expect(E2E_MAX_PLANNED_LOGINS_PER_GROUP).toBe(4);
		expect(
			E2E_MAX_PLANNED_LOGINS_PER_GROUP * (1 + E2E_CI_RETRIES) +
				E2E_STARTUP_PROBE_LOGINS
		).toBeLessThanOrEqual(E2E_AUTH_BUCKET_LIMIT);
		expect(
			(E2E_MAX_PLANNED_LOGINS_PER_GROUP + 1) * (1 + E2E_CI_RETRIES) +
				E2E_STARTUP_PROBE_LOGINS
		).toBeGreaterThan(E2E_AUTH_BUCKET_LIMIT);
	});

	it('rejects a group that plans more than four first attempts', () => {
		expect(() =>
			assertGroupPlan([
				plan('at-limit', [
					['e2e/specs/one.spec.ts', 2],
					['e2e/specs/two.spec.ts', 2],
				]),
			])
		).not.toThrow();

		const error = captureError(() =>
			assertGroupPlan([
				plan('over-limit', [
					['e2e/specs/one.spec.ts', 2],
					['e2e/specs/two.spec.ts', 3],
				]),
			])
		);
		expect(error.message).toMatch(/at most 4/);
		expect(error.message).toMatch(/Split the group/);
	});

	it('rejects malformed login declarations and duplicate files', () => {
		expect(() =>
			assertGroupPlan([plan('bad-count', [['e2e/specs/one.spec.ts', 1.5]])])
		).toThrow(/non-negative integer plannedLogins/);
		expect(() =>
			assertGroupPlan([
				plan('one', [['e2e/specs/one.spec.ts', 1]]),
				plan('two', [['e2e/specs/one.spec.ts', 1]]),
			])
		).toThrow(/more than one full-suite group/);
	});
});

describe('full-suite selection', () => {
	it('groups the full suite unless an argument selects tests or opens a UI', () => {
		expect(shouldGroupFullSuite([])).toBe(true);
		expect(shouldGroupFullSuite(['--workers=1'])).toBe(true);
		expect(shouldGroupFullSuite(['--workers', '1'])).toBe(true);
		expect(shouldGroupFullSuite(['--reporter=dot'])).toBe(true);
		expect(shouldGroupFullSuite(['--project', 'chromium'])).toBe(true);

		expect(shouldGroupFullSuite(['e2e/specs/session.spec.ts'])).toBe(false);
		expect(shouldGroupFullSuite(['e2e/specs'])).toBe(false);
		expect(shouldGroupFullSuite(['--', 'e2e/specs/session.spec.ts'])).toBe(
			false
		);
		expect(shouldGroupFullSuite(['--grep', 'signs in'])).toBe(false);
		expect(shouldGroupFullSuite(['--grep=signs in'])).toBe(false);
		expect(shouldGroupFullSuite(['-g', 'signs in'])).toBe(false);
		expect(shouldGroupFullSuite(['--last-failed'])).toBe(false);
		expect(shouldGroupFullSuite(['--only-changed=origin/main'])).toBe(false);
		expect(shouldGroupFullSuite(['--shard=1/2'])).toBe(false);
		expect(shouldGroupFullSuite(['--ui'])).toBe(false);
		expect(shouldGroupFullSuite(['--debug'])).toBe(false);
		expect(shouldGroupFullSuite(['--list'])).toBe(false);
	});

	it('plans every maintained spec exactly once in fixed order', () => {
		const discovered = discoverSpecFiles(PROJECT_ROOT);
		const groups = planFullSuiteGroups(discovered);
		const plannedFiles = groups.flatMap((group) =>
			group.specs.map((spec) => spec.file)
		);

		expect(groups.map((group) => group.name)).toEqual(
			FULL_SUITE_GROUPS.map((group) => group.name)
		);
		expect(new Set(plannedFiles).size).toBe(plannedFiles.length);
		expect([...plannedFiles].sort()).toEqual([...discovered].sort());
	});
});

describe('discovery coverage', () => {
	it('rejects a newly added spec that no group owns', () => {
		const error = captureError(() =>
			assertGroupCoverage(
				[plan('core', [['e2e/specs/core.spec.ts', 1]])],
				['e2e/specs/core.spec.ts', 'e2e/specs/new-journey.spec.ts']
			)
		);
		expect(error.message).toMatch(/missing maintained specs/);
		expect(error.message).toMatch(/e2e\/specs\/new-journey\.spec\.ts/);
		expect(error.message).toMatch(/scripts\/e2e\/groups\.ts/);
	});

	it('rejects a group entry whose spec file is gone', () => {
		const missing = captureError(() =>
			assertGroupCoverage(
				[
					plan('core', [['e2e/specs/core.spec.ts', 1]]),
					plan('gone', [['e2e/specs/gone.spec.ts', 1]]),
				],
				['e2e/specs/core.spec.ts']
			)
		);
		expect(missing.message).toMatch(/e2e\/specs\/gone\.spec\.ts/);
	});

	it('rejects one spec assigned to two groups', () => {
		const error = captureError(() =>
			assertGroupCoverage(
				[
					plan('one', [['e2e/specs/shared.spec.ts', 1]]),
					plan('two', [['e2e/specs/shared.spec.ts', 1]]),
				],
				['e2e/specs/shared.spec.ts']
			)
		);
		expect(error.message).toMatch(/assigned to both/);
	});

	it('rejects ambiguous or empty group definitions', () => {
		expect(() => assertGroupPlan([])).toThrow(/empty/);
		expect(() => assertGroupPlan([plan('Bad Name', [])])).toThrow(/must match/);
		expect(() => assertGroupPlan([plan('empty', [])])).toThrow(/has no specs/);
		expect(() =>
			assertGroupPlan([
				plan('same', [['e2e/specs/one.spec.ts', 1]]),
				plan('same', [['e2e/specs/two.spec.ts', 1]]),
			])
		).toThrow(/duplicate full-suite group name/);
		expect(() =>
			assertGroupPlan([plan('bad-path', [['src/specs/one.spec.ts', 1]])])
		).toThrow(/not a Playwright spec path/);
	});
});
