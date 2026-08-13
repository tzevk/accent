import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	invalidateUserCache,
	canModifyTargetUser,
	RESOURCES as API_RESOURCES,
	PERMISSIONS as API_PERMISSIONS,
} from '@/utils/api-permissions';
import { hashPassword } from '@/utils/password';
import { revokeAllUserSessions } from '@/utils/session';

// POST - reset user password
export async function POST(request) {
	let db;
	try {
		// RBAC: update users permission required to reset password
		const auth = await ensurePermission(
			request,
			API_RESOURCES.USERS,
			API_PERMISSIONS.UPDATE
		);
		if (auth instanceof Response) return auth;

		const data = await request.json();
		const { user_id, new_password } = data;

		if (!user_id) {
			return NextResponse.json(
				{ success: false, error: 'User ID is required' },
				{ status: 400 }
			);
		}

		if (!new_password) {
			return NextResponse.json(
				{ success: false, error: 'New password is required' },
				{ status: 400 }
			);
		}

		if (new_password.length < 6) {
			return NextResponse.json(
				{ success: false, error: 'Password must be at least 6 characters' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// Verify user exists
		// Verify user exists and check target access
		const [existing] = await db.execute(
			`SELECT u.id, u.username, u.is_super_admin, u.role_id, r.role_hierarchy
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.id = ? AND u.isDelete = 0 LIMIT 1`,
			[user_id]
		);
		if (!existing || existing.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'User not found' },
				{ status: 404 }
			);
		}

		const targetCheck = canModifyTargetUser(auth.user, existing[0]);
		if (!targetCheck.allowed) {
			return NextResponse.json(
				{ success: false, error: targetCheck.reason },
				{ status: 403 }
			);
		}

		// Hash the password with bcrypt before storing
		const hashed = await hashPassword(new_password);
		await db.execute(
			'UPDATE users SET password_hash = ?, last_password_change = CURRENT_TIMESTAMP WHERE id = ?',
			[hashed, user_id]
		);

		// SEC-14: revoke every existing session so the old password's
		// sessions are invalidated immediately. Sweep the in-memory user cache
		// so revoked sessions stop authenticating right away.
		await revokeAllUserSessions(db, user_id);
		invalidateUserCache(user_id);

		return NextResponse.json({
			success: true,
			message: `Password reset successfully for user "${existing[0].username}"`,
		});
	} catch (error) {
		console.error('Error resetting password:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to reset password' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
