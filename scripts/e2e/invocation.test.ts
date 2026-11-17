// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { E2EUsageError, resolveE2EInvocation } from './invocation.ts';

type InvocationEnv = Partial<Pick<NodeJS.ProcessEnv, 'CI' | 'GITHUB_ACTIONS'>>;

const LOCAL_ENV: InvocationEnv = {};
const CI_ENV: InvocationEnv = { CI: 'true' };
const GITHUB_ACTIONS_ENV: InvocationEnv = { GITHUB_ACTIONS: 'true' };
const DEBUG_COMMAND =
	'npm run test:e2e -- --local-run-reason "browser-only failure investigation" --ui';

function captureError(run: () => unknown): Error {
	try {
		run();
	} catch (error) {
		if (error instanceof Error) {
			return error;
		}
		throw error;
	}
	throw new Error('Expected the invocation to be rejected');
}

describe('E2E invocation guard', () => {
	it('rejects a local default run and points at GitHub Actions', () => {
		const error = captureError(() =>
			resolveE2EInvocation(['--grep', 'payroll'], LOCAL_ENV)
		);
		expect(error).toBeInstanceOf(E2EUsageError);
		expect(error.message).toMatch(/GitHub Actions/);
		expect(error.message).toMatch(/Vitest/);
		expect(error.message).toContain(DEBUG_COMMAND);
	});

	it('rejects a bare --ui without an explicit reason', () => {
		const error = captureError(() => resolveE2EInvocation(['--ui'], LOCAL_ENV));
		expect(error).toBeInstanceOf(E2EUsageError);
		expect(error.message).toContain(DEBUG_COMMAND);
	});

	it('accepts UI mode when the local reason is named', () => {
		const args = [
			'--local-run-reason',
			'browser-only failure investigation',
			'--ui',
			'--grep',
			'payroll review',
			'e2e/specs/payroll.spec.ts',
		];
		expect(resolveE2EInvocation(args, LOCAL_ENV)).toEqual({
			playwrightArgs: [
				'--ui',
				'--grep',
				'payroll review',
				'e2e/specs/payroll.spec.ts',
			],
			localRunReason: 'browser-only failure investigation',
		});
	});

	it('accepts an explicit local reason without UI', () => {
		expect(
			resolveE2EInvocation(
				[
					'--local-run-reason',
					'browser-only failure investigation',
					'--grep',
					'payroll',
				],
				LOCAL_ENV
			)
		).toEqual({
			playwrightArgs: ['--grep', 'payroll'],
			localRunReason: 'browser-only failure investigation',
		});
	});

	it('keeps GitHub Actions one-shot without extra flags', () => {
		const args = ['--grep', 'payroll', '--workers=1'];
		expect(resolveE2EInvocation(args, GITHUB_ACTIONS_ENV)).toEqual({
			playwrightArgs: args,
			localRunReason: null,
		});
	});

	it('does not treat generic CI as GitHub Actions', () => {
		const error = captureError(() =>
			resolveE2EInvocation(['--grep', 'payroll'], CI_ENV)
		);
		expect(error).toBeInstanceOf(E2EUsageError);
		expect(error.message).toMatch(/GitHub Actions/);
	});

	it('does not authorize a local run when GITHUB_ACTIONS is false', () => {
		const error = captureError(() =>
			resolveE2EInvocation([], { GITHUB_ACTIONS: 'false' })
		);
		expect(error).toBeInstanceOf(E2EUsageError);
	});

	it('requires the literal GITHUB_ACTIONS=true value', () => {
		for (const value of ['1', 'TRUE']) {
			const error = captureError(() =>
				resolveE2EInvocation([], { GITHUB_ACTIONS: value })
			);
			expect(error).toBeInstanceOf(E2EUsageError);
		}
	});

	it('accepts and strips the equals form, preserving later equals', () => {
		expect(
			resolveE2EInvocation(
				['--local-run-reason=browser=only', '--ui'],
				LOCAL_ENV
			)
		).toEqual({
			playwrightArgs: ['--ui'],
			localRunReason: 'browser=only',
		});
	});

	it('trims surrounding whitespace from the reason', () => {
		expect(
			resolveE2EInvocation(['--local-run-reason=  browser check  '], LOCAL_ENV)
		).toEqual({
			playwrightArgs: [],
			localRunReason: 'browser check',
		});
	});

	it('rejects a blank equals-form reason', () => {
		const error = captureError(() => {
			resolveE2EInvocation(['--local-run-reason='], LOCAL_ENV);
		});
		expect(error.message).toMatch(/non-empty reason/);
	});

	it('rejects an empty quoted reason', () => {
		const error = captureError(() => {
			resolveE2EInvocation(['--local-run-reason', ''], LOCAL_ENV);
		});
		expect(error.message).toMatch(/non-empty reason/);
	});

	it('does not consume a following option as the reason', () => {
		const error = captureError(() => {
			resolveE2EInvocation(['--local-run-reason', '--ui'], LOCAL_ENV);
		});
		expect(error.message).toMatch(/needs a value/);
	});

	it('rejects a trailing flag with no reason', () => {
		const error = captureError(() => {
			resolveE2EInvocation(['--local-run-reason'], LOCAL_ENV);
		});
		expect(error.message).toMatch(/needs a value/);
	});

	it('rejects a duplicate flag in either form', () => {
		const duplicateArgs = [
			['--local-run-reason=a', '--local-run-reason=b'],
			['--local-run-reason', 'a', '--local-run-reason', 'b'],
			['--local-run-reason=a', '--local-run-reason', 'b'],
		];
		for (const args of duplicateArgs) {
			const error = captureError(() => resolveE2EInvocation(args, LOCAL_ENV));
			expect(error.message).toMatch(/only once/);
		}
	});

	it('rejects a duplicate flag even in GitHub Actions', () => {
		const error = captureError(() => {
			resolveE2EInvocation(
				['--local-run-reason=a', '--local-run-reason=b'],
				GITHUB_ACTIONS_ENV
			);
		});
		expect(error.message).toMatch(/only once/);
	});

	it('rejects an invalid reason even with --ui', () => {
		const error = captureError(() => {
			resolveE2EInvocation(['--ui', '--local-run-reason='], LOCAL_ENV);
		});
		expect(error.message).toMatch(/non-empty reason/);
	});

	it('does not mutate frozen caller arguments', () => {
		const input = Object.freeze([
			'--local-run-reason',
			'browser check',
			'--ui',
			'--grep',
			'payroll',
		]);
		const result = resolveE2EInvocation(input, LOCAL_ENV);
		expect(result.playwrightArgs).toEqual(['--ui', '--grep', 'payroll']);
		expect(result.playwrightArgs).not.toBe(input);
		expect(input).toEqual([
			'--local-run-reason',
			'browser check',
			'--ui',
			'--grep',
			'payroll',
		]);
	});
});
