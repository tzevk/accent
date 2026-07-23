import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { logActivity } from '@/utils/activity-logger';
import { getDefaultPermissionsForLevel, mergePermissions } from '@/utils/rbac';

// Helper to safely parse JSON
function safeParse(json, fallback = []) {
	try {
		if (!json) return fallback;
		if (typeof json === 'object') return json;
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

export async function POST(req) {
	let db = null;
	try {
		let body = null;
		try {
			body = await req.json();
		} catch {
			return NextResponse.json(
				{ success: false, message: 'Invalid request body' },
				{ status: 400 }
			);
		}

		const identifier = body?.username || body?.email;
		const password = body?.password;

		if (!identifier || !password) {
			return NextResponse.json(
				{ success: false, message: 'Username/Email and password required' },
				{ status: 400 }
			);
		}

		try {
			db = await dbConnect();
		} catch (err) {
			console.error('Login DB connect failed:', err);
			const isNet = [
				'ETIMEDOUT',
				'ECONNREFUSED',
				'ENOTFOUND',
				'DB_CONNECTION_FAILED',
				'PROTOCOL_CONNECTION_LOST',
			].includes(err?.code);
			return NextResponse.json(
				{
					success: false,
					message: isNet
						? 'Database temporarily unavailable. Please try again shortly.'
						: 'Server error',
				},
				{ status: isNet ? 503 : 500 }
			);
		}

		// Single query: fetch user + role permissions in one round trip.
		// Only selects needed columns (avoids fetching large JSON blobs).
		let rows = [];
		try {
			const [qRows] = await db.execute(
				`SELECT u.id, u.username, u.email, u.full_name, u.role_id,
              u.is_super_admin, u.is_active,
              u.permissions AS user_permissions,
              u.field_permissions AS user_field_permissions,
              r.permissions AS role_permissions,
              r.role_hierarchy
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE (u.username = ? OR u.email = ?)
         AND u.password_hash = ?
         AND u.isDelete = 0
       LIMIT 1`,
				[identifier, identifier, password]
			);
			rows = qRows || [];

			if (rows.length > 0) {
				const user = rows[0];
				const userId = user.id;

				try {
					await db.execute(
						'UPDATE users SET last_login = NOW(), is_active = TRUE, status = "active" WHERE id = ?',
						[userId]
					);

					logActivity({
						userId,
						actionType: 'login',
						description: `User ${user.username} logged in successfully`,
						request: req,
						status: 'success',
					}).catch(console.error);
				} catch (err) {
					console.warn(
						'Failed to update last_login for user',
						userId,
						err?.code || err?.message || err
					);
				}
			} else {
				logActivity({
					userId: 0,
					actionType: 'login',
					description: `Failed login attempt for identifier: ${identifier}`,
					details: { identifier },
					request: req,
					status: 'failed',
				}).catch(console.error);
			}
		} catch (err) {
			console.error('Login query failed:', err);
			if (db) {
				try {
					await db.end();
				} catch {}
			}
			return NextResponse.json(
				{ success: false, message: 'Server error' },
				{ status: 500 }
			);
		}

		if (rows.length > 0) {
			const user = rows[0];
			const userId = user.id;
			const isSuperAdmin =
				user.is_super_admin === 1 || user.is_super_admin === true;

			// Merge permissions from user + role (fetched in the same query)
			const userPermissions = safeParse(user.user_permissions, []);
			let rolePermissions = safeParse(user.role_permissions, []);

			if (
				(!rolePermissions || rolePermissions.length === 0) &&
				typeof user.role_hierarchy === 'number'
			) {
				try {
					rolePermissions =
						getDefaultPermissionsForLevel(user.role_hierarchy) || [];
				} catch {}
			}

			const permissions = mergePermissions(rolePermissions, userPermissions);
			const fieldPermissions = safeParse(user.user_field_permissions, {});

			if (db) {
				try {
					await db.end();
				} catch {}
			}

			const userData = {
				id: userId,
				username: user.username,
				email: user.email,
				full_name: user.full_name || user.username,
				role_id: user.role_id,
				is_super_admin: isSuperAdmin,
				permissions: permissions,
				merged_permissions: permissions,
				field_permissions: fieldPermissions,
			};

			const res = NextResponse.json({
				success: true,
				message: 'Login successful',
				is_super_admin: isSuperAdmin,
				user: userData,
			});
			const forwardedProto = req.headers.get('x-forwarded-proto');
			const proto =
				forwardedProto ||
				(req.nextUrl?.protocol
					? req.nextUrl.protocol.replace(':', '')
					: 'http');
			const isSecure = proto === 'https';

			res.cookies.set('auth', '1', {
				httpOnly: true,
				sameSite: 'lax',
				secure: isSecure,
				path: '/',
				priority: 'high',
			});

			res.cookies.set('user_id', String(userId), {
				httpOnly: true,
				sameSite: 'lax',
				secure: isSecure,
				path: '/',
				priority: 'high',
			});

			res.cookies.set('is_super_admin', isSuperAdmin ? '1' : '0', {
				httpOnly: true,
				sameSite: 'lax',
				secure: isSecure,
				path: '/',
				priority: 'high',
			});

			return res;
		}

		if (db) {
			try {
				await db.end();
			} catch {}
		}

		return NextResponse.json(
			{ success: false, message: 'Invalid credentials' },
			{ status: 401 }
		);
	} catch (error) {
		console.error('Login error:', error);
		return NextResponse.json(
			{ success: false, message: 'Server error' },
			{ status: 500 }
		);
	}
}
