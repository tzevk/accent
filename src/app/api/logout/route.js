import { NextResponse } from 'next/server';
import { logActivity } from '@/utils/activity-logger';
import { endUserSession } from '@/utils/work-session-close';
import { invalidateUserCache } from '@/utils/api-permissions';
import { cookies } from 'next/headers';
import { dbConnect } from '@/utils/database';
import { revokeSession } from '@/utils/session';

export async function POST(req) {
	// Get session token from cookie before clearing
	const cookieStore = await cookies();
	const sessionToken = cookieStore.get('session')?.value;

	let userId = null;
	if (sessionToken) {
		let db;
		try {
			db = await dbConnect();
			userId = await revokeSession(db, sessionToken);
		} catch (error) {
			console.error('Logout session revocation failed:', error);
		} finally {
			if (db) {
				try {
					db.release();
				} catch {
					/* ignore */
				}
			}
		}
	}

	if (userId) {
		// Evict the cached user keyed by this token's hash — otherwise a replayed
		// cookie stays authenticated for up to USER_CACHE_TTL (60 s) after the
		// session row is deleted.
		invalidateUserCache(userId);

		// Log logout activity
		logActivity({
			userId,
			actionType: 'logout',
			description: 'User logged out',
			request: req,
			status: 'success',
		}).catch(console.error);

		// End work session — the shared close path, marked as a real logout so
		// the Punch Out tile can tell it apart from a sweep- or beacon-stamped
		// end (ticket #331).
		endUserSession(userId, { endSource: 'logout' }).catch(console.error);
	}

	const res = NextResponse.json({
		success: true,
		message: 'Logged out successfully',
	});
	const forwardedProto = req.headers.get('x-forwarded-proto');
	const proto =
		forwardedProto ||
		(req.nextUrl?.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
	const isSecure = proto === 'https';
	const baseCookie = {
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		path: '/',
	};

	res.cookies.set('session', '', { ...baseCookie, maxAge: 0 });

	return res;
}
