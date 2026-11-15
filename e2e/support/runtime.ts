import { createConnection, type Connection } from 'mysql2/promise';
import {
	fixtureNamespace,
	fitIdentifier,
	parseE2ERuntime,
	type E2ERuntime,
} from '../../scripts/e2e/contracts.ts';

export type { E2ERuntime } from '../../scripts/e2e/contracts.ts';
export { fixtureNamespace, fitIdentifier, parseE2ERuntime };

/** Read the runtime the orchestrator published for this Playwright process. */
export function readE2ERuntime(): E2ERuntime {
	return parseE2ERuntime();
}

/**
 * Open an independent fixture reader. Tests use this instead of the app's pool
 * so stored payroll evidence can be checked without trusting the route under
 * test. The caller owns and closes the connection.
 */
export async function connectFixtureReader(
	runtime: E2ERuntime
): Promise<Connection> {
	return createConnection({
		host: runtime.database.host,
		port: runtime.database.port,
		database: runtime.database.database,
		user: runtime.database.user,
		password: runtime.database.password,
		dateStrings: true,
	});
}

export { fixtureNamespace as namespaceForWorker };
