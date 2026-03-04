/**
 * In-memory rate limiter for API endpoints
 * 
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Per-IP tracking with automatic cleanup
 * - Configurable limits per endpoint category
 * - Memory-efficient with LRU-style eviction
 */

// Rate limit configurations by endpoint category
export const RATE_LIMITS = {
  // Auth endpoints - strict limits to prevent brute force
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,          // 10 attempts per window
    blockDurationMs: 30 * 60 * 1000 // Block for 30 minutes after exceeding
  },
  // Dashboard/stats endpoints - moderate limits
  dashboard: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 30,          // 30 requests per minute
    blockDurationMs: 60 * 1000
  },
  // General API endpoints - standard limits
  api: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 100,         // 100 requests per minute
    blockDurationMs: 60 * 1000
  },
  // Heavy operations (exports, reports) - strict limits
  heavy: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 5,           // 5 requests per minute
    blockDurationMs: 2 * 60 * 1000
  }
};

// In-memory store for rate limiting
// Structure: Map<key, { count, windowStart, blockedUntil }>
const store = new Map();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_ENTRIES = 10000; // Prevent unbounded growth

let cleanupTimer = null;

function startCleanup() {
  if (cleanupTimer) return;
  
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let deleted = 0;
    
    for (const [key, entry] of store.entries()) {
      // Remove entries where the window has expired and not blocked
      if (entry.windowStart + RATE_LIMITS.api.windowMs * 2 < now && 
          (!entry.blockedUntil || entry.blockedUntil < now)) {
        store.delete(key);
        deleted++;
      }
    }
    
    // If still too many entries, remove oldest ones
    if (store.size > MAX_ENTRIES) {
      const entries = Array.from(store.entries());
      entries.sort((a, b) => a[1].windowStart - b[1].windowStart);
      const toDelete = entries.slice(0, store.size - MAX_ENTRIES + 1000);
      toDelete.forEach(([key]) => store.delete(key));
    }
    
    if (deleted > 0) {
      console.log(`[RateLimiter] Cleaned up ${deleted} expired entries, ${store.size} remaining`);
    }
  }, CLEANUP_INTERVAL);
  
  // Don't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

// Start cleanup on module load
startCleanup();

/**
 * Extract client IP from request
 */
export function getClientIP(request) {
  // Check common proxy headers
  const forwarded = request.headers.get?.('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIP = request.headers.get?.('x-real-ip');
  if (realIP) return realIP;
  
  // Vercel-specific
  const vercelIP = request.headers.get?.('x-vercel-forwarded-for');
  if (vercelIP) return vercelIP.split(',')[0].trim();
  
  // Fallback (may not be available in all environments)
  return request.ip || 'unknown';
}

/**
 * Get rate limit category based on pathname
 */
export function getRateLimitCategory(pathname) {
  if (pathname.startsWith('/api/login') || 
      pathname.startsWith('/api/logout') ||
      pathname.startsWith('/api/auth')) {
    return 'auth';
  }
  
  if (pathname.includes('dashboard-stats') || 
      pathname.includes('manhours-stats') ||
      pathname.startsWith('/api/analytics')) {
    return 'dashboard';
  }
  
  if (pathname.includes('export') || 
      pathname.includes('report') ||
      pathname.includes('bulk')) {
    return 'heavy';
  }
  
  return 'api';
}

/**
 * Check if request is rate limited
 * 
 * @param {Request} request - The incoming request
 * @param {string} [category] - Rate limit category (auto-detected if not provided)
 * @returns {{ limited: boolean, remaining: number, resetIn: number, headers: Headers }}
 */
export function checkRateLimit(request, category) {
  const ip = getClientIP(request);
  const pathname = new URL(request.url).pathname;
  const cat = category || getRateLimitCategory(pathname);
  const config = RATE_LIMITS[cat] || RATE_LIMITS.api;
  
  const key = `${ip}:${cat}`;
  const now = Date.now();
  
  let entry = store.get(key);
  
  // Check if blocked
  if (entry?.blockedUntil && entry.blockedUntil > now) {
    const resetIn = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      limited: true,
      remaining: 0,
      resetIn,
      retryAfter: resetIn,
      headers: createRateLimitHeaders(0, config.maxRequests, resetIn)
    };
  }
  
  // Initialize or reset window
  if (!entry || entry.windowStart + config.windowMs < now) {
    entry = { count: 0, windowStart: now, blockedUntil: null };
    store.set(key, entry);
  }
  
  entry.count++;
  
  // Check if over limit
  if (entry.count > config.maxRequests) {
    entry.blockedUntil = now + config.blockDurationMs;
    const resetIn = Math.ceil(config.blockDurationMs / 1000);
    
    console.warn(`[RateLimiter] IP ${ip} blocked for ${cat} - ${entry.count} requests in window`);
    
    return {
      limited: true,
      remaining: 0,
      resetIn,
      retryAfter: resetIn,
      headers: createRateLimitHeaders(0, config.maxRequests, resetIn)
    };
  }
  
  const remaining = config.maxRequests - entry.count;
  const resetIn = Math.ceil((entry.windowStart + config.windowMs - now) / 1000);
  
  return {
    limited: false,
    remaining,
    resetIn,
    headers: createRateLimitHeaders(remaining, config.maxRequests, resetIn)
  };
}

/**
 * Create standard rate limit headers
 */
function createRateLimitHeaders(remaining, limit, resetIn) {
  const headers = new Headers();
  headers.set('X-RateLimit-Limit', String(limit));
  headers.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  headers.set('X-RateLimit-Reset', String(resetIn));
  return headers;
}

/**
 * Apply rate limit headers to a response
 */
export function applyRateLimitHeaders(response, rateLimitResult) {
  if (!rateLimitResult?.headers) return response;
  
  for (const [key, value] of rateLimitResult.headers.entries()) {
    response.headers.set(key, value);
  }
  
  return response;
}

/**
 * Reset rate limit for a specific IP (useful for testing or admin override)
 */
export function resetRateLimit(ip, category = 'all') {
  if (category === 'all') {
    for (const cat of Object.keys(RATE_LIMITS)) {
      store.delete(`${ip}:${cat}`);
    }
  } else {
    store.delete(`${ip}:${category}`);
  }
}

/**
 * Get rate limit stats (for monitoring/debugging)
 */
export function getRateLimitStats() {
  const stats = {
    totalEntries: store.size,
    byCategory: {},
    blockedIPs: []
  };
  
  const now = Date.now();
  
  for (const [key, entry] of store.entries()) {
    const [ip, cat] = key.split(':');
    
    if (!stats.byCategory[cat]) {
      stats.byCategory[cat] = { count: 0, blocked: 0 };
    }
    stats.byCategory[cat].count++;
    
    if (entry.blockedUntil && entry.blockedUntil > now) {
      stats.byCategory[cat].blocked++;
      stats.blockedIPs.push({ ip, category: cat, unblockAt: new Date(entry.blockedUntil).toISOString() });
    }
  }
  
  return stats;
}
