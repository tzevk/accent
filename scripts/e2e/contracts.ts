import { createHash, randomBytes } from 'node:crypto';

/**
 * Shared contract between the owned Node orchestrator (`scripts/e2e`) and the
 * Playwright process (`e2e/support`). Keep this module free of database and
 * filesystem access so both sides can import it safely.
 */

export const E2E_DATABASE_MAX_NAME_LENGTH = 64;
export const E2E_NAMESPACE_MAX_LENGTH = 64;

export interface E2EDatabaseTarget {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
}

export interface E2ERuntime {
	baseUrl: string;
	runTag: string;
	issue: number;
	database: E2EDatabaseTarget;
	artifactsDir: string;
}

const RUNTIME_ENV_KEYS = [
	'E2E_BASE_URL',
	'E2E_RUN_TAG',
	'E2E_ISSUE',
	'E2E_DB_HOST',
	'E2E_DB_PORT',
	'E2E_DB_NAME',
	'E2E_DB_USER',
	'E2E_ARTIFACTS_DIR',
] as const;

/** UTC so a run id is stable across machines and daylight-saving changes. */
export function createRunId(
	date: Date = new Date(),
	random: string = randomBytes(3).toString('hex')
): string {
	const pad = (value: number, width = 2): string =>
		String(value).padStart(width, '0');
	const stamp =
		`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
		`_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
	const suffix = random.toLowerCase();
	if (!/^[a-z0-9]+$/.test(suffix)) {
		throw new Error(
			`[e2e] run id suffix must be lowercase alphanumeric, got ${JSON.stringify(random)}.`
		);
	}
	return `${stamp}_${suffix}`;
}

export function buildRunTag(issue: number, runId: string): string {
	if (!Number.isInteger(issue) || issue <= 0) {
		throw new Error(`[e2e] ticket issue must be a positive integer.`);
	}
	return `E2E-${issue}-${runId}`;
}

/**
 * Build a unique disposable database name from the caller's validated
 * INTEGRATION_DB_NAME. The suffix keeps every invocation isolated and the
 * mandatory `integration` token keeps the leads safety resolver's contract.
 */
export function deriveE2EDatabaseName(baseName: string, runId: string): string {
	if (!baseName.toLowerCase().includes('integration')) {
		throw new Error(
			`[e2e] database base name ${JSON.stringify(baseName)} must contain "integration".`
		);
	}
	if (!/^[A-Za-z0-9_]+$/.test(runId)) {
		throw new Error(
			`[e2e] run id ${JSON.stringify(runId)} must match /^[A-Za-z0-9_]+$/.`
		);
	}
	const suffix = `_e2e_${runId}`;
	const available = E2E_DATABASE_MAX_NAME_LENGTH - suffix.length;
	if (available < 1) {
		throw new Error(
			`[e2e] run id ${JSON.stringify(runId)} leaves no room for a database name.`
		);
	}
	const trimmedBase =
		baseName.length > available ? baseName.slice(0, available) : baseName;
	const name = `${trimmedBase}${suffix}`;
	if (!name.toLowerCase().includes('integration')) {
		throw new Error(
			`[e2e] cannot shorten ${JSON.stringify(baseName)} without dropping "integration"; use a shorter INTEGRATION_DB_NAME.`
		);
	}
	return name;
}

/** `E2E-<issue>-<run>-<worker>[-suffix]`, shortened for narrow columns. */
export function fixtureNamespace(
	runTag: string,
	workerIndex: number,
	suffix?: string,
	maxLength: number = E2E_NAMESPACE_MAX_LENGTH
): string {
	if (!Number.isInteger(workerIndex) || workerIndex < 0) {
		throw new Error(`[e2e] worker index must be a non-negative integer.`);
	}
	const namespace = `${runTag}-${workerIndex}${suffix ? `-${suffix}` : ''}`;
	return fitIdentifier(namespace, maxLength);
}

/**
 * Trim a unique fixture identifier to a database column limit while keeping a
 * deterministic hash tail so two long namespaces cannot collapse together.
 */
export function fitIdentifier(value: string, maxLength: number): string {
	if (!Number.isInteger(maxLength) || maxLength < 8) {
		throw new Error(`[e2e] identifier limit must be an integer of at least 8.`);
	}
	if (value.length <= maxLength) return value;
	const hash = createHash('sha256').update(value).digest('hex').slice(0, 7);
	const prefix = value.slice(0, maxLength - hash.length - 1);
	return `${prefix}-${hash}`;
}

export interface DatabaseVersion {
	major: number;
	minor: number;
	patch: number;
}

/** E2E and production both run MariaDB 10.11; MySQL is not interchangeable. */
export function parseDatabaseVersion(version: string): DatabaseVersion {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (!match) {
		throw new Error(
			`[e2e] could not read a database version from ${JSON.stringify(version)}.`
		);
	}
	const parsed: DatabaseVersion = {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
	if (parsed.major !== 10 || parsed.minor !== 11) {
		throw new Error(
			`[e2e] unsupported database version ${JSON.stringify(version)}: E2E requires only MariaDB 10.11.x, matching production 10.11.15.`
		);
	}
	return parsed;
}

/**
 * Parse the environment the orchestrator passes to the Playwright process.
 * Missing values fail closed so a bare `npx playwright test` cannot silently
 * run against an inherited operational database.
 */
export function parseE2ERuntime(
	env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): E2ERuntime {
	const missing = RUNTIME_ENV_KEYS.filter((key) => !env[key]);
	if (missing.length > 0) {
		throw new Error(
			`[e2e] missing required runtime variables: ${missing.join(', ')}. ` +
				`Run "npm run test:e2e" so the owned harness sets them.`
		);
	}
	const baseUrl = String(env.E2E_BASE_URL);
	try {
		new URL(baseUrl);
	} catch {
		throw new Error(`[e2e] E2E_BASE_URL is not a URL: ${baseUrl}`);
	}
	const port = Number(env.E2E_DB_PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`[e2e] E2E_DB_PORT must be a TCP port, got ${JSON.stringify(env.E2E_DB_PORT)}.`
		);
	}
	const issue = Number(env.E2E_ISSUE);
	if (!Number.isInteger(issue) || issue <= 0) {
		throw new Error(
			`[e2e] E2E_ISSUE must be a positive integer, got ${JSON.stringify(env.E2E_ISSUE)}.`
		);
	}
	return {
		baseUrl,
		runTag: String(env.E2E_RUN_TAG),
		issue,
		database: {
			host: String(env.E2E_DB_HOST),
			port,
			database: String(env.E2E_DB_NAME),
			user: String(env.E2E_DB_USER),
			password: String(env.E2E_DB_PASSWORD ?? ''),
		},
		artifactsDir: String(env.E2E_ARTIFACTS_DIR),
	};
}
