import type { Rule, SourceCode } from 'eslint';

/**
 * Route authorization guard (ADR-0011, remediation workstream A6).
 *
 * Every HTTP handler exported from `src/app/api/**\/route.{js,ts}` must call a
 * recognized authorization function inside the handler's own execution path,
 * or the handler must be named by HTTP method in
 * `scripts/route-auth-allowlist.json` with a reason.
 *
 * The check is per handler, not per file: `activity-master` shipped guarded
 * GET/POST methods next to unguarded PUT/DELETE, which a file-level predicate
 * would have missed.
 *
 * This rule looks at parsed syntax. A comment, a bare identifier reference, an
 * import, or a guard buried in an uncalled nested function does not satisfy it.
 * A local helper counts only when the handler calls it. Re-exports are not
 * followed: the target cannot be verified from this file, so the export must
 * name its method in the allowlist.
 *
 * It checks that a guard call is present, not that the handler returns the
 * denial branch; API tests still assert 401/403 behavior. Inline disable
 * directives are not an exception mechanism: this rule reports the directives
 * it can see, but ESLint applies block directives before reports, so a block
 * disable can still suppress diagnostics. The allowlist is the only supported
 * exception.
 */

type AstNode = {
	type: string;
	loc?: {
		start: { line: number; column: number };
		end: { line: number; column: number };
	} | null;
	[key: string]: unknown;
};

interface AllowlistEntry {
	path: string;
	methods: string[];
}

interface Handler {
	method: string;
	reportNode: AstNode;
	/** Function or expression to inspect, or null when the target cannot be verified. */
	body: AstNode | null;
}

interface GuardEnvironment {
	bindings: Map<string, AstNode>;
	guardNames: Set<string>;
	visited: Set<AstNode>;
	sourceCode: SourceCode;
}

const RULE_ID = 'accent/require-route-auth';

/** Handlers Next.js routes by HTTP method. Next ignores other named exports. */
const HTTP_METHODS: Record<string, true> = {
	GET: true,
	POST: true,
	PUT: true,
	PATCH: true,
	DELETE: true,
	HEAD: true,
	OPTIONS: true,
};

/**
 * Approved authorization entry points. `ensurePermission` is the dominant
 * permission wrapper; the others resolve the session or a project-scoped
 * access decision and return a denial the handler must return.
 */
const AUTH_GUARDS: Record<string, true> = {
	getCurrentUser: true,
	getServerAuth: true,
	ensurePermission: true,
	requireProjectAccess: true,
	resolveProjectAccess: true,
};

const DIRECTIVE_PATTERN =
	/^\s*eslint-(disable(?:-next-line|-line)?)\b([\s\S]*)$/;
const CHILD_OMIT_KEYS: Record<string, true> = {
	type: true,
	loc: true,
	range: true,
	parent: true,
	tokens: true,
	comments: true,
};

function isAstNode(value: unknown): value is AstNode {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		typeof value.type === 'string'
	);
}

function asNode(value: unknown): AstNode | null {
	return isAstNode(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function nameOf(value: unknown): string | null {
	const node = asNode(value);
	if (!node) return null;
	if (node.type === 'Identifier' && typeof node.name === 'string') {
		return node.name;
	}
	if (node.type === 'Literal' && typeof node.value === 'string') {
		return node.value;
	}
	return null;
}

function memberPropertyName(node: AstNode): string | null {
	const property = asNode(node.property);
	if (!property) return null;
	if (!node.computed && property.type === 'Identifier') {
		return typeof property.name === 'string' ? property.name : null;
	}
	if (node.computed && property.type === 'Literal') {
		return typeof property.value === 'string' ? property.value : null;
	}
	return null;
}

function isFunctionNode(node: AstNode): boolean {
	return (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	);
}

function isRouteFile(filename: string): boolean {
	const normalized = filename.replace(/\\/g, '/');
	return /(^|\/)src\/app\/api\/(?:.+\/)?route\.(?:js|ts)$/.test(normalized);
}

/** Child nodes from the parser's visitor keys, with a generic fallback. */
function childNodes(node: AstNode, sourceCode: SourceCode): AstNode[] {
	const visitorKeys = sourceCode.visitorKeys[node.type];
	const keys =
		visitorKeys ??
		Object.keys(node).filter((key) => !Object.hasOwn(CHILD_OMIT_KEYS, key));
	const children: AstNode[] = [];

	for (const key of keys) {
		const value = node[key];
		const single = asNode(value);
		if (single) {
			children.push(single);
			continue;
		}
		for (const item of asArray(value)) {
			const child = asNode(item);
			if (child) children.push(child);
		}
	}

	return children;
}

/**
 * Collect function declarations and variable initializers in a statement
 * scope without descending into nested function bodies. A handler call can
 * resolve these names; an uncalled nested guard remains unreachable.
 */
function collectBindings(
	node: AstNode,
	bindings: Map<string, AstNode>,
	sourceCode: SourceCode
): void {
	if (node.type === 'FunctionDeclaration') {
		const name = nameOf(node.id);
		if (name) bindings.set(name, node);
		return;
	}
	if (
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	) {
		return;
	}
	if (node.type === 'VariableDeclarator') {
		const name = nameOf(node.id);
		const init = asNode(node.init);
		if (name && init) bindings.set(name, init);
		return;
	}
	for (const child of childNodes(node, sourceCode)) {
		collectBindings(child, bindings, sourceCode);
	}
}

/** Import aliases such as `import { ensurePermission as check }`. */
function collectGuardNames(program: AstNode): Set<string> {
	const names = new Set(Object.keys(AUTH_GUARDS));

	for (const statement of asArray(program.body)) {
		const declaration = asNode(statement);
		if (!declaration || declaration.type !== 'ImportDeclaration') continue;

		for (const specifierValue of asArray(declaration.specifiers)) {
			const specifier = asNode(specifierValue);
			if (!specifier || specifier.type !== 'ImportSpecifier') continue;

			const imported = nameOf(specifier.imported);
			const local = nameOf(specifier.local);
			if (imported && local && Object.hasOwn(AUTH_GUARDS, imported)) {
				names.add(local);
			}
		}
	}

	return names;
}

function walkFunction(fn: AstNode, environment: GuardEnvironment): boolean {
	if (environment.visited.has(fn)) return false;
	environment.visited.add(fn);

	const body = asNode(fn.body);
	if (!body) return false;

	const bindings = new Map(environment.bindings);
	collectBindings(body, bindings, environment.sourceCode);

	return walkNode(body, bindings, environment);
}

function walkNode(
	node: AstNode,
	bindings: Map<string, AstNode>,
	environment: GuardEnvironment
): boolean {
	if (isFunctionNode(node)) return false;

	if (node.type === 'CallExpression') {
		const callee = asNode(node.callee);

		if (callee?.type === 'Identifier') {
			const name = nameOf(callee);
			const binding = name ? bindings.get(name) : undefined;

			if (binding) {
				const resolved = isFunctionNode(binding)
					? walkFunction(binding, environment)
					: walkNode(binding, bindings, environment);
				if (resolved) return true;
			} else if (name && environment.guardNames.has(name)) {
				return true;
			}
		} else if (callee?.type === 'MemberExpression') {
			const property = memberPropertyName(callee);
			if (property && environment.guardNames.has(property)) return true;
		} else if (callee && isFunctionNode(callee)) {
			// An immediately invoked function is part of the handler's path.
			if (walkFunction(callee, environment)) return true;
		}
	}

	for (const child of childNodes(node, environment.sourceCode)) {
		if (walkNode(child, bindings, environment)) return true;
	}

	return false;
}

function handlerHasGuard(
	root: AstNode,
	moduleBindings: Map<string, AstNode>,
	guardNames: Set<string>,
	sourceCode: SourceCode
): boolean {
	const environment: GuardEnvironment = {
		bindings: moduleBindings,
		guardNames,
		visited: new Set(),
		sourceCode,
	};

	if (isFunctionNode(root)) return walkFunction(root, environment);
	return walkNode(root, moduleBindings, environment);
}

/** Top-level function and variable bindings, for `export { handler as GET }`. */
function collectModuleBindings(
	program: AstNode,
	sourceCode: SourceCode
): Map<string, AstNode> {
	const bindings = new Map<string, AstNode>();

	for (const statement of asArray(program.body)) {
		const node = asNode(statement);
		if (!node) continue;

		if (node.type === 'ExportNamedDeclaration') {
			const declaration = asNode(node.declaration);
			if (declaration) collectBindings(declaration, bindings, sourceCode);
		} else if (
			node.type === 'FunctionDeclaration' ||
			node.type === 'VariableDeclaration'
		) {
			collectBindings(node, bindings, sourceCode);
		}
	}

	return bindings;
}

function collectHandlers(
	program: AstNode,
	moduleBindings: Map<string, AstNode>
): { handlers: Handler[]; wildcardExports: AstNode[] } {
	const handlers: Handler[] = [];
	const wildcardExports: AstNode[] = [];

	for (const statement of asArray(program.body)) {
		const node = asNode(statement);
		if (!node) continue;

		if (node.type === 'ExportAllDeclaration') {
			wildcardExports.push(node);
			continue;
		}

		if (node.type !== 'ExportNamedDeclaration') continue;

		const declaration = asNode(node.declaration);

		if (declaration?.type === 'FunctionDeclaration') {
			const method = nameOf(declaration.id);
			if (method && HTTP_METHODS[method] === true) {
				handlers.push({
					method,
					reportNode: node,
					body: declaration,
				});
			}
		}

		if (declaration?.type === 'VariableDeclaration') {
			for (const declaratorValue of asArray(declaration.declarations)) {
				const declarator = asNode(declaratorValue);
				if (!declarator || declarator.type !== 'VariableDeclarator') continue;

				const method = nameOf(declarator.id);
				if (!method || HTTP_METHODS[method] !== true) continue;

				handlers.push({
					method,
					reportNode: node,
					body: asNode(declarator.init),
				});
			}
		}

		const external = asNode(node.source) !== null;

		for (const specifierValue of asArray(node.specifiers)) {
			const specifier = asNode(specifierValue);
			if (!specifier || specifier.type !== 'ExportSpecifier') continue;

			const method = nameOf(specifier.exported);
			if (!method || HTTP_METHODS[method] !== true) continue;

			const local = nameOf(specifier.local);
			const body = external || !local ? null : moduleBindings.get(local);

			handlers.push({
				method,
				reportNode: node,
				body: body ?? null,
			});
		}
	}

	return { handlers, wildcardExports };
}

function readAllowlist(options: unknown): AllowlistEntry[] {
	if (
		typeof options !== 'object' ||
		options === null ||
		!('allowlist' in options)
	) {
		return [];
	}

	const value = options.allowlist;
	if (!Array.isArray(value)) return [];

	const allowlist: AllowlistEntry[] = [];
	for (const entry of value) {
		if (
			typeof entry !== 'object' ||
			entry === null ||
			!('path' in entry) ||
			!('methods' in entry) ||
			!('reason' in entry)
		) {
			continue;
		}

		const path = entry.path;
		const methods = entry.methods;
		const reason = entry.reason;
		if (
			typeof path !== 'string' ||
			!Array.isArray(methods) ||
			typeof reason !== 'string' ||
			reason.trim().length === 0
		) {
			continue;
		}

		const methodNames = methods.filter(
			(method): method is string => typeof method === 'string'
		);
		if (methodNames.length !== methods.length) continue;

		allowlist.push({ path, methods: methodNames });
	}

	return allowlist;
}

function allowlistMatches(
	allowlist: AllowlistEntry[],
	filename: string,
	method: string
): boolean {
	const normalizedFile = filename.replace(/\\/g, '/');

	return allowlist.some((entry) => {
		const entryPath = entry.path.replace(/\\/g, '/').replace(/^\.\//, '');
		const pathMatches =
			normalizedFile === entryPath || normalizedFile.endsWith(`/${entryPath}`);

		// Literal method membership only: `*` is not a method.
		return pathMatches && entry.methods.includes(method);
	});
}

/** A comment that could hide this rule's diagnostics if it applied. */
function directiveTargetsRule(commentValue: string, ruleId: string): boolean {
	const match = DIRECTIVE_PATTERN.exec(commentValue);
	if (!match) return false;

	const rulesPart = match[2].split('--', 1)[0].trim();
	if (rulesPart.length === 0) return true;

	return rulesPart
		.split(',')
		.map((rule) => rule.trim().replace(/^['"]|['"]$/g, ''))
		.includes(ruleId);
}

const rule: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require an authorization call in every exported Next.js API route handler.',
		},
		schema: [
			{
				type: 'object',
				properties: {
					allowlist: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								path: { type: 'string' },
								methods: {
									type: 'array',
									items: { type: 'string' },
									minItems: 1,
									uniqueItems: true,
								},
								reason: { type: 'string', pattern: '\\S' },
							},
							required: ['path', 'methods', 'reason'],
							additionalProperties: false,
						},
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			missingAuth:
				'HTTP {{method}} handler has no authorization guard. Call getCurrentUser, getServerAuth, ensurePermission, requireProjectAccess, or resolveProjectAccess, or add a per-method exception to scripts/route-auth-allowlist.json.',
			unverifiableExport:
				'HTTP {{method}} handler is re-exported from another module, so this rule cannot verify its authorization. Export the guarded handler directly, or add a per-method exception to scripts/route-auth-allowlist.json after reviewing the target.',
			wildcardReexport:
				'Wildcard re-exports cannot be checked for handler authorization. Export each HTTP handler explicitly, or add per-method exceptions to scripts/route-auth-allowlist.json.',
			inlineDisable:
				'Inline disable comments are not authorization exceptions. Add a per-method exception to scripts/route-auth-allowlist.json with a reason instead.',
		},
	},

	create(context) {
		const allowlist = readAllowlist(context.options[0]);

		return {
			'Program:exit'(program) {
				if (!isRouteFile(context.filename)) return;

				const ast = program as unknown as AstNode;
				const sourceCode = context.sourceCode;
				const ruleId = context.id || RULE_ID;

				for (const comment of sourceCode.getAllComments()) {
					if (!directiveTargetsRule(comment.value, ruleId)) continue;
					if (!comment.loc) continue;
					context.report({
						loc: comment.loc,
						messageId: 'inlineDisable',
					});
				}

				const moduleBindings = collectModuleBindings(ast, sourceCode);
				const { handlers, wildcardExports } = collectHandlers(
					ast,
					moduleBindings
				);

				for (const node of wildcardExports) {
					context.report({
						node: node as never,
						messageId: 'wildcardReexport',
					});
				}

				if (handlers.length === 0) return;

				const guardNames = collectGuardNames(ast);

				for (const handler of handlers) {
					if (allowlistMatches(allowlist, context.filename, handler.method)) {
						continue;
					}

					if (!handler.body) {
						context.report({
							node: handler.reportNode as never,
							messageId: 'unverifiableExport',
							data: { method: handler.method },
						});
						continue;
					}

					if (
						handlerHasGuard(
							handler.body,
							moduleBindings,
							guardNames,
							sourceCode
						)
					) {
						continue;
					}

					context.report({
						node: handler.reportNode as never,
						messageId: 'missingAuth',
						data: { method: handler.method },
					});
				}
			},
		};
	},
};

export default rule;
