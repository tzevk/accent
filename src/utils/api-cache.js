/**
 * API Response Cache Utility
 * 
 * Provides in-memory caching for API responses with:
 * - Configurable TTL per cache key
 * - Automatic cleanup of expired entries
 * - Memory-efficient LRU-style eviction
 * - Support for user-specific and global caches
 */

// Cache storage: Map<key, { data, expiresAt, createdAt }>
const cache = new Map();

// Default TTL values for different cache categories (in milliseconds)
export const CACHE_TTL = {
  DASHBOARD_STATS: 30 * 1000,      // 30 seconds
  USER_DATA: 60 * 1000,            // 1 minute
  PERMISSIONS: 5 * 60 * 1000,      // 5 minutes
  STATIC_DATA: 10 * 60 * 1000,     // 10 minutes
  ANALYTICS: 2 * 60 * 1000,        // 2 minutes
};

const MAX_CACHE_SIZE = 1000;
let lastCleanup = 0;
const CLEANUP_INTERVAL = 60 * 1000; // Run cleanup at most once per minute

/**
 * Periodic cleanup of expired entries
 */
function cleanupIfNeeded() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  
  let expired = 0;
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < now) {
      cache.delete(key);
      expired++;
    }
  }
  
  // If still too large, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, cache.size - MAX_CACHE_SIZE + 100);
    toRemove.forEach(([key]) => cache.delete(key));
  }
}

/**
 * Generate a cache key
 * @param {string} prefix - Cache category prefix
 * @param {string|number} [identifier] - Optional identifier (e.g., user ID)
 * @param {object} [params] - Optional query parameters
 */
export function cacheKey(prefix, identifier, params) {
  let key = prefix;
  if (identifier) key += `:${identifier}`;
  if (params) {
    const sortedParams = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    if (sortedParams) key += `?${sortedParams}`;
  }
  return key;
}

/**
 * Get cached data if available and not expired
 * @param {string} key - Cache key
 * @returns {any|null} - Cached data or null if not found/expired
 */
export function getCache(key) {
  cleanupIfNeeded();
  
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

/**
 * Set cached data
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} [ttlMs] - TTL in milliseconds (default: 60 seconds)
 */
export function setCache(key, data, ttlMs = 60000) {
  cleanupIfNeeded();
  
  const now = Date.now();
  cache.set(key, {
    data,
    createdAt: now,
    expiresAt: now + ttlMs
  });
}

/**
 * Invalidate cache entries matching a pattern
 * @param {string|RegExp} pattern - Key prefix or regex to match
 */
export function invalidateCache(pattern) {
  if (typeof pattern === 'string') {
    // Invalidate all keys starting with pattern
    for (const key of cache.keys()) {
      if (key.startsWith(pattern)) {
        cache.delete(key);
      }
    }
  } else if (pattern instanceof RegExp) {
    for (const key of cache.keys()) {
      if (pattern.test(key)) {
        cache.delete(key);
      }
    }
  }
}

/**
 * Invalidate all cache entries
 */
export function clearAllCache() {
  cache.clear();
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  const now = Date.now();
  let expired = 0;
  let valid = 0;
  
  for (const entry of cache.values()) {
    if (entry.expiresAt < now) {
      expired++;
    } else {
      valid++;
    }
  }
  
  return {
    totalEntries: cache.size,
    validEntries: valid,
    expiredEntries: expired
  };
}

/**
 * Higher-order function to wrap an async function with caching
 * @param {string} keyPrefix - Cache key prefix
 * @param {Function} fn - Async function to wrap
 * @param {number} [ttlMs] - Cache TTL in milliseconds
 * @returns {Function} - Wrapped function that caches results
 */
export function withCache(keyPrefix, fn, ttlMs = 60000) {
  return async function cachedFn(...args) {
    // Generate cache key from arguments
    const argsKey = args.map(a => {
      if (a === null || a === undefined) return 'null';
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    }).join(':');
    
    const key = `${keyPrefix}:${argsKey}`;
    
    // Check cache
    const cached = getCache(key);
    if (cached !== null) {
      return cached;
    }
    
    // Execute function and cache result
    const result = await fn(...args);
    setCache(key, result, ttlMs);
    return result;
  };
}

/**
 * Create cache-aware NextResponse with proper headers
 * @param {object} data - Response data
 * @param {object} options - Options including cache settings
 * @returns {Response} - NextResponse with cache headers
 */
export function cachedResponse(data, options = {}) {
  const {
    status = 200,
    maxAge = 30,
    staleWhileRevalidate = 60,
    isPrivate = true,
    headers = {}
  } = options;
  
  const cacheControl = isPrivate 
    ? `private, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
    : `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
  
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      ...headers
    }
  });
}
