#!/usr/bin/env node
/**
 * Re-runs the piolium audit PoCs against a local production build and records
 * the evidence in `artifacts/security-poc-reruns.json` (ADR-evidence for
 * issue #254, story 40: "before and after are evidenced, not asserted").
 *
 * The audit bundle (`piolium/`) is gitignored, so it is absent in CI. When the
 * findings directory is missing this script prints how to obtain the bundle and
 * exits 0 without writing an artifact.
 *
 * Usage:
 *   npm run build:prod            # once, if .next is missing/stale
 *   node scripts/security-poc-reruns.mjs
 *
 * Environment: the same `.env` as the app. The server runs on POC_PORT (3122)
 * with the DEV_DB_* credentials mapped onto PROD_DB_* (the E2E harness does the
 * same); it is stopped again before the script exits.
 */
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PORT = Number(process.env.POC_PORT || 3122);
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = process.cwd();
const FINDINGS = path.join(ROOT, 'piolium', 'findings');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT = path.join(ARTIFACT_DIR, 'security-poc-reruns.json');

/** Run a command synchronously and capture everything for the artifact. */
function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		encoding: 'utf8',
		timeout: options.timeout ?? 300_000,
		env: { ...process.env, ...(options.env ?? {}) },
	});
	return {
		command: [command, ...args].join(' '),
		status: result.status,
		stdout: (result.stdout ?? '').trim().slice(-20_000),
		stderr: (result.stderr ?? '').trim().slice(-20_000),
		error: result.error ? String(result.error.message) : null,
	};
}

/** Pick the Python launcher that exists on this machine. */
function pythonCommand() {
	for (const candidate of ['python', 'python3']) {
		const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
		if (!probe.error && probe.status === 0) return candidate;
	}
	return null;
}

async function waitForHealth(timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${BASE_URL}/api/health`);
			if (response.ok) return true;
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}

const missing = [];
if (!existsSync(FINDINGS)) missing.push('piolium/findings');
if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID')))
	missing.push('.next build');
if (missing.length > 0) {
	console.log(
		`[poc-reruns] skipped: ${missing.join(', ')} missing. ` +
			'The audit bundle is not committed; run `npm run build:prod` first, then ' +
			're-run this script where `piolium/` exists.'
	);
	process.exit(0);
}

const evidence = {
	flow: 'security-poc-reruns',
	generatedAt: new Date().toISOString(),
	baseUrl: BASE_URL,
	staticCheck: run('node', ['scripts/check-route-auth.mjs']),
	c1: null,
	c2: null,
	h1: null,
	summary: {},
};

// ── start the production server on the PoC port ────────────────────────────
const serverEnv = {
	...process.env,
	NODE_ENV: 'production',
	PROD_DB_NAME: process.env.DEV_DB_NAME,
	PROD_DB_USER: process.env.DEV_DB_USER,
	PROD_DB_PASSWORD: process.env.DEV_DB_PASSWORD,
};
const server = spawn(
	process.execPath,
	[
		path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
		'start',
		'-p',
		String(PORT),
	],
	{
		cwd: ROOT,
		env: serverEnv,
		stdio: ['ignore', 'pipe', 'pipe'],
	}
);
let serverLog = '';
server.stdout.on('data', (chunk) => {
	serverLog += chunk.toString();
});
server.stderr.on('data', (chunk) => {
	serverLog += chunk.toString();
});

try {
	const healthy = await waitForHealth();
	if (!healthy) {
		evidence.summary.error = 'server did not become healthy';
	} else {
		const python = pythonCommand();
		const c1 = path.join(
			FINDINGS,
			'C1-forged-session-master-data-access',
			'poc.py'
		);
		const c2 = path.join(FINDINGS, 'C2-active-users-cookie-forgery', 'poc.py');
		const h1 = path.join(
			FINDINGS,
			'H1-stored-xss-weak-sanitize-bypass',
			'poc.js'
		);

		evidence.c1 = python
			? run(python, [c1], { env: { BASE_URL } })
			: { skipped: 'no python launcher found' };
		evidence.c2 = python
			? run(python, [c2], { env: { BASE_URL } })
			: { skipped: 'no python launcher found' };
		evidence.h1 = run('node', [h1], { env: { BASE_URL } });

		const c1Statuses = (evidence.c1.stdout ?? '').match(/-+> \d+/g) ?? [];
		const h1Result = /RESULT: ([^\n]+)/.exec(evidence.h1.stdout ?? '');
		const h1Verdict = /\{"status":"(?:confirmed|failed)"[^\n]*\}/.exec(
			evidence.h1.stdout ?? ''
		);
		evidence.summary = {
			staticCheckExit: evidence.staticCheck.status,
			c1Exit: evidence.c1.status,
			c1No2xxBypass: !c1Statuses.some((entry) => / 2\d\d$/.test(entry)),
			c2Exit: evidence.c2.status,
			h1Exit: evidence.h1.status,
			h1ResultLine: h1Result?.[1] ?? null,
			h1Verdict: h1Verdict?.[0] ?? null,
		};
	}
} finally {
	if (!server.killed) {
		server.kill('SIGTERM');
		// Give the process tree a moment before the artifact is written.
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	evidence.serverLogTail = serverLog.slice(-4_000);
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	writeFileSync(ARTIFACT, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(`[poc-reruns] wrote ${path.relative(ROOT, ARTIFACT)}`);
	console.log(`[poc-reruns] summary: ${JSON.stringify(evidence.summary)}`);
	// The piped server output keeps the event loop alive; the work is done.
	process.exit(0);
}
