#!/usr/bin/env node
/**
 * Read-only deploy preflight for the #254 security branch.
 *
 * Answers the three questions that decide whether deploying the branch can
 * break a running environment:
 *
 *   1. Will the unique-index migration succeed?  -> duplicate active values in
 *      the six document-number columns, which make `ADD UNIQUE` fail.
 *   2. Will the new per-handler guards lock people out? -> roles/users missing
 *      the mapped `resource:action` grants (every non-super-admin is subject
 *      to them after deploy).
 *   3. How heavy is the migration? -> row counts and table sizes for the six
 *      tables the generated columns are added to.
 *
 * Nothing is written; run it against production with the PROD_DB_* values:
 *
 *   node scripts/predeploy-check.mjs --target=prod
 *   node scripts/predeploy-check.mjs --target=prod --artifact e2e/artifacts/predeploy-prod.json
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { getDbSslConfig } from '../src/utils/database.js';

const ENV_PREFIX_BY_TARGET = {
	dev: 'DEV_DB',
	staging: 'STAGING_DB',
	prod: 'PROD_DB',
};

/** The six columns the migration guards with generated-column unique indexes. */
const NUMBER_TARGETS = [
	{ table: 'quotations', column: 'quotation_number', active: 'isDelete = 0' },
	{ table: 'payment_entries', column: 'receipt_no', active: 'isDelete = 0' },
	{
		table: 'project_invoices',
		column: 'invoice_number',
		active: '(isDelete = 0 OR isDelete IS NULL)',
	},
	{
		table: 'project_quotations',
		column: 'quotation_number',
		active: '(isDelete = 0 OR isDelete IS NULL)',
	},
	{ table: 'outgoing_purchase_orders', column: 'sr_no', active: 'isDelete = 0' },
	{ table: 'leads', column: 'lead_id', active: 'isDelete = 0' },
];

/**
 * Every flat permission the branch's guards can require, grouped by the
 * feature that needs it. A role that works in a feature must hold its keys;
 * the report lists what each active role is missing.
 */
const REQUIRED_GRANTS = [
	{
		area: 'masters: categories, descriptions, activity master (SETTINGS)',
		keys: ['settings:read', 'settings:update', 'settings:delete'],
	},
	{
		area: 'financial masters: accounts, banks, account heads (ACCOUNTS)',
		keys: [
			'accounts:read',
			'accounts:create',
			'accounts:update',
			'accounts:delete',
		],
	},
	{
		area: 'material requisitions (MATERIAL_REQUISITION)',
		keys: [
			'material_requisition:read',
			'material_requisition:create',
			'material_requisition:delete',
		],
	},
	{
		area: 'invoices: list + project invoices (INVOICES)',
		keys: [
			'invoices:read',
			'invoices:create',
			'invoices:update',
			'invoices:delete',
		],
	},
	{
		area: 'purchase orders + project POs (PURCHASE_ORDERS)',
		keys: [
			'purchase_orders:read',
			'purchase_orders:create',
			'purchase_orders:update',
			'purchase_orders:delete',
		],
	},
	{
		area: 'project quotations (QUOTATIONS)',
		keys: ['quotations:read', 'quotations:create'],
	},
	{ area: 'payee list (ADMIN)', keys: ['admin:read'] },
	{
		area: 'employee import template + attendance-monthly writes (EMPLOYEES)',
		keys: ['employees:create', 'employees:update', 'employees:delete'],
	},
];

const ALL_REQUIRED_KEYS = [
	...new Set(REQUIRED_GRANTS.flatMap((group) => group.keys)),
];

function parseArgs(argv) {
	let target = 'dev';
	let artifactPath = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--target' || arg === '--artifact') {
			const value = argv[index + 1];
			if (!value || value.startsWith('--')) {
				throw new Error(`${arg} needs a value`);
			}
			if (arg === '--target') target = value;
			else artifactPath = value;
			index += 1;
		} else if (arg.startsWith('--target=')) {
			target = arg.slice('--target='.length);
		} else if (arg.startsWith('--artifact=')) {
			artifactPath = arg.slice('--artifact='.length);
			if (!artifactPath) throw new Error('--artifact needs a value');
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (!Object.hasOwn(ENV_PREFIX_BY_TARGET, target)) {
		throw new Error(
			`unknown --target ${JSON.stringify(target)} (dev|staging|prod)`
		);
	}
	return { target, artifactPath };
}

/** roles_master.permissions arrives as JSON text or pre-parsed by the driver. */
function parsePermissions(raw) {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter((key) => typeof key === 'string');
	if (typeof raw === 'object') {
		return Object.values(raw).filter((key) => typeof key === 'string');
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((key) => typeof key === 'string')
			: [];
	} catch {
		return [];
	}
}

const { target, artifactPath } = parseArgs(process.argv.slice(2));
const envPrefix = ENV_PREFIX_BY_TARGET[target];
const database = process.env[`${envPrefix}_NAME`];
const user = process.env[`${envPrefix}_USER`];
const password = process.env[`${envPrefix}_PASSWORD`];

if (!database || !user) {
	throw new Error(
		`missing ${envPrefix}_NAME / ${envPrefix}_USER in the environment (.env). ` +
			'Production values live in the Vercel project env; run this where they are available.'
	);
}

const ssl = getDbSslConfig();
if (!ssl && target === 'prod') {
	console.warn(
		'[preflight] WARNING: DB_SSL_MODE is off for a production target — SEC-20 expects verify.'
	);
}

const connection = await mysql.createConnection({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT),
	user,
	password,
	database,
	ssl,
	dateStrings: true,
});

const report = {
	target,
	database,
	generatedAt: new Date().toISOString(),
	duplicates: [],
	migrationWeight: [],
	connectionBudget: null,
	roleGaps: [],
	coverage: [],
	users: {},
	blockers: [],
};

try {
	// 1 ─ duplicate active numbers (the migration blocker) ───────────────────
	for (const { table, column, active } of NUMBER_TARGETS) {
		const [rows] = await connection.execute(
			`SELECT ${column} AS value, COUNT(*) AS count
         FROM ${table}
        WHERE ${active} AND ${column} IS NOT NULL AND ${column} <> ''
        GROUP BY ${column}
       HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 10`
		);
		const [totals] = await connection.execute(
			`SELECT COUNT(*) AS rows_total
         FROM ${table}
        WHERE ${active} AND ${column} IS NOT NULL AND ${column} <> ''`
		);
		report.duplicates.push({
			column: `${table}.${column}`,
			duplicateValues: rows,
			duplicateGroups: rows.length,
			checkedRows: Number(totals[0]?.rows_total ?? 0),
		});
		if (rows.length > 0) {
			report.blockers.push(
				`${table}.${column}: ${rows.length} duplicate value(s) among active rows — ` +
					'deduplicate before running the unique-index migration.'
			);
		}
	}

	// 2 ─ migration weight ────────────────────────────────────────────────────
	const tableNames = NUMBER_TARGETS.map((entry) => entry.table);
	const [sizes] = await connection.query(
		`SELECT TABLE_NAME AS table_name, TABLE_ROWS AS approx_rows,
            ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 1) AS mb
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tableNames.map(() => '?').join(', ')})`,
		tableNames
	);
	report.migrationWeight = sizes;

	// 3 ─ connection budget: the proxy adds its own pool (2 connections per
	//     instance) on top of the app pool (5), multiplied by instance count.
	const [connectionVars] = await connection.query(
		`SELECT @@max_connections AS max_connections,
            @@max_user_connections AS max_user_connections`
	);
	const [threads] = await connection.query(
		'SELECT COUNT(*) AS threads_connected FROM information_schema.PROCESSLIST'
	);
	report.connectionBudget = {
		maxConnections: Number(connectionVars[0]?.max_connections ?? 0),
		maxUserConnections: Number(connectionVars[0]?.max_user_connections ?? 0),
		threadsConnected: Number(threads[0]?.threads_connected ?? 0),
	};

	// 4 ─ role/user coverage for the new guards ──────────────────────────────
	const [roles] = await connection.execute(
		`SELECT id, role_code, role_name, role_hierarchy, status, permissions
       FROM roles_master
      ORDER BY role_hierarchy, id`
	);
	const [users] = await connection.execute(
		`SELECT id, username, role_id, is_super_admin, permissions
       FROM users
      WHERE isDelete = 0`
	);

	const activeUsers = users.filter((row) => Number(row.is_super_admin) !== 1);
	report.users = {
		total: users.length,
		superAdmins: users.length - activeUsers.length,
		nonSuperAdmins: activeUsers.length,
		usersWithoutRole: activeUsers.filter((row) => !row.role_id).length,
	};

	for (const role of roles) {
		const held = new Set(parsePermissions(role.permissions));
		const missing = ALL_REQUIRED_KEYS.filter((key) => !held.has(key));
		const missingGroups = REQUIRED_GRANTS.map((group) => ({
			area: group.area,
			missing: group.keys.filter((key) => !held.has(key)),
		})).filter((group) => group.missing.length > 0);
		report.roleGaps.push({
			role: role.role_name,
			roleCode: role.role_code,
			hierarchy: role.role_hierarchy,
			status: role.status,
			userCount: activeUsers.filter((row) => row.role_id === role.id).length,
			missingKeys: missing,
			missingAreas: missingGroups,
		});
	}

	// User-level grants can cover a role gap, so coverage is computed over the
	// union of the role's permissions and the user's personal permissions.
	const rolePermissionsById = new Map(
		roles.map((role) => [role.id, new Set(parsePermissions(role.permissions))])
	);
	const userPermissions = activeUsers.map((row) => ({
		username: row.username,
		held: new Set([
			...(rolePermissionsById.get(row.role_id) ?? []),
			...parsePermissions(row.permissions),
		]),
	}));
	report.coverage = ALL_REQUIRED_KEYS.map((key) => {
		const heldByRoles = roles
			.filter((role) => parsePermissions(role.permissions).includes(key))
			.map((role) => role.role_name);
		const heldByUsers = userPermissions
			.filter((entry) => entry.held.has(key))
			.map((entry) => entry.username);
		return { key, heldByRoles, heldByUsers };
	});

	console.log(`[preflight] ${database} @ ${target} — read-only`);
	for (const entry of report.duplicates) {
		const state = entry.duplicateGroups > 0 ? 'BLOCKER' : 'ok';
		console.log(
			`[preflight] ${state} ${entry.column}: ${entry.duplicateGroups} duplicate group(s) in ${entry.checkedRows} active row(s)`
		);
	}
	if (report.migrationWeight.length > 0) {
		console.log(
			`[preflight] migration weight: ${report.migrationWeight
				.map((row) => `${row.table_name}≈${row.approx_rows ?? 0} rows/${row.mb ?? 0}MB`)
				.join(', ')}`
		);
	}
	console.log(
		`[preflight] users: ${report.users.total} active (${report.users.superAdmins} super-admin bypass, ` +
			`${report.users.nonSuperAdmins} subject to guards, ${report.users.usersWithoutRole} without a role)`
	);
	const budget = report.connectionBudget;
	console.log(
		`[preflight] connections: ${budget.threadsConnected} open, max_connections=${budget.maxConnections}, ` +
			`max_user_connections=${budget.maxUserConnections || 'unlimited'} — each app instance now needs ` +
			'5 (app pool) + 2 (proxy pool)'
	);
	if (
		budget.maxUserConnections > 0 &&
		budget.maxUserConnections < 14 &&
		report.users.total > 0
	) {
		console.warn(
			'[preflight] WARNING: max_user_connections leaves no room for two app instances once the proxy pool is added.'
		);
	}
	for (const gap of report.roleGaps) {
		if (gap.status !== 'active' || gap.missingKeys.length === 0) continue;
		console.log(
			`[preflight] role "${gap.role}" (${gap.userCount} non-super user(s)) missing: ${gap.missingKeys.join(', ')}`
		);
	}
	for (const entry of report.coverage) {
		if (entry.heldByRoles.length === 0 && entry.heldByUsers.length === 0) {
			console.log(
				`[preflight] no role or user holds ${entry.key} — super-admin-only after deploy`
			);
		}
	}
	console.log(
		report.blockers.length === 0
			? '[preflight] verdict: no duplicate blockers; review the role gaps before deploy'
			: `[preflight] verdict: ${report.blockers.length} blocker(s) — do not run the migration yet`
	);

	if (artifactPath) {
		await mkdir(path.dirname(artifactPath), { recursive: true });
		await writeFile(
			artifactPath,
			`${JSON.stringify(
				{ flow: 'security-preflight', ...report, ok: report.blockers.length === 0 },
				null,
				2
			)}\n`
		);
		console.log(`[preflight] artifact written to ${artifactPath}`);
	}
} finally {
	await connection.end();
}
