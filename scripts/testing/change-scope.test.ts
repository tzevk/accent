// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyTestScope } from './change-scope.ts';

const ROOT_DOCUMENTS = [
	'AGENTS.md',
	'CODING_STANDARDS.md',
	'GLOSSARY.md',
	'README.md',
];

const RUNTIME_PATHS = [
	'src/app/page.tsx',
	'src/lib/money.ts',
	'src/server/reports/route.ts',
	'migrations/20260101_add_table.js',
	'knexfile.js',
	'next.config.ts',
	'package.json',
	'package-lock.json',
	'vitest.config.ts',
	'scripts/testing/ci-scope.ts',
	'.github/workflows/checks.yml',
];

describe('documentation-only selection', () => {
	it('turns the runtime suites off when every changed file is documentation', () => {
		const decision = classifyTestScope([
			...ROOT_DOCUMENTS,
			'docs/README.md',
			'docs/app/payroll/operator-guide.md',
			'docs/adr/0011-route-authorization.md',
		]);

		expect(decision.runtime).toBe(false);
	});

	it.each(ROOT_DOCUMENTS)(
		'treats the root document %s as documentation',
		(document) => {
			expect(classifyTestScope([document, 'docs/todo/notes.md']).runtime).toBe(
				false
			);
		}
	);
});

describe('runtime selection', () => {
	it.each(RUNTIME_PATHS)(
		'keeps runtime checks for the changed path %s',
		(changedPath) => {
			const decision = classifyTestScope([changedPath]);

			expect(decision.runtime).toBe(true);
		}
	);

	it('keeps runtime checks when documentation is mixed with source', () => {
		const decision = classifyTestScope(['docs/README.md', 'src/lib/money.ts']);

		expect(decision.runtime).toBe(true);
	});

	it('keeps runtime checks when a move out of src reports the deleted path', () => {
		// `git diff --no-renames` lists both sides of a move; the old source path
		// must select the suites even though the new path is documentation.
		const decision = classifyTestScope([
			'src/app/payroll/operator-guide.md',
			'docs/app/payroll/operator-guide.md',
		]);

		expect(decision.runtime).toBe(true);
	});

	it('treats any file under docs/ as documentation, not just Markdown', () => {
		const decision = classifyTestScope([
			'docs/diagram.png',
			'docs/notes.txt',
			'docs/examples/sample.json',
		]);

		expect(decision.runtime).toBe(false);
	});

	it('keeps runtime checks for unknown root Markdown and nested READMEs', () => {
		const lookalikes = [
			'NOTES.md',
			'CONTRIBUTING.md',
			'PRODUCT.md',
			'readme.md',
			'Docs/README.md',
			'README.md.bak',
			'docs-old/guide.md',
			'docs-backup/guide.md',
			'docs',
			'extras/README.md',
			'extras/AGENTS.md',
			'src/README.md',
			'src/app/payroll/README.md',
			'./docs/README.md',
			' README.md',
		];

		for (const lookalike of lookalikes) {
			expect(classifyTestScope([lookalike]).runtime, lookalike).toBe(true);
		}
	});

	it('keeps runtime checks for an empty changed-file list', () => {
		const decision = classifyTestScope([]);

		expect(decision.runtime).toBe(true);
	});
});

describe('input handling', () => {
	it('accepts frozen input and leaves it unchanged', () => {
		const files = Object.freeze([
			'docs/README.md',
			'src/lib/money.ts',
			'src/lib/money.ts',
		]);

		expect(classifyTestScope(files).runtime).toBe(true);
		expect(files).toEqual([
			'docs/README.md',
			'src/lib/money.ts',
			'src/lib/money.ts',
		]);
	});
});
