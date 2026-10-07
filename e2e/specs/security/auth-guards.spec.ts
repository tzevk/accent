import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { readArtifact, writeArtifact } from '../../lib/artifacts';
import { exec, rows } from '../../lib/db';
import { E2E_ENV } from '../../lib/env';
import { ADMIN_USER, EMPLOYEE_USER } from '../../lib/fixtures';
import {
	SECURITY_USERS,
	anonymousContext,
	cleanupSecurityFixtures,
	forgedSessionContext,
	loginAs,
	seedSecurityFixtures,
} from '../../lib/security-fixtures';

/**
 * Workstream A authorization sweep (plan A2/A3/A4 + ADR-0014, issue #254).
 *
 * Asserts the external contract of every route the workstream added or
 * re-guarded, plus the public surface and the logout contract:
 *
 *  1. no session      -> 401   (the proxy answers before the handler runs)
 *  2. forged `session` cookie -> 401   (a cookie value with no `sessions` row)
 *  3. employee session -> 403   (the fixture employee holds no permissions)
 *  4. finance session  -> the guard passed (2xx/400/404, never 401/403)
 *  5. deleted routes   -> 404 signed in, 401 anonymously
 *  6. `/api/health` and `/api/session` stay public with a minimal payload
 *  7. anonymous page requests redirect to /signin
 *  8. logout revokes exactly the session it was called with (plan story 14)
 *
 * `GUARDED_ROUTES.methods` is the set of handlers this workstream added or
 * re-guarded, read off each route file: where a file already guarded some
 * handlers (`/api/projects` GET/POST, `/api/employees/import` POST) only the
 * newly guarded ones are swept.
 *
 * The finance sweep sends a deliberately invalid request, so most mutating
 * methods come back 400 from the handler's own validation. Three POSTs have
 * no validation branch and would otherwise write to the real tables
 * (`admin/material-requisitions`, `projects/[id]/{invoice,quotation}`);
 * those use a namespaced payload addressed at a project id no real project
 * uses. The fourth, `projects/[id]/purchase-order`, now creates a canonical
 * order (#310): its handler validates the body, and `createOrder` requires
 * an existing Project, so the sweep seeds a namespaced Project
 * (`E2E-SEC-AG-P1`) and addresses that route at it with a valid payload.
 * Every row the sweep creates is purged by the spec — before the sweep (in
 * case a previous run crashed) and again at the end, where the artifact
 * records the observed counts.
 *
 * Rate-limit budget: the `auth` category allows 10 logins/15 min per platform
 * IP (shared with every other spec), so this file logs in exactly twice — the
 * memoized finance session used by the whole sweep, and one second finance
 * session for the logout contract. The employee identity reuses the cookie jar
 * the setup project already wrote (`e2e/.auth/employee.json`), like the RBAC
 * spec does. Every request carries its own `x-vercel-forwarded-for`
 * (ADR-0013's trusted header), so each identity counts in its own `api` bucket
 * (~50 requests against 120/min) instead of the shared anonymous one.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

type StatusField = 'anonymous' | 'forged' | 'employee' | 'finance';

const TRUSTED_IP_HEADER = 'x-vercel-forwarded-for';

/** One platform IP per identity, so the sweeps never share a rate-limit bucket. */
const PLATFORM_IPS = {
	admin: '203.0.113.10',
	anonymous: '203.0.113.11',
	forged: '203.0.113.12',
	employee: '203.0.113.13',
	finance: '203.0.113.14',
} as const;

interface Identity {
	context: APIRequestContext;
	forwardedFor: string;
}

interface GuardedRoute {
	/** Route file the method list was read from. */
	source: string;
	/** Request path; `[id]` segments use a literal id. */
	path: string;
	methods: readonly Method[];
	/**
	 * Body for the finance sweep's POST/PUT/DELETE calls. Omitted where `{}`
	 * already trips the handler's validation; present for the four POSTs that
	 * have none, so the call cannot fail on a missing NOT NULL column.
	 */
	financeBody?: Record<string, unknown>;
}

/** A project id no real project uses; sweep rows for it are purged. */
const SWEEP_PROJECT_ID = 999999999;

/**
 * The purchase-order sweep POST creates a canonical order scoped to the
 * Project in its path (#310), and `createOrder` validates that the Project
 * exists — so the sweep seeds this namespaced Project and addresses the
 * route at its real id. `{sweepOrderProjectId}` in a route path resolves
 * to it once `beforeAll` has seeded it.
 */
const SWEEP_PROJECT_CODE = 'E2E-SEC-AG-P1';

/** The seeded sweep Project's real id; resolved in `beforeAll`. */
let sweepOrderProjectId = 0;

/** Resolve a route path's `{sweepOrderProjectId}` placeholder. */
function routePath(route: GuardedRoute): string {
	return route.path.replace(
		'{sweepOrderProjectId}',
		String(sweepOrderProjectId)
	);
}

/** Every row the finance sweep may write is namespaced `E2E-SEC-AG-`. */
const SWEEP_PREFIX = 'E2E-SEC-AG-';

const GUARDED_ROUTES: readonly GuardedRoute[] = [
	{
		source: 'src/app/api/masters/categories/route.js',
		path: '/api/masters/categories',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/masters/descriptions/route.js',
		path: '/api/masters/descriptions',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/masters/account-heads/route.js',
		path: '/api/masters/account-heads',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/masters/accounts/route.js',
		path: '/api/masters/accounts',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/masters/banks/route.js',
		path: '/api/masters/banks',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/activity-master/route.js',
		path: '/api/activity-master',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/activity-master/activities/route.js',
		path: '/api/activity-master/activities',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/activity-master/subactivities/route.js',
		path: '/api/activity-master/subactivities',
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/admin/invoice-list/route.ts',
		path: '/api/admin/invoice-list',
		methods: ['GET'],
	},
	{
		source: 'src/app/api/admin/payee-list/route.js',
		path: '/api/admin/payee-list',
		methods: ['GET'],
	},
	{
		source: 'src/app/api/admin/material-requisitions/route.js',
		path: '/api/admin/material-requisitions',
		methods: ['GET', 'POST', 'DELETE'],
		financeBody: {
			requisition_number: `${SWEEP_PREFIX}REQ-1`,
			requisition_date: '2019-01-01',
			requested_by: 'E2E Security',
			department: 'E2E',
			notes: 'e2e/specs/security/auth-guards.spec.ts',
		},
	},
	{
		source: 'src/app/api/admin/material-requisitions/next-number/route.js',
		path: '/api/admin/material-requisitions/next-number',
		methods: ['GET'],
	},
	{
		// Per-handler gap fixed in this workstream: GET/POST were already
		// guarded, the PUT/DELETE pair was not.
		source: 'src/app/api/projects/route.js',
		path: '/api/projects',
		methods: ['PUT', 'DELETE'],
	},
	{
		source: 'src/app/api/projects/[id]/invoice/route.js',
		path: `/api/projects/${SWEEP_PROJECT_ID}/invoice`,
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
		financeBody: {
			invoice_number: `${SWEEP_PREFIX}INV-1`,
			invoice_date: '2019-01-01',
			company_name: 'E2E Security',
			city: 'E2E',
			invoice_amount: 1,
			project_number: SWEEP_PREFIX,
			expenses_head: 'E2E',
			payment: 1,
			purchase_description: 'e2e/specs/security/auth-guards.spec.ts',
			payment_overdue_days: 0,
			remarks: 'e2e/specs/security/auth-guards.spec.ts',
			tab_type: 'invoice',
		},
	},
	{
		// #310: the Project tab's order surface now creates a canonical
		// order; `createOrder` requires an existing Project, so the path
		// addresses the seeded sweep Project (see `routePath`).
		source: 'src/app/api/projects/[id]/purchase-order/route.js',
		path: '/api/projects/{sweepOrderProjectId}/purchase-order',
		methods: ['GET', 'POST'],
		financeBody: {
			direction: 'supplier',
			order_number: `${SWEEP_PREFIX}PO-1`,
			counterparty_name: 'E2E Security',
			currency: 'INR',
			amount_basis: 'gross',
			gross_amount: 1,
			tax_amount: 0,
			net_amount: 1,
			order_date: '2019-01-01',
			status: 'draft',
			firmness: 'unknown',
			remarks: 'e2e/specs/security/auth-guards.spec.ts',
		},
	},
	{
		source: 'src/app/api/projects/[id]/quotation/route.js',
		path: `/api/projects/${SWEEP_PROJECT_ID}/quotation`,
		methods: ['GET', 'POST'],
		financeBody: {
			quotation_number: `${SWEEP_PREFIX}Q-1`,
			quotation_date: '2019-01-01',
			client_name: 'E2E Security',
			enquiry_number: SWEEP_PREFIX,
			enquiry_quantity: '1',
			scope_of_work: 'e2e/specs/security/auth-guards.spec.ts',
			gross_amount: 1,
			gst_percentage: 18,
			gst_amount: 0,
			net_amount: 1,
		},
	},
	{
		// Guard added for the template download; the import POST was already
		// guarded (and needs multipart, which this sweep does not build).
		source: 'src/app/api/employees/import/route.js',
		path: '/api/employees/import',
		methods: ['GET'],
	},
];

/** Routes deleted by A3/A4: gone from the tree, so 404 once authorized. */
const DELETED_ROUTES: readonly { method: Method; path: string }[] = [
	{ method: 'POST', path: '/api/auth/login' },
	{ method: 'GET', path: '/api/employees/available-for-users' },
	{ method: 'GET', path: '/api/employees/1/attendance' },
	{ method: 'GET', path: '/api/employees/1/salary-structure' },
];

/** The guarded route the logout contract probes by replaying a revoked token. */
const PROBE_ROUTE = '/api/masters/banks';

const ARTIFACT = 'security-auth-guards';

/** One row per `<METHOD> <path>`, filled in by the sweeps. */
interface RouteStatus {
	route: string;
	source: string;
	anonymous?: number;
	forged?: number;
	employee?: number;
	finance?: number;
}

/** Observations the artifact carries besides `routes`. */
interface SweepEvidence {
	preSweepPurge?: Record<string, number>;
	deletedRoutes?: { route: string; anonymous: number; authenticated: number }[];
	publicEndpoints?: {
		health: { status: number; body: Record<string, unknown> };
		session: { status: number; body: Record<string, unknown> };
		forgedSession: { status: number; authenticated: unknown };
	};
	pageRedirect?: {
		anonymous: { status: number; location: string | undefined };
		signedIn: { status: number; location: string | null };
	};
	logout?: {
		logoutStatus: number;
		replayedBeforeLogout: number;
		replayedAfterLogout: number;
		secondSessionAfterLogout: number;
		secondSessionAuthenticated: boolean;
		revokedTokenRows: number;
		liveRowsForUser: { before: number; after: number };
	};
}

interface SessionBody {
	authenticated: boolean;
	user?: { username: string };
}

const statuses = new Map<string, RouteStatus>();
const evidence: SweepEvidence = {};

function statusRow(route: GuardedRoute, method: Method): RouteStatus {
	const key = `${method} ${routePath(route)}`;
	let row = statuses.get(key);
	if (!row) {
		row = { route: key, source: route.source };
		statuses.set(key, row);
	}
	return row;
}

/** The rate-limit identity header the proxy trusts (ADR-0013). */
function platformHeaders(identity: Identity): Record<string, string> {
	return { [TRUSTED_IP_HEADER]: identity.forwardedFor };
}

/**
 * Deliberately invalid request: GET with no parameters, POST/PUT/DELETE with an
 * empty JSON object unless the route table carries a namespaced payload. Every
 * mutating method carries a JSON body so a handler that parses one cannot fail
 * on an empty stream.
 */
function call(
	identity: Identity,
	method: Method,
	path: string,
	body?: Record<string, unknown>
): Promise<APIResponse> {
	const headers = platformHeaders(identity);
	switch (method) {
		case 'GET':
			return identity.context.get(path, { headers });
		case 'POST':
			return identity.context.post(path, { data: body ?? {}, headers });
		case 'PUT':
			return identity.context.put(path, { data: body ?? {}, headers });
		case 'DELETE':
			return identity.context.delete(path, { data: body ?? {}, headers });
	}
}

/** Probe `/api/session` to prove which identity a context really carries. */
async function expectIdentity(
	identity: Identity,
	username: string
): Promise<SessionBody> {
	const response = await call(identity, 'GET', '/api/session');
	const body = (await response.json()) as SessionBody;
	expect(response.status(), `/api/session as ${username}`).toBe(200);
	expect(body.authenticated, `/api/session as ${username}`).toBe(true);
	expect(body.user?.username, `/api/session as ${username}`).toBe(username);
	return body;
}

/**
 * The finance sweep proves the *guard* does not reject the role; a deliberately
 * invalid payload (e.g. a nonexistent project id) may still fail deeper in the
 * handler, so any status other than the auth rejections passes.
 */
function guardPassed(status: number | undefined): boolean {
	return status !== undefined && status !== 401 && status !== 403;
}

/** Ask every guarded method as one identity and record the statuses. */
async function sweep(
	identity: Identity,
	field: StatusField,
	accept: (status: number) => boolean,
	expectation: string
): Promise<void> {
	for (const route of GUARDED_ROUTES) {
		for (const method of route.methods) {
			const row = statusRow(route, method);
			const status = (
				await call(
					identity,
					method,
					routePath(route),
					field === 'finance' ? route.financeBody : undefined
				)
			).status();
			row[field] = status;
			expect(
				accept(status),
				`${field} ${row.route} -> ${status}, ${expectation}`
			).toBe(true);
		}
	}
}

/** Hard-delete every row the finance sweep may have written. */
async function purgeSweepRows(): Promise<Record<string, number>> {
	const purged: Record<string, number> = {};
	purged.projectInvoices = (
		await exec('DELETE FROM project_invoices WHERE project_id = ?', [
			SWEEP_PROJECT_ID,
		])
	).affectedRows;
	// The purchase-order sweep used to write `project_purchase_orders`;
	// #310 removed that write path, so the legacy table stays empty.
	// The canonical order and its journal are purged by number prefix
	// (the seeded Project's id is only known once it exists).
	purged.projectPurchaseOrders = (
		await exec('DELETE FROM project_purchase_orders WHERE project_id = ?', [
			SWEEP_PROJECT_ID,
		])
	).affectedRows;
	purged.orderEvents = (
		await exec(
			`DELETE FROM order_events WHERE order_uid IN
         (SELECT order_uid FROM orders WHERE order_number LIKE ?)`,
			[`${SWEEP_PREFIX}%`]
		)
	).affectedRows;
	purged.orders = (
		await exec('DELETE FROM orders WHERE order_number LIKE ?', [
			`${SWEEP_PREFIX}%`,
		])
	).affectedRows;
	purged.sweepProjects = (
		await exec('DELETE FROM projects WHERE project_code = ?', [
			SWEEP_PROJECT_CODE,
		])
	).affectedRows;
	purged.projectQuotations = (
		await exec('DELETE FROM project_quotations WHERE project_id = ?', [
			SWEEP_PROJECT_ID,
		])
	).affectedRows;
	purged.materialRequisitions = (
		await exec(
			'DELETE FROM material_requisitions WHERE requisition_number LIKE ?',
			[`${SWEEP_PREFIX}%`]
		)
	).affectedRows;
	return purged;
}

let anonymous: Identity;
let forged: Identity;
let employee: Identity;
let finance: Identity | undefined;

/**
 * The finance identity for the whole file; a second login only for the logout
 * case. Cleared once the logout contract has revoked it, so a retry (or any
 * later test) logs in again instead of reusing a dead session.
 */
async function financeIdentity(
	playwright: Parameters<typeof loginAs>[0]
): Promise<Identity> {
	finance ??= {
		context: await loginAs(playwright, E2E_ENV.baseURL, 'finance'),
		forwardedFor: PLATFORM_IPS.finance,
	};
	return finance;
}

test.beforeAll(async ({ playwright }) => {
	await seedSecurityFixtures();
	// Rows can survive a crashed or interrupted earlier run; clear them before
	// the sweep so an insert never collides with its own leftovers.
	evidence.preSweepPurge = await purgeSweepRows();
	// The purchase-order sweep creates a canonical order scoped to the
	// Project in its path, and `createOrder` validates that the Project
	// exists — so the sweep carries its own namespaced Project.
	const project = await exec(
		`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
		[SWEEP_PROJECT_CODE, 'E2E Security Auth Guards Project', 'E2E Security']
	);
	sweepOrderProjectId = project.insertId;
	anonymous = {
		context: await anonymousContext(playwright, E2E_ENV.baseURL),
		forwardedFor: PLATFORM_IPS.anonymous,
	};
	forged = {
		context: await forgedSessionContext(playwright, E2E_ENV.baseURL),
		forwardedFor: PLATFORM_IPS.forged,
	};
	employee = {
		context: await playwright.request.newContext({
			baseURL: E2E_ENV.baseURL,
			// Signed in by `e2e/auth.setup.ts` through the real sign-in page.
			storageState: 'e2e/.auth/employee.json',
		}),
		forwardedFor: PLATFORM_IPS.employee,
	};
});

test.afterAll(async () => {
	await purgeSweepRows();
	await finance?.context.dispose();
	await employee?.context.dispose();
	await forged?.context.dispose();
	await anonymous?.context.dispose();
	await cleanupSecurityFixtures();
});

test('rejects anonymous and forged sessions on every workstream-A route', async () => {
	await sweep(
		anonymous,
		'anonymous',
		(status) => status === 401,
		'expected 401'
	);
	await sweep(forged, 'forged', (status) => status === 401, 'expected 401');
});

test('denies the employee identity on every workstream-A route', async () => {
	// The employee fixture has no role permissions at all, so the identity
	// probe must confirm the session before a 403 can mean "denied".
	await expectIdentity(employee, EMPLOYEE_USER.username);

	await sweep(employee, 'employee', (status) => status === 403, 'expected 403');
});

test('keeps every workstream-A route reachable for the finance role', async ({
	playwright,
}) => {
	const financeApi = await financeIdentity(playwright);
	await expectIdentity(financeApi, SECURITY_USERS.finance.username);

	await sweep(financeApi, 'finance', guardPassed, 'the guard must not 401/403');
});

test('answers 404 for deleted routes and 401 without a session', async ({
	request,
}) => {
	const admin: Identity = {
		context: request,
		forwardedFor: PLATFORM_IPS.admin,
	};
	await expectIdentity(admin, ADMIN_USER.username);

	const deleted: NonNullable<SweepEvidence['deletedRoutes']> = [];
	for (const route of DELETED_ROUTES) {
		const key = `${route.method} ${route.path}`;
		const authenticated = (
			await call(admin, route.method, route.path)
		).status();
		expect(authenticated, `signed-in ${key}`).toBe(404);

		const anonymousStatus = (
			await call(anonymous, route.method, route.path)
		).status();
		expect(anonymousStatus, `anonymous ${key}`).toBe(401);

		deleted.push({ route: key, anonymous: anonymousStatus, authenticated });
	}
	evidence.deletedRoutes = deleted;
});

test('serves the public endpoints without a session', async () => {
	const health = await call(anonymous, 'GET', '/api/health');
	const healthBody = (await health.json()) as Record<string, unknown>;
	expect(health.status()).toBe(200);
	expect(Object.keys(healthBody).sort()).toEqual(['status']);
	expect(healthBody.status).toBe('ok');

	const session = await call(anonymous, 'GET', '/api/session');
	const sessionBody = (await session.json()) as Record<string, unknown>;
	expect(session.status()).toBe(200);
	expect(sessionBody.authenticated).toBe(false);
	expect(sessionBody.user).toBeUndefined();

	// A forged cookie is a bad credential, not a public-path problem: the
	// public endpoints answer it the same way as no cookie at all.
	const forgedSession = await call(forged, 'GET', '/api/session');
	const forgedBody = (await forgedSession.json()) as Record<string, unknown>;
	expect(forgedSession.status()).toBe(200);
	expect(forgedBody.authenticated).toBe(false);

	evidence.publicEndpoints = {
		health: { status: health.status(), body: healthBody },
		session: { status: session.status(), body: sessionBody },
		forgedSession: {
			status: forgedSession.status(),
			authenticated: forgedBody.authenticated,
		},
	};
});

test('redirects an anonymous page request to the sign-in page', async ({
	request,
}) => {
	const admin: Identity = {
		context: request,
		forwardedFor: PLATFORM_IPS.admin,
	};
	const redirected = await anonymous.context.get('/dashboard', {
		maxRedirects: 0,
		headers: platformHeaders(anonymous),
	});
	expect([302, 307]).toContain(redirected.status());
	expect(redirected.headers()['location']).toContain('/signin');

	// Control: the same path with a session is not sent to /signin.
	const signedIn = await request.get('/dashboard', {
		maxRedirects: 0,
		headers: platformHeaders(admin),
	});
	expect(signedIn.status()).toBeGreaterThanOrEqual(200);
	expect(signedIn.status()).toBeLessThan(400);
	expect(signedIn.headers()['location'] ?? '').not.toContain('/signin');

	evidence.pageRedirect = {
		anonymous: {
			status: redirected.status(),
			location: redirected.headers()['location'],
		},
		signedIn: {
			status: signedIn.status(),
			location: signedIn.headers()['location'] ?? null,
		},
	};
});

test('logout ends exactly the session it was called with', async ({
	playwright,
}) => {
	const owners = await rows<{ id: number }>(
		`SELECT id FROM users WHERE username = ?`,
		[SECURITY_USERS.finance.username]
	);
	expect(owners).toHaveLength(1);
	const financeUserId = owners[0].id;

	const first = await financeIdentity(playwright);
	const second = await loginAs(playwright, E2E_ENV.baseURL, 'finance');
	const secondIdentity: Identity = {
		context: second,
		forwardedFor: PLATFORM_IPS.finance,
	};
	try {
		const cookieA = (await first.context.storageState()).cookies.find(
			(cookie) => cookie.name === 'session'
		);
		if (!cookieA?.value)
			throw new Error('[e2e] finance session A has no token');
		const tokenA = cookieA.value;

		const cookieB = (await second.storageState()).cookies.find(
			(cookie) => cookie.name === 'session'
		);
		if (!cookieB?.value)
			throw new Error('[e2e] finance session B has no token');
		const tokenB = cookieB.value;
		expect(tokenB, 'the two logins must issue distinct sessions').not.toBe(
			tokenA
		);

		// Replay A's exact cookie: the context the login helper built is not
		// enough on its own, because logout clears the cookie in its jar.
		const replayA = await playwright.request.newContext({
			baseURL: E2E_ENV.baseURL,
			storageState: { cookies: [{ ...cookieA, secure: false }], origins: [] },
		});
		const replayIdentity: Identity = {
			context: replayA,
			forwardedFor: PLATFORM_IPS.finance,
		};
		try {
			const beforeLogout = await call(replayIdentity, 'GET', PROBE_ROUTE);
			expect(beforeLogout.status(), 'replayed token A before logout').toBe(200);

			// Count before and after rather than assuming a pristine seed, so a
			// retried run still proves "exactly one session ended".
			const liveBefore = Number(
				(
					await rows<{ n: number }>(
						`SELECT COUNT(*) AS n FROM sessions
          WHERE user_id = ? AND expires_at > NOW()`,
						[financeUserId]
					)
				)[0].n
			);
			expect(
				liveBefore,
				'both finance sessions are live before the logout'
			).toBeGreaterThanOrEqual(2);

			const logout = await call(first, 'POST', '/api/logout');
			expect(logout.status()).toBe(200);

			const afterLogout = await call(replayIdentity, 'GET', PROBE_ROUTE);
			expect(afterLogout.status(), 'replayed token A after logout').toBe(401);

			const survivorProbe = await call(secondIdentity, 'GET', PROBE_ROUTE);
			expect(survivorProbe.status(), 'session B survives A logging out').toBe(
				200
			);
			const sessionB = await expectIdentity(
				secondIdentity,
				SECURITY_USERS.finance.username
			);

			const revoked = await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM sessions WHERE token_hash = SHA2(?, 256)`,
				[tokenA]
			);
			const survivor = await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM sessions
          WHERE token_hash = SHA2(?, 256) AND expires_at > NOW()`,
				[tokenB]
			);
			const liveAfter = Number(
				(
					await rows<{ n: number }>(
						`SELECT COUNT(*) AS n FROM sessions
          WHERE user_id = ? AND expires_at > NOW()`,
						[financeUserId]
					)
				)[0].n
			);
			expect(Number(revoked[0].n), "revoked session A's row is gone").toBe(0);
			expect(Number(survivor[0].n), "session B's row is still live").toBe(1);
			expect(liveAfter, 'logout ended exactly one session').toBe(
				liveBefore - 1
			);

			evidence.logout = {
				logoutStatus: logout.status(),
				replayedBeforeLogout: beforeLogout.status(),
				replayedAfterLogout: afterLogout.status(),
				secondSessionAfterLogout: survivorProbe.status(),
				secondSessionAuthenticated: sessionB.authenticated,
				revokedTokenRows: Number(revoked[0].n),
				liveRowsForUser: { before: liveBefore, after: liveAfter },
			};
		} finally {
			await replayA.dispose();
		}
	} finally {
		await second.dispose();
		// The memoized sweep session has been revoked by this test; drop it so a
		// retry or a reordered run logs in again instead of replaying a corpse.
		await first.context.dispose();
		finance = undefined;
	}
});

test('writes the security-auth-guards artifact', async () => {
	const routes = [...statuses.values()].sort((a, b) =>
		a.route.localeCompare(b.route)
	);
	const expectedRouteCount = GUARDED_ROUTES.reduce(
		(total, route) => total + route.methods.length,
		0
	);
	// Rows the sweeps did not reach (a filtered or retried run) are breaches,
	// not silently absent: `ok` is derived from what was observed.
	const breaches = routes
		.filter(
			(row) =>
				row.anonymous !== 401 ||
				row.forged !== 401 ||
				row.employee !== 403 ||
				!guardPassed(row.finance)
		)
		.map((row) => row.route);

	// The sweep's mutating POSTs wrote through the finance session;
	// prove it in the database, then purge every row this spec created.
	const created = {
		projectInvoices: Number(
			(
				await rows<{ n: number }>(
					'SELECT COUNT(*) AS n FROM project_invoices WHERE project_id = ?',
					[SWEEP_PROJECT_ID]
				)
			)[0].n
		),
		orders: Number(
			(
				await rows<{ n: number }>(
					`SELECT COUNT(*) AS n FROM orders
            WHERE project_id = ? AND order_number LIKE ?`,
					[sweepOrderProjectId, `${SWEEP_PREFIX}%`]
				)
			)[0].n
		),
		projectQuotations: Number(
			(
				await rows<{ n: number }>(
					'SELECT COUNT(*) AS n FROM project_quotations WHERE project_id = ?',
					[SWEEP_PROJECT_ID]
				)
			)[0].n
		),
		materialRequisitions: Number(
			(
				await rows<{ n: number }>(
					'SELECT COUNT(*) AS n FROM material_requisitions WHERE requisition_number LIKE ?',
					[`${SWEEP_PREFIX}%`]
				)
			)[0].n
		),
	};
	const wroteThrough = Object.values(created).every((count) => count === 1);

	const purged = await purgeSweepRows();
	const leftovers = Number(
		(
			await rows<{ n: number }>(
				`SELECT
          (SELECT COUNT(*) FROM project_invoices WHERE project_id = ?) +
          (SELECT COUNT(*) FROM project_purchase_orders WHERE project_id = ?) +
          (SELECT COUNT(*) FROM project_quotations WHERE project_id = ?) +
           (SELECT COUNT(*) FROM material_requisitions WHERE requisition_number LIKE ?) +
           (SELECT COUNT(*) FROM orders WHERE project_id = ? AND order_number LIKE ?) +
           (SELECT COUNT(*) FROM order_events WHERE order_uid IN
             (SELECT order_uid FROM orders WHERE order_number LIKE ?)) +
           (SELECT COUNT(*) FROM projects WHERE project_code = ?) AS n`,
				[
					SWEEP_PROJECT_ID,
					SWEEP_PROJECT_ID,
					SWEEP_PROJECT_ID,
					`${SWEEP_PREFIX}%`,
					sweepOrderProjectId,
					`${SWEEP_PREFIX}%`,
					`${SWEEP_PREFIX}%`,
					SWEEP_PROJECT_CODE,
				]
			)
		)[0].n
	);

	// Written before the assertions so even a partial run leaves the artifact
	// behind; `ok` says whether the observations actually held.
	const ok =
		routes.length === expectedRouteCount &&
		breaches.length === 0 &&
		wroteThrough &&
		leftovers === 0;
	writeArtifact(ARTIFACT, {
		routes,
		expectedRouteCount,
		breaches,
		created,
		purged,
		leftovers,
		...evidence,
		ok,
	});

	expect(routes.length, 'every swept method is recorded').toBe(
		expectedRouteCount
	);
	expect(breaches, 'per-route contract breaches').toEqual([]);
	expect(
		created,
		'the sweep mutating POSTs wrote through the finance role'
	).toEqual({
		projectInvoices: 1,
		orders: 1,
		projectQuotations: 1,
		materialRequisitions: 1,
	});
	expect(leftovers, 'sweep rows are purged').toBe(0);
	expect(readArtifact(ARTIFACT)).toMatchObject({ ok: true });
});
