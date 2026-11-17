#!/usr/bin/env node
/**
 * Pull-request runtime-suite selector for the Checks workflow.
 *
 * The workflow runs this after a full-history checkout:
 *
 *   node --experimental-strip-types scripts/testing/ci-scope.ts
 *
 * Inputs (environment only; no files, databases, or servers are touched):
 *   GITHUB_EVENT_NAME  event that triggered the workflow
 *   CI_BASE_SHA        pull request base commit
 *   CI_HEAD_SHA        pull request head commit
 *   GITHUB_OUTPUT      optional step-output file; receives `runtime=<bool>`
 *
 * Uncertainty selects the runtime suites: an unknown event, unusable commit
 * ids, missing Git, or a failed diff never turn checks off. Only a verified
 * documentation-only diff does.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { classifyTestScope, type TestScopeDecision } from './change-scope.ts';

interface CiScopeResolution extends TestScopeDecision {
	/** Files Git reported between the pull request commits, in Git's order. */
	changedFiles: readonly string[];
	baseSha: string | null;
	headSha: string | null;
}

const PULL_REQUEST_EVENT = 'pull_request';

/** Abbreviated or full hexadecimal commit ids; flags and refs are rejected. */
const COMMIT_ID_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Large enough for a repository-wide rename, small enough to fail loudly. */
const DIFF_MAX_BUFFER = 32 * 1024 * 1024;

const MAX_LISTED_FILES = 20;

function allChecks(reason: string): CiScopeResolution {
	return {
		runtime: true,
		reason,
		changedFiles: [],
		baseSha: null,
		headSha: null,
	};
}

function readCommitId(value: string | undefined): string | null {
	const candidate = value?.trim();
	if (!candidate || !COMMIT_ID_PATTERN.test(candidate)) {
		return null;
	}
	return candidate.toLowerCase();
}

function firstLine(text: string): string {
	const line = text.split(/\r?\n/).find((part) => part.trim().length > 0);
	return line === undefined ? '' : line.trim();
}

/** Condenses a Git failure into one line for the printed reason. */
function describeFailure(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	const code = 'code' in error ? error.code : undefined;
	if (typeof code === 'string' && code === 'ENOENT') {
		return 'git is not installed or not on PATH';
	}
	const stderr = 'stderr' in error ? error.stderr : undefined;
	if (typeof stderr === 'string' && stderr.trim().length > 0) {
		return firstLine(stderr);
	}
	if (Buffer.isBuffer(stderr) && stderr.length > 0) {
		return firstLine(stderr.toString('utf8'));
	}
	return firstLine(error.message);
}

/**
 * Lists changed paths between the two commits. `--no-renames` is deliberate: a
 * move out of `src/` must still report the deleted source path, which keeps the
 * runtime suites selected, and `-z` avoids quoting or newline ambiguity.
 */
function listChangedFiles(baseSha: string, headSha: string): string[] {
	const stdout = execFileSync(
		'git',
		['diff', '--name-only', '--no-renames', '-z', baseSha, headSha],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			maxBuffer: DIFF_MAX_BUFFER,
			stdio: ['ignore', 'pipe', 'pipe'],
		}
	);
	return stdout.split('\0').filter((file) => file.length > 0);
}

/**
 * Resolves the runtime decision without writing anything. Non-pull-request
 * events always run the suites; pull requests are classified from the diff.
 */
function resolveCiScope(env: Readonly<NodeJS.ProcessEnv>): CiScopeResolution {
	const eventName = env.GITHUB_EVENT_NAME?.trim() ?? '';
	if (eventName !== PULL_REQUEST_EVENT) {
		return allChecks(
			eventName.length > 0
				? `event "${eventName}" is not a pull request, so the runtime suites always run`
				: 'GITHUB_EVENT_NAME is unavailable, so the runtime suites always run'
		);
	}

	const baseSha = readCommitId(env.CI_BASE_SHA);
	const headSha = readCommitId(env.CI_HEAD_SHA);
	if (baseSha === null || headSha === null) {
		return allChecks(
			'CI_BASE_SHA and CI_HEAD_SHA must both be hexadecimal commit ids, so the runtime suites always run'
		);
	}

	let changedFiles: string[];
	try {
		changedFiles = listChangedFiles(baseSha, headSha);
	} catch (error) {
		return {
			...allChecks(
				`git could not produce the diff (${describeFailure(
					error
				)}), so the runtime suites always run`
			),
			baseSha,
			headSha,
		};
	}

	return {
		...classifyTestScope(changedFiles),
		changedFiles,
		baseSha,
		headSha,
	};
}

/** Explains the decision for the workflow log and for local runs. */
function formatSummary(resolution: CiScopeResolution): string {
	const lines = [
		`[ci-scope] runtime=${resolution.runtime}`,
		`[ci-scope] reason: ${resolution.reason}`,
	];
	if (resolution.baseSha !== null && resolution.headSha !== null) {
		lines.push(
			`[ci-scope] commits: ${resolution.baseSha}..${resolution.headSha}`
		);
		if (resolution.changedFiles.length > 0) {
			lines.push(`[ci-scope] changed files: ${resolution.changedFiles.length}`);
			for (const file of resolution.changedFiles.slice(0, MAX_LISTED_FILES)) {
				lines.push(`[ci-scope]   ${file}`);
			}
			const hidden = resolution.changedFiles.length - MAX_LISTED_FILES;
			if (hidden > 0) {
				lines.push(`[ci-scope]   ... ${hidden} more`);
			}
		}
	}
	if (!resolution.runtime) {
		lines.push(
			'[ci-scope] runtime suites are skipped; any non-documentation change runs them.'
		);
	}
	return `${lines.join('\n')}\n`;
}

function main(): number {
	const resolution = resolveCiScope(process.env);
	process.stdout.write(formatSummary(resolution));

	const outputPath = process.env.GITHUB_OUTPUT?.trim();
	if (outputPath) {
		try {
			appendFileSync(outputPath, `runtime=${resolution.runtime}\n`, 'utf8');
		} catch (error) {
			process.stderr.write(
				`[ci-scope] could not append to GITHUB_OUTPUT: ${describeFailure(
					error
				)}\n`
			);
			return 1;
		}
	}
	return 0;
}

process.exitCode = main();
