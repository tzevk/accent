// Shared HTTP helpers for safe JSON parsing and consistent error handling

export async function parseJSONSafe(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    const text = await response.text();
    throw new Error(text?.slice(0, 300) || `HTTP ${response.status}`);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Received a non-JSON response from server');
    }
    throw e;
  }
}

export async function fetchJSON(url, options) {
  // Lightweight in-memory cache for GET requests to reduce repeated identical fetches
  // Usage: fetchJSON('/api/xyz', { cacheTTL: 5000 }) // TTL in ms
  const isGet = !options || (options && (!options.method || options.method.toUpperCase() === 'GET'));
  const cacheTTL = options && typeof options.cacheTTL === 'number' ? options.cacheTTL : 0; // ms

  if (!globalThis.__fetchJSON_cache) globalThis.__fetchJSON_cache = new Map();
  const cache = globalThis.__fetchJSON_cache;
  const cacheKey = url + (options && options.cacheKey ? `|${options.cacheKey}` : '');

  if (isGet && cacheTTL > 0) {
    const entry = cache.get(cacheKey);
    if (entry && entry.expires > Date.now()) {
      return entry.data;
    }
  }

  const res = await fetch(url, options);
  const data = await parseJSONSafe(res);
  if (!res.ok || data?.success === false) {
    const errMsg = data?.error || data?.message || `Request failed (${res.status})`;
    const details = data?.details;
    throw new Error(details ? `${errMsg}: ${details}` : errMsg);
  }

  if (isGet && cacheTTL > 0) {
    try {
      cache.set(cacheKey, { data, expires: Date.now() + cacheTTL });
      // Trim cache if it grows too large
      if (cache.size > 500) {
        // remove oldest entries
        const keys = cache.keys();
        for (let i = 0; i < 100; i++) {
          const k = keys.next().value;
          if (!k) break;
          cache.delete(k);
        }
      }
    } catch {
      // ignore cache failures
    }
  }
  return data;
}
