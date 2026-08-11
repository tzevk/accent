import { NextResponse } from 'next/server';
import { logActivity, endUserSession } from '@/utils/activity-logger';
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
		// Log logout activity
		logActivity({
			userId,
			actionType: 'logout',
			description: 'User logged out',
			request: req,
			status: 'success',
		}).catch(console.error);

		// End work session
		endUserSession(userId).catch(console.error);
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
