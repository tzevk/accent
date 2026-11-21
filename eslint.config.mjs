import { readFileSync } from 'node:fs';
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
import requireRouteAuth from './scripts/testing/require-route-auth.ts';

const routeAuthAllowlist = JSON.parse(
	readFileSync(
		new URL('./scripts/route-auth-allowlist.json', import.meta.url),
		'utf8'
	)
);

// Default ignores (use the `ignores` property instead of .eslintignore)
const ignores = [
	'node_modules/**',
	'.next/**',
	'out/**',
	'build/**',
	'e2e/artifacts/**',
	'playwright-report/**',
	'test-results/**',
	'next-env.d.ts',
	'._*',
	'**/._*',
	'._**',
	'**/._**',
	'*.backup',
	'*.orig',
	'*.log',
	'_package-lock.json',
	'_node_modules',
];

const eslintConfig = [
	// Global ignores applied first
	{ ignores },
	// Next.js 16 ships native ESLint flat configs (no FlatCompat needed)
	...coreWebVitals,
	...typescript,
	{
		files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
		rules: {
			// React Compiler-powered rules that are NEW in eslint-config-next 16.
			// They flag ~190 long-standing patterns in this codebase (inline nav
			// components, Date.now() ref init, setState-in-effect, ...). Demoted
			// to warnings to keep the Next 16 upgrade reviewable; burn down and
			// re-promote to errors incrementally.
			'react-hooks/static-components': 'warn',
			'react-hooks/set-state-in-effect': 'warn',
			'react-hooks/purity': 'warn',
			'react-hooks/refs': 'warn',
			'react-hooks/preserve-manual-memoization': 'warn',
			'react-hooks/incompatible-library': 'warn',
			'react-hooks/immutability': 'warn',
		},
	},
	{
		// Every exported Next.js API handler must call an authorization guard or
		// be named by HTTP method in the reasoned allowlist. The rule inspects
		// parsed syntax, so comments and unused nested code cannot satisfy it.
		files: ['src/app/api/**/route.js', 'src/app/api/**/route.ts'],
		plugins: {
			accent: {
				rules: {
					'require-route-auth': requireRouteAuth,
				},
			},
		},
		rules: {
			'accent/require-route-auth': [
				'error',
				{ allowlist: routeAuthAllowlist },
			],
		},
	},
	{
		// Playwright fixtures call their completion callback `use`; it is not a
		// React hook. Keep the React hook rules for application code only.
		files: ['e2e/**/*.ts'],
		rules: {
			'react-hooks/rules-of-hooks': 'off',
		},
	},
	{
		// CommonJS scripts legitimately use require()
		files: ['**/*.cjs'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
];

export default eslintConfig;
