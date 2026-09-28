import { describe, it, expect, vi } from 'vitest';
import {
	SESSION_TTL_SECONDS,
	createSessionToken,
	hashSessionToken,
	createSession,
	revokeSession,
	revokeAllUserSessions,
} from '@/utils/session';

describe('session token helpers', () => {
	it('creates a 64-char hex token (256 bits)', () => {
		const token = createSessionToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('hashes to 64 hex chars, differing from the token, deterministically', () => {
		const token = createSessionToken();
		const hash = hashSessionToken(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toBe(token);
		expect(hashSessionToken(token)).toBe(hash);
	});
});

const makeDb = () => ({ execute: vi.fn().mockResolvedValue([[], {}]) });

describe('createSession', () => {
	it('stores only the token hash and runs bounded expiry cleanup', async () => {
		const db = makeDb();
		const token = await createSession(db, 7);

		expect(db.execute).toHaveBeenCalledTimes(2);

		const [insertSql, insertParams] = db.execute.mock.calls[0];
		expect(insertSql).toContain('INSERT INTO sessions');
		expect(insertParams[0]).toBe(hashSessionToken(token));
		expect(insertParams[1]).toBe(7);
		expect(insertParams[2]).toBe(SESSION_TTL_SECONDS);
		// The raw token must never be written to the DB.
		expect(JSON.stringify(insertParams)).not.toContain(token);

		const [cleanupSql, cleanupParams] = db.execute.mock.calls[1];
		expect(cleanupSql).toContain('DELETE FROM sessions');
		expect(cleanupParams).toEqual([7]);
	});

	it('returns a token whose hash matches the INSERT param', async () => {
		const db = makeDb();
		const token = await createSession(db, 1);
		const insertParams = db.execute.mock.calls[0][1];
		expect(hashSessionToken(token)).toBe(insertParams[0]);
	});
});

describe('revokeSession', () => {
	it('returns the row user_id and deletes the row', async () => {
		const db = {
			execute: vi
				.fn()
				.mockResolvedValueOnce([[{ user_id: 42 }], {}])
				.mockResolvedValueOnce([[], {}]),
		};

		const userId = await revokeSession(db, 'raw-token');

		expect(userId).toBe(42);
		expect(db.execute).toHaveBeenCalledTimes(2);
		const [selectSql, selectParams] = db.execute.mock.calls[0];
		expect(selectSql).toContain('SELECT user_id FROM sessions');
		expect(selectParams).toEqual([hashSessionToken('raw-token')]);
		const [deleteSql, deleteParams] = db.execute.mock.calls[1];
		expect(deleteSql).toContain('DELETE FROM sessions');
		expect(deleteParams).toEqual([hashSessionToken('raw-token')]);
	});

	it('returns null when no row matches', async () => {
		const db = { execute: vi.fn().mockResolvedValue([[], {}]) };
		const userId = await revokeSession(db, 'unknown-token');
		expect(userId).toBeNull();
		// Still attempts the DELETE (idempotent).
		expect(db.execute).toHaveBeenCalledTimes(2);
	});
});

describe('revokeAllUserSessions', () => {
	it('deletes every session row for the user', async () => {
		const db = makeDb();
		await revokeAllUserSessions(db, 5);
		expect(db.execute).toHaveBeenCalledTimes(1);
		const [sql, params] = db.execute.mock.calls[0];
		expect(sql).toContain('DELETE FROM sessions WHERE user_id = ?');
		expect(params).toEqual([5]);
	});
});
