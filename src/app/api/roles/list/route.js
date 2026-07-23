import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/roles/list
 *
 * Lightweight endpoint — returns id + role_name for all active roles.
 * Only requires authentication (no special permission) since it's used
 * by user-management UIs that already gate on users:read / users:update.
 */
export async function GET(request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	let db;
	try {
		db = await dbConnect();
		const [rows] = await db.execute(
			'SELECT id, role_name, role_code FROM roles_master WHERE status = ? ORDER BY role_name',
			['active']
		);
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching roles list:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch roles' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
