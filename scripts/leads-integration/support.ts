import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// mysql2 and bcrypt are production dependencies of this repo (package.json),
// so the runner needs no extra install. Requiring them here keeps the runner
// runnable with plain `node` and unit-testable without the Next server.
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

export const SAFETY_ENV_VARS = [
	'INTEGRATION_DB_HOST',
	'INTEGRATION_DB_PORT',
	'INTEGRATION_DB_NAME',
	'INTEGRATION_DB_USER',
	'INTEGRATION_DB_PASSWORD',
] as const;

export type SafetyEnv = Record<(typeof SAFETY_ENV_VARS)[number], string>;

export interface ResolvedSafety {
	host: string;
	port: number;
	name: string;
	user: string;
	password: string;
	// Exact values the app server must use so the app pool, proxy pool,
	// and knex all point at the same disposable database.
	serverEnv: Record<string, string>;
	// Exact connection the independent reader uses (its own client).
	reader: {
		host: string;
		port: number;
		database: string;
		user: string;
		password: string;
	};
}

const FORBIDDEN_NAME_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /prod/i, reason: 'looks like a production database' },
	{ pattern: /stag/i, reason: 'looks like a staging database' },
	{
		pattern: /^accent_crm_dev/i,
		reason: 'looks like the development database',
	},
	{ pattern: /_dev(_|$)/i, reason: 'looks like a development database' },
	{ pattern: /crmaccent/i, reason: 'matches the production database name' },
];

const REQUIRED_NAME_TOKEN = 'integration';

function fail(message: string): never {
	throw new Error(`[leads-integration] ${message}`);
}

function readDotEnvValue(key: string): string | undefined {
	const envPath = path.resolve(process.cwd(), '.env');
	if (!existsSync(envPath)) return undefined;
	try {
		for (const line of readFileSync(envPath, 'utf8').split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('='))
				continue;
			const [name, ...rest] = trimmed.split('=');
			if (name.trim() === key) return rest.join('=').trim();
		}
	} catch {
		return undefined;
	}
	return undefined;
}

/** Resolve + validate the disposable integration target. Fails closed. */
export function resolveSafetyTarget(
	env: NodeJS.ProcessEnv = process.env
): ResolvedSafety {
	const missing = SAFETY_ENV_VARS.filter(
		(key) => !env[key] && key !== 'INTEGRATION_DB_PASSWORD'
	);
	if (missing.length > 0) {
		fail(
			`missing required integration database variables: ${missing.join(', ')}. ` +
				`Copy the INTEGRATION_DB_* block from .env.example into your shell (never into .env).`
		);
	}
	const host = String(env.INTEGRATION_DB_HOST);
	const port = Number(env.INTEGRATION_DB_PORT);
	const name = String(env.INTEGRATION_DB_NAME);
	const user = String(env.INTEGRATION_DB_USER);
	const password = String(env.INTEGRATION_DB_PASSWORD ?? '');

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		fail(
			`INTEGRATION_DB_PORT must be a TCP port, got ${JSON.stringify(env.INTEGRATION_DB_PORT)}.`
		);
	}
	const LOOPBACK_HOSTS: Record<string, true> = {
		'127.0.0.1': true,
		'::1': true,
		localhost: true,
	};
	if (LOOPBACK_HOSTS[host] !== true) {
		fail(
			`refusing host ${JSON.stringify(host)}: only loopback MySQL is approved for integration runs.`
		);
	}
	if (!/^[A-Za-z0-9_]+$/.test(name)) {
		fail(
			`refusing target ${JSON.stringify(name)}: INTEGRATION_DB_NAME must match /^[A-Za-z0-9_]+$/.`
		);
	}
	if (!name.toLowerCase().includes(REQUIRED_NAME_TOKEN)) {
		fail(
			`refusing target ${JSON.stringify(name)}: INTEGRATION_DB_NAME must contain ` +
				`${JSON.stringify(REQUIRED_NAME_TOKEN)} so only a disposable database is used.`
		);
	}
	for (const { pattern, reason } of FORBIDDEN_NAME_PATTERNS) {
		if (pattern.test(name))
			fail(`refusing target ${JSON.stringify(name)}: ${reason}.`);
	}
	// Never reuse the branch credentials of the real app database.
	const sensitive = ['DEV_DB_NAME', 'STAGING_DB_NAME', 'PROD_DB_NAME'] as const;
	for (const key of sensitive) {
		const value = env[key] ?? readDotEnvValue(key);
		if (value && value === name) {
			fail(
				`refusing target ${JSON.stringify(name)}: matches ${key} from app config.`
			);
		}
	}
	if (!user) fail('INTEGRATION_DB_USER must not be empty.');

	return {
		host,
		port,
		name,
		user,
		password,
		serverEnv: {
			NODE_ENV: 'development',
			DB_HOST: host,
			DB_PORT: String(port),
			DEV_DB_NAME: name,
			DEV_DB_USER: user,
			DEV_DB_PASSWORD: password,
			// Pin every branch the runtime or knex could select (NODE_ENV is set
			// to development above, so dev wins; the rest are belt and braces).
			STAGING_DB_NAME: name,
			STAGING_DB_USER: user,
			STAGING_DB_PASSWORD: password,
			PROD_DB_NAME: name,
			PROD_DB_USER: user,
			PROD_DB_PASSWORD: password,
			DB_SSL_MODE: 'off',
		},
		reader: { host, port, database: name, user, password },
	};
}

export interface Connection {
	execute: (
		sql: string,
		params?: Array<string | number | null>
	) => Promise<[Array<Record<string, unknown>>, unknown]>;
	end: () => Promise<void>;
}

export async function connectReader(
	resolved: ResolvedSafety
): Promise<Connection> {
	return (await mysql.createConnection({
		host: resolved.reader.host,
		port: resolved.reader.port,
		database: resolved.reader.database,
		user: resolved.reader.user,
		password: resolved.reader.password,
		dateStrings: true,
	})) as Connection;
}

/** Direct server connection (no database) for create/drop of the disposable DB. */
export async function connectServer(
	resolved: ResolvedSafety
): Promise<Connection> {
	return (await mysql.createConnection({
		host: resolved.host,
		port: resolved.port,
		user: resolved.user,
		password: resolved.password,
	})) as Connection;
}

export async function hashFixturePassword(plaintext: string): Promise<string> {
	return bcrypt.hash(plaintext, 10);
}

export function runIdFromDate(date: Date = new Date()): string {
	const pad = (value: number, width = 2): string =>
		String(value).padStart(width, '0');
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

export function csvEscape(value: string): string {
	return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
