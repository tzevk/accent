import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	DEFAULT_LEAD_POLICY,
	hasAllProjectScope,
	resolveProjectRights,
} from '@/lib/project-rights';

/**
 * GET /api/projects/access
 *
 * Answers one question for the navigation: may this actor open at least one
 * project workspace? Membership, lead designation, and scoped explicit grants
 * all count; financial or commercial permissions alone do not.
 *
 * Failures are closed — an error reports `hasAccess: false`.
 */
export async function GET(request) {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		if (user.is_super_admin || hasAllProjectScope(user)) {
			return NextResponse.json({
				success: true,
				data: { hasAccess: true },
			});
		}

		db = await dbConnect();
		const [rows] = await db.execute(
			'SELECT project_id, project_team FROM projects WHERE isDelete = 0'
		);

		const hasAccess = (rows || []).some((project) => {
			try {
				return resolveProjectRights({
					user,
					project,
					leadPolicy: DEFAULT_LEAD_POLICY,
				}).canOpen;
			} catch (error) {
				console.warn('[projects/access] rights resolution failed', error);
				return false;
			}
		});

		return NextResponse.json({
			success: true,
			data: { hasAccess },
		});
	} catch (error) {
		console.warn('[projects/access] lookup failed', error?.message || error);
		return NextResponse.json({
			success: true,
			data: { hasAccess: false },
		});
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}
