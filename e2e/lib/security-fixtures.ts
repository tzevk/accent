import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec, rows } from './db';
import { ADMIN_USER, EMPLOYEE_USER } from './fixtures';

/**
 * Shared identity harness for the security E2E specs (`e2e/specs/security/`).
 *
 * Everything here is a real row in the real database: a `roles_master` role
 * whose `permissions` JSON holds the keys the post-remediation route guards
 * check (plan workstream A2/A5), and a `users` row whose password uses the same
 * bcrypt pattern as `e2e/lib/fixtures.ts`. Sessions are real too — `loginAs`
 * posts to `/api/login` and carries the issued `session` cookie.
 *
 * Each `loginAs` is counted under its own `auth` rate-limit bucket: the POST
 * carries a per-identity TEST-NET `x-vercel-forwarded-for` (the proxy's trusted
 * header, ADR-0013) and clears that bucket first, so a rerun inside the same
 * 15-minute window cannot 429 the next spec.
 *
 * Rows `seedSecurityFixtures()` inserts (namespace `e2e_sec_`):
 *
 *   roles_master
 *     role_code      'e2e_sec_finance'
 *     role_name      'E2E Security Finance'
 *     role_hierarchy 60
 *     department     'E2E'
 *     status         'active'
 *     permissions    JSON [
 *                      'settings:read', 'settings:create', 'settings:update',
 *                      'settings:delete', 'accounts:read', 'accounts:create',
 *                      'accounts:update', 'accounts:delete', 'invoices:read',
 *                      'invoices:create', 'invoices:update', 'invoices:delete',
 *                      'purchase_orders:read', 'purchase_orders:create',
 *                      'purchase_orders:update', 'purchase_orders:delete',
 *                      'quotations:read', 'quotations:create',
 *                      'quotations:update', 'quotations:delete',
 *                      'material_requisition:read',
 *                      'material_requisition:create',
 *                      'material_requisition:update',
 *                      'material_requisition:delete', 'projects:read',
 *                      'projects:create', 'projects:update', 'projects:delete',
 *                      'employees:read', 'employees:create',
 *                      'employees:update', 'employees:delete', 'admin:read'
 *                    ]
 *
 *   users
 *     username       'e2e_sec_finance'
 *     email          'e2e.sec.finance@accent.test'
 *     full_name      'E2E Security Finance'
 *     password_hash  bcrypt('E2e#Finance1', 10)
 *     status         'active', is_active 1, is_super_admin 0, isDelete 0
 *     account_type   'employee', role_id = the role above
 *
 * `SECURITY_USERS.superAdmin` and `SECURITY_USERS.employee` are the EXISTING
 * fixtures (`ADMIN_USER` / `EMPLOYEE_USER`): reused, never re-inserted, so the
 * signed-in storage states in `e2e/.auth/` keep working. The base fixtures must
 * exist, i.e. `seedFixtures()` (run by `e2e/global-setup.ts`) has run first.
 *
 * Usage (one spec file):
 *
 *   import { expect, test } from '@playwright/test';
 *   import { rows } from '../../lib/db';
 *   import { E2E_ENV } from '../../lib/env';
 *   import {
 *     SECURITY_ROLES,
 *     SECURITY_USERS,
 *     anonymousContext,
 *     cleanupSecurityFixtures,
 *     forgedSessionContext,
 *     loginAs,
 *     seedSecurityFixtures,
 *   } from '../../lib/security-fixtures';
 *
 *   test.beforeAll(async () => {
 *     await seedSecurityFixtures();
 *   });
 *
 *   test.afterAll(async () => {
 *     await cleanupSecurityFixtures();
 *   });
 *
 *   test('finance works, anonymous and forged do not', async ({ playwright }) => {
 *     const finance = await loginAs(playwright, E2E_ENV.baseURL, 'finance');
 *     const anonymous = await anonymousContext(playwright, E2E_ENV.baseURL);
 *     const forged = await forgedSessionContext(playwright, E2E_ENV.baseURL);
 *     try {
 *       expect((await finance.get('/api/masters/banks')).status()).toBe(200);
 *       expect((await anonymous.get('/api/masters/banks')).status()).toBe(401);
 *       expect((await forged.get('/api/masters/banks')).status()).toBe(401);
 *
 *       const session = await (await finance.get('/api/session')).json();
 *       expect(session.user.username).toBe(SECURITY_USERS.finance.username);
 *
 *       const role = await rows(
 *         'SELECT permissions FROM roles_master WHERE role_code = ?',
 *         [SECURITY_ROLES.finance.roleCode]
 *       );
 *       expect(role[0].permissions).toContain('accounts:read');
 *     } finally {
 *       await finance.dispose();
 *       await anonymous.dispose();
 *       await forged.dispose();
 *     }
 *   });
 */

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

const CRUD = ['read', 'create', 'update', 'delete'];

/** The four CRUD keys the route guards check, e.g. `settings:read`. */
function crud(resource: string): string[] {
	return CRUD.map((verb) => `${resource}:${verb}`);
}

/** Role rows this harness owns. */
export const SECURITY_ROLES = {
	finance: {
		roleCode: 'e2e_sec_finance',
		roleName: 'E2E Security Finance',
		roleHierarchy: 60,
		permissions: [
			...crud('settings'),
			...crud('accounts'),
			...crud('invoices'),
			...crud('purchase_orders'),
			...crud('quotations'),
			...crud('material_requisition'),
			...crud('projects'),
			...crud('employees'),
			'admin:read',
		],
	},
} as const;

/**
 * Login identities: `superAdmin` and `employee` are the existing fixtures
 * (`ADMIN_USER` / `EMPLOYEE_USER`), `finance` is the row seeded by
 * `seedSecurityFixtures()` under `SECURITY_ROLES.finance`.
 */
export const SECURITY_USERS = {
	superAdmin: { ...ADMIN_USER },
	finance: {
		username: 'e2e_sec_finance',
		email: 'e2e.sec.finance@accent.test',
		password: 'E2e#Finance1',
		fullName: 'E2E Security Finance',
	},
	employee: { ...EMPLOYEE_USER },
} as const;

export type SecurityUserKey = keyof typeof SECURITY_USERS;

/** The value `forgedSessionContext` puts in the `session` cookie by default. */
export const FORGED_SESSION_TOKEN = 'forged-value';

export interface SecuritySeeded {
	/** `roles_master.id` of the seeded `e2e_sec_finance` role. */
	roleId: number;
	/** `users.id` of the seeded `e2e_sec_finance` user. */
	financeUserId: number;
	/** `users.id` of the existing super-admin fixture. */
	superAdminUserId: number;
	/** `users.id` of the existing low-privilege employee fixture. */
	employeeUserId: number;
}

/**
 * Purge the harness rows, then insert the role and its user from scratch. Safe
 * to call repeatedly and from every spec's `beforeAll`.
 */
export async function seedSecurityFixtures(): Promise<SecuritySeeded> {
	await cleanupSecurityFixtures();

	// Fail before inserting anything if the base fixtures are missing.
	const fixtureUsers = await rows<{ id: number; username: string }>(
		`SELECT id, username FROM users WHERE username IN (?, ?) AND isDelete = 0`,
		[SECURITY_USERS.superAdmin.username, SECURITY_USERS.employee.username]
	);
	const superAdminUserId = fixtureUsers.find(
		(row) => row.username === SECURITY_USERS.superAdmin.username
	)?.id;
	const employeeUserId = fixtureUsers.find(
		(row) => row.username === SECURITY_USERS.employee.username
	)?.id;
	if (!superAdminUserId || !employeeUserId) {
		throw new Error(
			'[e2e] base fixture users are missing — seedFixtures() (run by ' +
				'e2e/global-setup.ts) must run before seedSecurityFixtures()'
		);
	}

	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, ?, 'E2E', ?, ?, 'active')`,
		[
			SECURITY_ROLES.finance.roleCode,
			SECURITY_ROLES.finance.roleName,
			SECURITY_ROLES.finance.roleHierarchy,
			JSON.stringify(SECURITY_ROLES.finance.permissions),
			'E2E security fixture role (e2e/lib/security-fixtures.ts)',
		]
	);

	const passwordHash = await bcrypt.hash(SECURITY_USERS.finance.password, 10);
	const finance = await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			SECURITY_USERS.finance.username,
			passwordHash,
			SECURITY_USERS.finance.email,
			SECURITY_USERS.finance.fullName,
			role.insertId,
		]
	);

	return {
		roleId: role.insertId,
		financeUserId: finance.insertId,
		superAdminUserId,
		employeeUserId,
	};
}

/**
 * Remove every row this harness owns (`e2e_sec_finance` user + role, plus its
 * sessions, which cascade). Safe to run repeatedly; call it from `afterAll`.
 */
export async function cleanupSecurityFixtures(): Promise<void> {
	const username = SECURITY_USERS.finance.username;

	// Log tables have drifted across schemas (see fixtures.ts); purging the
	// fixture user must never be blocked by them.
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username = ?)`,
	]) {
		try {
			await exec(sql, [username]);
		} catch {
			// Optional table — keep purging.
		}
	}

	// sessions/user_activity_logs/user_permissions cascade from the users row.
	await exec(`DELETE FROM users WHERE username = ?`, [username]);
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [
		SECURITY_ROLES.finance.roleCode,
	]);
}

/**
 * The `auth` rate-limit identity each loginAs call is counted under, via the
 * proxy's trusted header (ADR-0013: `x-vercel-forwarded-for`, which Vercel
 * overwrites but a local `next start` passes through).
 *
 * This is E2E platform simulation for isolation only: without it every login
 * in a run shares the single `unknown:anon:auth` bucket (10 per 15 min), so
 * auth.setup plus a few spec logins would 429 unrelated specs on a rerun.
 * These are TEST-NET-2 addresses that never route anywhere, and the rate-limit
 * spec keeps proving that rotating the *client-supplied* `x-forwarded-for`
 * cannot mint a fresh budget.
 */
const LOGIN_IP_BY_USER: Record<SecurityUserKey, string> = {
	superAdmin: '198.18.0.1',
	finance: '198.18.0.2',
	employee: '198.18.0.3',
};

/**
 * Clear this identity's `auth` buckets so a rerun inside the same fixed
 * window starts from a full budget. Best-effort: on a schema without the
 * operational `rate_limit_buckets` table there is nothing persisted to clear.
 */
async function resetLoginRateLimitBudget(ip: string): Promise<void> {
	try {
		await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
			`${ip}:%:auth`,
		]);
	} catch {
		// Pre-migration schema — the limiter is in-memory there.
	}
}

/**
 * Sign in through the real API and return a context carrying that session.
 * Throws (with the login status) when the credentials or the harness rows are
 * wrong, so a broken fixture fails at the call site, not as a mystery 401.
 */
export async function loginAs(
	playwright: PlaywrightApi,
	baseURL: string,
	userKey: SecurityUserKey
): Promise<APIRequestContext> {
	const user = SECURITY_USERS[userKey];
	const ip = LOGIN_IP_BY_USER[userKey];
	const probe = await playwright.request.newContext({ baseURL });
	try {
		await resetLoginRateLimitBudget(ip);
		const res = await probe.post('/api/login', {
			headers: { 'x-vercel-forwarded-for': ip },
			data: { username: user.username, password: user.password },
		});
		if (!res.ok()) {
			const retryAfter = res.headers()['retry-after'];
			throw new Error(
				`[e2e] loginAs(${userKey}) failed: POST /api/login -> ` +
					`${res.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}

		const token = sessionTokenFrom(res.headers()['set-cookie'] ?? '');
		if (!token) {
			throw new Error(
				`[e2e] loginAs(${userKey}): login succeeded but no session cookie was set`
			);
		}
		return await playwright.request.newContext({
			baseURL,
			storageState: sessionStorageState(baseURL, token),
		});
	} finally {
		await probe.dispose();
	}
}

/** A request context with no cookies at all. */
export async function anonymousContext(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	// `playwright.request.newContext` inherits the config's default
	// storageState (the signed-in admin jar) unless it is cleared explicitly.
	return playwright.request.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] },
	});
}

/**
 * A request context whose `session` cookie is `forged-value` — the exact
 * cookie-presence bypass the old proxy accepted. Pass another token to forge a
 * well-formed-looking one.
 */
export async function forgedSessionContext(
	playwright: PlaywrightApi,
	baseURL: string,
	token: string = FORGED_SESSION_TOKEN
): Promise<APIRequestContext> {
	return playwright.request.newContext({
		baseURL,
		storageState: sessionStorageState(baseURL, token),
	});
}

/** Pull the session token out of the login response's `set-cookie` header. */
function sessionTokenFrom(setCookie: string): string | null {
	const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(setCookie);
	return match ? match[1] : null;
}

/**
 * Cookie jar for an authenticated API context. The E2E server speaks plain
 * HTTP on localhost while `NODE_ENV=production` makes the app set `Secure`, so
 * the flag is cleared to guarantee the cookie is sent over http.
 */
function sessionStorageState(
	baseURL: string,
	token: string
): { cookies: Cookie[]; origins: [] } {
	return {
		cookies: [
			{
				name: 'session',
				value: token,
				domain: new URL(baseURL).hostname,
				path: '/',
				expires: -1,
				httpOnly: true,
				secure: false,
				sameSite: 'Lax',
			},
		],
		origins: [],
	};
}
