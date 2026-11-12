#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { startE2EHarness, type E2EHarness } from './environment.ts';

function errorMessage(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function runPlaywright(
	harness: E2EHarness
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	const cli = path.join(process.cwd(), 'node_modules', 'playwright', 'cli.js');
	if (!existsSync(cli)) {
		throw new Error(
			`[e2e] Playwright CLI not found at ${cli}; run npm ci and npx playwright install chromium.`
		);
	}
	const child = spawn(
		process.execPath,
		[cli, 'test', ...process.argv.slice(2)],
		{
			env: harness.playwrightEnv,
			cwd: process.cwd(),
			stdio: 'inherit',
			shell: false,
		}
	);
	const { promise, resolve, reject } = Promise.withResolvers<{
		code: number | null;
		signal: NodeJS.Signals | null;
	}>();
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

async function main(): Promise<number> {
	let harness: E2EHarness;
	try {
		harness = await startE2EHarness();
	} catch (error) {
		process.stderr.write(`${errorMessage(error)}\n`);
		return 1;
	}

	let testResult: { code: number | null; signal: NodeJS.Signals | null } | null =
		null;
	let testError: unknown = null;
	try {
		testResult = await runPlaywright(harness);
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

process.exitCode = await main();
