import crypto from 'crypto';
import { queryProxy } from './proxy-db';

// ═══════════════════════════════════════════════════════════════════════════
// Session probe (ADR-0011)
//
// proxy.ts validates the `session` cookie against MySQL before routing: the
// cookie is hashed and looked up in `sessions` joined to an active user, so a
// forged cookie no longer reaches a handler. The result is cached per proxy
// instance for 60 s (ADR-0013's staleness bound); a DB error serves a
// still-fresh cache entry when there is one and denies otherwise, so the
// proxy fails closed but does not lock everyone out on a blip.
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_SIZE = 500;
const CACHE_EVICT_COUNT = 100;

// Mirrors src/utils/api-permissions.js `_fetchUserFromDb`: same token hash,
// same expiry/isDelete/active-user predicate. Duplicated on purpose — the
// proxy must not share modules with the handlers (ADR-0011).
const SESSION_LOOKUP_SQL = `
  SELECT s.user_id, u.is_active, u.status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = ?
     AND s.expires_at > NOW()
     AND u.isDelete = 0
   LIMIT 1`;

interface SessionRow {
	user_id: number;
	is_active: number | boolean | null;
	status: string | null;
}

interface CacheEntry {
	valid: boolean;
	expiresAt: number;
}

const sessionCache = new Map<string, CacheEntry>();

/** SHA-256 hex of the cookie value — the digest stored in sessions.token_hash. */
export function hashSessionToken(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

function isActiveUser(row: SessionRow): boolean {
	return (
		(row.is_active === null || row.is_active === 1 || row.is_active === true) &&
		(row.status === 'active' || !row.status)
	);
}

function remember(tokenHash: string, valid: boolean): void {
	if (sessionCache.size >= CACHE_MAX_SIZE) {
		// Map iterates in insertion order — drop the oldest entries.
		let remaining = CACHE_EVICT_COUNT;
		for (const key of sessionCache.keys()) {
			sessionCache.delete(key);
			if (--remaining === 0) break;
		}
	}
	sessionCache.set(tokenHash, {
		valid,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
}

/**
 * True when the cookie names a live session belonging to an active user.
 * Never throws: an unreachable DB serves a fresh cached verdict if there is
 * one, and denies otherwise.
 */
export async function isSessionValid(
	token: string | undefined | null
): Promise<boolean> {
	if (!token) return false;

	const tokenHash = hashSessionToken(token);
	const cached = sessionCache.get(tokenHash);
	if (cached && cached.expiresAt > Date.now()) return cached.valid;

	try {
		const rows = await queryProxy<SessionRow>(SESSION_LOOKUP_SQL, [tokenHash]);
		const valid = rows.length > 0 && isActiveUser(rows[0]);
		remember(tokenHash, valid);
		return valid;
	} catch (error) {
		console.error(
			'[proxy] session probe failed, denying request:',
			error instanceof Error ? error.message : error
		);
		const fallback = sessionCache.get(tokenHash);
		if (fallback && fallback.expiresAt > Date.now()) return fallback.valid;
		return false;
	}
}
