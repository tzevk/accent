import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { endUserSession } from '@/utils/work-session-close';

/**
 * POST /api/work-sessions/close
 *
 * The page-close beacon (ticket #331). When the dashboard tab or window goes
 * away without a Sign out, the browser posts here from `pagehide` and the
 * caller's open Work Session is ended, stamped with the close time the browser
 * reports. An end the browser could not time out is stamped by the database
 * instead, so a beacon never leaves a session open.
 *
 * Auth: the session cookie (`getCurrentUser`). No permission gate — any
 * signed-in user may end their own session, and the user always comes from the
 * session, never the body, so a caller can only ever end their own. This route
 * is therefore NOT on the ADR-0014 public allowlist and `src/proxy.ts` is
 * unchanged.
 *
 * Idempotent: only active sessions are ended, so a duplicate beacon — or one
 * that arrives after the logout already ended the session — writes nothing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A close time the browser reported, or null when it is absent or unusable. */
function parseReportedClose(body: unknown): Date | null {
	if (!body || typeof body !== 'object' || !('closedAt' in body)) return null;
	const value: unknown = body.closedAt;
	if (typeof value !== 'string' || value === '') return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: Request) {
	// Auth marker for `npm run check:route-auth` (route-guard sweep): the
	// handler authorizes through the session before it touches the database.
	const currentUser = await getCurrentUser(request);
	if (!currentUser) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	let reportedClose: Date | null = null;
	try {
		const text = await request.text();
		if (text.trim() !== '')
			reportedClose = parseReportedClose(JSON.parse(text));
	} catch (error) {
		// A beacon is best-effort: an unreadable body still ends the session,
		// stamped by the database rather than lost.
		console.warn('Work session close: unreadable beacon body', error);
	}

	await endUserSession(currentUser.id, {
		endSource: 'beacon',
		endedAt: reportedClose,
	});

	return NextResponse.json({ success: true });
}
