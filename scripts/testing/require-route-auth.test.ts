// @vitest-environment node
import { resolve } from 'node:path';
import { Linter } from 'eslint';
import nextTypeScriptConfigs from 'eslint-config-next/typescript';
import { describe, expect, it } from 'vitest';
import rule from './require-route-auth.ts';

const RULE_ID = 'accent/require-route-auth';
const ROUTE_FILENAME = resolve('src/app/api/widgets/route.ts');

interface AllowlistEntry {
	path: string;
	methods: string[];
	reason: string;
}

const parser = nextTypeScriptConfigs
	.map((config) => config.languageOptions?.parser)
	.find((candidate) => candidate !== undefined);

if (!parser) {
	throw new Error('eslint-config-next/typescript must configure a parser');
}

const linter = new Linter({ cwd: process.cwd(), configType: 'flat' });

function lint(
	code: string,
	allowlist: AllowlistEntry[] = [],
	filename = ROUTE_FILENAME
): Linter.LintMessage[] {
	const messages = linter.verify(
		code,
		[
			{
				// The filename fixture lives under the repository cwd. Without a
				// `files` match ESLint reports "No matching configuration found".
				files: ['**/*.ts', '**/*.js'],
				languageOptions: {
					parser,
					ecmaVersion: 2022,
					sourceType: 'module',
				},
				plugins: {
					accent: {
						rules: { 'require-route-auth': rule },
					},
				},
				rules: {
					[RULE_ID]: ['error', { allowlist }],
				},
				linterOptions: {
					reportUnusedDisableDirectives: 'off',
				},
			},
		],
		{ filename }
	);

	// Every diagnostic must come from this rule. A configuration warning or an
	// ignored-file notice has `ruleId: null` and would otherwise look like a
	// clean negative result.
	expect(messages.filter((message) => message.fatal)).toEqual([]);
	expect(messages.filter((message) => message.ruleId !== RULE_ID)).toEqual([]);

	return messages;
}

const PUBLIC_GET: AllowlistEntry = {
	path: 'src/app/api/widgets/route.ts',
	methods: ['GET'],
	reason: 'Public liveness probe used by the test.',
};

describe('handler coverage', () => {
	it('passes handlers that call an approved guard', () => {
		const messages = lint(`
			import { ensurePermission, getServerAuth } from '@/utils/api-permissions';

			export async function GET(request: Request) {
				const auth = await ensurePermission(request, 'leads', 'read');
				if (auth instanceof Response) return auth;
				return Response.json({ ok: true });
			}

			export async function POST(request: Request) {
				const session = await getServerAuth();
				if (!session.authenticated) return new Response(null, { status: 401 });
				return Response.json({ ok: true });
			}
		`);

		expect(messages).toEqual([]);
	});

	it('fails only the unguarded method when GET and DELETE are mixed', () => {
		const messages = lint(`
			import { ensurePermission } from '@/utils/api-permissions';

			export async function GET(request: Request) {
				await ensurePermission(request, 'leads', 'read');
				return Response.json({ ok: true });
			}

			export async function DELETE() {
				return Response.json({ ok: true });
			}
		`);

		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('missingAuth');
		expect(messages[0].message).toContain('HTTP DELETE');
	});

	it('does not accept a bare guard reference', () => {
		const messages = lint(`
			import { getCurrentUser } from '@/utils/api-permissions';

			export async function GET() {
				getCurrentUser;
				return Response.json({ ok: true });
			}
		`);

		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('missingAuth');
	});

	it('does not accept comments, imports, or unused nested guards', () => {
		const messages = lint(`
			import { ensurePermission } from '@/utils/api-permissions';

			// ensurePermission(request, 'leads', 'read')
			export async function GET(request: Request) {
				function unused() {
					return ensurePermission(request, 'leads', 'read');
				}

				const alsoUnused = async () => ensurePermission(request, 'leads', 'read');
				return Response.json({ ok: true });
			}
		`);

		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('missingAuth');
	});

	it('accepts a module helper when the handler calls it', () => {
		const messages = lint(`
			import { ensurePermission, getCurrentUser } from '@/utils/api-permissions';

			async function authorize(request: Request) {
				return ensurePermission(request, 'leads', 'read');
			}

			export async function GET(request: Request) {
				const auth = await authorize(request);
				if (auth instanceof Response) return auth;
				return Response.json({ ok: true });
			}

			export async function POST(request: Request) {
				const authorizeLocally = async () => getCurrentUser(request);
				const user = await authorizeLocally();
				if (!user) return new Response(null, { status: 401 });
				return Response.json({ ok: true });
			}
		`);

		expect(messages).toEqual([]);
	});

	it('accepts variable exports and a local export specifier', () => {
		const messages = lint(`
			import { ensurePermission, getServerAuth } from '@/utils/api-permissions';

			export async function GET(request: Request) {
				return ensurePermission(request, 'leads', 'read');
			}

			export function POST(request: Request) {
				return ensurePermission(request, 'leads', 'create');
			}

			export const PUT = async (request: Request) => {
				const session = await getServerAuth();
				if (!session.authenticated) return new Response(null, { status: 401 });
				return Response.json({ ok: true });
			};

			export const PATCH = async (request: Request) =>
				ensurePermission(request, 'leads', 'update');

			async function removeHandler(request: Request) {
				return ensurePermission(request, 'leads', 'delete');
			}

			export { removeHandler as DELETE };
		`);

		expect(messages).toEqual([]);
	});

	it('fails closed on an external re-export unless its method is allowlisted', () => {
		const code = `export { GET, handler as POST } from './other-route';`;

		const messages = lint(code);
		expect(messages).toHaveLength(2);
		expect(
			messages.every((message) => message.messageId === 'unverifiableExport')
		).toBe(true);
		expect(messages.map((message) => message.message)).toEqual([
			expect.stringContaining('HTTP GET'),
			expect.stringContaining('HTTP POST'),
		]);

		const allowlisted = lint(code, [
			{
				path: 'src/app/api/widgets/route.ts',
				methods: ['GET', 'POST'],
				reason: 'Reviewed forwarder used by the test.',
			},
		]);
		expect(allowlisted).toEqual([]);
	});

	it('fails closed on a wildcard re-export', () => {
		const messages = lint(`export * from './other-route';`);

		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('wildcardReexport');
	});
});

describe('allowlist scope', () => {
	it('exempts only the named HTTP method', () => {
		const code = `
			export async function GET() {
				return Response.json({ ok: true });
			}

			export async function POST() {
				return Response.json({ ok: true });
			}
		`;

		const messages = lint(code, [PUBLIC_GET]);

		expect(messages).toHaveLength(1);
		expect(messages[0].message).toContain('HTTP POST');
	});

	it('does not treat a wildcard as an HTTP method', () => {
		const messages = lint(
			`
				export async function GET() {
					return Response.json({ ok: true });
				}
			`,
			[
				{
					path: 'src/app/api/widgets/route.ts',
					methods: ['*'],
					reason: 'A wildcard must not act as an HTTP method.',
				},
			]
		);

		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('missingAuth');
	});

	it('matches the repository path, not just the file name', () => {
		const messages = lint(
			`export async function GET() { return Response.json({ ok: true }); }`,
			[
				{
					path: 'src/app/api/elsewhere/route.ts',
					methods: ['GET'],
					reason: 'A different path must not exempt this file.',
				},
			]
		);

		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('missingAuth');
	});
});

describe('inline disables', () => {
	it('reports a disable comment that targets this rule', () => {
		const messages = lint(`
			// eslint-disable-next-line accent/require-route-auth
			export async function GET() {
				return Response.json({ ok: true });
			}
		`);

		expect(
			messages.some((message) => message.messageId === 'inlineDisable')
		).toBe(true);
	});

	it('leaves a qualified disable for an unrelated built-in rule alone', () => {
		const messages = lint(`
			/* eslint-disable no-debugger */
			debugger;

			export async function GET(request: Request) {
				await getCurrentUser(request);
				return Response.json({ ok: true });
			}
		`);

		expect(messages).toEqual([]);
	});
});

describe('scope', () => {
	it('ignores files outside src/app/api route modules', () => {
		const messages = lint(
			`
				export async function GET() {
					return Response.json({ ok: true });
				}
			`,
			[],
			resolve('src/server/widgets.ts')
		);

		expect(messages).toEqual([]);
	});

	it('ignores named exports that are not HTTP methods', () => {
		const messages = lint(`
			export async function helper() {
				return 1;
			}
		`);

		expect(messages).toEqual([]);
	});
});
