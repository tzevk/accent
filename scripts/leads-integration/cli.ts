#!/usr/bin/env node
// Repeatable authenticated HTTP integration command for issue #369.
// Runs the real Next server against a disposable migrated MySQL database:
// safety gate -> create DB -> staged Drizzle history with legacy evidence
// -> full migration -> start server -> login over HTTP -> run CLI scenarios
// -> verify persistence with an independent reader.
import { runLeadsIntegration } from './runner.ts';
import { resolveSafetyTarget } from './support.ts';

try {
	await runLeadsIntegration(() => resolveSafetyTarget());
} catch (error) {
	const detail =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${detail}\n`);
	process.exit(1);
}
