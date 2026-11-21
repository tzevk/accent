#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRunId } from './contracts.ts';
import { startE2EHarness, type E2EHarness } from './environment.ts';
import {
	discoverSpecFiles,
	planFullSuiteGroups,
	shouldGroupFullSuite,
	type E2EGroupDefinition,
} from './groups.ts';
import {
	E2EUsageError,
	resolveE2EInvocation,
	type E2EInvocation,
} from './invocation.ts';

interface PlaywrightResult {
	code: number | null;
	signal: NodeJS.Signals | null;
}

interface GroupOutcome {
	group: E2EGroupDefinition;
	testResult: PlaywrightResult | null;
	testError: unknown;
	startupError: unknown;
	cleanupError: unknown;
}

function errorMessage(error: unknown): string {
	return error instanceof Error
		? (error.stack ?? error.message)
		: String(error);
}

async function runPlaywright(
	harness: E2EHarness,
	playwrightArgs: readonly string[],
	envOverrides: Partial<NodeJS.ProcessEnv> = {}
): Promise<PlaywrightResult> {
	const cli = path.join(process.cwd(), 'node_modules', 'playwright', 'cli.js');
	if (!existsSync(cli)) {
		throw new Error(
			`[e2e] Playwright CLI not found at ${cli}; run npm ci and npx playwright install chromium.`
		);
	}
	const child = spawn(process.execPath, [cli, 'test', ...playwrightArgs], {
		env: { ...harness.playwrightEnv, ...envOverrides },
		cwd: process.cwd(),
		stdio: 'inherit',
		shell: false,
	});
	const { promise, resolve, reject } =
		Promise.withResolvers<PlaywrightResult>();
	child.once('error', reject);
	child.once('close', (code, signal) => resolve({ code, signal }));

	const forwardSignal = (signal: NodeJS.Signals): void => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill(signal);
		}
	};
	const onSigint = (): void => forwardSignal('SIGINT');
	const onSigterm = (): void => forwardSignal('SIGTERM');
	process.once('SIGINT', onSigint);
	process.once('SIGTERM', onSigterm);
	try {
		return await promise;
	} finally {
		process.removeListener('SIGINT', onSigint);
		process.removeListener('SIGTERM', onSigterm);
	}
}

/** Focused or UI invocation: one owned harness, Playwright arguments intact. */
async function runSingleHarness(invocation: E2EInvocation): Promise<number> {
	let harness: E2EHarness;
	try {
		harness = await startE2EHarness();
	} catch (error) {
		process.stderr.write(`${errorMessage(error)}\n`);
		return 1;
	}

	let testResult: PlaywrightResult | null = null;
	let testError: unknown = null;
	try {
		testResult = await runPlaywright(harness, invocation.playwrightArgs);
	} catch (error) {
		testError = error;
	}

	let cleanupError: unknown = null;
	try {
		await harness.stop();
	} catch (error) {
		cleanupError = error;
	}

	if (testError !== null) {
		process.stderr.write(`${errorMessage(testError)}\n`);
		if (cleanupError !== null) {
			process.stderr.write(
				`[e2e] cleanup also failed:\n${errorMessage(cleanupError)}\n`
			);
		}
		return 1;
	}
	if (cleanupError !== null) {
		process.stderr.write(`${errorMessage(cleanupError)}\n`);
		return 1;
	}
	if (testResult === null || testResult.code !== 0) {
		if (testResult?.signal) {
			process.stderr.write(
				`[e2e] Playwright stopped by ${testResult.signal}; the journey did not pass.\n`
			);
		}
		return 1;
	}
	process.stdout.write('[e2e] PASS\n');
	return 0;
}

function groupFailureReasons(outcome: GroupOutcome): string[] {
	const reasons: string[] = [];
	if (outcome.startupError !== null) {
		reasons.push(`startup failed: ${errorMessage(outcome.startupError)}`);
	}
	if (outcome.testError !== null) {
		reasons.push(
			`could not run Playwright: ${errorMessage(outcome.testError)}`
		);
	}
	if (outcome.testResult !== null) {
		if (outcome.testResult.signal !== null) {
			reasons.push(`Playwright stopped by ${outcome.testResult.signal}`);
		} else if (outcome.testResult.code !== 0) {
			reasons.push(
				`Playwright exited with code ${String(outcome.testResult.code)}`
			);
		}
	}
	if (outcome.cleanupError !== null) {
		reasons.push(`cleanup failed: ${errorMessage(outcome.cleanupError)}`);
	}
	return reasons;
}

function reportGroupOutcome(outcome: GroupOutcome): void {
	const reasons = groupFailureReasons(outcome);
	if (reasons.length === 0) return;
	process.stderr.write(
		`[e2e] group ${outcome.group.name} FAILED:\n- ${reasons.join('\n- ')}\n`
	);
}

/**
 * Routine full-suite invocation: one disposable database and server per
 * explicit file group, stopped before the next group starts. Every group runs
 * even when an earlier test fails; startup and cleanup failures are reported
 * alongside those test failures instead of replacing them.
 */
async function runGroupedSuite(
	projectRoot: string,
	playwrightArgs: readonly string[]
): Promise<number> {
	let groups: readonly E2EGroupDefinition[];
	try {
		groups = planFullSuiteGroups(discoverSpecFiles(projectRoot));
	} catch (error) {
		process.stderr.write(`${errorMessage(error)}\n`);
		return 1;
	}

	const suiteRunId = createRunId();
	const artifactsRoot = path.join(
		projectRoot,
		'e2e',
		'artifacts',
		'groups',
		suiteRunId
	);
	process.stdout.write(
		`[e2e] full suite: ${groups.length} sequential owned groups; artifacts at ${path.relative(projectRoot, artifactsRoot)}\n`
	);
	if (playwrightArgs.length > 0) {
		process.stdout.write(
			`[e2e] forwarding non-selector Playwright options to every group: ${playwrightArgs.join(' ')}\n`
		);
	}

	const outcomes: GroupOutcome[] = [];
	let interruptedSignal: NodeJS.Signals | null = null;
	const onSigint = (): void => {
		interruptedSignal ??= 'SIGINT';
	};
	const onSigterm = (): void => {
		interruptedSignal ??= 'SIGTERM';
	};
	process.on('SIGINT', onSigint);
	process.on('SIGTERM', onSigterm);

	try {
		for (let index = 0; index < groups.length; index += 1) {
			if (interruptedSignal !== null) break;
			const group = groups[index];
			const specFiles = group.specs.map((spec) => spec.file);
			process.stdout.write(
				`[e2e] group ${index + 1}/${groups.length} ${group.name}: ${specFiles.join(', ')} ` +
					`(artifacts ${path.relative(projectRoot, path.join(artifactsRoot, group.name))})\n`
			);

			let harness: E2EHarness | null = null;
			let startupError: unknown = null;
			if (interruptedSignal === null) {
				try {
					harness = await startE2EHarness({ projectRoot });
				} catch (error) {
					startupError = error;
				}
			}

			if (harness === null) {
				if (startupError === null) {
					// The interrupt arrived after the loop check but before this
					// group could start; no owned resource exists to clean up.
					break;
				}
				const outcome: GroupOutcome = {
					group,
					testResult: null,
					testError: null,
					startupError,
					cleanupError: null,
				};
				outcomes.push(outcome);
				reportGroupOutcome(outcome);
				if (interruptedSignal !== null) break;
				continue;
			}

			let testResult: PlaywrightResult | null = null;
			let testError: unknown = null;
			if (interruptedSignal === null) {
				const groupArtifactsDir = path.join(artifactsRoot, group.name);
				try {
					testResult = await runPlaywright(
						harness,
						[...specFiles, ...playwrightArgs],
						{ E2E_ARTIFACTS_DIR: groupArtifactsDir }
					);
				} catch (error) {
					testError = error;
				}
			}

			let cleanupError: unknown = null;
			try {
				await harness.stop();
			} catch (error) {
				cleanupError = error;
			}

			const outcome: GroupOutcome = {
				group,
				testResult,
				testError,
				startupError: null,
				cleanupError,
			};
			outcomes.push(outcome);
			reportGroupOutcome(outcome);
			if (testResult?.signal) {
				interruptedSignal ??= testResult.signal;
			}
			if (interruptedSignal !== null) break;
		}
	} finally {
		process.removeListener('SIGINT', onSigint);
		process.removeListener('SIGTERM', onSigterm);
	}

	const failed = outcomes.filter(
		(outcome) => groupFailureReasons(outcome).length > 0
	);
	const completed = outcomes.filter((outcome) => outcome.testResult !== null);
	if (interruptedSignal !== null) {
		process.stderr.write(
			`[e2e] full suite interrupted by ${interruptedSignal}; owned cleanup finished and no further group was started. ` +
				`${groups.length - outcomes.length} group(s) did not start.\n`
		);
	}
	const failedCompleted = failed.filter(
		(outcome) => outcome.testResult !== null
	).length;
	const passed = completed.length - failedCompleted;
	const notCompleted = groups.length - completed.length;
	if (
		failed.length > 0 ||
		interruptedSignal !== null ||
		completed.length !== groups.length
	) {
		process.stderr.write(
			`[e2e] full suite FAIL: ${passed} of ${groups.length} groups passed; ` +
				`${failed.length} failed, ${notCompleted} not completed.\n`
		);
		return 1;
	}
	const specCount = groups.reduce(
		(total, group) => total + group.specs.length,
		0
	);
	process.stdout.write(
		`[e2e] full suite PASS: ${groups.length} groups, ${specCount} specs.\n`
	);
	return 0;
}

async function main(): Promise<number> {
	let invocation: E2EInvocation;
	try {
		invocation = resolveE2EInvocation(process.argv.slice(2), process.env);
	} catch (error) {
		if (error instanceof E2EUsageError) {
			process.stderr.write(`${error.message}\n`);
		} else {
			process.stderr.write(`${errorMessage(error)}\n`);
		}
		return 1;
	}
	if (invocation.localRunReason !== null) {
		process.stdout.write(
			`[e2e] Local run reason: ${invocation.localRunReason}\n`
		);
	}

	const projectRoot = process.cwd();
	if (shouldGroupFullSuite(invocation.playwrightArgs)) {
		return runGroupedSuite(projectRoot, invocation.playwrightArgs);
	}
	return runSingleHarness(invocation);
}

process.exitCode = await main();
