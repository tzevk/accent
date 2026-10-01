import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Route authorization guard (ADR-0011, remediation workstream A6).
 *
 * Every HTTP handler exported from `src/app/api/**\/route.{js,ts}` must
 * authorize the request itself — a reference to `getCurrentUser`,
 * `getServerAuth`, or `ensurePermission` inside the handler body — or be
 * listed in `scripts/route-auth-allowlist.json` with a reason.
 *
 * The check is per handler, not per file: `activity-master`'s GET/POST were
 * guarded while its PUT/DELETE were not, so a file-level check would miss the
 * exact gap this guard exists to catch.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'src', 'app', 'api');
const allowlistFile = path.join(root, 'scripts', 'route-auth-allowlist.json');

const HTTP_METHODS = new Set([
	'GET',
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
	'HEAD',
	'OPTIONS',
]);

const AUTH_REFERENCE = /\b(getCurrentUser|getServerAuth|ensurePermission)\b/;

/** Blank out comments and string/template literals so only code can satisfy the check. */
function stripCommentsAndStrings(source) {
	let out = '';

	for (let i = 0; i < source.length; i++) {
		const step = skipToken(source, i);
		if (step.skipped) {
			out += ' '.repeat(step.index - i + 1);
			i = step.index;
			continue;
		}
		out += source[i];
	}

	return out;
}

/** Recursively collect every `route.{js,ts}` under `dir`. */
async function collectRouteFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectRouteFiles(full)));
		} else if (/^route\.(js|ts)$/.test(entry.name)) {
			files.push(full);
		}
	}

	return files;
}

/**
 * If a string / template literal / comment starts at `index`, return the index
 * of its last character (so callers can jump past it) with `skipped: true`.
 */
function skipToken(source, index) {
	const char = source[index];
	const next = source[index + 1];

	if (char === '/' && next === '/') {
		const end = source.indexOf('\n', index);
		return { skipped: true, index: end === -1 ? source.length - 1 : end - 1 };
	}
	if (char === '/' && next === '*') {
		const end = source.indexOf('*/', index + 2);
		return { skipped: true, index: end === -1 ? source.length - 1 : end + 1 };
	}
	if (char === "'" || char === '"' || char === '`') {
		for (let i = index + 1; i < source.length; i++) {
			if (source[i] === '\\') {
				i++;
				continue;
			}
			if (source[i] === char) return { skipped: true, index: i };
		}
		return { skipped: true, index: source.length - 1 };
	}

	return { skipped: false, index };
}

/** Index of the delimiter balancing `open` at `start`, or -1. */
function skipBalanced(source, start, open, close) {
	let depth = 0;

	for (let i = start; i < source.length; i++) {
		const step = skipToken(source, i);
		if (step.skipped) {
			i = step.index;
			continue;
		}
		if (source[i] === open) depth++;
		else if (source[i] === close && --depth === 0) return i;
	}

	return -1;
}

/** Index of the next `char` outside strings/comments, or -1. */
function findNext(source, start, char) {
	for (let i = start; i < source.length; i++) {
		const step = skipToken(source, i);
		if (step.skipped) {
			i = step.index;
			continue;
		}
		if (source[i] === char) return i;
	}

	return -1;
}

function skipWhitespace(source, start) {
	let i = start;
	while (i < source.length && /\s/.test(source[i])) i++;
	return i;
}

function matchesKeywordAt(source, index, keyword) {
	return (
		source.startsWith(keyword, index) &&
		!/[\w$]/.test(source[index + keyword.length] || '')
	);
}

/**
 * Skip an `async` / `function NAME` prefix so arrow functions and function
 * expressions (`const X = async (a) => { ... }`) parse like declarations.
 */
function skipFunctionPrefix(source, start) {
	let i = skipWhitespace(source, start);

	if (matchesKeywordAt(source, i, 'async')) i = skipWhitespace(source, i + 5);

	if (matchesKeywordAt(source, i, 'function')) {
		i = skipWhitespace(source, i + 8);
		const name = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
		if (name) {
			const after = skipWhitespace(source, i + name[0].length);
			if (source[after] === '(') i = after;
		}
	}

	return i;
}

/** Keywords that look like calls but are not identifiers we care about. */
const NON_CALL_IDENTIFIERS = new Set([
	'await',
	'case',
	'catch',
	'class',
	'const',
	'delete',
	'do',
	'else',
	'export',
	'extends',
	'finally',
	'for',
	'function',
	'if',
	'import',
	'in',
	'instanceof',
	'let',
	'new',
	'of',
	'return',
	'super',
	'switch',
	'this',
	'throw',
	'try',
	'typeof',
	'var',
	'void',
	'while',
	'yield',
]);

/** Names invoked as calls in already comments/strings-stripped code. */
function collectCallees(code) {
	const callees = new Set();

	for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
		if (NON_CALL_IDENTIFIERS.has(match[1])) continue;
		callees.add(match[1]);
	}

	return callees;
}

/**
 * Same-file declarations whose body authorizes, e.g. `getRequestContext` in
 * `projects/[id]/member-details/route.ts`. A handler that calls one of these is
 * considered authorized — the one-hop delegation the per-handler rule must see
 * through. (Heuristic: it follows call sites, not data flow, so a helper that
 * merely reads the user without enforcing still counts.)
 */
function collectLocalGuards(source) {
	const guards = new Set();

	// function NAME(...) { ... }  /  export [async] function NAME(...) { ... }
	const fnPattern =
		/(?:^|[\s;{}])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
	for (const match of source.matchAll(fnPattern)) {
		const body = handlerBody(source, match.index + match[0].length - 1);
		if (AUTH_REFERENCE.test(stripCommentsAndStrings(body))) {
			guards.add(match[1]);
		}
	}

	// const NAME = async (...) => { ... }  /  const NAME = (...) => { ... }
	const bindingPattern =
		/(?:^|[\s;{}])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
	for (const match of source.matchAll(bindingPattern)) {
		const body = handlerBody(source, match.index + match[0].length);
		if (AUTH_REFERENCE.test(stripCommentsAndStrings(body))) {
			guards.add(match[1]);
		}
	}

	return guards;
}

function callsLocalGuard(code, localGuards) {
	for (const callee of collectCallees(code)) {
		if (localGuards.has(callee)) return true;
	}

	return false;
}

/**
 * First `{` after a TypeScript return annotation that starts the *body* rather
 * than a type literal. Type braces are followed by `>`/`|`/`&`/`,`/`)`/`.`; a
 * union member followed directly by `{` means the type ended and the body
 * begins; `=>` after a type is an arrow's annotation.
 */
function findBodyBraceAfterType(source, start) {
	let pos = start;

	for (;;) {
		const brace = findNext(source, pos, '{');
		if (brace === -1) return -1;

		const close = skipBalanced(source, brace, '{', '}');
		if (close === -1) return brace;

		const after = skipWhitespace(source, close + 1);
		const next = source[after] || '';

		if (next === '{') return after;
		if (next === '=' && source.startsWith('=>', after)) {
			pos = after + 2;
			continue;
		}
		if (
			next === '>' ||
			next === '|' ||
			next === '&' ||
			next === ',' ||
			next === ')' ||
			next === '.'
		) {
			pos = close + 1;
			continue;
		}

		return brace;
	}
}

/** Body text of a handler whose signature ends at `sigEnd` (block or expression). */
function handlerBody(source, sigEnd) {
	let i = skipFunctionPrefix(source, sigEnd);

	// Parameter list (skips destructured `{ params }` so it is not mistaken for the body).
	if (source[i] === '(') {
		const close = skipBalanced(source, i, '(', ')');
		if (close === -1) return '';
		i = skipWhitespace(source, close + 1);
	}

	// Arrow assignment: `export const GET = async () => { ... }`.
	if (source.startsWith('=>', i)) i = skipWhitespace(source, i + 2);

	// TypeScript return annotation: `: Promise<Response> { ... }`.
	if (source[i] === ':') {
		const brace = findBodyBraceAfterType(source, i + 1);
		if (brace === -1) return '';
		i = brace;
	}

	if (source[i] === '{') {
		const close = skipBalanced(source, i, '{', '}');
		return close === -1 ? source.slice(i) : source.slice(i, close + 1);
	}

	// Expression-bodied handler: take the remainder of the statement.
	const end = findStatementEnd(source, i);
	return source.slice(i, end);
}

/** End index of a `;`-terminated or newline-terminated statement. */
function findStatementEnd(source, start) {
	let depth = 0;

	for (let i = start; i < source.length; i++) {
		const step = skipToken(source, i);
		if (step.skipped) {
			i = step.index;
			continue;
		}
		const char = source[i];
		if (char === '(' || char === '[' || char === '{') depth++;
		else if (char === ')' || char === ']' || char === '}') {
			if (depth === 0) return i;
			depth--;
		} else if (char === ';' && depth === 0) {
			return i + 1;
		} else if (char === '\n' && depth === 0) {
			return i;
		}
	}

	return source.length;
}

/**
 * Parse the exported HTTP handlers of a route module: `export async function
 * GET`, `export const GET =`, and `export { GET } [from '...']` forms.
 */
function parseHandlers(source) {
	const handlers = [];

	// export [async] function GET(request, ctx) { ... }
	const fnPattern = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
	for (const match of source.matchAll(fnPattern)) {
		const name = match[1];
		if (!HTTP_METHODS.has(name)) continue;
		// match[0] ends with the opening `(`; handlerBody skips the parameter list.
		handlers.push({
			name,
			body: handlerBody(source, match.index + match[0].length - 1),
		});
	}

	// export const GET = ...;
	const constPattern = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g;
	for (const match of source.matchAll(constPattern)) {
		const name = match[1];
		if (!HTTP_METHODS.has(name)) continue;
		handlers.push({
			name,
			body: handlerBody(source, match.index + match[0].length),
		});
	}

	// export { GET, POST as PUT } [from './other-route.js']
	const reexportPattern =
		/export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g;
	for (const match of source.matchAll(reexportPattern)) {
		const names = match[1]
			.split(',')
			.map((entry) => entry.trim().split(/\s+as\s+/))
			.map(([local, exported]) => ({
				local: local.trim(),
				exported: (exported || local).trim(),
			}))
			.filter(({ exported }) => HTTP_METHODS.has(exported));

		for (const { local, exported } of names) {
			handlers.push({
				name: exported,
				body: '',
				reexportFrom: match[2] || null,
				reexportLocal: local,
			});
		}
	}

	return handlers;
}

/** Follow a re-export to the target module's handler body (one hop). */
async function resolveReexport(fromFile, handler) {
	const specifier = handler.reexportFrom;
	if (!specifier || !specifier.startsWith('.')) return '';

	const base = path.resolve(path.dirname(fromFile), specifier);
	const candidates = [
		base,
		`${base}.js`,
		`${base}.ts`,
		path.join(base, 'index.js'),
	];

	for (const candidate of candidates) {
		try {
			const source = await readFile(candidate, 'utf8');
			const target = parseHandlers(source).find(
				(parsed) =>
					parsed.name === handler.reexportLocal || parsed.name === handler.name
			);
			return target?.body || '';
		} catch {
			/* try the next candidate */
		}
	}

	return '';
}

function normalizePath(file) {
	return path.relative(root, file).split(path.sep).join('/');
}

function isAllowlisted(allowlist, filePath, method) {
	return allowlist.some(
		(entry) =>
			entry.path === filePath &&
			Array.isArray(entry.methods) &&
			(entry.methods.includes('*') || entry.methods.includes(method))
	);
}

let allowlist;
try {
	allowlist = JSON.parse(await readFile(allowlistFile, 'utf8'));
} catch (error) {
	console.error(
		`[check:route-auth] cannot read ${normalizePath(allowlistFile)}: ${error.message}`
	);
	process.exit(1);
}

if (!Array.isArray(allowlist)) {
	console.error(
		'[check:route-auth] allowlist must be a JSON array of {path, methods, reason}'
	);
	process.exit(1);
}

const routeFiles = (await collectRouteFiles(apiDir)).sort();
const violations = [];
let handlerCount = 0;

for (const file of routeFiles) {
	const filePath = normalizePath(file);
	const source = await readFile(file, 'utf8');
	const localGuards = collectLocalGuards(source);

	for (const handler of parseHandlers(source)) {
		handlerCount++;

		let body = handler.body;
		if (!body && handler.reexportFrom) {
			body = await resolveReexport(file, handler);
		}

		const code = stripCommentsAndStrings(body);

		if (AUTH_REFERENCE.test(code)) continue;
		if (isAllowlisted(allowlist, filePath, handler.name)) continue;
		if (callsLocalGuard(code, localGuards)) continue;

		violations.push({ filePath, method: handler.name });
	}
}

if (violations.length > 0) {
	console.error(
		`[check:route-auth] ${violations.length} handler(s) without an authorization reference:`
	);
	for (const { filePath, method } of violations) {
		console.error(`[check:route-auth]   ${filePath} — ${method}`);
	}
	console.error(
		'[check:route-auth] add `ensurePermission(request, RESOURCES.X, PERMISSIONS.Y)` to the handler, ' +
			`or an entry to ${normalizePath(allowlistFile)} when the route is public by design.`
	);
	process.exit(1);
}

console.log(
	`[check:route-auth] ok — ${handlerCount} handler(s) across ${routeFiles.length} route file(s) authorize (${allowlist.length} allowlisted path(s))`
);
