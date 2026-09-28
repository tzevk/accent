import { NextResponse, type NextRequest } from 'next/server';
// Relative imports on purpose: the proxy must not rely on shared modules with
// the route handlers (ADR-0011), and it stays independent of the app's alias
// configuration and of src/utils/database.js's shared global pool.
import { isSessionValid, hashSessionToken } from './utils/session-probe.js';
import {
	consumeRateLimitBucket,
	deleteExpiredRateLimitBuckets,
} from './utils/rate-limit-store.js';

// ═══════════════════════════════════════════════════════════════════════════
// Unauthenticated surface (ADR-0014)
//
// Exact matches only — adding an entry here is a security decision, and the
// CI route guard's allowlist mirrors this list. Prefix matching for non-asset
// paths is deliberately gone: a new /api/auth/* route must not become public
// by accident.
// ═══════════════════════════════════════════════════════════════════════════
const PUBLIC_PATHS: Record<string, true> = {
	'/signin': true,
	'/api/login': true,
	'/api/logout': true,
	'/api/session': true,
	// Smart Office's outbound webhook sends no session cookie; the real
	// auth boundary is the Bearer check inside the route handler.
	'/api/attendance/webhook': true,
	// Uptime probe; answers { status: 'ok' } and carries no data.
	'/api/health': true,
	'/favicon.ico': true,
	'/robots.txt': true,
	'/sitemap.xml': true,
	'/manifest.webmanifest': true,
	'/accent-logo.png': true,
};

// Asset trees serve no data (build output, rasterized PNGs) and are requested
// by arbitrary path, so these three stay prefix-matched.
const PUBLIC_ASSET_PREFIXES = ['/_next', '/public', '/uploads'];

// ═══════════════════════════════════════════════════════════════════════════
// In-memory rate limiter (runtime-agnostic; Next 16 proxy runs on Node.js)
// ═══════════════════════════════════════════════════════════════════════════
interface RateLimitEntry {
	count: number;
	windowStart: number;
	blockedUntil: number | null;
}

interface RateLimitConfig {
	windowMs: number;
	maxRequests: number;
	blockDurationMs: number;
}

interface RateLimitResult {
	limited: boolean;
	remaining: number;
	resetIn: number;
	limit: number;
	category: RateLimitCategory;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Rate limit configurations
const RATE_LIMITS = {
	auth: {
		windowMs: 15 * 60 * 1000,
		maxRequests: 10,
		blockDurationMs: 30 * 60 * 1000,
	},
	session: {
		windowMs: 60 * 1000,
		maxRequests: 120,
		blockDurationMs: 60 * 1000,
	},
	dashboard: {
		windowMs: 60 * 1000,
		maxRequests: 60,
		blockDurationMs: 60 * 1000,
	},
	api: { windowMs: 60 * 1000, maxRequests: 120, blockDurationMs: 60 * 1000 },
	heavy: {
		windowMs: 60 * 1000,
		maxRequests: 10,
		blockDurationMs: 2 * 60 * 1000,
	},
} satisfies Record<string, RateLimitConfig>;

type RateLimitCategory = keyof typeof RATE_LIMITS;

const MAX_RATE_LIMIT_WINDOW_MS = Math.max(
	...Object.values(RATE_LIMITS).map((config) => config.windowMs)
);

// ADR-0013: the two brute-forceable categories count in MySQL so hopping
// instances cannot reset the budget; the short windows stay in the Map below.
// A DB bucket is a plain fixed window — it 429s until the window ends and has
// no `blockDurationMs`, which only the in-memory categories apply.
const DB_BACKED_CATEGORIES: Record<RateLimitCategory, boolean> = {
	auth: true,
	heavy: true,
	session: false,
	dashboard: false,
	api: false,
};

// ADR-0013: identity comes only from the header the platform sets and
// overwrites — Vercel strips client-supplied values from this one. The
// client-controlled `x-forwarded-for` first hop is never trusted. A future
// non-Vercel deployment points this constant at its own trusted header.
const TRUSTED_IP_HEADER = 'x-vercel-forwarded-for';
const UNKNOWN_IP = 'unknown';

function getClientIP(req: NextRequest): string {
	const trusted = req.headers.get(TRUSTED_IP_HEADER);
	if (trusted) {
		const first = trusted.split(',')[0].trim();
		if (first) return first;
	}
	return UNKNOWN_IP;
}

function getRateLimitCategory(pathname: string): RateLimitCategory {
	if (pathname.startsWith('/api/login') || pathname.startsWith('/api/logout')) {
		return 'auth';
	}
	if (pathname.startsWith('/api/session')) {
		return 'session';
	}
	if (
		pathname.includes('dashboard-stats') ||
		pathname.includes('manhours-stats') ||
		pathname.startsWith('/api/analytics')
	) {
		return 'dashboard';
	}
	if (
		pathname.includes('export') ||
		pathname.includes('report') ||
		pathname.includes('bulk')
	) {
		return 'heavy';
	}
	return 'api';
}

async function checkRateLimit(
	req: NextRequest,
	isAuthenticated: boolean
): Promise<RateLimitResult | null> {
	const pathname = req.nextUrl.pathname;

	// Only rate limit API routes
	if (!pathname.startsWith('/api')) return null;

	// Don't rate limit preflight requests
	if (req.method === 'OPTIONS') return null;

	const ip = getClientIP(req);
	const category = getRateLimitCategory(pathname);
	const config = RATE_LIMITS[category];
	const sessionValue = req.cookies.get('session')?.value;
	// Key shape from ADR-0013: `ip:sha256(session token)|anon:category`.
	// Only a *validated* session contributes identity: the cookie is
	// client-supplied, so hashing an unverified value would let an attacker
	// mint a fresh budget per request — the same rotation bypass the trusted
	// IP header closes for `x-forwarded-for` (which is why `/api/login`, where
	// no session exists yet, is always counted as `anon`).
	const identity =
		isAuthenticated && sessionValue ? hashSessionToken(sessionValue) : 'anon';

	const key = `${ip}:${identity}:${category}`;

	if (DB_BACKED_CATEGORIES[category]) {
		const bucket = await consumeRateLimitBucket({
			bucketKey: key,
			windowMs: config.windowMs,
			maxRequests: config.maxRequests,
		});
		if (bucket.limited && bucket.count === config.maxRequests + 1) {
			console.warn(
				`[RateLimit] IP ${ip} over ${category} limit (${config.maxRequests} per ${Math.round(config.windowMs / 60000)}m)`
			);
		}
		return { ...bucket, category };
	}

	const now = Date.now();

	let entry = rateLimitStore.get(key);

	// Check if blocked
	if (entry?.blockedUntil && entry.blockedUntil > now) {
		const resetIn = Math.ceil((entry.blockedUntil - now) / 1000);
		return {
			limited: true,
			remaining: 0,
			resetIn,
			limit: config.maxRequests,
			category,
		};
	}

	// Initialize or reset window
	if (!entry || entry.windowStart + config.windowMs < now) {
		entry = { count: 0, windowStart: now, blockedUntil: null };
		rateLimitStore.set(key, entry);
	}

	entry.count++;

	// Check if over limit
	if (entry.count > config.maxRequests) {
		entry.blockedUntil = now + config.blockDurationMs;
		console.warn(
			`[RateLimit] IP ${ip} blocked for ${category} - ${entry.count} requests`
		);
		return {
			limited: true,
			remaining: 0,
			resetIn: Math.ceil(config.blockDurationMs / 1000),
			limit: config.maxRequests,
			category,
		};
	}

	return {
		limited: false,
		remaining: config.maxRequests - entry.count,
		resetIn: Math.ceil((entry.windowStart + config.windowMs - now) / 1000),
		limit: config.maxRequests,
		category,
	};
}

// Periodic cleanup (runs on each request but only cleans if needed)
let lastCleanup = 0;
function cleanupRateLimitStore() {
	const now = Date.now();
	if (now - lastCleanup < 60000) return; // Once per minute max
	lastCleanup = now;

	for (const [key, entry] of rateLimitStore.entries()) {
		if (
			entry.windowStart + MAX_RATE_LIMIT_WINDOW_MS * 2 < now &&
			(!entry.blockedUntil || entry.blockedUntil < now)
		) {
			rateLimitStore.delete(key);
		}
	}

	// Prevent unbounded growth
	if (rateLimitStore.size > 5000) {
		const entries = Array.from(rateLimitStore.entries());
		entries.sort((a, b) => a[1].windowStart - b[1].windowStart);
		entries.slice(0, 1000).forEach(([k]) => rateLimitStore.delete(k));
	}

	// The DB buckets share this sweep (ADR-0013); it never throws, so this
	// stays fire-and-forget rather than delaying the request.
	deleteExpiredRateLimitBuckets(MAX_RATE_LIMIT_WINDOW_MS * 2);
}

/**
 * Proxy - request gate in front of every route (Next 16 renamed the
 * `middleware` file convention to `proxy`; it runs on the Node.js runtime).
 *
 * 1. Validates the session cookie against MySQL (ADR-0011; 60 s cache)
 * 2. Rate limits API routes — `auth`/`heavy` buckets live in MySQL (ADR-0013)
 * 3. Public paths pass through; an authenticated user on /signin goes to
 *    /dashboard
 * 4. Unauthenticated page requests redirect to /signin, API requests get 401
 * 5. Admin gating stays server-side in src/app/admin/layout.tsx
 *
 * Session validation here is authentication only: every handler still
 * authorizes the resource it serves via ensurePermission.
 */
export async function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;

	// Cleanup old rate limit entries periodically
	cleanupRateLimitStore();

	// Validated once per request (60 s per-instance cache; no query at all when
	// the cookie is absent) and reused for the rate-limit identity and the gate.
	const sessionToken = req.cookies.get('session')?.value;
	const isAuthenticated = await isSessionValid(sessionToken);

	// Rate limiting for API routes
	const rateLimitResult = await checkRateLimit(req, isAuthenticated);
	if (rateLimitResult?.limited) {
		return NextResponse.json(
			{ success: false, error: 'Too many requests. Please try again later.' },
			{
				status: 429,
				headers: {
					'Retry-After': String(rateLimitResult.resetIn),
					'X-RateLimit-Limit': String(rateLimitResult.limit),
					'X-RateLimit-Remaining': '0',
					'X-RateLimit-Reset': String(rateLimitResult.resetIn),
				},
			}
		);
	}

	// Allow public routes: exact-match entries, plus the asset trees that are
	// requested by arbitrary path (ADR-0014).
	const isPublicRoute =
		PUBLIC_PATHS[pathname] === true ||
		PUBLIC_ASSET_PREFIXES.some(
			(prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
		);

	if (isPublicRoute) {
		// If an authenticated user tries to access /signin, redirect to dashboard
		if (pathname === '/signin' && isAuthenticated) {
			const url = req.nextUrl.clone();
			url.pathname = '/dashboard';
			return NextResponse.redirect(url);
		}
		return NextResponse.next();
	}

	// Real validation (ADR-0011): SHA-256 the cookie and require a live row in
	// `sessions` for an active, non-deleted user. Cached 60 s per instance; a
	// DB error denies unless a fresh cached verdict exists.
	if (!isAuthenticated) {
		// API requests get 401 JSON response
		if (pathname.startsWith('/api')) {
			return NextResponse.json(
				{ success: false, message: 'Unauthorized' },
				{ status: 401 }
			);
		}
		// Page requests redirect to signin
		const url = req.nextUrl.clone();
		url.pathname = '/signin';
		url.searchParams.set('from', pathname);
		return NextResponse.redirect(url);
	}

	// Admin route gating moved server-side to src/app/admin/layout.tsx
	// (DB-backed is_super_admin / role check instead of the forgeable cookie).

	// Add cache control headers to prevent caching of protected pages
	const response = NextResponse.next();
	response.headers.set('Cache-Control', 'no-store, must-revalidate');
	response.headers.set('Pragma', 'no-cache');

	// Add rate limit headers for API routes
	if (rateLimitResult && pathname.startsWith('/api')) {
		response.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
		response.headers.set(
			'X-RateLimit-Remaining',
			String(rateLimitResult.remaining)
		);
		response.headers.set('X-RateLimit-Reset', String(rateLimitResult.resetIn));
	}

	return response;
}

// Configure which paths the proxy runs on
// Keep matcher minimal: only skip Next internals. Public vs protected
// is decided inside proxy() via PUBLIC_PATHS/PUBLIC_ASSET_PREFIXES, not here.
export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
