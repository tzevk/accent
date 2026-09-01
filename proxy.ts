import { NextResponse, type NextRequest } from 'next/server';

// Define paths that do NOT require authentication
const publicPaths = [
	'/signin',
	'/api/login',
	'/api/logout',
	'/api/auth',
	'/api/session',
	// Smart Office's outbound webhook sends no session cookie; the real
	// auth boundary is the Bearer check inside the route handler.
	'/api/attendance/webhook',
	'/_next',
	'/favicon.ico',
	'/robots.txt',
	'/sitemap.xml',
	'/manifest.webmanifest',
	'/accent-logo.png',
	'/public',
	'/uploads',
];

function isPublicPath(pathname: string) {
	return publicPaths.some(
		(p) => pathname === p || pathname.startsWith(p + '/')
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory rate limiter (runtime-agnostic; Next 16 proxy runs on Node.js)
// ═══════════════════════════════════════════════════════════════════════════
interface RateLimitEntry {
	count: number;
	windowStart: number;
	blockedUntil: number | null;
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
};

function getClientIP(req: NextRequest): string {
	const forwarded = req.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	const cfConnecting = req.headers.get('cf-connecting-ip');
	if (cfConnecting) return cfConnecting.trim();
	const trueClientIp = req.headers.get('true-client-ip');
	if (trueClientIp) return trueClientIp.trim();
	const clientIp = req.headers.get('x-client-ip');
	if (clientIp) return clientIp.trim();
	const realIP = req.headers.get('x-real-ip');
	if (realIP) return realIP;
	const vercelIP = req.headers.get('x-vercel-forwarded-for');
	if (vercelIP) return vercelIP.split(',')[0].trim();
	return 'unknown';
}

function getRateLimitCategory(pathname: string): keyof typeof RATE_LIMITS {
	if (
		pathname.startsWith('/api/login') ||
		pathname.startsWith('/api/logout') ||
		pathname.startsWith('/api/auth')
	) {
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

function checkRateLimit(req: NextRequest): {
	limited: boolean;
	remaining: number;
	resetIn: number;
	limit: number;
	category: keyof typeof RATE_LIMITS;
} | null {
	const pathname = req.nextUrl.pathname;

	// Only rate limit API routes
	if (!pathname.startsWith('/api')) return null;

	// Don't rate limit preflight requests
	if (req.method === 'OPTIONS') return null;

	const ip = getClientIP(req);
	const category = getRateLimitCategory(pathname);
	const config = RATE_LIMITS[category];
	const sessionValue = req.cookies.get('session')?.value;
	const keyIdentity = sessionValue ? `${ip}:${sessionValue}` : ip;

	const key = `${keyIdentity}:${category}`;
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
		const maxWindowMs = Math.max(
			...Object.values(RATE_LIMITS).map((config) => config.windowMs)
		);
		if (
			entry.windowStart + maxWindowMs * 2 < now &&
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
}

/**
 * Proxy - Single source of truth for authentication (Next 16 renamed the
 * `middleware` file convention to `proxy`; it runs on the Node.js runtime)
 *
 * This is the ONLY place where auth is enforced:
 * 1. Rate limiting for API routes
 * 2. Public routes are allowed through
 * 3. Authenticated users on /signin are redirected to /dashboard
 * 4. Unauthenticated users are redirected to /signin
 * 5. Admin gating happens server-side in src/app/admin/layout.tsx
 *
 * NOTE: The proxy only checks cookie presence — by design, not limitation.
 * The session token is validated against the sessions table in Node
 * (getCurrentUser / getServerAuth) on every API route and server layout.
 */
export function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;

	// Cleanup old rate limit entries periodically
	cleanupRateLimitStore();

	// Rate limiting for API routes
	const rateLimitResult = checkRateLimit(req);
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

	// Presence check only — real validation happens in Node via getCurrentUser
	// (Edge cannot reach MySQL). A forgeable cookie here buys nothing: without a
	// matching row in the sessions table every API route and server layout 401s.
	const isAuthenticated = !!req.cookies.get('session')?.value;

	// Allow public routes
	if (isPublicPath(pathname)) {
		// If authenticated user tries to access /signin, redirect to dashboard
		if (pathname === '/signin' && isAuthenticated) {
			const url = req.nextUrl.clone();
			url.pathname = '/dashboard';
			return NextResponse.redirect(url);
		}
		return NextResponse.next();
	}

	// All other routes require authentication
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
// is decided inside proxy() via isPublicPath(), not by the matcher.
export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
