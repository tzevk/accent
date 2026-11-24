import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Full-suite owned-runtime grouping.
 *
 * Every group owns a fresh disposable MariaDB database and Next server, so its
 * database-backed auth bucket starts empty. The proxy allows 10 real
 * `/api/login` requests per fixed 15-minute window. Each group additionally
 * spends one anonymous login on the harness startup probe
 * (`verifyApplicationDatabase`), and CI retries a failed test once. Therefore
 * a group may plan at most four first-attempt browser logins:
 *
 *   4 * (1 first attempt + 1 CI retry) + 1 startup probe = 9 <= 10
 *
 * Focused local invocations never use these groups. A spec path, selector flag,
 * `--ui`, `--debug` or `--list` keeps the original one-harness path. Non-selector
 * options such as `--workers=1` are forwarded to every group.
 */

/** `RATE_LIMITS.auth.maxRequests` in `src/proxy.ts`. */
export const E2E_AUTH_BUCKET_LIMIT = 10;
/** One throwaway login proves the app reached the disposable database. */
export const E2E_STARTUP_PROBE_LOGINS = 1;
/** `retries: 1` on CI in `playwright.config.ts`. */
export const E2E_CI_RETRIES = 1;

/**
 * Four planned logins fit the bucket even if every failed test retries:
 * `4 * (1 + 1 retry) + 1 probe = 9`.
 */
export const E2E_MAX_PLANNED_LOGINS_PER_GROUP = Math.floor(
	(E2E_AUTH_BUCKET_LIMIT - E2E_STARTUP_PROBE_LOGINS) / (1 + E2E_CI_RETRIES)
);

export interface E2ESpecGroupEntry {
	/** Project-relative POSIX path below `e2e/specs/`. */
	file: string;
	/** First-attempt real `/api/login` requests this spec makes. */
	plannedLogins: number;
}

export interface E2EGroupDefinition {
	/** Stable, filesystem-safe name used below the suite artifact root. */
	name: string;
	specs: readonly E2ESpecGroupEntry[];
}

/**
 * Explicit file groups. Adding a spec requires adding it to exactly one group
 * here; the full-suite preflight fails loudly instead of silently skipping it.
 *
 * Order is fixed so CI runs the same groups in the same sequence every time.
 * Keep each group's planned logins at or below
 * `E2E_MAX_PLANNED_LOGINS_PER_GROUP`. If a spec gains enough sign-ins to push
 * its group over that limit, move it to its own group instead of raising the
 * budget.
 */
export const FULL_SUITE_GROUPS: readonly E2EGroupDefinition[] = [
	// Keep the salary lifecycle and access specs in separate groups: their
	// combined planned logins would exceed the per-group budget.
	{
		name: 'salary-profiles',
		specs: [{ file: 'e2e/specs/salary-profiles.spec.ts', plannedLogins: 3 }],
	},
	{
		name: 'salary-profile-access',
		specs: [
			{
				file: 'e2e/specs/salary-profile-access.spec.ts',
				plannedLogins: 3,
			},
		],
	},
	// Pack compatible journeys to avoid one database migration per spec.
	// Session and contention use separate rows and actors with no browser login
	// in the contention spec.
	{
		name: 'session-and-transactions',
		specs: [
			{ file: 'e2e/specs/session.spec.ts', plannedLogins: 3 },
			{ file: 'e2e/specs/salary-contention.spec.ts', plannedLogins: 0 },
		],
	},
	// These four journeys seed separate rows, use separate actors and write to
	// different numbering stores, so one owned runtime keeps them independent.
	{
		name: 'payroll-quotation-voucher-lead',
		specs: [
			{ file: 'e2e/specs/payroll-review.spec.ts', plannedLogins: 1 },
			{ file: 'e2e/specs/quotation.spec.ts', plannedLogins: 1 },
			{ file: 'e2e/specs/cash-voucher.spec.ts', plannedLogins: 1 },
			{
				file: 'e2e/specs/lead-conversion.spec.ts',
				plannedLogins: 1,
			},
		],
	},
	{
		name: 'company-vendor-and-lead-work',
		specs: [
			{ file: 'e2e/specs/company-vendor.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/lead-work.spec.ts', plannedLogins: 2 },
		],
	},
	{
		name: 'collaboration-and-monitoring',
		specs: [
			{ file: 'e2e/specs/messages.spec.ts', plannedLogins: 1 },
			{ file: 'e2e/specs/monitoring.spec.ts', plannedLogins: 2 },
		],
	},
	{
		name: 'tickets-and-own-timesheet',
		specs: [
			{ file: 'e2e/specs/tickets.spec.ts', plannedLogins: 3 },
			{ file: 'e2e/specs/employee-time.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'work-logs-and-ledger',
		specs: [
			{ file: 'e2e/specs/work-logs.spec.ts', plannedLogins: 3 },
			{ file: 'e2e/specs/accounts-ledger.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'personal-tasks-and-utilization',
		specs: [
			{ file: 'e2e/specs/personal-tasks.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/workforce-reports.spec.ts', plannedLogins: 2 },
		],
	},
	{
		name: 'sales-invoice-and-register',
		specs: [
			{ file: 'e2e/specs/sales-invoice.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/sales-register.spec.ts', plannedLogins: 2 },
		],
	},
	{
		name: 'attendance-and-holidays',
		specs: [
			{ file: 'e2e/specs/attendance.spec.ts', plannedLogins: 3 },
			{ file: 'e2e/specs/holiday.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'leave',
		specs: [{ file: 'e2e/specs/leave-workflows.spec.ts', plannedLogins: 4 }],
	},
	{
		name: 'user-administration-and-roles',
		specs: [
			{ file: 'e2e/specs/user-administration.spec.ts', plannedLogins: 3 },
			{ file: 'e2e/specs/roles.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'account-access',
		specs: [{ file: 'e2e/specs/account-access.spec.ts', plannedLogins: 3 }],
	},
	{
		name: 'project-lead-policy',
		specs: [
			{ file: 'e2e/specs/project-lead-policy.spec.ts', plannedLogins: 2 },
		],
	},
	{
		name: 'profile-timesheet-and-payslip',
		specs: [
			{ file: 'e2e/specs/profile-dashboard.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/timesheet-report.spec.ts', plannedLogins: 1 },
			{ file: 'e2e/specs/employee-payslip.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'proposal-project-budget-and-payments',
		specs: [
			{ file: 'e2e/specs/project-budget.spec.ts', plannedLogins: 1 },
			{ file: 'e2e/specs/payment-workflows.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/proposal-project.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'financial-close-and-evidence',
		specs: [
			{ file: 'e2e/specs/financial-close.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/expenditure-evidence.spec.ts', plannedLogins: 2 },
		],
	},
	{
		name: 'orders-and-supplier-invoice',
		specs: [
			{ file: 'e2e/specs/orders.spec.ts', plannedLogins: 3 },
			{ file: 'e2e/specs/supplier-invoice.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'expense-recognition',
		specs: [
			{ file: 'e2e/specs/expense-recognition.spec.ts', plannedLogins: 1 },
			{ file: 'e2e/specs/petty-cash-spend.spec.ts', plannedLogins: 1 },
		],
	},
	{
		name: 'payroll-run-and-rates',
		specs: [
			{ file: 'e2e/specs/payroll-run.spec.ts', plannedLogins: 2 },
			{ file: 'e2e/specs/payroll-rates.spec.ts', plannedLogins: 2 },
		],
	},
	// Browser-free, but isolated: finalization locks the global Employee/profile
	// population and saves a roster snapshot, so it must not share a database
	// with the payroll browser fixtures whose teardown would contend.
	{
		name: 'payroll-finalize-contention',
		specs: [
			{
				file: 'e2e/specs/payroll-finalize-contention.spec.ts',
				plannedLogins: 0,
			},
		],
	},
	{
		name: 'project-workspace',
		specs: [{ file: 'e2e/specs/project-workspace.spec.ts', plannedLogins: 4 }],
	},
];

/** Playwright's default spec/test file suffixes, limited to the specs tree. */
const SPEC_FILE_PATTERN = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const GROUP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function fail(message: string): never {
	throw new Error(`[e2e] ${message}`);
}

/**
 * Playwright options that select fewer tests or open an interactive session.
 * Any of these keeps the legacy single-harness focused path.
 */
const FOCUSED_SELECTOR_FLAGS: Record<string, true> = {
	'--ui': true,
	'--debug': true,
	'--list': true,
	'--last-failed': true,
	'--only-changed': true,
	'--grep': true,
	'-g': true,
	'--grep-invert': true,
	'--shard': true,
};

/** Options that consume the following token when not written as `--flag=value`. */
const VALUE_TAKING_FLAGS: Record<string, true> = {
	'--workers': true,
	'-j': true,
	'--timeout': true,
	'--global-timeout': true,
	'--retries': true,
	'--max-failures': true,
	'--repeat-each': true,
	'--reporter': true,
	'--config': true,
	'-c': true,
	'--output': true,
	'--project': true,
	'--tsconfig': true,
	'--grep': true,
	'-g': true,
	'--grep-invert': true,
	'--shard': true,
};

/**
 * Grouping is the routine full-suite path when the caller selects no tests and
 * opens no interactive session. Non-selector options such as `--workers=1` are
 * forwarded to every group; positional spec paths and selector flags keep the
 * legacy single-harness focused path.
 */
export function shouldGroupFullSuite(
	playwrightArgs: readonly string[]
): boolean {
	let skipValue = false;
	for (const arg of playwrightArgs) {
		if (skipValue) {
			skipValue = false;
			continue;
		}
		if (arg === '--') return false;
		if (!arg.startsWith('-')) {
			if (
				arg === '.' ||
				arg.includes('/') ||
				arg.includes('\\') ||
				/\.(?:spec|test)\./.test(arg)
			) {
				return false;
			}
			continue;
		}
		const equals = arg.indexOf('=');
		const name = equals === -1 ? arg : arg.slice(0, equals);
		if (FOCUSED_SELECTOR_FLAGS[name] === true) return false;
		if (!arg.includes('=') && VALUE_TAKING_FLAGS[name] === true) {
			skipValue = true;
		}
	}
	return true;
}

function discoverFilesRecursively(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...discoverFilesRecursively(fullPath));
		} else if (entry.isFile() && SPEC_FILE_PATTERN.test(entry.name)) {
			files.push(fullPath);
		}
	}
	return files;
}

/**
 * Discover every maintained Playwright spec below `e2e/specs`, independent of
 * the group list. Paths are sorted project-relative POSIX names so the
 * coverage assertion and the resulting command are deterministic.
 */
export function discoverSpecFiles(
	projectRoot: string = process.cwd()
): readonly string[] {
	const specsRoot = path.join(projectRoot, 'e2e', 'specs');
	let discovered: string[];
	try {
		discovered = discoverFilesRecursively(specsRoot);
	} catch (error) {
		fail(
			`cannot discover Playwright specs under ${specsRoot}: ` +
				(error instanceof Error ? error.message : String(error))
		);
	}
	const relative = discovered
		.map((file) => path.relative(projectRoot, file).split(path.sep).join('/'))
		.sort();
	if (relative.length === 0) {
		fail(
			`no Playwright spec files found under ${specsRoot}; refusing to report an empty full suite.`
		);
	}
	return relative;
}

/** Validate one explicit group plan before any database or server starts. */
export function assertGroupPlan(groups: readonly E2EGroupDefinition[]): void {
	if (groups.length === 0) {
		fail('the full-suite group plan is empty.');
	}
	const groupNames = new Set<string>();
	const files = new Set<string>();
	for (const group of groups) {
		if (!GROUP_NAME_PATTERN.test(group.name)) {
			fail(
				`group name ${JSON.stringify(group.name)} must match ${GROUP_NAME_PATTERN}.`
			);
		}
		if (groupNames.has(group.name)) {
			fail(`duplicate full-suite group name ${JSON.stringify(group.name)}.`);
		}
		groupNames.add(group.name);
		if (group.specs.length === 0) {
			fail(`full-suite group ${JSON.stringify(group.name)} has no specs.`);
		}

		let plannedLogins = 0;
		for (const spec of group.specs) {
			if (!Number.isInteger(spec.plannedLogins) || spec.plannedLogins < 0) {
				fail(
					`${spec.file} must declare a non-negative integer plannedLogins, got ${JSON.stringify(spec.plannedLogins)}.`
				);
			}
			if (
				!spec.file.startsWith('e2e/specs/') ||
				spec.file.includes('../') ||
				!SPEC_FILE_PATTERN.test(spec.file)
			) {
				fail(
					`${JSON.stringify(spec.file)} is not a Playwright spec path below e2e/specs/.`
				);
			}
			if (files.has(spec.file)) {
				fail(`${spec.file} is assigned to more than one full-suite group.`);
			}
			files.add(spec.file);
			plannedLogins += spec.plannedLogins;
		}

		if (plannedLogins > E2E_MAX_PLANNED_LOGINS_PER_GROUP) {
			fail(
				`group ${JSON.stringify(group.name)} plans ${plannedLogins} first-attempt logins; ` +
					`the auth bucket allows at most ${E2E_MAX_PLANNED_LOGINS_PER_GROUP} ` +
					`(${E2E_AUTH_BUCKET_LIMIT} per window - ${E2E_STARTUP_PROBE_LOGINS} startup probe, ` +
					`with ${E2E_CI_RETRIES} CI retry per failed attempt). Split the group.`
			);
		}
	}
}

/**
 * Prove every discovered spec is assigned exactly once and every assigned spec
 * exists. A newly added spec therefore fails the full suite before harness
 * startup until its owner adds a group entry.
 */
export function assertGroupCoverage(
	groups: readonly E2EGroupDefinition[],
	discoveredSpecs: readonly string[]
): void {
	if (discoveredSpecs.length === 0) {
		fail('no Playwright specs were discovered for the full suite.');
	}
	const discovered = new Set(discoveredSpecs);
	const assigned = new Set<string>();
	const assignments = new Map<string, string>();
	for (const group of groups) {
		for (const spec of group.specs) {
			if (assignments.has(spec.file)) {
				fail(
					`${spec.file} is assigned to both ${JSON.stringify(assignments.get(spec.file))} and ${JSON.stringify(group.name)}.`
				);
			}
			assignments.set(spec.file, group.name);
			assigned.add(spec.file);
		}
	}

	const unassigned = [...discovered]
		.filter((file) => !assigned.has(file))
		.sort();
	if (unassigned.length > 0) {
		fail(
			`full-suite coverage is missing maintained specs: ${unassigned.join(', ')}. ` +
				'Add each file to exactly one group in scripts/e2e/groups.ts.'
		);
	}

	const missing = [...assigned].filter((file) => !discovered.has(file)).sort();
	if (missing.length > 0) {
		fail(
			`full-suite groups reference specs that do not exist: ${missing.join(', ')}. ` +
				'Remove the stale entry or restore the spec.'
		);
	}
}

/**
 * Validate the explicit plan and its coverage, then return the deterministic
 * group order the CLI will run.
 */
export function planFullSuiteGroups(
	discoveredSpecs: readonly string[],
	groups: readonly E2EGroupDefinition[] = FULL_SUITE_GROUPS
): readonly E2EGroupDefinition[] {
	assertGroupPlan(groups);
	assertGroupCoverage(groups, discoveredSpecs);
	return groups;
}
