import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password.
 * Returns the bcrypt hash string (includes salt).
 */
export async function hashPassword(plaintext: string): Promise<string> {
	return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored hash.
 * Handles both bcrypt hashes and legacy plaintext (pre-migration).
 * Returns `true` if the password matches.
 */
export async function verifyPassword(
	plaintext: string,
	hash: string
): Promise<boolean> {
	if (needsRehash(hash)) {
		// Legacy plaintext — direct comparison
		return plaintext === hash;
	}
	return bcrypt.compare(plaintext, hash);
}

/**
 * Returns `true` if the stored hash is NOT a bcrypt hash
 * (i.e. it's a legacy plaintext password that needs upgrading).
 */
export function needsRehash(hash: string): boolean {
	return !hash.startsWith('$2');
}
