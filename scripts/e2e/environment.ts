import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import type { Connection as MysqlConnection } from 'mysql2/promise';
import { z } from 'zod';
import {
	connectReader,
	connectServer,
	hashFixturePassword,
	type Connection,
	type ResolvedSafety,
} from '../leads-integration/support.ts';
import {
	buildRunTag,
	createRunId,
	fitIdentifier,
	fixtureNamespace,
	type E2ERuntime,
} from './contracts.ts';
import {
	assertNoUnownedNextProcess,
	assertSupportedDatabase,
	chooseAppPort,
	removeOwnedDevLock,
	resolveE2ETarget,
} from './safety.ts';

const HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const APP_REQUEST_TIMEOUT_MS = 120_000;

const HealthResponseSchema = z
	.object({ status: z.literal('ok') })
	.passthrough();
const ProbeLoginResponseSchema = z
	.object({
		success: z.literal(true),
		user: z.object({ id: z.number() }).passthrough(),
	})
	.passthrough();

function fail(message: string): never {
	throw new Error(`[e2e] ${message}`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function log(message: string): void {
	process.stdout.write(`[e2e] ${message}\n`);
}

function errorNumber(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null || !('errno' in error)) {
		return undefined;
	}
	return typeof error.errno === 'number' ? error.errno : undefined;
}

function assertIdentifier(name: string): void {
	if (!/^[A-Za-z0-9_]+$/.test(name)) {
		fail(`refusing database name ${JSON.stringify(name)}.`);
	}
}

async function createDatabase(target: ResolvedSafety): Promise<void> {
	assertIdentifier(target.name);
	const connection = await connectServer(target);
	try {
		await connection.execute(
			`CREATE DATABASE \`${target.name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
			[]
		);
	} catch (error) {
		if (errorNumber(error) === 1007) {
			fail(
				`refusing to reuse existing database ${JSON.stringify(target.name)}: ` +
					`drop it manually or run again with a new run id.`
			);
		}
		throw error;
	} finally {
		await connection.end();
	}
}

async function dropDatabase(target: ResolvedSafety): Promise<void> {
	assertIdentifier(target.name);
	const connection = await connectServer(target);
	try {
		await connection.execute(
			`DROP DATABASE IF EXISTS \`${target.name}\``,
			[]
		);
	} finally {
		await connection.end();
	}
}

async function migrateDatabase(
	target: ResolvedSafety,
	projectRoot: string
): Promise<void> {
	const knex: Knex = knexFactory({
		client: 'mysql2',
		connection: {
			host: target.host,
			// Pass the resolved port explicitly. INTEGRATION_DB_PORT alone is
			// never allowed to steer migrations through configuration drift.
			port: target.port,
			user: target.user,
			password: target.password,
			database: target.name,
			dateStrings: true,
		},
		migrations: { directory: path.join(projectRoot, 'migrations') },
	});
	try {
		await knex.migrate.latest();
	} finally {
		await knex.destroy();
	}
}

async function verifyMigratedDatabase(
	reader: Connection,
	expectedName: string
): Promise<void> {
	const [databaseRows] = await reader.execute(
		'SELECT DATABASE() AS database_name',
		[]
	);
	if (String(databaseRows[0]?.database_name ?? '') !== expectedName) {
		fail(
			`migration reader connected to ${JSON.stringify(databaseRows[0]?.database_name)}, expected ${JSON.stringify(expectedName)}.`
		);
	}
	const [migrationRows] = await reader.execute(
		'SELECT COUNT(*) AS total FROM knex_migrations',
		[]
	);
	if (Number(migrationRows[0]?.total ?? 0) === 0) {
		fail('the disposable database has no recorded migrations.');
	}
}

/**
 * Seed a throwaway login and use the real route to prove the running app is
 * connected to the disposable database, not an inherited operational fallback.
 * The probe user disappears with the database.
 */
async function verifyApplicationDatabase(
	baseUrl: string,
	reader: Connection,
	runTag: string
): Promise<void> {
	const username = fitIdentifier(`${runTag}-probe`, 50);
	const password = randomBytes(24).toString('hex');
	const passwordHash = await hashFixturePassword(password);
	await reader.execute(
		`INSERT INTO users
       (username, password_hash, full_name, status, permissions, is_active, isDelete, is_super_admin)
     VALUES (?, ?, ?, 'active', '[]', 1, 0, 0)`,
		[username, passwordHash, 'E2E app-target probe']
	);

	let response: Response;
	try {
		response = await fetch(`${baseUrl}/api/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
			signal: AbortSignal.timeout(APP_REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		fail(
			`application probe login could not reach ${baseUrl}: ${errorMessage(error)}.`
		);
	}
	const text = await response.text();
	if (!response.ok) {
		fail(
			`application does not reach the disposable database: probe login returned ` +
				`HTTP ${response.status} (${text.slice(0, 300)}). Check DEV_DB_*, DB_HOST, and DB_PORT pinning.`
		);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		fail('application probe login returned a non-JSON response.');
	}
	const probe = ProbeLoginResponseSchema.safeParse(payload);
	if (!probe.success) {
		fail(
			'application probe login did not authenticate the user created in the disposable database; ' +
				'the app may be connected to a different database.'
		);
	}
}

async function waitForHealth(
	baseUrl: string,
	server: ChildProcess,
	timeoutMs: number
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	const serverState: { error: Error | null } = { error: null };
	server.once('error', (error) => {
		serverState.error = error;
	});
	let lastError = 'unknown';
	while (Date.now() < deadline) {
		if (serverState.error !== null) {
			fail(`server process failed to start: ${serverState.error.message}`);
		}
		if (server.exitCode !== null || server.signalCode !== null) {
			fail(
				`server process exited (code ${String(server.exitCode)}) before becoming healthy. ` +
					`Check for a stale .next/dev/lock or an unowned process on the chosen port.`
			);
		}
		try {
			const response = await fetch(`${baseUrl}/api/health`, {
				signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
			});
			if (response.ok) {
				const payload: unknown = await response.json();
				if (HealthResponseSchema.safeParse(payload).success) return;
				lastError = `unexpected body ${JSON.stringify(payload)}`;
			} else {
				lastError = `status ${response.status}`;
			}
		} catch (error) {
			lastError = errorMessage(error);
		}
		const tick = Promise.withResolvers<void>();
		setTimeout(tick.resolve, 1_000);
		await tick.promise;
	}
	fail(`server at ${baseUrl} never became healthy: ${lastError}`);
}

function appChildEnv(
	target: ResolvedSafety,
	port: number
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	// Inherited URLs and CA paths must not redirect the pool regardless of the
	// pinned branch variables. `next dev` loads .env without overriding these.
	delete env.DATABASE_URL;
	delete env.DB_SSL_CA_PATH;
	return {
		...env,
		...target.serverEnv,
		PORT: String(port),
		HOSTNAME: '127.0.0.1',
		NEXT_TELEMETRY_DISABLED: '1',
	};
}

function startAppServer(
	target: ResolvedSafety,
	projectRoot: string,
	port: number
): ChildProcess {
	const nextBin = path.join(
		projectRoot,
		'node_modules',
		'next',
		'dist',
		'bin',
		'next'
	);
	if (!existsSync(nextBin)) {
		fail(`Next CLI not found at ${nextBin}; run npm ci first.`);
	}
	const child = spawn(
		process.execPath,
		[nextBin, 'dev', '--port', String(port), '--hostname', '127.0.0.1'],
		{
			env: appChildEnv(target, port),
			cwd: projectRoot,
			stdio: 'inherit',
			shell: false,
		}
	);
	child.on('error', (error) => {
		log(`server process error: ${error.message}`);
	});
	return child;
}

async function stopTaskkillTree(pid: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
		stdio: 'ignore',
		shell: false,
	});
	killer.on('error', () => resolve());
	killer.on('close', () => resolve());
	await promise;
}

async function stopAppServer(server: ChildProcess | null): Promise<void> {
	if (!server || server.exitCode !== null || server.signalCode !== null) return;
	// On Windows the dev server owns a child tree. Kill the whole tree first;
	// SIGTERM to the parent alone orphans children that keep the port and lock.
	if (process.platform === 'win32' && server.pid !== undefined) {
		await stopTaskkillTree(server.pid);
		if (server.exitCode !== null || server.signalCode !== null) return;
	}
	const { promise, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(() => {
		try {
			server.kill('SIGKILL');
		} catch {}
		resolve();
	}, 10_000);
	server.once('exit', () => {
		clearTimeout(timer);
		resolve();
	});
	if (process.platform !== 'win32') {
		try {
			server.kill('SIGTERM');
		} catch {
			clearTimeout(timer);
			resolve();
		}
	} else if (server.exitCode !== null || server.signalCode !== null) {
		clearTimeout(timer);
		resolve();
	}
	await promise;
}

export interface E2EFixtureHookContext {
	runtime: E2ERuntime;
	/** Independent mysql2 reader owned by the harness; hooks must not end it. */
	reader: MysqlConnection;
	namespace: (workerIndex: number, suffix?: string) => string;
}

export interface E2EFixtureHooks {
	seed: (context: E2EFixtureHookContext) => Promise<void>;
	cleanup?: (context: E2EFixtureHookContext) => Promise<void>;
}

interface LoadedHooks {
	hooks: E2EFixtureHooks;
	modulePath: string;
}

interface HookModule extends Partial<E2EFixtureHooks> {
	default?: E2EFixtureHooks;
	hooks?: E2EFixtureHooks;
}

async function loadFixtureHooks(
	projectRoot: string
): Promise<LoadedHooks | null> {
	const modulePath = path.join(projectRoot, 'e2e', 'fixtures', 'hooks.ts');
	if (!existsSync(modulePath)) return null;
	// The hook module belongs to the following journey ticket and may not exist
	// yet, so the specifier is genuinely runtime-selected.
	const moduleExports = (await import(
		pathToFileURL(modulePath).href
	)) as HookModule;
	const exported = moduleExports.default ?? moduleExports.hooks;
	if (exported !== undefined) {
		if (typeof exported.seed !== 'function') {
			fail(
				`${path.relative(projectRoot, modulePath)} must export a seed(context) function.`
			);
		}
		return { hooks: exported, modulePath };
	}
	if (typeof moduleExports.seed !== 'function') {
		fail(
			`${path.relative(projectRoot, modulePath)} must export a seed(context) function.`
		);
	}
	return {
		hooks: { seed: moduleExports.seed, cleanup: moduleExports.cleanup },
		modulePath,
	};
}

export interface StartE2EHarnessOptions {
	projectRoot?: string;
	env?: NodeJS.ProcessEnv;
	issue?: number;
	runId?: string;
	/** E2E_PORT; when omitted the OS supplies a free loopback port. */
	port?: string;
}

export interface E2EHarness {
	runtime: E2ERuntime;
	reader: Connection;
	hooks: E2EFixtureHooks | null;
	/** Pinned environment for the Playwright child process. */
	playwrightEnv: NodeJS.ProcessEnv;
	stop: () => Promise<void>;
}

/**
 * Create the disposable database, migrate it with an explicit port, run the
 * following ticket's fixture hook, then start and verify an owned Next server.
 * Any setup failure cleans up every resource created so far.
 */
export async function startE2EHarness(
	options: StartE2EHarnessOptions = {}
): Promise<E2EHarness> {
	const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
	const env = options.env ?? process.env;
	const issue = options.issue ?? Number(env.E2E_ISSUE ?? 426);
	const runId = options.runId ?? createRunId();
	const runTag = buildRunTag(issue, runId);
	const artifactsDir = path.join(projectRoot, 'e2e', 'artifacts');

	log(`run ${runTag}`);

	let target: ResolvedSafety | null = null;
	let reader: Connection | null = null;
	let server: ChildProcess | null = null;
	let serverPid: number | undefined;
	let port = 0;
	let databaseCreated = false;
	let loadedHooks: LoadedHooks | null = null;
	let stopped = false;

	const hookContext = (): E2EFixtureHookContext => {
		if (target === null || reader === null) {
			throw new Error('[e2e] fixture hooks requested before setup completed.');
		}
		return {
			runtime: {
				baseUrl: `http://127.0.0.1:${port}`,
				runTag,
				issue,
				database: {
					host: target.host,
					port: target.port,
					database: target.name,
					user: target.user,
					password: target.password,
				},
				artifactsDir,
			},
			// connectReader returns a real mysql2/promise connection behind a
			// narrower local interface; hook fixtures need the full library type.
			reader: reader as unknown as MysqlConnection,
			namespace: (workerIndex: number, suffix?: string) =>
				fixtureNamespace(runTag, workerIndex, suffix),
		};
	};

	const cleanup = async (): Promise<string[]> => {
		const errors: string[] = [];
		if (loadedHooks !== null) {
			try {
				await loadedHooks.hooks.cleanup?.(hookContext());
			} catch (error) {
				errors.push(`fixture cleanup: ${errorMessage(error)}`);
			}
		}
		try {
			await stopAppServer(server);
		} catch (error) {
			errors.push(`stopping the app server: ${errorMessage(error)}`);
		}
		if (serverPid !== undefined) {
			try {
				removeOwnedDevLock(projectRoot, serverPid, port);
			} catch (error) {
				errors.push(`removing the owned dev lock: ${errorMessage(error)}`);
			}
		}
		server = null;
		serverPid = undefined;
		if (reader !== null) {
			try {
				await reader.end();
			} catch (error) {
				errors.push(`closing the fixture reader: ${errorMessage(error)}`);
			}
			reader = null;
		}
		if (databaseCreated && target !== null) {
			try {
				await dropDatabase(target);
			} catch (error) {
				errors.push(`dropping ${target.name}: ${errorMessage(error)}`);
			}
		}
		return errors;
	};

	try {
		await mkdir(artifactsDir, { recursive: true });

		target = resolveE2ETarget(env, runId);
		await assertSupportedDatabase(target);
		assertNoUnownedNextProcess(projectRoot);
		port = await chooseAppPort(options.port ?? env.E2E_PORT);
		log(
			`disposable target ${target.host}:${String(target.port)}/${target.name}; app port ${port}`
		);

		await createDatabase(target);
		databaseCreated = true;
		log('migrating the disposable database');
		await migrateDatabase(target, projectRoot);

		reader = await connectReader(target);
		await verifyMigratedDatabase(reader, target.name);

		loadedHooks = await loadFixtureHooks(projectRoot);
		if (loadedHooks === null) {
			log('no e2e/fixtures/hooks.ts yet; skipping fixture seed.');
		} else {
			await loadedHooks.hooks.seed(hookContext());
		}

		server = startAppServer(target, projectRoot, port);
		serverPid = server.pid;
		log(`waiting for the owned app at http://127.0.0.1:${port}`);
		await waitForHealth(`http://127.0.0.1:${port}`, server, HEALTH_TIMEOUT_MS);
		await verifyApplicationDatabase(`http://127.0.0.1:${port}`, reader, runTag);
		log('app target verified');
	} catch (error) {
		const cleanupErrors = await cleanup();
		if (cleanupErrors.length > 0) {
			fail(
				`${errorMessage(error)}\ncleanup also failed:\n- ${cleanupErrors.join('\n- ')}`
			);
		}
		throw error;
	}

	const runtime = hookContext().runtime;
	const playwrightEnv: NodeJS.ProcessEnv = {
		...appChildEnv(target, port),
		E2E_BASE_URL: runtime.baseUrl,
		E2E_RUN_TAG: runtime.runTag,
		E2E_ISSUE: String(runtime.issue),
		E2E_DB_HOST: runtime.database.host,
		E2E_DB_PORT: String(runtime.database.port),
		E2E_DB_NAME: runtime.database.database,
		E2E_DB_USER: runtime.database.user,
		E2E_DB_PASSWORD: runtime.database.password,
		E2E_ARTIFACTS_DIR: runtime.artifactsDir,
	};

	return {
		runtime,
		reader,
		hooks: loadedHooks?.hooks ?? null,
		playwrightEnv,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			const cleanupErrors = await cleanup();
			if (cleanupErrors.length > 0) {
				fail(`cleanup failed:\n- ${cleanupErrors.join('\n- ')}`);
			}
		},
	};
}

/**
 * Run a callback against an owned harness. Exported so an outside-repo
 * inspection script can hold fixtures and the server, then clean up on signal.
 */
export async function withE2EHarness<T>(
	callback: (harness: E2EHarness) => Promise<T>,
	options: StartE2EHarnessOptions = {}
): Promise<T> {
	const harness = await startE2EHarness(options);
	const outcome = await callback(harness).then(
		(value) => ({ ok: true as const, value }),
		(error: unknown) => ({ ok: false as const, error })
	);
	try {
		await harness.stop();
	} catch (cleanupError) {
		if (!outcome.ok) {
			fail(
				`${errorMessage(outcome.error)}\ncleanup also failed: ${errorMessage(cleanupError)}`
			);
		}
		throw cleanupError;
	}
	if (!outcome.ok) throw outcome.error;
	return outcome.value;
}
