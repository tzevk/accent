import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every E2E flow finishes by writing a JSON artifact under e2e/artifacts/.
 * The artifact is the repeatable proof of what the run asserted: rerun the
 * flow and regenerate it. CI uploads the directory.
 */

export const ARTIFACTS_DIR = path.join(process.cwd(), 'e2e', 'artifacts');

export function writeArtifact(
	name: string,
	data: Record<string, unknown>
): string {
	mkdirSync(ARTIFACTS_DIR, { recursive: true });
	const file = path.join(ARTIFACTS_DIR, `${name}.json`);
	writeFileSync(
		file,
		JSON.stringify(
			{ flow: name, generatedAt: new Date().toISOString(), ...data },
			null,
			2
		) + '\n'
	);
	return file;
}

export function readArtifact(name: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(path.join(ARTIFACTS_DIR, `${name}.json`), 'utf8')
	) as Record<string, unknown>;
}
