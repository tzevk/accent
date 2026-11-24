import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';
import {
	hasAllProjectScope,
	loadLeadPolicy,
	resolveProjectRights,
} from '@/lib/project-rights';

// Disable caching for session endpoint
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
	try {
		const user = await getCurrentUser(req);
		if (!user) {
			return NextResponse.json({ authenticated: false });
		}

		const hasProjectAccess = await canOpenAnyProject(user);
		return NextResponse.json({
			authenticated: true,
			user: { ...user, hasProjectAccess },
		});
	} catch (error) {
		console.error('[Session] Error:', error.message);
		return NextResponse.json({ authenticated: false }, { status: 500 });
	}
}

// This flag controls navigation only. Project routes still authorize each request.
async function canOpenAnyProject(user) {
	if (user.is_super_admin || hasAllProjectScope(user)) return true;

	let db;
	try {
		db = await dbConnect();
		const [rows] = await db.execute(
			'SELECT project_id, project_team FROM projects WHERE isDelete = 0'
		);
		const leadPolicy = await loadLeadPolicy(db);

		return rows.some((project) => {
			try {
				return resolveProjectRights({ user, project, leadPolicy }).canOpen;
			} catch (error) {
				console.warn('[Session] Project rights resolution failed', error);
				return false;
			}
		});
	} catch (error) {
		console.warn('[Session] Projects access lookup failed', error);
		return false;
	} finally {
		try {
			db?.release();
		} catch {
			// Releasing the pool connection cannot change the access decision.
		}
	}
}
