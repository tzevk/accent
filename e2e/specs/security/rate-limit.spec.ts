import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readArtifact, writeArtifact } from '../../lib/artifacts';
import { exec, rows } from '../../lib/db';
import { E2E_ENV } from '../../lib/env';
import {
	anonymousContext,
	forgedSessionContext,
} from '../../lib/security-fixtures';

/**
 * Rate limiting under the post-remediation identity + store rules (plan
 * workstream F1/F2, ADR-0013):
 *
 *   - identity is the platform-set header `x-vercel-forwarded-for`; rotating
 *     the client-supplied `x-forwarded-for` must not mint a fresh budget
 *   - `auth` (10 requests / 15 min) counts in the shared `rate_limit_buckets`
 *     table, so the 11th wrong-password attempt in one window is 429 with a
 *     numeric `Retry-After`
 *   - `session` (120 requests / min) still counts in the proxy's in-memory
 *     Map, so the 121st `/api/session` request in one window is 429
 *   - every bucket row this spec creates is purged before and after the run
 *
 * The spec never logs in successfully: both probes are anonymous (wrong
 * password / forged cookie), so the shared `auth` budget of the fixture users
 * stays untouched for the other security specs.
 */

/** Plan F2 / ADR-0013 policy: `auth` is 10 requests per 15 minutes. */
const AUTH_LIMIT = 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

/** Plan F2 / ADR-0013 policy: `session` is 120 requests per minute. */
const SESSION_LIMIT = 120;

/** The header the proxy keys the limiter on (`getClientIP`). */
const TRUSTED_HEADER = 'x-vercel-forwarded-for';

/**
 * A TEST-NET address (RFC 5737 — never a real client), drawn at random from
 * the two documentation blocks no sibling spec pins; `auth-guards.spec.ts`
 * holds `203.0.113.10-14`, and colliding with it would share the proxy's
 * in-memory `${ip}:anon:session` bucket (breaking the 121st-request assertion)
 * and let the purge here delete that spec's rows. Everything below holds the
 * value constant: it is the only thing ADR-0013 lets the limiter key on, so a
 * unique value keeps other traffic out of this spec's budget. The per-run draw
 * also keeps a rerun from reusing the previous run's key — the `session`
 * counter lives in the proxy's in-memory Map (60 s block duration) and cannot
 * be purged from here, so for that one category this is best-effort isolation.
 */
const TEST_NET_BLOCKS = ['192.0.2', '198.51.100'];
const TEST_NET_BLOCK = TEST_NET_BLOCKS[randomInt(0, TEST_NET_BLOCKS.length)];
const TRUSTED_IP = `${TEST_NET_BLOCK}.${randomInt(1, 255)}`;

/** Never a real account, so the login handler 401s without touching a user. */
const PROBE_IDENTIFIER = 'e2e_sec_ratelimit_probe';
const PROBE_PASSWORD = 'definitely-wrong';

/** The key the proxy derives for an unauthenticated login attempt. */
const AUTH_BUCKET_KEY = `${TRUSTED_IP}:anon:auth`;

interface Observed {
	purgedBefore: number;
	authStatuses: number[];
	authRetryAfter?: string;
	authBucketCount: number;
	sessionStatuses: number[];
	sessionFirstLimitedAt: number;
	sessionRetryAfter?: string;
	purgedAfter: number;
	remainingRows: number;
}

const observed: Observed = {
	purgedBefore: 0,
	authStatuses: [],
	authBucketCount: 0,
	sessionStatuses: [],
	sessionFirstLimitedAt: 0,
	purgedAfter: 0,
	remainingRows: 0,
};

/** Delete every bucket row keyed to this spec's trusted IP. */
async function purgeBuckets(ip: string): Promise<number> {
	const result = await exec(
		'DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?',
		[`${ip}:%`]
	);
	return result.affectedRows;
}

/** How many bucket rows the shared store still holds for this IP. */
async function countBuckets(ip: string): Promise<number> {
	const found = await rows<{ n: number }>(
		'SELECT COUNT(*) AS n FROM rate_limit_buckets WHERE bucket_key LIKE ?',
		[`${ip}:%`]
	);
	return Number(found[0]?.n ?? 0);
}

/** The current auth window's request count, aligned exactly like the store. */
async function authBucketCount(): Promise<number> {
	const windowStart = Math.floor(Date.now() / AUTH_WINDOW_MS) * AUTH_WINDOW_MS;
	const found = await rows<{ total: number | string }>(
		'SELECT COALESCE(SUM(count), 0) AS total FROM rate_limit_buckets WHERE bucket_key = ? AND window_start = ?',
		[AUTH_BUCKET_KEY, windowStart]
	);
	return Number(found[0]?.total ?? 0);
}

/**
 * The `auth` window is fixed and aligned to the wall clock, so a roll between
 * attempt 10 and attempt 11 would reset the count and turn the 11th attempt
 * into a 401. The whole loop must therefore fit inside what is left of the
 * current window; start only when a wide margin remains (11 requests against a
 * local server take well under a second).
 */
const AUTH_WINDOW_RUNWAY_MS = 30_000;

async function waitForUsableAuthWindow(): Promise<void> {
	const remaining = AUTH_WINDOW_MS - (Date.now() % AUTH_WINDOW_MS);
	if (remaining < AUTH_WINDOW_RUNWAY_MS) {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, remaining + 250);
		await promise;
	}
}

test.describe('security: rate limiting (F1/F2, ADR-0013)', () => {
	test.beforeAll(async () => {
		observed.purgedBefore = await purgeBuckets(TRUSTED_IP);
	});

	// Safety net: a mid-test failure must not leave rows that poison a rerun
	// that happens to draw the same last octet.
	test.afterAll(async () => {
		await purgeBuckets(TRUSTED_IP);
	});

	test('auth: rotating x-forwarded-for does not mint a new budget', async ({
		playwright,
	}) => {
		await waitForUsableAuthWindow();

		const login = await anonymousContext(playwright, E2E_ENV.baseURL);
		try {
			for (let attempt = 1; attempt <= AUTH_LIMIT + 1; attempt++) {
				const res = await login.post('/api/login', {
					headers: {
						// The platform-set header is the identity — constant.
						[TRUSTED_HEADER]: TRUSTED_IP,
						// Client-supplied: rotated on every attempt, exactly
						// like the header-rotation bypass F1 closes.
						'x-forwarded-for': `10.0.0.${attempt}`,
					},
					data: { username: PROBE_IDENTIFIER, password: PROBE_PASSWORD },
				});
				observed.authStatuses.push(res.status());
				if (res.status() === 429) {
					observed.authRetryAfter = res.headers()['retry-after'];
				}
			}
		} finally {
			await login.dispose();
		}

		// The first ten attempts reach the handler and are rejected on
		// credentials, so the limiter let them through.
		expect(observed.authStatuses.slice(0, AUTH_LIMIT)).toEqual(
			Array.from({ length: AUTH_LIMIT }, () => 401)
		);
		// The eleventh is refused by the shared bucket despite the new
		// `x-forwarded-for` value...
		expect(observed.authStatuses[AUTH_LIMIT]).toBe(429);
		// ...with a numeric Retry-After pointing at the window end.
		expect(observed.authRetryAfter).toMatch(/^\d+$/);
		const retryAfterSeconds = Number(observed.authRetryAfter);
		expect(retryAfterSeconds).toBeGreaterThan(0);
		expect(retryAfterSeconds).toBeLessThanOrEqual(AUTH_WINDOW_MS / 1000);
		// F2 proof: the count really lives in the shared table, keyed by the
		// trusted IP + `anon` (the rotated header contributed nothing).
		observed.authBucketCount = await authBucketCount();
		expect(observed.authBucketCount).toBe(AUTH_LIMIT + 1);
	});

	test('session: the in-memory category still limits, and the run cleans up', async ({
		playwright,
	}) => {
		const forged = await forgedSessionContext(
			playwright,
			E2E_ENV.baseURL,
			`ratelimit-probe-${Date.now()}`
		);
		try {
			for (let attempt = 1; attempt <= SESSION_LIMIT + 1; attempt++) {
				const res = await forged.get('/api/session', {
					headers: { [TRUSTED_HEADER]: TRUSTED_IP },
				});
				observed.sessionStatuses.push(res.status());
				if (res.status() === 429) {
					if (observed.sessionFirstLimitedAt === 0) {
						observed.sessionFirstLimitedAt = attempt;
						observed.sessionRetryAfter = res.headers()['retry-after'];
					}
				}
			}
		} finally {
			await forged.dispose();
		}

		// One tight loop, one window: the 121st request is the first 429.
		expect(observed.sessionFirstLimitedAt).toBe(SESSION_LIMIT + 1);
		expect(observed.sessionStatuses[SESSION_LIMIT]).toBe(429);
		expect(observed.sessionStatuses.slice(0, SESSION_LIMIT)).not.toContain(429);
		expect(observed.sessionRetryAfter).toMatch(/^\d+$/);
		expect(Number(observed.sessionRetryAfter)).toBeGreaterThan(0);

		// Cleanup: nothing this spec touched may survive in the shared table.
		observed.purgedAfter = await purgeBuckets(TRUSTED_IP);
		observed.remainingRows = await countBuckets(TRUSTED_IP);
		expect(observed.remainingRows).toBe(0);

		// The artifact must not claim success the auth half did not observe: the
		// two tests run independently and this one still writes the file when
		// the F1/F2 assertions above failed.
		const ok =
			observed.authStatuses[AUTH_LIMIT] === 429 &&
			observed.authBucketCount === AUTH_LIMIT + 1 &&
			observed.sessionFirstLimitedAt === SESSION_LIMIT + 1 &&
			observed.remainingRows === 0;

		writeArtifact('security-rate-limit', {
			trustedHeader: TRUSTED_HEADER,
			trustedIp: TRUSTED_IP,
			rotatedHeader: 'x-forwarded-for',
			policy: {
				auth: `${AUTH_LIMIT}/15m in rate_limit_buckets`,
				session: `${SESSION_LIMIT}/min in the in-memory Map`,
			},
			auth: {
				endpoint: 'POST /api/login',
				attempts: observed.authStatuses.length,
				statuses: observed.authStatuses,
				retryAfter: observed.authRetryAfter ?? null,
				bucketKey: AUTH_BUCKET_KEY,
				bucketCount: observed.authBucketCount,
			},
			session: {
				endpoint: 'GET /api/session',
				attempts: observed.sessionStatuses.length,
				statuses: observed.sessionStatuses,
				firstLimitedAt: observed.sessionFirstLimitedAt,
				retryAfter: observed.sessionRetryAfter ?? null,
			},
			cleanup: {
				purgedBefore: observed.purgedBefore,
				purgedAfter: observed.purgedAfter,
				remainingBucketRows: observed.remainingRows,
			},
			ok,
		});
		expect(readArtifact('security-rate-limit')).toMatchObject({
			trustedIp: TRUSTED_IP,
			ok,
			auth: { statuses: observed.authStatuses },
			session: { statuses: observed.sessionStatuses },
		});
	});
});
