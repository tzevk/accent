/**
 * Shared disposable identity for browser session/permission journeys.
 *
 * Each call creates one ordinary active user with a bcrypt password and either:
 *
 * - a custom, namespaced role that carries exactly the requested permissions
 *   (the default); fewer permissions never fall back to hierarchy defaults, so
 *   a user created with `[]` has no rights at all;
 * - or, when `{ admin: true }` is requested, the read-only `admin` reference
 *   role owned by `e2e/fixtures/hooks.ts`, with the requested permissions
 *   added directly to the user. The reference role is never created, modified,
 *   or replaced here, and this fixture never seeds a super admin.
 *
 * Cleanup deletes the user's sessions first, then the tracked user row, then a
 * custom role only when this call created it and no user still references it.
 * A partially created identity cleans up after itself before rethrowing.
 */
import { randomBytes } from 'node:crypto';
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { hashFixturePassword } from '../../scripts/leads-integration/support.ts';

const ADMIN_ROLE_CODE = 'admin';

export interface JourneyUserOptions {
	/**
	 * Reuse the hook-seeded `admin` role for shell access instead of a custom
	 * role. Only for pages whose gate is the role code, never to grant a
	 * permission a custom role can carry.
	 */
	admin?: boolean;
}

export interface JourneyUser {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it outside the test. */
	password: string;
	/** Delete owned sessions, user and role. Safe to call more than once. */
	dispose(): Promise<void>;
}

interface RoleRow extends RowDataPacket {
	id: number | string;
}

interface OwnedRows {
	userId: number | null;
	roleId: number | null;
	roleCode: string | null;
}

/**
 * Create the identity and return it only after every row exists. The caller
 * owns it and must `dispose()` in a `finally` block.
 */
export async function createJourneyUser(
	connection: Connection,
	namespace: string,
	permissions: readonly string[],
	options: JourneyUserOptions = {}
): Promise<JourneyUser> {
	const fixtureNamespace = namespace.trim();
	if (!fixtureNamespace) {
		throw new Error('[journey-user] namespace must not be empty.');
	}
	const requested = normalizePermissions(permissions);

	const username = fitIdentifier(fixtureNamespace, 50);
	const email = `${fitIdentifier(fixtureNamespace, 80).toLowerCase()}@e2e.invalid`;
	const password = randomBytes(24).toString('hex');
	const passwordHash = await hashFixturePassword(password);

	const owned: OwnedRows = {
		userId: null,
		roleId: null,
		roleCode: null,
	};

	let roleId: number;
	try {
		if (options.admin === true) {
			// The hook-seeded reference is reused, never owned or modified.
			roleId = await findReferenceAdminRole(connection);
		} else {
			const roleCode = fitIdentifier(`${fixtureNamespace}-role`, 50);
			const roleName = fitIdentifier(`E2E Journey ${fixtureNamespace}`, 255);
			// NULL hierarchy keeps the login route's legacy default-permission
			// fallback out of the way, so the role carries exactly `requested`.
			roleId = await insertRow(
				connection,
				`INSERT INTO roles_master (
            role_code, role_name, role_hierarchy, permissions, status
          ) VALUES (?, ?, NULL, ?, 'active')`,
				[roleCode, roleName, JSON.stringify(requested)]
			);
			owned.roleId = roleId;
			owned.roleCode = roleCode;
		}

		// Admin reuse leaves the reference role untouched and adds the
		// requested grants directly to this user. A custom role already owns
		// the grants, so its user has no direct permissions.
		const directPermissions = options.admin === true ? requested : [];
		const userId = await insertRow(
			connection,
			`INSERT INTO users (
          username, password_hash, email, full_name, status, role_id,
          permissions, is_active, isDelete, is_super_admin, account_type
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, 0, 0, 'employee')`,
			[
				username,
				passwordHash,
				email,
				username,
				roleId,
				JSON.stringify(directPermissions),
			]
		);
		owned.userId = userId;

		let disposed = false;
		return {
			userId,
			username,
			password,
			async dispose(): Promise<void> {
				if (disposed) return;
				await cleanupOwned(connection, owned);
				disposed = true;
			},
		};
	} catch (error) {
		try {
			await cleanupOwned(connection, owned);
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; journey-user fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

function normalizePermissions(permissions: readonly string[]): string[] {
	const unique = new Set<string>();
	for (const permission of permissions) {
		if (typeof permission !== 'string' || permission.trim() === '') {
			throw new Error(
				'[journey-user] every requested permission must be a non-empty string.'
			);
		}
		unique.add(permission);
	}
	return [...unique];
}

async function findReferenceAdminRole(connection: Connection): Promise<number> {
	const [rows] = await connection.execute<RoleRow[]>(
		`SELECT id
       FROM roles_master
      WHERE role_code = ?
      LIMIT 1`,
		[ADMIN_ROLE_CODE]
	);
	if (!rows[0]) {
		throw new Error(
			'[journey-user] no admin reference role exists; e2e/fixtures/hooks.ts must seed it before the app starts.'
		);
	}
	return Number(rows[0].id);
}

async function cleanupOwned(
	connection: Connection,
	owned: OwnedRows
): Promise<void> {
	if (owned.userId !== null) {
		await connection.execute('DELETE FROM sessions WHERE user_id = ?', [
			owned.userId,
		]);
		await connection.execute('DELETE FROM users WHERE id = ?', [owned.userId]);
	}
	if (owned.roleId !== null && owned.roleCode !== null) {
		await connection.execute(
			`DELETE FROM roles_master
        WHERE id = ?
          AND role_code = ?
          AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = ?)`,
			[owned.roleId, owned.roleCode, owned.roleId]
		);
	}
}

async function insertRow(
	connection: Connection,
	sql: string,
	params: ExecuteValues[]
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(sql, params);
	return Number(result.insertId);
}
