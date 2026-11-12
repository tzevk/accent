import { createServer } from 'node:net';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
	connectServer,
	resolveSafetyTarget,
	type Connection,
	type ResolvedSafety,
} from '../leads-integration/support.ts';
import { deriveE2EDatabaseName, parseDatabaseVersion } from './contracts.ts';

export const NEXT_DEV_LOCK = path.join('.next', 'dev', 'lock');
export const NEXT_BUILD_LOCK = path.join('.next', 'lock');

function fail(message: string): never {
	throw new Error(`[e2e] ${message}`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Reuse the leads safety resolver, then swap in a per-invocation database name.
 * The returned `serverEnv` pins every branch the app, proxy, or Knex could use.
 */
export function resolveE2ETarget(
	env: NodeJS.ProcessEnv,
	runId: string
): ResolvedSafety {
	let base: ResolvedSafety;
	try {
		base = resolveSafetyTarget(env);
	} catch (error) {
		fail(errorMessage(error));
	}
	const databaseName = deriveE2EDatabaseName(base.name, runId);
	try {
		return resolveSafetyTarget({ ...env, INTEGRATION_DB_NAME: databaseName });
	} catch (error) {
		fail(errorMessage(error));
	}
}

/** Production runs MariaDB 10.11.15; refuse MySQL or another MariaDB line. */
export async function assertSupportedDatabase(
	target: ResolvedSafety
): Promise<void> {
	const connection: Connection = await connectServer(target);
	try {
		const [rows] = await connection.execute('SELECT VERSION() AS version', []);
		const version = String(rows[0]?.version ?? '');
		parseDatabaseVersion(version);
	} finally {
		await connection.end();
	}
}

function assertPortNumber(value: string | number, label: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		fail(`${label} must be a TCP port, got ${JSON.stringify(value)}.`);
	}
	return port;
}

function canBindLoopback(port: number): Promise<boolean> {
	const server = createServer();
	const { promise, resolve, reject } = Promise.withResolvers<boolean>();
	server.once('error', (error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
			resolve(false);
			return;
		}
		reject(error);
	});
	server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
		server.close(() => resolve(true));
	});
	return promise;
}

/**
 * An explicit E2E_PORT is checked and refused when another process owns it.
 * Without one, ask the OS for a loopback port and release it for Next.
 */
export async function chooseAppPort(preferred?: string): Promise<number> {
	if (preferred) {
		const port = assertPortNumber(preferred, 'E2E_PORT');
		if (!(await canBindLoopback(port))) {
			fail(
				`E2E_PORT ${port} is already in use by an unowned process. ` +
					`Stop it or unset E2E_PORT instead of attaching the harness to it.`
			);
		}
		return port;
	}
	const server = createServer();
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	server.once('error', reject);
	server.listen({ port: 0, host: '127.0.0.1' }, () => {
		const address = server.address();
		if (address === null || typeof address === 'string') {
			server.close();
			fail('could not allocate a loopback port.');
			return;
		}
		const port = address.port;
		server.close(() => resolve(port));
	});
	return promise;
}

interface DevLockInfo {
	pid?: number;
	appUrl?: string;
}

function readDevLock(filePath: string): DevLockInfo | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
		if (typeof parsed !== 'object' || parsed === null) return null;
		const info: DevLockInfo = {};
		if ('pid' in parsed) {
			if (typeof parsed.pid === 'number') info.pid = parsed.pid;
			if (typeof parsed.pid === 'string') {
				const pid = Number(parsed.pid);
				if (Number.isInteger(pid)) info.pid = pid;
			}
		}
		if ('appUrl' in parsed && typeof parsed.appUrl === 'string') {
			info.appUrl = parsed.appUrl;
		}
		return info;
	} catch {
		return null;
	}
}

/**
 * Refuse to start when an unowned Next dev server or build already holds the
 * project's lock. Never kill it and never attach to it.
 */
export function assertNoUnownedNextProcess(projectRoot: string): void {
	const devLock = path.join(projectRoot, NEXT_DEV_LOCK);
	if (existsSync(devLock)) {
		const info = readDevLock(devLock);
		const running =
			info?.appUrl || info?.pid
				? ` (URL ${info.appUrl ?? 'unknown'}, PID ${String(info.pid ?? 'unknown')})`
				: '';
		fail(
			`refusing to start: ${NEXT_DEV_LOCK} exists${running}. ` +
				`Another next dev server or build lock is active. Stop it, then remove the lock only after confirming its PID is gone.`
		);
	}
	const buildLock = path.join(projectRoot, NEXT_BUILD_LOCK);
	if (existsSync(buildLock)) {
		fail(
			`refusing to start: ${NEXT_BUILD_LOCK} exists. ` +
				`A next build may be running or left a lock. Stop it, then remove the lock only after confirming no build process is active.`
		);
	}
}

/**
 * Remove the dev lock only when it still names the server this invocation
 * started. A lock owned by another process is left untouched for the operator.
 */
export function removeOwnedDevLock(
	projectRoot: string,
	ownedPid: number | undefined,
	ownedPort: number
): void {
	const devLock = path.join(projectRoot, NEXT_DEV_LOCK);
	if (!existsSync(devLock)) return;
	const info = readDevLock(devLock);
	const ownsPid = ownedPid !== undefined && info?.pid === ownedPid;
	let ownsPort = false;
	if (info?.appUrl !== undefined) {
		try {
			ownsPort = Number(new URL(info.appUrl).port) === ownedPort;
		} catch {
			ownsPort = false;
		}
	}
	if (!ownsPid && !ownsPort) return;
	rmSync(devLock, { force: true });
}
