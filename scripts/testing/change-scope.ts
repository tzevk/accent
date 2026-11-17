/**
 * Documentation-only test selection for pull requests.
 *
 * This module is pure: it never reads the filesystem, Git, or the environment.
 * The only changed files that may skip runtime suites are the repository's
 * documentation and reference assets. Everything else — including nested
 * README files, unknown root Markdown, configuration, scripts, and `.github` —
 * selects the full suites.
 */

export interface TestScopeDecision {
	/** Whether the runtime suites must run for this change. */
	runtime: boolean;
	/** Human-readable justification printed by the CI adapter. */
	reason: string;
}

/** Root-level Markdown documents that describe the project, not its behavior. */
const ROOT_DOCUMENTATION_FILES: Readonly<Record<string, true>> = {
	'AGENTS.md': true,
	'CODING_STANDARDS.md': true,
	'GLOSSARY.md': true,
	'README.md': true,
};

/** Repository convention: this directory holds documentation and reference assets. */
const DOCUMENTATION_DIRECTORY = 'docs/';

/**
 * True only for a Git-style repository-relative documentation path.
 * Paths are compared verbatim; no normalization is applied, so
 * an unexpected spelling can only make the selection more conservative.
 */
function isDocumentationPath(file: string): boolean {
	if (Object.hasOwn(ROOT_DOCUMENTATION_FILES, file)) {
		return true;
	}
	return (
		file.startsWith(DOCUMENTATION_DIRECTORY) &&
		file.length > DOCUMENTATION_DIRECTORY.length
	);
}

const MAX_REPORTED_PATHS = 3;

/** Names a few offending files so the printed reason is actionable. */
function describePaths(paths: readonly string[]): string {
	const listed = paths.slice(0, MAX_REPORTED_PATHS).map((file) => `"${file}"`);
	const remaining = paths.length - listed.length;
	if (remaining > 0) {
		return `${listed.join(', ')} and ${remaining} more`;
	}
	return listed.join(', ');
}

/**
 * Decides whether a pull request needs the runtime suites from the files Git
 * reports as changed. Only a nonempty, entirely documentation list disables
 * them; an empty list proves nothing and therefore selects everything.
 */
export function classifyTestScope(files: readonly string[]): TestScopeDecision {
	if (files.length === 0) {
		return {
			runtime: true,
			reason:
				'the diff reported no changed files, so no documentation-only claim can be verified',
		};
	}

	const runtimeFiles: string[] = [];
	for (const file of files) {
		if (!isDocumentationPath(file)) {
			runtimeFiles.push(file);
		}
	}

	if (runtimeFiles.length === 0) {
		return {
			runtime: false,
			reason: `all ${files.length} changed file(s) are documentation-only (under docs/ or a known root document)`,
		};
	}

	return {
		runtime: true,
		reason: `${runtimeFiles.length} of ${files.length} changed file(s) can affect runtime behavior: ${describePaths(
			runtimeFiles
		)}`,
	};
}
