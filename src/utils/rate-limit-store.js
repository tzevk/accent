import { queryProxy } from './proxy-db.js';

// ═══════════════════════════════════════════════════════════════════════════
// DB-backed fixed-window rate-limit buckets (ADR-0013)
//
// `auth` (password guessing) and `heavy` (export/report/bulk) count here so
// hopping proxy instances cannot mint a fresh budget; the short-window
// categories stay in proxy.ts's in-memory Map. One row per
// (bucket_key, window_start) in `rate_limit_buckets`; the window is aligned to
// a fixed boundary so every instance agrees on when it ends.
//
// The window is fixed (not sliding): an attacker gets at most 2x the budget
// across a boundary, which is the tradeoff that buys one atomic upsert.
// ═══════════════════════════════════════════════════════════════════════════

const UPSERT_SQL = `
  INSERT INTO rate_limit_buckets (bucket_key, window_start, count)
  VALUES (?, ?, 1)
  ON DUPLICATE KEY UPDATE count = count + 1`;

const COUNT_SQL = `
  SELECT count FROM rate_limit_buckets
   WHERE bucket_key = ? AND window_start = ?`;

const DELETE_EXPIRED_SQL =
	'DELETE FROM rate_limit_buckets WHERE window_start < ?';

/**
 * Count one request against a fixed-window bucket and report the verdict.
 *
 * Returns `{ limited, count, remaining, resetIn, limit }` where `resetIn` is
 * the seconds left in the window (the 429's `Retry-After`) and `count` is the
 * window's total after this request (so the caller can log the first trip
 * without state). A DB error fails open — logged and allowed — because the
 * limiter must not turn a database hiccup into an outage; the login path's
 * bcrypt cost remains the backstop.
 */
export async function consumeRateLimitBucket({
	bucketKey,
	windowMs,
	maxRequests,
	now = Date.now(),
}) {
	const windowStart = Math.floor(now / windowMs) * windowMs;
	const resetIn = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));

	try {
		await queryProxy(UPSERT_SQL, [bucketKey, windowStart]);
		const rows = await queryProxy(COUNT_SQL, [bucketKey, windowStart]);
		const count = Number(rows?.[0]?.count ?? 1);

		return {
			limited: count > maxRequests,
			count,
			remaining: Math.max(0, maxRequests - count),
			resetIn,
			limit: maxRequests,
		};
	} catch (error) {
		console.error(
			'[RateLimit] bucket write failed, failing open:',
			error?.message ?? error
		);
		return {
			limited: false,
			count: 0,
			remaining: maxRequests,
			resetIn,
			limit: maxRequests,
		};
	}
}

/**
 * Drop buckets older than `retentionMs` (2x the largest limiter window).
 * Never throws — the sweep piggybacks on proxy.ts's cleanup interval.
 */
export async function deleteExpiredRateLimitBuckets(
	retentionMs,
	now = Date.now()
) {
	try {
		await queryProxy(DELETE_EXPIRED_SQL, [now - retentionMs]);
	} catch (error) {
		console.error(
			'[RateLimit] bucket cleanup failed:',
			error?.message ?? error
		);
	}
}
